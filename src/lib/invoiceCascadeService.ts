import { db, doc, getDoc, getDocs, collection, deleteDoc, updateDoc, setDoc, query, where, serverTimestamp } from '../firebase';
import { ProviderFactory } from '../data/ProviderFactory';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { localDb } from './local-db';
import { Invoice, InvoiceItem, isPurchaseInvoice } from '../types';

export interface DeleteCascadeResult {
  success: boolean;
  error?: string;
  isPurchase: boolean;
  isSale: boolean;
  deletedItemsCount: number;
  affectedStockCount: number;
  deletedBatchCount: number;
}

/**
 * Normalizes an invoice number by stripping '#' and trimming whitespace.
 */
export function normalizeInvoiceNum(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).replace('#', '').trim();
}

/**
 * Checks if an invoice represents a purchase invoice.
 */
export function checkIsPurchase(inv: any): boolean {
  if (!inv) return false;
  if (isPurchaseInvoice(inv)) return true;
  const t = String(inv.invoiceType || inv.type || '').toLowerCase();
  if (t === 'purchase' || t.startsWith('purchase')) return true;
  const num = String(inv.invoiceNumber || '');
  if (num.startsWith('PUR-') || num.startsWith('DIS-')) return true;
  if (inv.purchaseType) return true;
  return false;
}

/**
 * Checks if an invoice represents a sale invoice.
 */
export function checkIsSale(inv: any): boolean {
  if (!inv) return false;
  if (checkIsPurchase(inv)) return false;
  const t = String(inv.invoiceType || inv.type || inv.templateType || '').toLowerCase();
  return t.startsWith('sale_') || t === 'parts' || t === 'sale_parts';
}

/**
 * Deletes an entire invoice with full cascading logic for:
 * 1. Stock / parts inventory (shop_parts_inventory):
 *    - Purchase invoice: Deletes or reduces the purchased inventory so it doesn't linger in stock.
 *    - Sale invoice: Restores the sold quantities back to inventory.
 * 2. Batches (disassembly_batches):
 *    - Purchase invoice: Deletes the disassembly batch record if created for this purchase.
 *    - Sale invoice: Reverses / decrements recovered amounts on the batch.
 * 3. Invoice items (invoice_items):
 *    - Deletes all items associated with this invoice.
 * 4. Financial transactions (vault_transactions):
 *    - Deletes or reverses related vouchers / cash movements.
 * 5. Primary invoice (invoices):
 *    - Deletes the invoice record from local provider and cloud Firestore.
 */
