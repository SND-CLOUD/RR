import { db, doc, getDoc, getDocs, collection, writeBatch, serverTimestamp, query, where } from '../firebase';
import { localDb } from './local-db';
import { Invoice, InvoiceItem } from '../types';

/**
 * Determines whether a device item was rejected by customer, cannot be repaired,
 * or lacked required spare parts, meaning it should NOT incur repair costs.
 */
export function isItemRefusedOrFailed(item: any): boolean {
  if (!item) return false;

  const sub = String(item.subStatus || '').toLowerCase().trim();
  const status = String(item.status || '').toLowerCase().trim();
  const src = String(item.source || '').toLowerCase().trim();
  const failureReason = String(item.failureReason || '').toLowerCase().trim();
  const engineerReport = String(item.engineerReport || '').toLowerCase().trim();
  const technicalNotes = String(item.technicalNotes || '').toLowerCase().trim();

  // Explicit subStatus codes
  if (['refused', 'unrepairable', 'no_parts', 'parts_not_available', 'failed', 'cancelled'].includes(sub)) {
    return true;
  }

  // Explicit status codes
  if (['70', 'cancelled', '55', '45'].includes(status)) {
    return true;
  }

  // Explicit source codes
  if (['refused', 'unrepairable', 'no_parts', 'parts_not_available', 'failed', 'cancelled'].includes(src)) {
    return true;
  }

  // Common keywords in failure reason
  const failureKeywords = [
    'لم يوافق',
    'رفض',
    'لا تصلح',
    'لا يصلح',
    'لم يتم الاصلاح',
    'لم يتم الإصلاح',
    'تعذر الاصلاح',
    'تعذر الإصلاح',
    'قطع الغيار',
    'عدم توفر قطع',
    'لم تتوفر قطع',
    'قطع غير متوفرة',
    'بدون قطع'
  ];

  if (failureReason && failureKeywords.some(kw => failureReason.includes(kw))) {
    return true;
  }

  // Decision outcome in engineer report / technical notes
  if (engineerReport && failureKeywords.some(kw => engineerReport.includes(kw))) {
    // Only if it represents a terminal decision (not merely diagnostic note in active stage)
    if (['50', '60', 'ready', 'delivered'].includes(status) || sub !== '') {
      return true;
    }
  }

  if (technicalNotes && failureKeywords.some(kw => technicalNotes.includes(kw))) {
    if (['50', '60', 'ready', 'delivered'].includes(status) || sub !== '') {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether an item should be billed to the customer.
 */
export function isItemBillable(item: any): boolean {
  return !isItemRefusedOrFailed(item);
}

/**
 * Gets the actual billable cost of an item.
 * If the item is rejected, unrepairable, or parts not available, returns 0.
 */
export function getItemBillableCost(item: any): number {
  if (!item) return 0;
  if (isItemRefusedOrFailed(item)) {
    return 0;
  }
  const cost = Number(item.cost);
  return isNaN(cost) || cost < 0 ? 0 : cost;
}

/**
 * Calculates the exact billable total of an invoice based on its billable items,
 * properly accounting for discount (discount or discountAmount) and taxes.
 */
export function calculateInvoiceBillableTotal(invoice: any, invoiceItems: any[]): number {
  if (!invoice) return 0;

  const invNum = String(invoice.invoiceNumber || '').replace('#', '').trim();
  const invId = String(invoice.id || '').trim();

  let items = invoiceItems || [];
  // If invoiceItems has mixed items (e.g. from the entire db), filter by this invoice
  if (items.length > 0 && (invId || invNum)) {
    const matching = items.filter(it => {
      const itId = String(it.invoiceId || '').trim();
      const itNum = String(it.invoiceNumber || '').replace('#', '').trim();
      const matchId = invId && itId === invId;
      const matchNum = invNum && itNum === invNum;
      return matchId || matchNum;
    });
    if (matching.length > 0) {
      items = matching;
    }
  }

  const rawBillableSum = items.reduce((sum, it) => sum + getItemBillableCost(it), 0);
  const discount = Number(invoice.discount !== undefined ? invoice.discount : (invoice.discountAmount || 0));
  const tax = Number(invoice.tax !== undefined ? invoice.tax : (invoice.taxAmount || 0));

  return Math.max(0, rawBillableSum - discount + tax);
}

/**
 * Returns a complete financial breakdown of an invoice (gross items total, billable total, discount, tax, and net payable).
 */
export function getInvoiceFinancialBreakdown(invoice: any, invoiceItems: any[]) {
  if (!invoice) return { rawSum: 0, billableSum: 0, discount: 0, tax: 0, netTotal: 0 };

  const invNum = String(invoice.invoiceNumber || '').replace('#', '').trim();
  const invId = String(invoice.id || '').trim();

  let items = invoiceItems || [];
  if (items.length > 0 && (invId || invNum)) {
    const matching = items.filter(it => {
      const itId = String(it.invoiceId || '').trim();
      const itNum = String(it.invoiceNumber || '').replace('#', '').trim();
      const matchId = invId && itId === invId;
      const matchNum = invNum && itNum === invNum;
      return matchId || matchNum;
    });
    if (matching.length > 0) {
      items = matching;
    }
  }

  const rawSum = items.reduce((sum, it) => sum + (Number(it.cost) || 0), 0);
  const billableSum = items.reduce((sum, it) => sum + getItemBillableCost(it), 0);
  const discount = Number(invoice.discount !== undefined ? invoice.discount : (invoice.discountAmount || 0));
  const tax = Number(invoice.tax !== undefined ? invoice.tax : (invoice.taxAmount || 0));
  const netTotal = Math.max(0, billableSum - discount + tax);

  return {
    rawSum,
    billableSum,
    discount,
    tax,
    netTotal
  };
}

/**
 * Recalculates and updates the totalCost of an invoice in Firestore.
 */
export async function recalculateAndSaveInvoiceTotal(
  invoiceId: string,
  invoiceNumber: string,
  currentItems: any[]
): Promise<number> {
  if (!invoiceId && !invoiceNumber) return 0;

  try {
    let invDocRef = invoiceId ? doc(db, 'invoices', invoiceId) : null;
    let invData: any = null;

    if (invDocRef) {
      const snap = await getDoc(invDocRef);
      if (snap.exists()) {
        invData = { id: snap.id, ...snap.data() };
      }
    }

    if (!invData && invoiceNumber) {
      const q = query(collection(db, 'invoices'), where('invoiceNumber', '==', invoiceNumber));
      const snaps = await getDocs(q);
      if (!snaps.empty) {
        invDocRef = snaps.docs[0].ref;
        invData = { id: snaps.docs[0].id, ...snaps.docs[0].data() };
      }
    }

    if (!invDocRef || !invData) return 0;

    const newTotal = calculateInvoiceBillableTotal(invData, currentItems);

    const batch = writeBatch(db);
    batch.update(invDocRef, {
      totalCost: newTotal,
      updatedAt: serverTimestamp()
    });
    await batch.commit();

    // Also update local DB if available
    try {
      if (localDb && (localDb as any).invoices) {
        await (localDb as any).invoices.update(invData.id, {
          totalCost: newTotal
        });
      }
    } catch (e) {
      console.warn('Could not update localDb invoice total:', e);
    }

    return newTotal;
  } catch (err) {
    console.error('Error recalculating invoice total:', err);
    return 0;
  }
}

/**
 * Retroactive Cleanup Utility:
 * Scans all items in Firestore `invoice_items` that are refused, unrepairable, or no_parts
 * and sets their cost to 0, storing the previous cost in estimatedCost.
 * Also recalculates and updates the totalCost of all affected invoices.
 */
export async function runRetroactiveNonBillableCleanup(): Promise<{
  updatedItemsCount: number;
  updatedInvoicesCount: number;
  totalCostZeroed: number;
}> {
  try {
    const itemsSnap = await getDocs(collection(db, 'invoice_items'));
    const invoicesSnap = await getDocs(collection(db, 'invoices'));

    const allInvoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const allItems = itemsSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() } as any));

    let updatedItemsCount = 0;
    let totalCostZeroed = 0;
    const affectedInvoiceNumbers = new Set<string>();
    const affectedInvoiceIds = new Set<string>();

    const itemUpdateBatches: { ref: any; updates: any }[] = [];

    for (const item of allItems) {
      if (isItemRefusedOrFailed(item)) {
        const currentCost = Number(item.cost || 0);
        if (currentCost > 0) {
          totalCostZeroed += currentCost;
          updatedItemsCount++;

          if (item.invoiceNumber) affectedInvoiceNumbers.add(String(item.invoiceNumber).trim());
          if (item.invoiceId) affectedInvoiceIds.add(String(item.invoiceId).trim());

          itemUpdateBatches.push({
            ref: item.ref,
            updates: {
              cost: 0,
              unitCost: 0,
              estimatedCost: currentCost,
              updatedAt: serverTimestamp()
            }
          });

          // Reflect locally in our working array for invoice recalculation
          item.cost = 0;
          item.unitCost = 0;
          item.estimatedCost = currentCost;
        }
      }
    }

    // Execute item updates in batches of 400
    for (let i = 0; i < itemUpdateBatches.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = itemUpdateBatches.slice(i, i + 400);
      chunk.forEach(u => batch.update(u.ref, u.updates));
      await batch.commit();
    }

    // Now recalculate totalCost for all invoices that had affected items or have discount/billable mismatches
    let updatedInvoicesCount = 0;
    const invoiceUpdateBatches: { ref: any; updates: any; invId: string }[] = [];

    for (const inv of allInvoices) {
      const explicitType = String(inv.invoiceType || inv.templateType || inv.type || '').toLowerCase();
      const isPurchase = inv.isPurchase === 1 || inv.isPurchase === true || inv.purchaseType || explicitType.startsWith('purchase_');
      const isOtherService = explicitType.startsWith('sale_') || isPurchase;
      if (isOtherService) continue;

      const invNum = String(inv.invoiceNumber || '').trim();
      const invId = String(inv.id || '').trim();

      const invItems = allItems.filter(it => {
        if (invId && String(it.invoiceId || '').trim() === invId) return true;
        if (invNum && String(it.invoiceNumber || '').trim() === invNum) return true;
        return false;
      });

      if (invItems.length > 0) {
        const correctTotal = calculateInvoiceBillableTotal(inv, invItems);
        if (Math.abs(Number(inv.totalCost || 0) - correctTotal) > 0.01) {
          invoiceUpdateBatches.push({
            ref: doc(db, 'invoices', inv.id),
            updates: {
              totalCost: correctTotal,
              updatedAt: serverTimestamp()
            },
            invId: inv.id
          });
          updatedInvoicesCount++;
        }
      }
    }

    // Execute invoice updates in batches of 400
    for (let i = 0; i < invoiceUpdateBatches.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = invoiceUpdateBatches.slice(i, i + 400);
      chunk.forEach(u => batch.update(u.ref, u.updates));
      await batch.commit();
    }

    // Also update localDb if present
    try {
      if (localDb && (localDb as any).invoice_items) {
        for (const itemUpdate of itemUpdateBatches) {
          try {
            await (localDb as any).invoice_items.update(itemUpdate.ref.id, {
              cost: 0,
              unitCost: 0
            });
          } catch (e) {}
        }
      }
      if (localDb) {
        for (const invUpdate of invoiceUpdateBatches) {
          try {
            if ((localDb as any).invoices) {
              await (localDb as any).invoices.update(invUpdate.invId || invUpdate.ref.id, {
                totalCost: invUpdate.updates.totalCost
              });
            }
          } catch (e) {}
          try {
            await localDb.run("UPDATE invoices SET totalCost = ? WHERE id = ?", [invUpdate.updates.totalCost, invUpdate.invId || invUpdate.ref.id]);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('LocalDB batch sync warning:', e);
    }

    return {
      updatedItemsCount,
      updatedInvoicesCount,
      totalCostZeroed
    };
  } catch (err) {
    console.error('Failed to run retroactive non-billable cleanup:', err);
    return {
      updatedItemsCount: 0,
      updatedInvoicesCount: 0,
      totalCostZeroed: 0
    };
  }
}
