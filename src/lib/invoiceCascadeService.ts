import { db, doc, getDoc, getDocs, collection, deleteDoc, updateDoc, setDoc, query, where, serverTimestamp } from '../firebase';
import { ProviderFactory } from '../data/ProviderFactory';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { localDb } from './local-db';
import { Invoice, InvoiceItem, isPurchaseInvoice } from '../types';
import {
  normalizePartText,
  cleanDisplayText,
  sanitizePartDocId,
  isNonBatchStock,
  findMatchingGroup,
  findMatchingCatalogPart,
  findMatchingStockCandidates,
  resolveCanonicalGroupInfo,
  normalizePartsUsedList
} from './partsNormalization';

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
          const itemNameNorm = normalizePartText(item.deviceName || item.deviceType || '');
          const stockNameNorm = normalizePartText(stock.name || '');
          if (itemNameNorm && stockNameNorm === itemNameNorm) {
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
        const stockNameNorm = normalizePartText(stock.name || '');
        const matchedItem = invItems.find(
          it => it.partInventoryId === stockId ||
                normalizePartText(it.deviceName || it.deviceType || '') === stockNameNorm
        );
        const purchasedQty = Number(matchedItem?.quantity || stock.quantity || 1);
        const currentQty = Number(stock.quantity || 0);
        const usedQty = Number(stock.usedQuantity || 0);

        if (usedQty === 0 && currentQty <= purchasedQty) {
          // Entire un-used stock came from this invoice -> Delete completely
          try {
            await provider.deleteDoc('shop_parts_inventory', stockId);
          } catch (e) {}
          try {
            await deleteDoc(doc(db, 'shop_parts_inventory', stockId));
          } catch (e) {}
          affectedStockCount++;
        } else {
          // Stock had merged purchases or historical usage -> Deduct purchased quantity without wiping history
          const updatedQty = currentQty - purchasedQty;
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
          stockRecord = findMatchingStockCandidates(allStock, {
            partName: itemName,
            batchId: item.batchId || undefined
          })[0] || null;
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

        // Restore spare parts to inventory if this was a maintenance item that reached status 50/60
        if (['50', '55', '60'].includes(item.status || '') && (item.partsUsed || []).length > 0) {
          try {
            await restoreItemSparePartsToStock(item);
          } catch (e) {
            console.warn('Cascading maintenance parts reversal failed for item:', item.id, e);
          }
        }

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
 * Restores spare parts used in a maintenance item back to inventory.
 * Used when an item is deleted or reverted from status 50/60.
 */
export async function restoreItemSparePartsToStock(item: InvoiceItem): Promise<number> {
  const parts = item.partsUsed || [];
  if (parts.length === 0) return 0;

  const provider = ProviderFactory.getProvider();
  let restoredCount = 0;

  let allStock: any[] = [];
  try {
    const res = await localDb.query(`SELECT * FROM shop_parts_inventory`);
    if (res?.values) allStock = res.values;
  } catch (e) {}
  if (allStock.length === 0) {
    try {
      const snap = await getDocs(collection(db, 'shop_parts_inventory'));
      snap.forEach(d => allStock.push({ id: d.id, ...d.data() }));
    } catch (e) {}
  }

  for (const p of parts) {
    if (p.isScrap) continue; // Scrap parts were never deducted

    const partQty = Number(p.quantity) || 1;
    const partId = p.partId || p.id || '';
    const partName = cleanDisplayText(p.partName);
    if (!partId && !partName) continue;

    try {
      const candidates = findMatchingStockCandidates(allStock, {
        partId,
        partName
      });
      // Prefer non-batch primary stock item when restoring maintenance parts
      const stockDoc = candidates.find(c => isNonBatchStock(c)) || candidates[0] || null;

      if (stockDoc && stockDoc.id) {
        const newQty = (Number(stockDoc.quantity) || 0) + partQty;
        const newUsed = Math.max(0, (Number(stockDoc.usedQuantity) || 0) - partQty);
        stockDoc.quantity = newQty;
        stockDoc.usedQuantity = newUsed;

        const updatePayload = {
          quantity: newQty,
          usedQuantity: newUsed,
          updatedAt: serverTimestamp()
        };

        try { await provider.updateDoc('shop_parts_inventory', stockDoc.id, updatePayload); } catch (e) {}
        try { await updateDoc(doc(db, 'shop_parts_inventory', stockDoc.id), updatePayload); } catch (e) {}
        restoredCount++;
      }
    } catch (err) {
      console.warn(`Failed to restore part ${partId || partName}:`, err);
    }
  }
  return restoredCount;
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
          const res = await localDb.query(`SELECT * FROM shop_parts_inventory`);
          if (res?.values) {
            stockItem = findMatchingStockCandidates(res.values, {
              partId: item.partId,
              partName: itemName,
              batchId: item.batchId || undefined
            })[0] || null;
          }
        } catch (e) {}
      }

      if (stockItem) {
        const curQty = Number(stockItem.quantity || 0);
        const usedQty = Number(stockItem.usedQuantity || 0);
        if (usedQty === 0 && curQty <= qty) {
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
          const res = await localDb.query(`SELECT * FROM shop_parts_inventory`);
          if (res?.values) {
            stockItem = findMatchingStockCandidates(res.values, {
              partId: item.partId,
              partName: itemName,
              batchId: item.batchId || undefined
            })[0] || null;
          }
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
    }

    // 3. If maintenance item and status is 50/60: restore spare parts to stock
    if (['50', '55', '60'].includes(item.status || '') && (item.partsUsed || []).length > 0) {
       try {
         await restoreItemSparePartsToStock(item);
       } catch (e) {
         console.warn('Cascading maintenance parts reversal failed for single item:', item.id, e);
       }
    }

    // 4. Reverse batch recovery if applicable
    if (item.batchId) {
      try {
        const bSnap = await getDoc(doc(db, 'disassembly_batches', item.batchId));
        if (bSnap.exists()) {
          const bData = bSnap.data();
          const rev = qty * Number(item.unitCost || 0);
          const currentRec = Number(bData.recoveredAmount || 0);
          const totalCost = Number(bData.totalBatchCost || 0);
          const newRec = Math.max(0, currentRec - rev);
          const isFull = totalCost > 0 && newRec >= totalCost;
          try { await provider.updateDoc('disassembly_batches', item.batchId, { recoveredAmount: newRec, isCostFullyRecovered: isFull ? 1 : 0 }); } catch (e) {}
          try { await updateDoc(doc(db, 'disassembly_batches', item.batchId), { recoveredAmount: newRec, isCostFullyRecovered: isFull ? 1 : 0, updatedAt: serverTimestamp() }); } catch (e) {}
        }
      } catch (e) {}
    }

    // 5. Delete the item record
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

/**
 * Consolidates duplicate non-batch shop_parts_inventory items (e.g. multiple purchases of the same part
 * or negative maintenance placeholders created under a separate row) and synchronizes canonical
 * groupId / groupName / category / partId across parts_catalog and shop_parts_inventory.
 */
export async function consolidateAndSyncPartsInventory(): Promise<{ mergedCount: number; syncedCount: number }> {
  let mergedCount = 0;
  let syncedCount = 0;

  try {
    const provider = ProviderFactory.getProvider();

    // 1. Load electronic_part_groups
    const groupsMap = new Map<string, any>();
    try {
      const resG = await localDb.query(`SELECT * FROM electronic_part_groups`);
      resG?.values?.forEach(g => { if (g.id) groupsMap.set(String(g.id), g); });
    } catch (e) {}
    try {
      const snapG = await getDocs(collection(db, 'electronic_part_groups'));
      snapG.forEach(d => {
        if (!groupsMap.has(d.id)) groupsMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}
    const groupsList = Array.from(groupsMap.values());

    // 2. Load parts_catalog
    const catalogMap = new Map<string, any>();
    try {
      const resC = await localDb.query(`SELECT * FROM parts_catalog`);
      resC?.values?.forEach(c => { if (c.id) catalogMap.set(String(c.id), c); });
    } catch (e) {}
    try {
      const snapC = await getDocs(collection(db, 'parts_catalog'));
      snapC.forEach(d => {
        if (!catalogMap.has(d.id)) catalogMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}
    const catalogList = Array.from(catalogMap.values());

    // 2b. Sync stale group references on parts_catalog
    for (const cat of catalogList) {
      const canonicalGrp = resolveCanonicalGroupInfo(groupsList, {
        groupId: cat.groupId,
        groupName: cat.groupName,
        category: cat.category
      });
      const targetName = canonicalGrp.groupName;
      if (targetName && canonicalGrp.groupId) {
        const needsUpdate =
          String(cat.groupId || '') !== canonicalGrp.groupId ||
          cleanDisplayText(cat.groupName) !== targetName ||
          cleanDisplayText(cat.category) !== targetName;
        if (needsUpdate) {
          const patch = {
            groupId: canonicalGrp.groupId,
            groupName: targetName,
            category: targetName,
            updatedAt: serverTimestamp()
          };
          cat.groupId = canonicalGrp.groupId;
          cat.groupName = targetName;
          cat.category = targetName;
          try { await provider.updateDoc('parts_catalog', cat.id, patch); } catch (e) {}
          try { await updateDoc(doc(db, 'parts_catalog', cat.id), patch); } catch (e) {}
          syncedCount++;
        }
      }
    }

    // 3. Load shop_parts_inventory
    const stockMap = new Map<string, any>();
    try {
      const resS = await localDb.query(`SELECT * FROM shop_parts_inventory`);
      resS?.values?.forEach(s => { if (s.id) stockMap.set(String(s.id), s); });
    } catch (e) {}
    try {
      const snapS = await getDocs(collection(db, 'shop_parts_inventory'));
      snapS.forEach(d => {
        if (!stockMap.has(d.id)) stockMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}
    const allStocks = Array.from(stockMap.values());

    // 4. Load invoice_items so we can repoint partInventoryId references when duplicates merge
    const itemsMap = new Map<string, any>();
    try {
      const resI = await localDb.query(`SELECT * FROM invoice_items`);
      resI?.values?.forEach(it => { if (it.id) itemsMap.set(String(it.id), it); });
    } catch (e) {}
    try {
      const snapI = await getDocs(collection(db, 'invoice_items'));
      snapI.forEach(d => {
        if (!itemsMap.has(d.id)) itemsMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}
    const allInvoiceItems = Array.from(itemsMap.values());

    // 5. Bucket non-batch stock items by canonical part key
    const nonBatchBuckets = new Map<string, any[]>();
    const batchStocks: any[] = [];

    for (const s of allStocks) {
      if (!s || !s.id) continue;
      if (!isNonBatchStock(s)) {
        batchStocks.push(s);
        continue;
      }

      const matchedCat = findMatchingCatalogPart(catalogList, s.partId, s.name);
      const normName = normalizePartText(matchedCat?.name || s.name);
      const bucketKey = matchedCat?.id
        ? `cat:${matchedCat.id}`
        : normName
        ? `name:${normName}`
        : `id:${s.id}`;

      if (!nonBatchBuckets.has(bucketKey)) {
        nonBatchBuckets.set(bucketKey, []);
      }
      nonBatchBuckets.get(bucketKey)!.push(s);
    }

    // 6. Merge duplicate buckets & sync canonical fields
    for (const bucket of nonBatchBuckets.values()) {
      if (bucket.length === 0) continue;

      const matchedCat = findMatchingCatalogPart(catalogList, bucket[0].partId, bucket[0].name);
      // Pick survivor: prefer doc with positive/higher qty or matching catalog partId
      const sorted = [...bucket].sort((a, b) => {
        const matchCatA = matchedCat && (a.partId === matchedCat.id || a.id === matchedCat.id) ? 1 : 0;
        const matchCatB = matchedCat && (b.partId === matchedCat.id || b.id === matchedCat.id) ? 1 : 0;
        if (matchCatA !== matchCatB) return matchCatB - matchCatA;
        const hasPartA = a.partId ? 1 : 0;
        const hasPartB = b.partId ? 1 : 0;
        if (hasPartA !== hasPartB) return hasPartB - hasPartA;
        return Number(b.quantity || 0) - Number(a.quantity || 0);
      });

      const survivor = sorted[0];
      const duplicates = sorted.slice(1);

      const canonicalPartId = matchedCat?.id || survivor.partId || sanitizePartDocId(survivor.name || survivor.id);
      const canonicalName = cleanDisplayText(matchedCat?.name || survivor.name);
      const grpSource = matchedCat || survivor;
      const canonicalGrp = resolveCanonicalGroupInfo(groupsList, {
        groupId: grpSource.groupId || survivor.groupId,
        groupName: grpSource.groupName || survivor.groupName,
        category: grpSource.category || survivor.category
      });
      const canonicalItemType = matchedCat?.itemType || survivor.itemType || (canonicalGrp.groupId ? 'electronic_part' : 'accessory_part');
      const canonicalCategory = canonicalGrp.groupName || cleanDisplayText(grpSource.category || survivor.category) || (canonicalItemType === 'electronic_part' ? 'قطع غيار إلكترونية' : 'قطع غيار وملحقات');

      if (duplicates.length > 0) {
        const mergedQty = sorted.reduce((acc, r) => acc + Number(r.quantity || 0), 0);
        const mergedUsed = sorted.reduce((acc, r) => acc + Number(r.usedQuantity || 0), 0);
        const bestUnitCost =
          sorted.map(r => Number(r.unitCost || 0)).find(v => v > 0) ?? Number(survivor.unitCost || 0);
        const bestSalePrice =
          sorted.map(r => Number(r.salePrice || 0)).find(v => v > 0) ?? Number(survivor.salePrice || 0);
        const bestSupplier =
          sorted.map(r => cleanDisplayText(r.supplierName)).find(v => v && v !== 'غير محدد') || survivor.supplierName || '';
        const bestPurchaseInvId =
          sorted.map(r => String(r.purchaseInvoiceId || '')).find(Boolean) || survivor.purchaseInvoiceId || '';
        const bestPurchaseInvNum =
          sorted.map(r => String(r.purchaseInvoiceNumber || '')).find(Boolean) || survivor.purchaseInvoiceNumber || '';

        const updatePayload: Record<string, any> = {
          partId: canonicalPartId,
          name: canonicalName,
          itemType: canonicalItemType,
          groupId: canonicalGrp.groupId,
          groupName: canonicalGrp.groupName,
          category: canonicalCategory,
          quantity: mergedQty,
          usedQuantity: mergedUsed,
          unitCost: bestUnitCost,
          salePrice: bestSalePrice,
          supplierName: bestSupplier,
          purchaseInvoiceId: bestPurchaseInvId,
          purchaseInvoiceNumber: bestPurchaseInvNum,
          updatedAt: serverTimestamp()
        };

        try { await provider.updateDoc('shop_parts_inventory', survivor.id, updatePayload); } catch (e) {}

        // Re-point invoice_items referencing duplicate stock IDs and delete duplicates
        const dupIds = new Set(duplicates.map(d => String(d.id)));
        for (const it of allInvoiceItems) {
          if (it.id && it.partInventoryId && dupIds.has(String(it.partInventoryId))) {
            try {
              await provider.updateDoc('invoice_items', it.id, { partInventoryId: survivor.id });
            } catch (e) {}
          }
        }

        for (const dup of duplicates) {
          try { await provider.deleteDoc('shop_parts_inventory', dup.id); } catch (e) {}
          mergedCount++;
        }

        try {
          const resAfter = await localDb.query(`SELECT * FROM shop_parts_inventory`);
          localDb.notify('shop_parts_inventory', resAfter?.values || []);
        } catch (e) {}
      } else {
        // Single doc: verify canonical metadata is in sync
        const needsMetaSync =
          String(survivor.partId || '') !== canonicalPartId ||
          cleanDisplayText(survivor.name) !== canonicalName ||
          String(survivor.itemType || '') !== canonicalItemType ||
          String(survivor.groupId || '') !== canonicalGrp.groupId ||
          cleanDisplayText(survivor.groupName) !== canonicalGrp.groupName ||
          cleanDisplayText(survivor.category) !== canonicalCategory;

        if (needsMetaSync) {
          const patch = {
            partId: canonicalPartId,
            name: canonicalName,
            itemType: canonicalItemType,
            groupId: canonicalGrp.groupId,
            groupName: canonicalGrp.groupName,
            category: canonicalCategory,
            updatedAt: serverTimestamp()
          };
          try { await provider.updateDoc('shop_parts_inventory', survivor.id, patch); } catch (e) {}
          syncedCount++;
        }
      }
    }

    // 7. Also sync group metadata on batch stock items if group was renamed
    for (const bs of batchStocks) {
      const matchedCat = findMatchingCatalogPart(catalogList, bs.partId, bs.name);
      const grpSource = matchedCat || bs;
      const canonicalGrp = resolveCanonicalGroupInfo(groupsList, {
        groupId: grpSource.groupId || bs.groupId,
        groupName: grpSource.groupName || bs.groupName,
        category: grpSource.category || bs.category
      });
      if (
        canonicalGrp.groupId &&
        canonicalGrp.groupName &&
        (String(bs.groupId || '') !== canonicalGrp.groupId ||
          cleanDisplayText(bs.groupName) !== canonicalGrp.groupName ||
          cleanDisplayText(bs.category) !== canonicalGrp.groupName)
      ) {
        const patch = {
          groupId: canonicalGrp.groupId,
          groupName: canonicalGrp.groupName,
          category: canonicalGrp.groupName,
          updatedAt: serverTimestamp()
        };
        try { await provider.updateDoc('shop_parts_inventory', bs.id, patch); } catch (e) {}
        syncedCount++;
      }
    }

    return { mergedCount, syncedCount };
  } catch (err) {
    console.warn('Error consolidating/syncing parts inventory:', err);
    return { mergedCount, syncedCount };
  }
}

async function fetchCloudDocsSafe(tableName: string, timeoutMs: number = 4500): Promise<any[]> {
  if (ProviderFactory.getMode() === 'LOCAL') return [];
  if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
  try {
    const snap: any = await Promise.race([
      FirebaseProviderInstance.getDocs(tableName),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    if (!snap || !snap.docs) return [];
    return snap.docs
      .map((d: any) => {
        const raw = typeof d.data === 'function' ? d.data() : d.data;
        return { ...(raw || {}), id: d.id || raw?.id };
      })
      .filter((x: any) => Boolean(x.id));
  } catch {
    return [];
  }
}

const parseAuditTimestampMs = (val: any): number => {
  if (!val) return 0;
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (typeof val?.toDate === 'function') return val.toDate().getTime();
  if (typeof val === 'number') return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

const isStructuralPurchaseInvoice = (inv: any): boolean => {
  if (!inv) return false;
  if (inv.isPurchase === true || inv.isPurchase === 1 || inv.isPurchase === '1') return true;
  const t = String(inv.invoiceType || inv.type || inv.templateType || '').toLowerCase().trim();
  if (t === 'purchase' || t.startsWith('purchase')) return true;
  const num = String(inv.invoiceNumber || '').trim().toUpperCase();
  if (num.startsWith('PUR-') || num.startsWith('DIS-')) return true;
  if (inv.purchaseType) return true;
  if ((inv.batchName || inv.batchTotalCost || inv.supplierId) && t !== 'maintenance' && !t.startsWith('sale_')) {
    return true;
  }
  return false;
};

export interface InventoryAuditRevertedStock {
  stockId: string;
  name: string;
  itemType: string;
  purchased: number;
  currentQty: number;
  currentUsed: number;
  targetQty: number;
  targetUsed: number;
  usedDelta: number;
}

export interface UnlinkedMaintenanceItemWarning {
  itemId: string;
  invoiceNumber: string;
  deviceName: string;
  sparePartsCost: number;
  engineerReport: string;
}

export interface InventoryUsedAuditPreview {
  healedHistoricalCount: number;
  updatedCount: number;
  revertedItems: InventoryAuditRevertedStock[];
  unlinkedMaintenanceItems: UnlinkedMaintenanceItemWarning[];
  electronicBefore: { available: number; used: number };
  electronicAfter: { available: number; used: number };
  accessoryBefore: { available: number; used: number };
  accessoryAfter: { available: number; used: number };
}

const VERIFIED_HISTORICAL_PARTS_BACKFILL: Record<string, any[]> = {
  // فاتورة 233 (KT x2) -> 2x كرت باور 5V-3V (تكلفة القطعة 2 = 4)
  x7zb5clzxkp: [
    {
      id: 'dpu_hist_233_pwr',
      partId: 'كرت باور 5V-3V',
      partName: 'كرت باور 5V-3V',
      groupId: 'مكثفات باور',
      groupName: 'مكثفات وقطع باور منوعة',
      quantity: 2,
      unitCost: 2,
      unitSalePrice: 4,
      isScrap: false,
      notes: '',
      addedInStage: 'maintenance'
    }
  ],
  // فاتورة 234 (KT) -> 1x كرت باور 5V-3V (تكلفة القطعة 2)
  '5rlwjshwgbu': [
    {
      id: 'dpu_hist_234_pwr',
      partId: 'كرت باور 5V-3V',
      partName: 'كرت باور 5V-3V',
      groupId: 'مكثفات باور',
      groupName: 'مكثفات وقطع باور منوعة',
      quantity: 1,
      unitCost: 2,
      unitSalePrice: 4,
      isScrap: false,
      notes: '',
      addedInStage: 'maintenance'
    }
  ],
  // فاتورة 237 (مودم جيل ثاني) -> 2x capacitor 35/100 (مستردة من نقطة الاستعادة المعتمدة)
  bbazbgfdj99: [
    {
      id: 'dpu_1795295137467',
      partId: 'capacitor 35_100',
      partName: 'capacitor 35/100',
      groupId: 'مكثفات باور',
      groupName: 'مكثفات وقطع باور منوعة',
      quantity: 2,
      unitCost: 0.5,
      unitSalePrice: 5,
      isScrap: false,
      notes: '',
      addedInStage: 'inspection'
    }
  ],
  // فاتورة 239 (فايكوم) -> 1x كرت باور 5V-3V (مطابقة للطابع الزمني 16:43:53 والتكلفة 2)
  evb744i1o5q: [
    {
      id: 'dpu_hist_239_pwr',
      partId: 'كرت باور 5V-3V',
      partName: 'كرت باور 5V-3V',
      groupId: 'مكثفات باور',
      groupName: 'مكثفات وقطع باور منوعة',
      quantity: 1,
      unitCost: 2,
      unitSalePrice: 4,
      isScrap: false,
      notes: '',
      addedInStage: 'maintenance'
    }
  ],
  // فاتورة 240 (1100X2) -> 1x capacitor 16/1000 (مطابقة للطابع الزمني 16:43:47 والتكلفة 0.5)
  '9a1r4t92xqo': [
    {
      id: 'dpu_hist_240_cap',
      partId: 'capacitor 16_1000',
      partName: 'capacitor 16/1000',
      groupId: 'مكثفات باور',
      groupName: 'مكثفات وقطع باور منوعة',
      quantity: 1,
      unitCost: 0.5,
      unitSalePrice: 5,
      isScrap: false,
      notes: '',
      addedInStage: 'maintenance'
    }
  ]
};

/**
 * Idempotently restores verified historical partsUsed arrays on existing maintenance invoice_items
 * whose partsUsed field was cleared by legacy sync/serialization while retaining hasNoParts=0 & sparePartsCost>0.
 */
export async function healVerifiedHistoricalMaintenanceParts(): Promise<number> {
  try {
    const provider = ProviderFactory.getProvider();
    const targetIds = Object.keys(VERIFIED_HISTORICAL_PARTS_BACKFILL);
    if (targetIds.length === 0) return 0;

    const pendingOutboxItemIds = new Set<string>();
    try {
      const outRes = await localDb.query(
        `SELECT recordId FROM outbox WHERE tableName = 'invoice_items' AND status IN ('PENDING', 'FAILED')`
      );
      outRes?.values?.forEach((r: any) => {
        if (r?.recordId) pendingOutboxItemIds.add(String(r.recordId));
      });
    } catch (_) {}

    const rowsById = new Map<string, any>();
    try {
      const placeholders = targetIds.map(() => '?').join(',');
      const res = await localDb.query(
        `SELECT * FROM invoice_items WHERE id IN (${placeholders})`,
        targetIds
      );
      res?.values?.forEach((r: any) => {
        if (r?.id) rowsById.set(String(r.id), r);
      });
    } catch (_) {}

    if (rowsById.size === 0) {
      const cloudItems = await fetchCloudDocsSafe('invoice_items', 3500);
      for (const c of cloudItems) {
        if (c?.id && VERIFIED_HISTORICAL_PARTS_BACKFILL[String(c.id)]) {
          rowsById.set(String(c.id), c);
        }
      }
    }

    let healedCount = 0;
    for (const itemId of targetIds) {
      if (pendingOutboxItemIds.has(itemId)) continue;
      const row = rowsById.get(itemId);
      if (!row) continue;

      const sLower = String(row.status || '').toLowerCase().trim();
      const isCancelled =
        sLower === '70' ||
        sLower === 'cancelled' ||
        row.isCancelled === 1 ||
        row.isCancelled === true ||
        row.isCancelled === '1';
      if (isCancelled) continue;

      const existingParts = normalizePartsUsedList(row.partsUsed);
      const hasNoPartsFlag = Number(row.hasNoParts || 0) === 1 || row.hasNoParts === true;
      const spareCost = Number(row.sparePartsCost || 0);

      if (existingParts.length === 0 && !hasNoPartsFlag && spareCost > 0) {
        const verifiedParts = VERIFIED_HISTORICAL_PARTS_BACKFILL[itemId].map(p => ({ ...p }));
        try {
          await provider.updateDoc('invoice_items', itemId, { partsUsed: verifiedParts }, undefined, true);
          healedCount++;
        } catch (err) {
          console.warn(`[healVerifiedHistoricalMaintenanceParts] Failed updating ${itemId}:`, err);
        }
      }
    }

    if (healedCount > 0 && localDb.hasObservers('invoice_items')) {
      try {
        const resAfter = await localDb.query(`SELECT * FROM invoice_items`);
        localDb.notify('invoice_items', resAfter?.values || []);
      } catch (_) {}
    }

    return healedCount;
  } catch (err) {
    console.warn('[healVerifiedHistoricalMaintenanceParts] warning:', err);
    return 0;
  }
}

async function computeInventoryUsedAuditPlan(): Promise<{
  consolidateRes: { mergedCount: number; syncedCount: number };
  updates: Array<{ stockId: string; updatePayload: { usedQuantity: number; quantity: number; updatedAt: any } }>;
  preview: InventoryUsedAuditPreview;
}> {
  const provider = ProviderFactory.getProvider();

  // Step 0a: Ensure verified historical maintenance partsUsed records are healed first
  const healedHistoricalCount = await healVerifiedHistoricalMaintenanceParts();

  // Step 0b: Consolidate duplicate non-batch stock items & sync group renames before counting
  const consolidateRes = await consolidateAndSyncPartsInventory();

  // Load local tombstones & pending outbox operations so deleted items are never resurrected
  const localTombstonesByTable = new Map<string, Set<string>>();
  try {
    const tombRes = await localDb.query(`SELECT tableName, recordId FROM deleted_records`);
    tombRes?.values?.forEach((row: any) => {
      if (row?.tableName && row?.recordId) {
        if (!localTombstonesByTable.has(row.tableName)) {
          localTombstonesByTable.set(row.tableName, new Set());
        }
        localTombstonesByTable.get(row.tableName)!.add(String(row.recordId));
      }
    });
  } catch (e) {}

  const pendingOutboxItemIds = new Set<string>();
  try {
    const outRes = await localDb.query(
      `SELECT recordId FROM outbox WHERE tableName = 'invoice_items' AND status IN ('PENDING', 'FAILED')`
    );
    outRes?.values?.forEach((r: any) => {
      if (r?.recordId) pendingOutboxItemIds.add(String(r.recordId));
    });
  } catch (e) {}

  const isTombstoned = (tbl: string, id: string) =>
    localTombstonesByTable.get(tbl)?.has(String(id)) ?? false;

  // 1. Fetch all shop inventory items (Local SQLite + best-effort Cloud merge)
  const stockMap = new Map<string, any>();
  try {
    const resStock = await localDb.query(`SELECT * FROM shop_parts_inventory`);
    resStock?.values?.forEach(s => { if (s.id) stockMap.set(String(s.id), s); });
  } catch (e) {}
  if (stockMap.size === 0) {
    try {
      const snapStock = await getDocs(collection(db, 'shop_parts_inventory'));
      snapStock.forEach(d => {
        if (!stockMap.has(d.id)) stockMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}
  }
  const allStocksList = Array.from(stockMap.values());

  // 1b. Fetch parts_catalog to resolve renamed parts by partId <-> name
  const catalogMap = new Map<string, any>();
  try {
    const resCat = await localDb.query(`SELECT * FROM parts_catalog`);
    resCat?.values?.forEach(c => { if (c.id) catalogMap.set(String(c.id), c); });
  } catch (e) {}
  const cloudCatalog = await fetchCloudDocsSafe('parts_catalog', 3500);
  for (const cc of cloudCatalog) {
    if (cc.id && !catalogMap.has(String(cc.id)) && !isTombstoned('parts_catalog', String(cc.id))) {
      catalogMap.set(String(cc.id), cc);
    }
  }
  const catalogList = Array.from(catalogMap.values());

  // 2. Fetch all invoices (Local SQLite + best-effort Cloud merge)
  const rawInvoicesMap = new Map<string, any>();
  try {
    const resInv = await localDb.query(`SELECT * FROM invoices`);
    resInv?.values?.forEach(inv => {
      if (inv?.id) rawInvoicesMap.set(String(inv.id), inv);
    });
  } catch (e) {}
  if (rawInvoicesMap.size === 0) {
    try {
      const snapInv = await getDocs(collection(db, 'invoices'));
      snapInv.forEach(d => {
        if (!rawInvoicesMap.has(d.id)) rawInvoicesMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (e) {}
  }
  const cloudInvoices = await fetchCloudDocsSafe('invoices', 4500);
  for (const cInv of cloudInvoices) {
    const cid = String(cInv.id || '');
    if (!cid || isTombstoned('invoices', cid)) continue;
    if (!rawInvoicesMap.has(cid)) {
      rawInvoicesMap.set(cid, cInv);
    }
  }

  // 3. Fetch ALL invoice_items (Local SQLite + best-effort Cloud merge & partsUsed recovery)
  const itemsMap = new Map<string, any>();
  try {
    const resItems = await localDb.query(`SELECT * FROM invoice_items`);
    resItems?.values?.forEach(it => { if (it.id) itemsMap.set(String(it.id), it); });
  } catch (e) {}
  if (itemsMap.size === 0) {
    try {
      const snapItems = await getDocs(collection(db, 'invoice_items'));
      snapItems.forEach(d => {
        const id = d.id;
        const data = d.data();
        if (!itemsMap.has(id)) {
          itemsMap.set(id, { id, ...data });
        }
      });
    } catch (e) {}
  }

  const cloudItems = await fetchCloudDocsSafe('invoice_items', 5000);
  for (const cItem of cloudItems) {
    const cid = String(cItem.id || '');
    if (!cid || isTombstoned('invoice_items', cid)) continue;

    const existingLocal = itemsMap.get(cid);
    if (!existingLocal) {
      if (cItem.partsUsed !== undefined) {
        cItem.partsUsed = normalizePartsUsedList(cItem.partsUsed);
      }
      itemsMap.set(cid, cItem);
    } else {
      const localParts = normalizePartsUsedList(existingLocal.partsUsed);
      const cloudParts = normalizePartsUsedList(cItem.partsUsed);
      if (localParts.length === 0 && cloudParts.length > 0 && !pendingOutboxItemIds.has(cid)) {
        const localStatusLower = String(existingLocal.status || '').toLowerCase().trim();
        const localSubLower = String(existingLocal.subStatus || '').toLowerCase().trim();
        const localIsFailure =
          ['70', 'cancelled', '55', '45', 'unrepairable', 'refused', 'no_parts', 'intact'].includes(localStatusLower) ||
          ['unrepairable', 'refused', 'no_parts', 'customer_refused', 'cancelled', 'intact'].includes(localSubLower);
        const localMs = parseAuditTimestampMs(existingLocal.updatedAt);
        const cloudMs = parseAuditTimestampMs(cItem.updatedAt);
        const localWasCorruptOrEmpty =
          existingLocal.partsUsed === null ||
          existingLocal.partsUsed === undefined ||
          existingLocal.partsUsed === '' ||
          (typeof existingLocal.partsUsed === 'string' && !existingLocal.partsUsed.trim().startsWith('['));

        if (!localIsFailure && (cloudMs >= localMs || localWasCorruptOrEmpty || localMs === 0)) {
          existingLocal.partsUsed = cloudParts;
          try {
            await provider.updateDoc('invoice_items', cid, { partsUsed: cloudParts }, undefined, true);
          } catch (e) {}
        }
      }
    }
  }

  // Build invoice lookup map AND track whether an invoice with status '70' actually has repaired/active items
  const nonCancelledItemsCountByInvKey = new Map<string, number>();
  const nonDeductedStatuses = new Set([
    '10', 'new',
    '20', '21', '22', 'inspection', 'testing', 'inspected',
    '25', '30', 'waiting_approval', 'awaiting_approval',
    '35', 'waiting_parts', 'awaiting_parts',
    '40', 'repairing', 'in_progress',
    '45', '70', 'cancelled'
  ]);

  for (const it of itemsMap.values()) {
    const sLower = String(it.status || '').toLowerCase().trim();
    const itCanc =
      sLower === 'cancelled' ||
      sLower === '70' ||
      it.isCancelled === 1 ||
      it.isCancelled === true ||
      it.isCancelled === '1';
    const invId = String(it.invoiceId || '').trim();
    const cleanNum = normalizeInvoiceNum(it.invoiceNumber);
    const rawNum = String(it.invoiceNumber || '').trim();
    for (const k of [invId, cleanNum, rawNum]) {
      if (!k) continue;
      if (!itCanc) {
        nonCancelledItemsCountByInvKey.set(k, (nonCancelledItemsCountByInvKey.get(k) || 0) + 1);
      }
    }
  }

  const invoicesMap = new Map<string, { isPurchase: boolean; isSaleParts: boolean; isWhollyCancelled: boolean }>();
  for (const inv of rawInvoicesMap.values()) {
    if (!inv) continue;
    const isPur = isStructuralPurchaseInvoice(inv);
    const tLower = String(inv.invoiceType || inv.type || inv.templateType || '').toLowerCase().trim();
    const sLower = String(inv.status || '').toLowerCase().trim();
    const isSP = !isPur && (tLower === 'sale_parts' || tLower === 'parts' || sLower === 'sale_parts');

    const explicitCancelFlag =
      sLower === 'cancelled' ||
      inv.isCancelled === 1 ||
      inv.isCancelled === true ||
      inv.isCancelled === '1';

    const keys = [
      inv.id ? String(inv.id).trim() : '',
      inv.invoiceNumber ? normalizeInvoiceNum(inv.invoiceNumber) : '',
      inv.invoiceNumber ? String(inv.invoiceNumber).trim() : ''
    ].filter(Boolean);

    const hasActiveNonCancelledItems = keys.some(k => (nonCancelledItemsCountByInvKey.get(k) || 0) > 0);
    const isWhollyCancelled =
      (explicitCancelFlag || sLower === '70') && !hasActiveNonCancelledItems;

    const entry = { isPurchase: isPur, isSaleParts: isSP, isWhollyCancelled };
    for (const k of keys) {
      invoicesMap.set(k, entry);
    }
  }

  // 4. Collect stats in deterministic passes
  const statsMap = new Map<string, { purchased: number; used: number }>();
  const ensureStats = (sId: string) => {
    if (!statsMap.has(sId)) statsMap.set(sId, { purchased: 0, used: 0 });
    return statsMap.get(sId)!;
  };

  const directSaleQueue: Array<{ stockId?: string; partId?: string; partName?: string; batchId?: string; qty: number }> = [];
  const maintenancePartsQueue: Array<{ partId?: string; partName?: string; qty: number }> = [];
  const unlinkedMaintenanceItems: UnlinkedMaintenanceItemWarning[] = [];

  const nonFailureReasonTexts = new Set([
    '',
    '-',
    '--',
    '---',
    'لا يوجد',
    'جاهز',
    'سليم',
    'انتظار قطع الغيار',
    'في انتظار قطع الغيار',
    'تم الإصلاح',
    'none',
    'null',
    'ready'
  ]);

  for (const item of itemsMap.values()) {
    const itemStatusLower = String(item.status || '').toLowerCase().trim();
    const isItemCancelled =
      itemStatusLower === 'cancelled' ||
      itemStatusLower === '70' ||
      item.isCancelled === 1 ||
      item.isCancelled === true ||
      item.isCancelled === '1';
    if (isItemCancelled) continue;

    const invoiceId = String(item.invoiceId || '').trim();
    const cleanInvNum = normalizeInvoiceNum(item.invoiceNumber);
    const parentInv =
      invoicesMap.get(invoiceId) ||
      invoicesMap.get(cleanInvNum) ||
      invoicesMap.get(String(item.invoiceNumber || '').trim());
    if (parentInv?.isWhollyCancelled) continue;

    const itemSourceLower = String(item.source || '').toLowerCase().trim();
    const isItemPurchase = item.isPurchase === true || item.isPurchase === 1 || item.isPurchase === '1';
    const isInvoicePurchase = parentInv?.isPurchase === true;
    const isActuallyPurchase = isItemPurchase || isInvoicePurchase || itemSourceLower.includes('purchase');

    const isDirectSaleParts =
      !isActuallyPurchase &&
      (Boolean(item.partInventoryId) ||
        itemSourceLower === 'sale_parts' ||
        itemStatusLower === 'sale_parts' ||
        (Boolean(parentInv?.isSaleParts) && itemSourceLower !== 'maintenance'));

    // A) Direct Part Item (Purchase or Direct Sale)
    if (isActuallyPurchase) {
      let targetStockId = item.partInventoryId && stockMap.has(String(item.partInventoryId))
        ? String(item.partInventoryId)
        : '';

      if (!targetStockId) {
        const itemName = item.deviceName || item.deviceType || item.name || '';
        const fallbackMatch = findMatchingStockCandidates(allStocksList, {
          partId: item.partId,
          partName: itemName,
          batchId: item.batchId || undefined
        })[0];
        if (fallbackMatch?.id) {
          targetStockId = String(fallbackMatch.id);
        }
      }

      if (targetStockId) {
        ensureStats(targetStockId).purchased += Number(item.quantity || 0);
      }
    } else if (isDirectSaleParts) {
      const qty = Number(item.quantity || 0);
      if (qty > 0) {
        directSaleQueue.push({
          stockId: item.partInventoryId ? String(item.partInventoryId) : undefined,
          partId: item.partId ? String(item.partId) : undefined,
          partName: item.deviceName || item.deviceType || item.name || '',
          batchId: item.batchId ? String(item.batchId) : undefined,
          qty
        });
      }
    }

    // B) Maintenance Item with partsUsed
    const partsList = normalizePartsUsedList(item.partsUsed);

    if (item.id && partsList.length > 0 && item.partsUsed) {
      const needsHeal =
        (typeof item.partsUsed === 'string' && !item.partsUsed.trim().startsWith('[')) ||
        (typeof item.partsUsed === 'object' && !Array.isArray(item.partsUsed));
      if (needsHeal) {
        try {
          await provider.updateDoc('invoice_items', String(item.id), { partsUsed: partsList }, undefined, true);
        } catch (e) {}
      }
    }

    if (!isActuallyPurchase && !isDirectSaleParts) {
      const subStatusLower = String(item.subStatus || '').toLowerCase().trim();
      const reasonClean = cleanDisplayText(item.failureReason).toLowerCase();

      const isExplicitRepaired = ['ready', 'repaired', 'delivered', 'completed'].includes(subStatusLower);
      const isTerminalSubFailure = [
        'unrepairable', 'refused', 'no_parts', 'customer_refused',
        'failed', 'parts_not_available', 'cancelled', 'intact'
      ].includes(subStatusLower);
      const isTerminalStatusFailure = [
        'unrepairable', 'refused', 'no_parts', 'parts_not_available',
        'intact', '55', '45', '70', 'cancelled'
      ].includes(itemStatusLower);
      const isTerminalSourceFailure = ['refused', 'unrepairable', 'failed', 'cancelled'].includes(itemSourceLower);
      const hasMeaningfulFailureReason =
        !isExplicitRepaired &&
        !subStatusLower &&
        Boolean(reasonClean) &&
        !nonFailureReasonTexts.has(reasonClean) &&
        (
          reasonClean.includes('لا يصلح') ||
          reasonClean.includes('لم يوافق') ||
          reasonClean.includes('رفض') ||
          reasonClean.includes('عدم توفر') ||
          reasonClean.includes('لم تتوفر') ||
          reasonClean.includes('ملغ') ||
          reasonClean.includes('انسحاب') ||
          reasonClean.includes('سليم')
        );

      const isFailedOrRefused =
        isTerminalSubFailure ||
        isTerminalStatusFailure ||
        isTerminalSourceFailure ||
        hasMeaningfulFailureReason;

      const isNotYetRepaired = nonDeductedStatuses.has(itemStatusLower);

      if (!isFailedOrRefused && !isNotYetRepaired) {
        if (partsList.length > 0) {
          for (const p of partsList) {
            if (p.isScrap === true || p.isScrap === 1 || p.isScrap === '1') continue;
            const rawQty = p.quantity ?? p.count ?? p.qty ?? 1;
            const partQty = Number(rawQty);
            if (!isFinite(partQty) || partQty <= 0) continue;

            const partName = cleanDisplayText(p.partName || p.name || p.part || '');
            const partId = String(p.partId || p.id || '').trim() || undefined;
            if (!partId && !partName) continue;

            maintenancePartsQueue.push({
              partId,
              partName,
              qty: partQty
            });
          }
        } else {
          // Track active repaired maintenance items that indicate parts (hasNoParts===0 or sparePartsCost>0)
          // yet have empty partsUsed[] so the user is warned if stock counters would drop!
          const spareCost = Number(item.sparePartsCost || 0);
          const hasNoPartsExplicitFalse =
            item.hasNoParts === 0 || item.hasNoParts === false || item.hasNoParts === '0';
          if (spareCost > 0 || hasNoPartsExplicitFalse) {
            unlinkedMaintenanceItems.push({
              itemId: String(item.id || ''),
              invoiceNumber: String(item.invoiceNumber || ''),
              deviceName: cleanDisplayText(item.deviceName || item.deviceType || ''),
              sparePartsCost: spareCost,
              engineerReport: cleanDisplayText(item.engineerReport || '')
            });
          }
        }
      }
    }
  }

  const allocateConsumption = (candidates: any[], totalQty: number, preferredStockId?: string) => {
    if (totalQty <= 0) return;

    const seen = new Set<string>();
    const ordered: any[] = [];
    if (preferredStockId && stockMap.has(preferredStockId)) {
      const pref = stockMap.get(preferredStockId);
      if (pref) {
        ordered.push(pref);
        seen.add(preferredStockId);
      }
    }

    const sortedOthers = candidates
      .filter(c => c?.id && !seen.has(String(c.id)))
      .sort((a, b) => {
        const stA = statsMap.get(String(a.id)) || { purchased: 0, used: 0 };
        const stB = statsMap.get(String(b.id)) || { purchased: 0, used: 0 };
        const capA = stA.purchased - stA.used;
        const capB = stB.purchased - stB.used;
        if ((capA > 0 ? 1 : 0) !== (capB > 0 ? 1 : 0)) {
          return (capB > 0 ? 1 : 0) - (capA > 0 ? 1 : 0);
        }
        const nbA = isNonBatchStock(a) ? 1 : 0;
        const nbB = isNonBatchStock(b) ? 1 : 0;
        if (nbA !== nbB) return nbB - nbA;
        return capB - capA;
      });

    ordered.push(...sortedOthers);
    if (ordered.length === 0) return;

    let remaining = totalQty;
    for (const cand of ordered) {
      if (remaining <= 0) break;
      const sId = String(cand.id);
      const st = ensureStats(sId);
      const availableCap = st.purchased - st.used;
      if (availableCap > 0) {
        const take = Math.min(availableCap, remaining);
        st.used += take;
        remaining -= take;
      }
    }

    if (remaining > 0) {
      const fallbackPrimary =
        (preferredStockId && stockMap.has(preferredStockId) ? stockMap.get(preferredStockId) : null) ||
        ordered.find(c => isNonBatchStock(c)) ||
        ordered[0];
      if (fallbackPrimary?.id) {
        ensureStats(String(fallbackPrimary.id)).used += remaining;
      }
    }
  };

  const resolveStockCandidatesForPart = (partId?: string, partName?: string) => {
    let candidates = findMatchingStockCandidates(allStocksList, { partId, partName });
    if (candidates.length === 0 && catalogList.length > 0) {
      const matchedCat = findMatchingCatalogPart(catalogList, partId, partName);
      if (matchedCat) {
        candidates = findMatchingStockCandidates(allStocksList, {
          partId: matchedCat.id,
          partName: matchedCat.name
        });
      }
    }
    return candidates;
  };

  // Pass B1: Direct part sales
  for (const ds of directSaleQueue) {
    const candidates = resolveStockCandidatesForPart(ds.partId, ds.partName);
    allocateConsumption(candidates, ds.qty, ds.stockId);
  }

  // Pass B2: Maintenance part deductions
  for (const mp of maintenancePartsQueue) {
    const candidates = resolveStockCandidatesForPart(mp.partId, mp.partName);
    allocateConsumption(candidates, mp.qty);
  }

  const updates: Array<{ stockId: string; updatePayload: { usedQuantity: number; quantity: number; updatedAt: any } }> = [];
  const revertedItems: InventoryAuditRevertedStock[] = [];
  const electronicBefore = { available: 0, used: 0 };
  const electronicAfter = { available: 0, used: 0 };
  const accessoryBefore = { available: 0, used: 0 };
  const accessoryAfter = { available: 0, used: 0 };

  for (const stock of allStocksList) {
    const sId = String(stock.id);
    const st = statsMap.get(sId) || { purchased: 0, used: 0 };

    const currentUsed = Number(stock.usedQuantity || 0);
    const currentQty = Number(stock.quantity || 0);

    const targetUsed = st.used;
    let targetQty = currentQty;

    if (st.purchased > 0) {
      targetQty = st.purchased - targetUsed;
    } else {
      const totalStock = currentQty + currentUsed;
      targetQty = totalStock - targetUsed;
    }

    if (stock.itemType === 'electronic_part') {
      electronicBefore.available += Math.max(0, currentQty);
      electronicBefore.used += currentUsed;
      electronicAfter.available += Math.max(0, targetQty);
      electronicAfter.used += targetUsed;
    } else if (stock.itemType === 'accessory_part') {
      accessoryBefore.available += Math.max(0, currentQty);
      accessoryBefore.used += currentUsed;
      accessoryAfter.available += Math.max(0, targetQty);
      accessoryAfter.used += targetUsed;
    }

    if (targetUsed < currentUsed) {
      revertedItems.push({
        stockId: sId,
        name: cleanDisplayText(stock.name || ''),
        itemType: String(stock.itemType || 'electronic_part'),
        purchased: st.purchased,
        currentQty,
        currentUsed,
        targetQty,
        targetUsed,
        usedDelta: targetUsed - currentUsed
      });
    }

    if (targetUsed !== currentUsed || targetQty !== currentQty) {
      updates.push({
        stockId: sId,
        updatePayload: {
          usedQuantity: targetUsed,
          quantity: targetQty,
          updatedAt: serverTimestamp()
        }
      });
    }
  }

  return {
    consolidateRes,
    updates,
    preview: {
      healedHistoricalCount,
      updatedCount: updates.length + consolidateRes.mergedCount + consolidateRes.syncedCount,
      revertedItems,
      unlinkedMaintenanceItems,
      electronicBefore,
      electronicAfter,
      accessoryBefore,
      accessoryAfter
    }
  };
}

/**
 * Inspects and previews the effect of recalculating inventory usedQuantity without modifying stock counts.
 * Heals verified historical partsUsed entries first, then flags any remaining stock deductions that would shrink.
 */
export async function previewInventoryUsedAudit(): Promise<InventoryUsedAuditPreview> {
  const { preview } = await computeInventoryUsedAuditPlan();
  return preview;
}

/**
 * Recalculates 'usedQuantity' and 'quantity' for all items in shop_parts_inventory based on historical invoice_items.
 * Heals verified historical partsUsed, consolidates duplicates first, recovers cloud partsUsed payloads, and distributes deductions idempotently.
 */
export async function recalculateInventoryUsedQuantities(): Promise<{ updatedCount: number }> {
  try {
    const provider = ProviderFactory.getProvider();
    const { consolidateRes, updates } = await computeInventoryUsedAuditPlan();

    let updatedCount = 0;
    for (const { stockId, updatePayload } of updates) {
      try {
        await provider.updateDoc('shop_parts_inventory', stockId, updatePayload, undefined, true);
        updatedCount++;
      } catch (e) {
        console.warn(`Failed to update stock ${stockId}:`, e);
      }
    }

    if (updatedCount > 0) {
      try {
        const resAfter = await localDb.query(`SELECT * FROM shop_parts_inventory`);
        localDb.notify('shop_parts_inventory', resAfter?.values || []);
      } catch (e) {}
    }

    return { updatedCount: updatedCount + consolidateRes.mergedCount + consolidateRes.syncedCount };
  } catch (err) {
    console.error('Error recalculating inventory used quantities:', err);
    return { updatedCount: 0 };
  }
}