export async function deleteInvoiceWithCascade(
  invoice: Invoice,
  options?: { items?: InvoiceItem[] }
): Promise<DeleteCascadeResult> {
  const provider = ProviderFactory.getProvider();
  const cleanInvNo = normalizeInvoiceNum(invoice.invoiceNumber);
  const invId = invoice.id || '';

  const isPurchase = checkIsPurchase(invoice);
  const isSale = checkIsSale(invoice);

  let affectedStockCount = 0;
  let deletedBatchCount = 0;
  let deletedItemsCount = 0;

  try {
    // 1. Gather all invoice_items for this invoice
    let invItems: InvoiceItem[] = options?.items || [];
    if (invItems.length === 0) {
      try {
        const localRes = await localDb.query(
          `SELECT * FROM invoice_items WHERE invoiceId = ? OR invoiceNumber = ? OR invoiceNumber = ?`,
          [invId, cleanInvNo, `#${cleanInvNo}`]
        );
        if (localRes?.values && localRes.values.length > 0) {
          invItems = localRes.values;
        }
      } catch (err) {
        console.warn('Local query for invoice items error:', err);
      }

      // If still empty or partial, also fetch from Firestore
      if (invItems.length === 0 && invId) {
        try {
          const q1 = query(collection(db, 'invoice_items'), where('invoiceId', '==', invId));
          const snap1 = await getDocs(q1);
          const fsItems: InvoiceItem[] = [];
          snap1.forEach(d => fsItems.push({ id: d.id, ...(d.data() as any) }));
          if (fsItems.length > 0) {
            invItems = fsItems;
          }
        } catch (err) {
          console.warn('Firestore query for invoice items error:', err);
        }
      }
    } else {
      // Filter provided items to only this invoice
      invItems = invItems.filter(it => {
        const itClean = normalizeInvoiceNum(it.invoiceNumber);
        return itClean === cleanInvNo || it.invoiceId === invId || it.id === invId;
      });
    }

    // ----------------------------------------------------
    // 2. PURCHASE INVOICE CASCADING (Remove inventory & batch)
    // ----------------------------------------------------
    if (isPurchase) {
      // Fetch all stock inventory to identify items introduced by this purchase
      let allStock: any[] = [];
      try {
        const stockRes = await localDb.query(`SELECT * FROM shop_parts_inventory`);
        if (stockRes?.values) allStock = stockRes.values;
      } catch (e) {}

      if (allStock.length === 0) {
        try {
          const snap = await getDocs(collection(db, 'shop_parts_inventory'));
          snap.forEach(d => allStock.push({ id: d.id, ...d.data() }));
        } catch (e) {}
      }

      const matchedStockIds = new Set<string>();

      // A) Match by purchaseInvoiceId or purchaseInvoiceNumber
      for (const stock of allStock) {
        const stockCleanInv = normalizeInvoiceNum(stock.purchaseInvoiceNumber);
        if (
          (stock.purchaseInvoiceId && stock.purchaseInvoiceId === invId) ||
          (stockCleanInv && stockCleanInv === cleanInvNo) ||
          (invoice.batchId && stock.batchId && stock.batchId === invoice.batchId)
        ) {
          matchedStockIds.add(stock.id);
        }
      }

      // B) Match by invoice items (partInventoryId, or item name + supplier)
      for (const item of invItems) {
        if (item.partInventoryId) {
          matchedStockIds.add(item.partInventoryId);
        }
        // Match by item name if stock was created with same supplier/notes
        for (const stock of allStock) {
          const itemName = (item.deviceName || item.deviceType || '').trim().toLowerCase();
          const stockName = (stock.name || '').trim().toLowerCase();
          if (itemName && stockName === itemName) {
            if (
              (invoice.batchId && stock.batchId === invoice.batchId) ||
              (item.batchId && stock.batchId === item.batchId) ||
              (invoice.customerName && stock.supplierName === invoice.customerName)
            ) {
              matchedStockIds.add(stock.id);
            }
          }
        }
      }

      // Process matched stock items: Delete or reduce quantity
      for (const stockId of matchedStockIds) {
        const stock = allStock.find(s => s.id === stockId);
        if (!stock) continue;

        // Determine how many units were bought in this invoice
        const matchedItem = invItems.find(
          it => it.partInventoryId === stockId || 
                (it.deviceName || it.deviceType || '').trim().toLowerCase() === (stock.name || '').trim().toLowerCase()
        );
        const purchasedQty = Number(matchedItem?.quantity || stock.quantity || 1);
        const currentQty = Number(stock.quantity || 0);

        if (currentQty <= purchasedQty) {
          // Entire stock or remaining pieces come from this invoice -> Delete completely
          try {
            await provider.deleteDoc('shop_parts_inventory', stockId);
          } catch (e) {}
          try {
            await deleteDoc(doc(db, 'shop_parts_inventory', stockId));
          } catch (e) {}
          affectedStockCount++;
        } else {
          // Stock had other sources or merged quantities -> Deduct purchased quantity
          const updatedQty = Math.max(0, currentQty - purchasedQty);
          try {
            await provider.updateDoc('shop_parts_inventory', stockId, { quantity: updatedQty });
          } catch (e) {}
          try {
            await updateDoc(doc(db, 'shop_parts_inventory', stockId), { 
              quantity: updatedQty,
              updatedAt: serverTimestamp() 
            });
          } catch (e) {}
          affectedStockCount++;
        }
      }

      // C) If this was a disassembly batch purchase, delete the Disassembly Batch
      const targetBatchId = invoice.batchId || invItems.find(i => i.batchId)?.batchId;
      if (targetBatchId) {
        try {
          await provider.deleteDoc('disassembly_batches', targetBatchId);
        } catch (e) {}
        try {
          await deleteDoc(doc(db, 'disassembly_batches', targetBatchId));
        } catch (e) {}
        deletedBatchCount++;
      }
    }

    // ----------------------------------------------------
    // 3. SALE INVOICE CASCADING (Restore stock & reverse batch recovery)
    // ----------------------------------------------------
    if (isSale) {
      let allStock: any[] = [];
      try {
        const stockRes = await localDb.query(`SELECT * FROM shop_parts_inventory`);
        if (stockRes?.values) allStock = stockRes.values;
      } catch (e) {}

      if (allStock.length === 0) {
        try {
          const snap = await getDocs(collection(db, 'shop_parts_inventory'));
          snap.forEach(d => allStock.push({ id: d.id, ...d.data() }));
        } catch (e) {}
      }

      for (const item of invItems) {
        const soldQty = Number(item.quantity || 1);
        const itemName = (item.deviceName || item.deviceType || '').trim();
        if (!itemName && !item.partInventoryId) continue;

        // Find the stock inventory record
        let stockRecord: any = null;
        if (item.partInventoryId) {
          stockRecord = allStock.find(s => s.id === item.partInventoryId);
          if (!stockRecord) {
            try {
              const docSnap = await getDoc(doc(db, 'shop_parts_inventory', item.partInventoryId));
              if (docSnap.exists()) stockRecord = { id: docSnap.id, ...docSnap.data() };
            } catch (e) {}
          }
        }

        // Fallback match by name and batch
        if (!stockRecord && itemName) {
          stockRecord = allStock.find(s => {
            const matchesName = (s.name || '').trim().toLowerCase() === itemName.toLowerCase();
            if (!matchesName) return false;
            if (item.batchId) return s.batchId === item.batchId;
            return true;
          });
        }

        if (stockRecord) {
          // Restore (increase) the inventory quantity
          const newQty = Number(stockRecord.quantity || 0) + soldQty;
          try {
            await provider.updateDoc('shop_parts_inventory', stockRecord.id, { quantity: newQty });
          } catch (e) {}
          try {
            await updateDoc(doc(db, 'shop_parts_inventory', stockRecord.id), {
              quantity: newQty,
              updatedAt: serverTimestamp()
            });
          } catch (e) {}
          affectedStockCount++;
        } else if (itemName) {
          // Stock item was completely deleted when it reached 0 -> Re-create it with the restored quantity!
          const newStockId = item.partInventoryId || doc(collection(db, 'shop_parts_inventory')).id;
          const restoredStockPayload = {
            id: newStockId,
            name: itemName,
            category: 'قطع غيار وملحقات',
            quantity: soldQty,
            unitCost: item.unitCost || 0,
            salePrice: (item.cost && item.quantity ? item.cost / item.quantity : item.unitCost) || 0,
            isDisassemblyBatch: !!item.batchId,
            batchId: item.batchId || '',
            batchName: item.batchName || '',
            currency: invoice.currency || 'USD',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          try {
            await provider.setDoc('shop_parts_inventory', newStockId, restoredStockPayload);
          } catch (e) {}
          try {
            await setDoc(doc(db, 'shop_parts_inventory', newStockId), restoredStockPayload);
          } catch (e) {}
          affectedStockCount++;
        }

        // Reverse Batch Recovered Revenue
        const batchId = item.batchId || stockRecord?.batchId;
        if (batchId) {
          try {
            let batchDoc: any = null;
            try {
              const bRes = await localDb.query(`SELECT * FROM disassembly_batches WHERE id = ?`, [batchId]);
              if (bRes?.values?.[0]) batchDoc = bRes.values[0];
            } catch (e) {}

            if (!batchDoc) {
              const bSnap = await getDoc(doc(db, 'disassembly_batches', batchId));
              if (bSnap.exists()) batchDoc = { id: bSnap.id, ...bSnap.data() };
            }

            if (batchDoc) {
              const saleRevenue = soldQty * Number(item.unitCost || (item.cost ? item.cost / soldQty : 0));
              const currentRecovered = Number(batchDoc.recoveredAmount || 0);
              const totalCost = Number(batchDoc.totalBatchCost || 0);
              const newRecovered = Math.max(0, currentRecovered - saleRevenue);
              const isCostFullyRecovered = totalCost > 0 && newRecovered >= totalCost;

              try {
                await provider.updateDoc('disassembly_batches', batchId, {
                  recoveredAmount: newRecovered,
                  isCostFullyRecovered: isCostFullyRecovered ? 1 : 0
                });
              } catch (e) {}
              try {
                await updateDoc(doc(db, 'disassembly_batches', batchId), {
                  recoveredAmount: newRecovered,
                  isCostFullyRecovered,
                  updatedAt: serverTimestamp()
                });
              } catch (e) {}
            }
          } catch (batchErr) {
            console.warn('Error adjusting disassembly batch on sale delete:', batchErr);
          }
        }
      }
    }

    // ----------------------------------------------------
    // 4. DELETE ALL INVOICE ITEMS & LINKED ACTIONS
    // ----------------------------------------------------
    for (const item of invItems) {
      if (item.id) {
        // Cascade delete maintenance actions for this item
        try {
          const mRes = await localDb.query(`SELECT id FROM maintenance_actions WHERE itemId = ?`, [item.id]);
          for (const m of (mRes?.values || [])) {
            if (m.id) {
              try { await provider.deleteDoc('maintenance_actions', m.id); } catch (e) {}
              try { await FirebaseProviderInstance.deleteDoc('maintenance_actions', m.id); } catch (e) {}
            }
          }
        } catch (e) {}

        // Cascade delete approval actions for this item
        try {
          const aRes = await localDb.query(`SELECT id FROM approval_actions WHERE itemId = ?`, [item.id]);
          for (const a of (aRes?.values || [])) {
            if (a.id) {
              try { await provider.deleteDoc('approval_actions', a.id); } catch (e) {}
              try { await FirebaseProviderInstance.deleteDoc('approval_actions', a.id); } catch (e) {}
            }
          }
        } catch (e) {}

        try {
          await provider.deleteDoc('invoice_items', item.id);
        } catch (e) {}
        try {
          await FirebaseProviderInstance.deleteDoc('invoice_items', item.id);
        } catch (e) {}
        deletedItemsCount++;
      }
    }

    // ----------------------------------------------------
    // 5. DELETE PRIMARY INVOICE RECORD
    // ----------------------------------------------------
    if (invId) {
      try {
        await provider.deleteDoc('invoices', invId);
      } catch (e) {}
      try {
        await FirebaseProviderInstance.deleteDoc('invoices', invId);
      } catch (e) {}
    }

    // ----------------------------------------------------
    // 6. DELETE ASSOCIATED FINANCIAL TRANSACTIONS (Vouchers)
    // ----------------------------------------------------
    try {
      let txs: any[] = [];
      const txRes = await localDb.query(
        `SELECT id FROM vault_transactions WHERE invoiceId = ? OR invoiceNumber = ? OR invoiceNumber = ?`,
        [invId, cleanInvNo, `#${cleanInvNo}`]
      );
      if (txRes?.values) txs = txRes.values;

      if (txs.length === 0) {
        try {
          const qTx = query(collection(db, 'vault_transactions'), where('invoiceNumber', '==', cleanInvNo));
          const snapTx = await getDocs(qTx);
          snapTx.forEach(d => txs.push({ id: d.id }));
        } catch (e) {}
      }

      for (const tx of txs) {
        if (tx.id) {
          try {
            await provider.deleteDoc('vault_transactions', tx.id);
          } catch (e) {}
          try {
            await FirebaseProviderInstance.deleteDoc('vault_transactions', tx.id);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('Error cleaning up vault transactions:', e);
    }

    return {
      success: true,
      isPurchase,
      isSale,
      deletedItemsCount,
      affectedStockCount,
      deletedBatchCount
    };
  } catch (err: any) {
    console.error('Error during deleteInvoiceWithCascade:', err);
    return {
      success: false,
      error: err?.message || 'فشل في حذف الفاتورة وعناصرها المرتبطة',
      isPurchase,
      isSale,
      deletedItemsCount,
      affectedStockCount,
      deletedBatchCount
    };
  }
}

/**
 * Deletes a single item (part/device) from an invoice and cascades to inventory.
 */
export async function deleteSingleInvoiceItemWithCascade(
  item: InvoiceItem,
  invoice: Invoice
): Promise<{ success: boolean; error?: string }> {
  const provider = ProviderFactory.getProvider();
  const isPurchase = checkIsPurchase(invoice);
  const isSale = checkIsSale(invoice);

  try {
    const qty = Number(item.quantity || 1);
    const itemName = (item.deviceName || item.deviceType || '').trim();

    // 1. If purchase invoice: reduce or delete corresponding inventory
    if (isPurchase) {
      let stockItem: any = null;
      if (item.partInventoryId) {
        try {
          const res = await localDb.query(`SELECT * FROM shop_parts_inventory WHERE id = ?`, [item.partInventoryId]);
          if (res?.values?.[0]) stockItem = res.values[0];
        } catch (e) {}
        if (!stockItem) {
          try {
            const snap = await getDoc(doc(db, 'shop_parts_inventory', item.partInventoryId));
            if (snap.exists()) stockItem = { id: snap.id, ...snap.data() };
          } catch (e) {}
        }
      }

      if (!stockItem && itemName) {
        try {
          const res = await localDb.query(`SELECT * FROM shop_parts_inventory WHERE LOWER(name) = LOWER(?)`, [itemName]);
          if (res?.values?.[0]) stockItem = res.values[0];
        } catch (e) {}
      }

      if (stockItem) {
        const curQty = Number(stockItem.quantity || 0);
        if (curQty <= qty) {
          try { await provider.deleteDoc('shop_parts_inventory', stockItem.id); } catch (e) {}
          try { await deleteDoc(doc(db, 'shop_parts_inventory', stockItem.id)); } catch (e) {}
        } else {
          const updated = curQty - qty;
          try { await provider.updateDoc('shop_parts_inventory', stockItem.id, { quantity: updated }); } catch (e) {}
          try { await updateDoc(doc(db, 'shop_parts_inventory', stockItem.id), { quantity: updated }); } catch (e) {}
        }
      }
    }

    // 2. If sale invoice: restore quantity to inventory
    if (isSale) {
      let stockItem: any = null;
      if (item.partInventoryId) {
        try {
          const res = await localDb.query(`SELECT * FROM shop_parts_inventory WHERE id = ?`, [item.partInventoryId]);
          if (res?.values?.[0]) stockItem = res.values[0];
        } catch (e) {}
        if (!stockItem) {
          try {
            const snap = await getDoc(doc(db, 'shop_parts_inventory', item.partInventoryId));
            if (snap.exists()) stockItem = { id: snap.id, ...snap.data() };
          } catch (e) {}
        }
      }

      if (!stockItem && itemName) {
        try {
          const res = await localDb.query(`SELECT * FROM shop_parts_inventory WHERE LOWER(name) = LOWER(?)`, [itemName]);
          if (res?.values?.[0]) stockItem = res.values[0];
        } catch (e) {}
      }

      if (stockItem) {
        const updated = Number(stockItem.quantity || 0) + qty;
        try { await provider.updateDoc('shop_parts_inventory', stockItem.id, { quantity: updated }); } catch (e) {}
        try { await updateDoc(doc(db, 'shop_parts_inventory', stockItem.id), { quantity: updated }); } catch (e) {}
      } else if (itemName) {
        const newStockId = item.partInventoryId || doc(collection(db, 'shop_parts_inventory')).id;
        const payload = {
          id: newStockId,
          name: itemName,
          category: 'قطع غيار وملحقات',
          quantity: qty,
          unitCost: item.unitCost || 0,
          salePrice: (item.cost && item.quantity ? item.cost / item.quantity : item.unitCost) || 0,
          isDisassemblyBatch: !!item.batchId,
          batchId: item.batchId || '',
          batchName: item.batchName || '',
          currency: invoice.currency || 'USD',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        try { await provider.setDoc('shop_parts_inventory', newStockId, payload); } catch (e) {}
        try { await setDoc(doc(db, 'shop_parts_inventory', newStockId), payload); } catch (e) {}
      }

      // Reverse batch recovery if applicable
      if (item.batchId) {
        try {
          const bSnap = await getDoc(doc(db, 'disassembly_batches', item.batchId));
          if (bSnap.exists()) {
            const bData = bSnap.data();
            const rev = qty * Number(item.unitCost || 0);
            const currentRec = Number(bData.recoveredAmount || 0);
            const newRec = Math.max(0, currentRec - rev);
            const isFull = (bData.totalBatchCost || 0) > 0 && newRec >= (bData.totalBatchCost || 0);
            try { await provider.updateDoc('disassembly_batches', item.batchId, { recoveredAmount: newRec, isCostFullyRecovered: isFull ? 1 : 0 }); } catch (e) {}
            try { await updateDoc(doc(db, 'disassembly_batches', item.batchId), { recoveredAmount: newRec, isCostFullyRecovered: isFull }); } catch (e) {}
          }
        } catch (e) {}
      }
    }

    // 3. Delete the item record
    if (item.id) {
      try { await provider.deleteDoc('invoice_items', item.id); } catch (e) {}
      try { await deleteDoc(doc(db, 'invoice_items', item.id)); } catch (e) {}
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error deleting single invoice item:', err);
    return { success: false, error: err?.message };
  }
}

/**
 * Scans shop_parts_inventory and disassembly_batches for orphaned records
 * (e.g. from previously deleted purchase invoices where cascading wasn't applied).
 */
export async function auditOrphanedPartsStock(): Promise<{
  orphanedItems: any[];
  orphanedBatches: any[];
}> {
  try {
    let allStockMap = new Map<string, any>();
    let allBatchesMap = new Map<string, any>();
    let allInvoicesMap = new Map<string, any>();

    // 1. Load from local DB
    try {
      const stockRes = await localDb.query(`SELECT * FROM shop_parts_inventory`);
      if (stockRes?.values) {
        stockRes.values.forEach((s: any) => { if (s.id) allStockMap.set(String(s.id), s); });
      }
      const bRes = await localDb.query(`SELECT * FROM disassembly_batches`);
      if (bRes?.values) {
        bRes.values.forEach((b: any) => { if (b.id) allBatchesMap.set(String(b.id), b); });
      }
      const invRes = await localDb.query(`SELECT * FROM invoices`);
      if (invRes?.values) {
        invRes.values.forEach((i: any) => { if (i.id) allInvoicesMap.set(String(i.id), i); });
      }
    } catch (e) {}

    // 2. Combine with Firestore documents to guarantee complete data across web and native
    try {
      const stockSnap = await getDocs(collection(db, 'shop_parts_inventory'));
      stockSnap.forEach(d => {
        if (!allStockMap.has(d.id)) {
          allStockMap.set(d.id, { id: d.id, ...d.data() });
        }
      });

      const batchSnap = await getDocs(collection(db, 'disassembly_batches'));
      batchSnap.forEach(d => {
        if (!allBatchesMap.has(d.id)) {
          allBatchesMap.set(d.id, { id: d.id, ...d.data() });
        }
      });

      const invSnap = await getDocs(collection(db, 'invoices'));
      invSnap.forEach(d => {
        if (!allInvoicesMap.has(d.id)) {
          allInvoicesMap.set(d.id, { id: d.id, ...d.data() });
        }
      });
    } catch (e) {
      console.warn('Firestore fetch in auditOrphanedPartsStock fallback error:', e);
    }

    const allStock = Array.from(allStockMap.values());
    const allBatches = Array.from(allBatchesMap.values());
    const allInvoices = Array.from(allInvoicesMap.values());

    const existingInvIds = new Set(allInvoices.map(i => String(i.id)));
    const existingInvNumbers = new Set(allInvoices.map(i => normalizeInvoiceNum(i.invoiceNumber)).filter(Boolean));
    const existingBatchIds = new Set(allBatches.map(b => String(b.id)));

    const orphanedItems: any[] = [];
    for (const stock of allStock) {
      // 0. Phantom / negative / corrupt items from previous buggy sales
      if (Number(stock.quantity || 0) < 0 || !stock.name || !stock.name.trim()) {
        orphanedItems.push({
          ...stock,
          orphanReason: Number(stock.quantity || 0) < 0
            ? `سجل صنف تالف برصيد سالب (${stock.quantity}) ناتج عن بيع غير مقترن بالمخزون`
            : 'سجل صنف غير صالح بدون اسم'
        });
        continue;
      }

      // 1. Explicitly linked to a deleted purchase invoice
      if (stock.purchaseInvoiceId && !existingInvIds.has(String(stock.purchaseInvoiceId))) {
        orphanedItems.push({ ...stock, orphanReason: 'فاتورة الشراء الخاصة بالصنف محذوفة من النظام' });
        continue;
      }
      const cleanInv = normalizeInvoiceNum(stock.purchaseInvoiceNumber);
      if (cleanInv && !existingInvNumbers.has(cleanInv)) {
        orphanedItems.push({ ...stock, orphanReason: 'رقم فاتورة الشراء غير موجود في النظام' });
        continue;
      }
      // 2. Disassembly batch item where the batch was deleted
      if (stock.isDisassemblyBatch && stock.batchId && !existingBatchIds.has(String(stock.batchId))) {
        orphanedItems.push({ ...stock, orphanReason: 'دفعة التفكيك/التشليح التابع لها الصنف محذوفة' });
        continue;
      }
    }

    // Check batches without matching purchase invoices
    const orphanedBatches: any[] = [];
    for (const batch of allBatches) {
      const batchIdStr = String(batch.id);
      const bNum = normalizeInvoiceNum(batch.batchNumber);
      const purchaseInvIdStr = batch.purchaseInvoiceId ? String(batch.purchaseInvoiceId) : null;
      const purchaseInvNumNorm = batch.purchaseInvoiceNumber ? normalizeInvoiceNum(batch.purchaseInvoiceNumber) : null;

      const hasMatchingInv = allInvoices.some(inv => {
        if (inv.id && purchaseInvIdStr && String(inv.id) === purchaseInvIdStr) return true;
        if (inv.batchId && String(inv.batchId) === batchIdStr) return true;
        
        const invClean = normalizeInvoiceNum(inv.invoiceNumber);
        if (invClean) {
          if (bNum && invClean === bNum) return true;
          if (purchaseInvNumNorm && invClean === purchaseInvNumNorm) return true;
        }
        return false;
      });

      // Also check if there are active stock items associated with this batch
      const hasStockItems = allStock.some(s => s.batchId && String(s.batchId) === batchIdStr);

      if (!hasMatchingInv && !hasStockItems) {
        orphanedBatches.push({ ...batch, orphanReason: 'فاتورة الشراء الخاصة بدفعة التفكيك محذوفة' });
      }
    }

    return { orphanedItems, orphanedBatches };
  } catch (err) {
    console.error('Error auditing orphaned stock:', err);
    return { orphanedItems: [], orphanedBatches: [] };
  }
}

/**
 * Clean up selected or all orphaned stock items and batches.
 */
export async function cleanOrphanedPartsStock(
  itemIds: string[],
  batchIds: string[]
): Promise<{ cleanedCount: number }> {
  const provider = ProviderFactory.getProvider();
  let cleanedCount = 0;

  for (const id of itemIds) {
    try {
      await provider.deleteDoc('shop_parts_inventory', id);
    } catch (e) {}
    try {
      await deleteDoc(doc(db, 'shop_parts_inventory', id));
    } catch (e) {}
    cleanedCount++;
  }

  for (const bId of batchIds) {
    try {
      await provider.deleteDoc('disassembly_batches', bId);
    } catch (e) {}
    try {
      await deleteDoc(doc(db, 'disassembly_batches', bId));
    } catch (e) {}
    cleanedCount++;
  }

  return { cleanedCount };
}

/**
 * Recalculates and synchronizes the recovered amounts and recovery status
 * for all disassembly batches based on actual recorded sales in invoice_items.
 */
export async function recalculateDisassemblyBatchesRecovery(): Promise<{
  updatedCount: number;
  batches: any[];
}> {
  try {
    const provider = ProviderFactory.getProvider();

    // 1. Fetch batches
    let batchesMap = new Map<string, any>();
    try {
      const bRes = await localDb.query(`SELECT * FROM disassembly_batches`);
      if (bRes?.values) {
        bRes.values.forEach((b: any) => { if (b.id) batchesMap.set(String(b.id), b); });
      }
    } catch (e) {}

    try {
      const bSnap = await getDocs(collection(db, 'disassembly_batches'));
      bSnap.forEach(d => {
        batchesMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}

    // 2. Fetch invoice_items
    let allItemsMap = new Map<string, any>();
    try {
      const itRes = await localDb.query(`SELECT * FROM invoice_items`);
      if (itRes?.values) {
        itRes.values.forEach((it: any) => { if (it.id) allItemsMap.set(String(it.id), it); });
      }
    } catch (e) {}

    try {
      const itSnap = await getDocs(collection(db, 'invoice_items'));
      itSnap.forEach(d => {
        allItemsMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}

    // 3. Fetch active invoices and distinguish purchase vs sales
    let activeInvIds = new Set<string>();
    let purchaseInvIds = new Set<string>();
    try {
      const invRes = await localDb.query(`SELECT id, isPurchase, invoiceType FROM invoices`);
      if (invRes?.values) {
        invRes.values.forEach((i: any) => {
          if (i.id) {
            activeInvIds.add(String(i.id));
            if (i.isPurchase === 1 || i.isPurchase === true || i.invoiceType === 'purchase') {
              purchaseInvIds.add(String(i.id));
            }
          }
        });
      }
    } catch (e) {}

    try {
      const invSnap = await getDocs(collection(db, 'invoices'));
      invSnap.forEach(d => {
        activeInvIds.add(d.id);
        const data = d.data();
        if (data?.isPurchase || data?.invoiceType === 'purchase') {
          purchaseInvIds.add(d.id);
        }
      });
    } catch (e) {}

    const allItems = Array.from(allItemsMap.values()).filter(it => {
      if (it.invoiceId && !activeInvIds.has(String(it.invoiceId))) return false;
      return true;
    });

    let updatedCount = 0;
    const resultBatches: any[] = [];

    for (const [batchId, batch] of batchesMap.entries()) {
      const bIdStr = String(batchId);
      const bName = (batch.batchName || '').trim().toLowerCase();
      const bTotalCost = Number(batch.totalBatchCost || 0);

      // Find items matching this batch that are legitimate sales (exclude purchase items)
      const matchingItems = allItems.filter(it => {
        // Must not be a purchase record
        if (it.source === 'purchase' || it.isPurchase === 1 || it.isPurchase === true) return false;
        if (it.invoiceId && purchaseInvIds.has(String(it.invoiceId))) return false;

        // Match batch strictly by unique ID or unique batch number
        if (it.batchId && (String(it.batchId) === bIdStr || (batch.batchNumber && String(it.batchId) === String(batch.batchNumber)))) return true;
        return false;
      });

      // Calculate total recovered revenue
      const calculatedRevenue = matchingItems.reduce((sum, it) => {
        const qty = Math.max(1, Number(it.quantity || 1));
        const unit = Number(it.unitCost || 0);
        const itemTotal = Number(it.cost || (qty * unit));
        return sum + itemTotal;
      }, 0);

      const isFullyRecovered = bTotalCost > 0 && calculatedRevenue >= bTotalCost;

      const currentRecovered = Number(batch.recoveredAmount || 0);
      const currentFullyRecovered = Boolean(batch.isCostFullyRecovered);

      if (currentRecovered !== calculatedRevenue || currentFullyRecovered !== isFullyRecovered) {
        const updateData = {
          recoveredAmount: calculatedRevenue,
          isCostFullyRecovered: isFullyRecovered ? 1 : 0,
          updatedAt: new Date().toISOString()
        };

        try {
          await provider.updateDoc('disassembly_batches', bIdStr, updateData);
        } catch (e) {}

        try {
          await updateDoc(doc(db, 'disassembly_batches', bIdStr), {
            recoveredAmount: calculatedRevenue,
            isCostFullyRecovered: isFullyRecovered ? 1 : 0,
            updatedAt: serverTimestamp()
          });
        } catch (e) {}

        updatedCount++;
        resultBatches.push({ ...batch, ...updateData, id: bIdStr });
      } else {
        resultBatches.push({ ...batch, id: bIdStr });
      }
    }

    return { updatedCount, batches: resultBatches };
  } catch (err) {
    console.error('Error recalculating disassembly batches recovery:', err);
    return { updatedCount: 0, batches: [] };
  }
}

/**
 * Permanently deletes a customer and cleanly cascades all related data:
 * 1. All invoices belonging to this customer (including items, inventory rollback/deductions, batches, and vouchers).
 * 2. Any lingering items belonging to this customer (including maintenance_actions & approval_actions).
 * 3. Any lingering customer vault_transactions (receipts, payments).
 * 4. Any customer saved PDFs.
 * 5. Primary customer document in both Local SQLite and Cloud Firestore.
 */
export async function deleteCustomerWithCascade(
  customer: { id: string; name?: string; customerNumber?: any },
  options?: {
    deletePastTransactions?: boolean;
    invoices?: Invoice[];
    items?: InvoiceItem[];
    transactions?: any[];
  }
): Promise<{ success: boolean; error?: string }> {
  if (!customer || !customer.id) {
    return { success: false, error: 'معرف العميل غير صالح' };
  }

  const custId = customer.id;
  const custName = (customer.name || '').trim();
  const provider = ProviderFactory.getProvider();

  try {
    if (options?.deletePastTransactions) {
      // 1. Collect all invoices for this customer
      let custInvoices: Invoice[] = [];
      if (options.invoices && options.invoices.length > 0) {
        custInvoices = options.invoices.filter(inv => 
          inv.customerId === custId || (custName && (inv.customerName || '').trim() === custName)
        );
      } else {
        try {
          const invRes = await localDb.query(
            `SELECT * FROM invoices WHERE customerId = ? OR (customerName IS NOT NULL AND TRIM(customerName) = ?)`,
            [custId, custName]
          );
          if (invRes?.values) custInvoices = invRes.values;
        } catch (e) {}
      }

      // Collect customer invoice IDs & invoice numbers
      const custInvIds = new Set<string>(custInvoices.map(i => i.id).filter(Boolean) as string[]);
      const custInvNumbers = new Set<string>(custInvoices.map(i => normalizeInvoiceNum(i.invoiceNumber)).filter(Boolean));

      // 2. Cascade delete every invoice
      for (const inv of custInvoices) {
        try {
          await deleteInvoiceWithCascade(inv, { items: options?.items });
        } catch (invErr) {
          console.warn('Error cascading invoice deletion for customer:', invErr);
          if (inv.id) {
            try { await provider.deleteDoc('invoices', inv.id); } catch (e) {}
            try { await FirebaseProviderInstance.deleteDoc('invoices', inv.id); } catch (e) {}
          }
        }
      }

      // 3. Find any remaining/orphan items belonging to this customer
      let remainingItems: any[] = [];
      try {
        const itemRes = await localDb.query(
          `SELECT * FROM invoice_items WHERE customerId = ? OR (customerName IS NOT NULL AND TRIM(customerName) = ?)`,
          [custId, custName]
        );
        if (itemRes?.values) remainingItems = itemRes.values;
      } catch (e) {}

      if (options?.items) {
        options.items.forEach(it => {
          if (it.customerId === custId || (custName && (it.customerName || '').trim() === custName)) {
            if (!remainingItems.some(r => r.id === it.id)) remainingItems.push(it);
          }
        });
      }

      for (const it of remainingItems) {
        if (!it.id) continue;
        // Clean related actions
        try {
          const mRes = await localDb.query(`SELECT id FROM maintenance_actions WHERE itemId = ?`, [it.id]);
          for (const m of (mRes?.values || [])) {
            if (m.id) {
              try { await provider.deleteDoc('maintenance_actions', m.id); } catch (e) {}
              try { await FirebaseProviderInstance.deleteDoc('maintenance_actions', m.id); } catch (e) {}
            }
          }
        } catch (e) {}

        try {
          const aRes = await localDb.query(`SELECT id FROM approval_actions WHERE itemId = ?`, [it.id]);
          for (const a of (aRes?.values || [])) {
            if (a.id) {
              try { await provider.deleteDoc('approval_actions', a.id); } catch (e) {}
              try { await FirebaseProviderInstance.deleteDoc('approval_actions', a.id); } catch (e) {}
            }
          }
        } catch (e) {}

        try { await provider.deleteDoc('invoice_items', it.id); } catch (e) {}
        try { await FirebaseProviderInstance.deleteDoc('invoice_items', it.id); } catch (e) {}
      }

      // 4. Find any customer transactions (receipts, payments, or linked vouchers)
      let remainingTxs: any[] = [];
      try {
        const txRes = await localDb.query(
          `SELECT * FROM vault_transactions WHERE customerId = ? OR (customerName IS NOT NULL AND TRIM(customerName) = ?)`,
          [custId, custName]
        );
        if (txRes?.values) remainingTxs = txRes.values;
      } catch (e) {}

      if (options?.transactions) {
        options.transactions.forEach(tx => {
          const cleanInv = normalizeInvoiceNum(tx.invoiceNumber);
          if (
            tx.customerId === custId || 
            (custName && (tx.customerName || '').trim() === custName) ||
            (tx.invoiceId && custInvIds.has(tx.invoiceId)) ||
            (cleanInv && custInvNumbers.has(cleanInv))
          ) {
            if (!remainingTxs.some(r => r.id === tx.id)) remainingTxs.push(tx);
          }
        });
      }

      for (const tx of remainingTxs) {
        if (!tx.id) continue;
        try { await provider.deleteDoc('vault_transactions', tx.id); } catch (e) {}
        try { await FirebaseProviderInstance.deleteDoc('vault_transactions', tx.id); } catch (e) {}
      }

      // 5. Clean saved PDFs for this customer
      try {
        const pdfRes = await localDb.query(
          `SELECT id FROM saved_pdfs WHERE customerId = ? OR (customerName IS NOT NULL AND TRIM(customerName) = ?)`,
          [custId, custName]
        );
        for (const pdf of (pdfRes?.values || [])) {
          if (pdf.id) {
            try { await provider.deleteDoc('saved_pdfs', pdf.id); } catch (e) {}
            try { await FirebaseProviderInstance.deleteDoc('saved_pdfs', pdf.id); } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // 6. Delete the primary customer document in Local SQLite and Cloud Firestore
    try {
      await provider.deleteDoc('customers', custId);
    } catch (e) {
      console.warn('Local customer delete error:', e);
    }

    try {
      await FirebaseProviderInstance.deleteDoc('customers', custId);
    } catch (e) {
      console.warn('Firebase customer delete error:', e);
    }

    // 7. Flush outbox sync in background to propagate all tombstones immediately
    import('../data/SyncEngine').then(({ SyncEngine }) => {
      SyncEngine.syncAll().catch(() => {});
    }).catch(() => {});

    return { success: true };
  } catch (err: any) {
    console.error('Error during deleteCustomerWithCascade:', err);
    return { success: false, error: err?.message || 'فشل في حذف العميل وعملياته المرتبطة' };
  }
}

