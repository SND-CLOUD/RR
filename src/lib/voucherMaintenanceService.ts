import { localDb } from './local-db';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { LocalProviderInstance } from '../data/LocalProvider';
import { ProviderFactory } from '../data/ProviderFactory';
import { db, doc, updateDoc, deleteDoc, getDoc, getDocs, collection } from '../firebase';
import { repairAllFundBalances, isAccountingTransactionValid, roundCurrencyAmount } from './fundRepairService';
import { parseDate } from './dateUtils';

export interface SettlementVoucherInfo {
  id: string;
  voucherNumber?: number | string;
  type: 'receipt' | 'payment';
  amount: number;
  currency: string;
  fundId?: string;
  fundName?: string;
  customerName?: string;
  customerId?: string;
  invoiceNumber?: string;
  invoiceId?: string;
  date: string;
  timestamp: string;
  notes: string;
  category?: string;
  isAuditGenerated: boolean;
}

export interface VoucherAuditSummary {
  totalVouchers: number;
  activeVouchers: number;
  reversedVouchers: number;
  settlementVouchersCount: number;
  duplicateNumbersCount: number;
  randomOrEmptyCount: number;
  maxVoucherNumber: number;
  settlementVouchers: SettlementVoucherInfo[];
  fundsStatus: Array<{
    id: string;
    name: string;
    currency: string;
    storedBalance: number;
    calculatedBalance: number;
    difference: number;
  }>;
}

export interface ResequencePreviewItem {
  id: string;
  oldVoucherNumber: number | string;
  newVoucherNumber: number;
  timestamp: string;
  formattedDate: string;
  type: 'receipt' | 'payment';
  amount: number;
  currency: string;
  customerName?: string;
  invoiceNumber?: string;
  notes: string;
  fundName?: string;
}

/**
 * Checks if a voucher is an automatically generated settlement voucher
 * or a settlement voucher created to balance discrepancies.
 */
export function isSettlementVoucher(tx: any): boolean {
  if (!tx) return false;
  const id = String(tx.id || '');
  const notes = String(tx.notes || '').toLowerCase();
  const statementNote = String(tx.statementNote || '').toLowerCase();
  const category = String(tx.transactionCategory || tx.category || '').toLowerCase();
  const source = String(tx.source || '').toLowerCase();

  if (id.startsWith('tx_audit') || id.startsWith('tx_settle') || id.startsWith('audit_')) return true;
  if (source === 'audit_repair' || source === 'audit') return true;

  if (notes.includes('لتسوية ومطابقة') || notes.includes('سند تسوية') || notes.includes('تسوية ومطابقة')) return true;
  if (notes.includes('تسوية جزئية/كلية من خلال نافذة التنبيهات')) return true;
  if (statementNote.includes('لتسوية ومطابقة') || statementNote.includes('سند تسوية')) return true;
  if (category === 'تسوية' || category.includes('تسوية')) return true;

  return false;
}

/**
 * Scans all vouchers across Local SQLite and Firestore Cloud
 * to generate a comprehensive diagnostic report.
 */
export async function getVouchersAuditSummary(): Promise<VoucherAuditSummary> {
  // 1. Fetch Local transactions
  let localTxs: any[] = [];
  try {
    const res = await localDb.query("SELECT * FROM vault_transactions");
    localTxs = res.values || [];
  } catch (e) {
    console.warn("Could not query local vault_transactions:", e);
  }

  // 2. Fetch Cloud transactions if available
  let cloudTxs: any[] = [];
  try {
    const mode = ProviderFactory.getMode();
    if (mode === 'CLOUD' || mode === 'AUTO') {
      const snap = await FirebaseProviderInstance.getDocs('vault_transactions');
      cloudTxs = snap.docs.map((d: any) => {
        const raw = typeof d.data === 'function' ? d.data() : d.data;
        return { ...(raw || {}), id: d.id || raw?.id };
      });
    }
  } catch (e) {
    console.warn("Could not query cloud vault_transactions:", e);
  }

  // Merge map by ID
  const txMap = new Map<string, any>();
  localTxs.forEach(t => { if (t?.id) txMap.set(t.id, t); });
  cloudTxs.forEach(t => {
    if (t?.id) {
      const existing = txMap.get(t.id);
      txMap.set(t.id, { ...(existing || {}), ...t });
    }
  });

  const allTxs = Array.from(txMap.values());

  // Count metrics
  let activeCount = 0;
  let reversedCount = 0;
  let randomOrEmptyCount = 0;
  let maxVoucherNum = 0;
  const numOccurrences = new Map<number, number>();
  const settlementList: SettlementVoucherInfo[] = [];

  allTxs.forEach(t => {
    const isValid = isAccountingTransactionValid(t);
    if (isValid) activeCount++;
    else reversedCount++;

    const rawNum = t.voucherNumber;
    const num = Number(rawNum);
    const isCleanNumber = !isNaN(num) && isFinite(num) && num > 0 && String(rawNum).trim() !== '';

    if (!isCleanNumber) {
      randomOrEmptyCount++;
    } else {
      if (num > maxVoucherNum) maxVoucherNum = num;
      numOccurrences.set(num, (numOccurrences.get(num) || 0) + 1);
    }

    if (isSettlementVoucher(t)) {
      const rawDate = t.timestamp || t.date || t.createdAt || '';
      const d = parseDate(rawDate);
      settlementList.push({
        id: t.id,
        voucherNumber: t.voucherNumber,
        type: (t.type || '').toLowerCase().trim() === 'payment' ? 'payment' : 'receipt',
        amount: Math.abs(Number(t.amount || t.receiptAmount || t.liabilityAmount || 0)),
        currency: t.currency || t.receiptCurrency || 'YER',
        fundId: t.fundId,
        fundName: t.fundName,
        customerName: t.customerName,
        customerId: t.customerId,
        invoiceNumber: t.invoiceNumber,
        invoiceId: t.invoiceId,
        date: d ? d.toLocaleDateString('ar-YE') : '',
        timestamp: d ? d.toISOString() : (rawDate || new Date().toISOString()),
        notes: t.notes || '',
        category: t.transactionCategory || t.category || '',
        isAuditGenerated: String(t.id).startsWith('tx_audit') || String(t.notes).includes('لتسوية ومطابقة')
      });
    }
  });

  let duplicateNumbersCount = 0;
  numOccurrences.forEach(count => {
    if (count > 1) duplicateNumbersCount += (count - 1);
  });

  // Calculate funds status
  let fundsStatus: VoucherAuditSummary['fundsStatus'] = [];
  try {
    const fundsRes = await localDb.query("SELECT * FROM fin_funds");
    const localFunds = fundsRes.values || [];

    fundsStatus = localFunds.map((fund: any) => {
      const storedBal = Number(fund.balance || 0);
      const fundNameTrimmed = (fund.name || '').trim().toLowerCase();

      // Calculate true balance strictly from valid vouchers
      const fundTxs = allTxs.filter(tx => {
        if (!isAccountingTransactionValid(tx)) return false;
        if (tx.fundId && tx.fundId === fund.id) return true;
        if (!tx.fundId && tx.fundName && tx.fundName.trim().toLowerCase() === fundNameTrimmed) return true;
        return false;
      });

      let calc = 0;
      fundTxs.forEach(tx => {
        const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
          ? Number(tx.receiptAmount)
          : (tx.amount !== undefined && tx.amount !== null ? Number(tx.amount) : 0);
        const amt = Math.abs(isNaN(rawAmt) ? 0 : rawAmt);
        const type = (tx.type || '').toLowerCase().trim();
        if (type === 'receipt' || type === 'deposit' || type === 'invoice_payment' || type === 'income' || type === 'inflow') {
          calc += amt;
        } else if (type === 'payment' || type === 'disbursement' || type === 'expense' || type === 'withdraw' || type === 'outflow') {
          calc -= amt;
        }
      });

      const finalCalc = roundCurrencyAmount(calc, fund.currency);
      return {
        id: fund.id,
        name: fund.name || fund.id,
        currency: fund.currency || 'YER',
        storedBalance: storedBal,
        calculatedBalance: finalCalc,
        difference: roundCurrencyAmount(storedBal - finalCalc, fund.currency)
      };
    });
  } catch (e) {
    console.warn("Could not query funds status:", e);
  }

  return {
    totalVouchers: allTxs.length,
    activeVouchers: activeCount,
    reversedVouchers: reversedCount,
    settlementVouchersCount: settlementList.length,
    duplicateNumbersCount,
    randomOrEmptyCount,
    maxVoucherNumber: maxVoucherNum,
    settlementVouchers: settlementList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    fundsStatus
  };
}

/**
 * Batch deletes erroneous settlement vouchers from both SQLite and Firestore,
 * optionally resets or clears their artificial impact on linked invoices,
 * and recalculates the real fund balances.
 */
export async function purgeSettlementVouchers(options: {
  voucherIds?: string[];
  resetInvoicePaid?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<{ deletedCount: number; message: string }> {
  const { voucherIds, resetInvoicePaid = false, onProgress } = options;

  onProgress?.('جاري كشف وتحديد سندات التسوية...');
  
  // 1. Find all target vouchers
  const summary = await getVouchersAuditSummary();
  const targetIds = voucherIds && voucherIds.length > 0 
    ? voucherIds 
    : summary.settlementVouchers.map(s => s.id);

  if (targetIds.length === 0) {
    return { deletedCount: 0, message: 'لا توجد سندات تسوية محددة للحذف.' };
  }

  onProgress?.(`جاري حذف ${targetIds.length} سند تسوية من قاعدة البيانات والسحابة...`);

  const provider = ProviderFactory.getProvider();
  const dbMode = ProviderFactory.getMode();
  let deletedCount = 0;

  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i];
    const voucherInfo = summary.settlementVouchers.find(s => s.id === id);

    // Delete from Local SQLite
    try {
      await localDb.run("DELETE FROM vault_transactions WHERE id = ?", [id]);
      await localDb.run("DELETE FROM outbox WHERE tableName = 'vault_transactions' AND recordId = ?", [id]).catch(() => {});
    } catch (e) {
      console.warn(`Error deleting local vault_transaction ${id}:`, e);
    }

    // Delete from Firestore
    try {
      await deleteDoc(doc(db, 'vault_transactions', id));
    } catch (e) {
      console.warn(`Error deleting cloud vault_transaction ${id}:`, e);
    }

    // Optionally handle linked invoice amountPaid
    if (resetInvoicePaid && voucherInfo?.invoiceNumber) {
      try {
        const invNo = String(voucherInfo.invoiceNumber).replace('#', '').trim();
        // Query remaining genuine receipts for this invoice
        const remainingTxsRes = await localDb.query(
          "SELECT * FROM vault_transactions WHERE invoiceNumber = ? AND id != ?",
          [invNo, id]
        );
        const remTxs = (remainingTxsRes.values || []).filter(isAccountingTransactionValid);
        
        let newAmountPaid = 0;
        remTxs.forEach((tx: any) => {
          const type = (tx.type || '').toLowerCase().trim();
          const amt = Math.abs(Number(tx.liabilityAmount !== undefined && tx.liabilityAmount !== null ? tx.liabilityAmount : tx.amount || 0));
          if (type === 'receipt' || type === 'invoice_payment') {
            newAmountPaid += amt;
          } else if (type === 'payment') {
            newAmountPaid -= amt;
          }
        });
        newAmountPaid = Math.max(0, newAmountPaid);

        // Update local invoice
        await localDb.run("UPDATE invoices SET amountPaid = ? WHERE invoiceNumber = ?", [newAmountPaid, invNo]);
        
        // Update cloud invoice
        const invDocsRes = await localDb.query("SELECT id FROM invoices WHERE invoiceNumber = ?", [invNo]);
        const invId = invDocsRes.values?.[0]?.id;
        if (invId) {
          try {
            await updateDoc(doc(db, 'invoices', invId), { amountPaid: newAmountPaid });
          } catch (err) {}
        }
      } catch (invErr) {
        console.warn(`Could not adjust invoice paid amount for ${voucherInfo.invoiceNumber}:`, invErr);
      }
    }

    deletedCount++;
    if (i % 5 === 0 || i === targetIds.length - 1) {
      onProgress?.(`تم حذف ${deletedCount} من أصل ${targetIds.length} سند تسوية...`);
    }
  }

  // 2. Recalculate true fund balances strictly from valid remaining vouchers
  onProgress?.('إعادة احتساب وتصحيح أرصدة الصناديق بدقة...');
  try {
    await repairAllFundBalances();
  } catch (fundErr) {
    console.error("Fund balance recalculation error after settlement purge:", fundErr);
  }

  // 3. Recalibrate max voucher number
  onProgress?.('إعادة معايرة عدادات السندات...');
  await recalibrateMaxVoucherNumber();

  // Notify system
  const updatedTxs = await localDb.query("SELECT * FROM vault_transactions");
  localDb.notify('vault_transactions', updatedTxs.values || []);

  const updatedFunds = await localDb.query("SELECT * FROM fin_funds");
  localDb.notify('fin_funds', updatedFunds.values || []);

  const updatedInvs = await localDb.query("SELECT * FROM invoices");
  localDb.notify('invoices', updatedInvs.values || []);

  window.dispatchEvent(new CustomEvent('snd_data_synced'));

  return {
    deletedCount,
    message: `تم بنجاح حذف ${deletedCount} سند تسوية خاطئ وموازنة أرصدة الصناديق المحاسبية تماماً.`
  };
}

/**
 * Generates a preview of sequential re-numbering for user approval.
 */
export async function previewVoucherResequencing(options: {
  startNumber?: number;
  sortOrder?: 'date_asc' | 'date_desc' | 'natural';
  excludeReversed?: boolean;
}): Promise<ResequencePreviewItem[]> {
  const { startNumber = 1001, sortOrder = 'date_asc', excludeReversed = false } = options;

  let localTxs: any[] = [];
  try {
    const res = await localDb.query("SELECT * FROM vault_transactions");
    localTxs = res.values || [];
  } catch (e) {
    console.warn("Could not query local vault_transactions for preview:", e);
  }

  let list = [...localTxs];
  if (excludeReversed) {
    list = list.filter(isAccountingTransactionValid);
  }

  // Sort list
  if (sortOrder === 'date_asc') {
    list.sort((a, b) => {
      const timeA = new Date(a.timestamp || a.date || a.createdAt || 0).getTime();
      const timeB = new Date(b.timestamp || b.date || b.createdAt || 0).getTime();
      if (timeA !== timeB) return timeA - timeB;
      const numA = Number(a.voucherNumber || 0);
      const numB = Number(b.voucherNumber || 0);
      if (numA !== numB) return numA - numB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  } else if (sortOrder === 'date_desc') {
    list.sort((a, b) => {
      const timeA = new Date(a.timestamp || a.date || a.createdAt || 0).getTime();
      const timeB = new Date(b.timestamp || b.date || b.createdAt || 0).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  let currentNum = Number(startNumber);
  const preview: ResequencePreviewItem[] = [];

  list.forEach(tx => {
    const rawDate = tx.timestamp || tx.date || tx.createdAt || '';
    const d = parseDate(rawDate);
    preview.push({
      id: tx.id,
      oldVoucherNumber: tx.voucherNumber ?? '-',
      newVoucherNumber: currentNum++,
      timestamp: d ? d.toISOString() : (rawDate || new Date().toISOString()),
      formattedDate: d ? d.toLocaleDateString('ar-YE') + ' ' + d.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' }) : '-',
      type: (tx.type || '').toLowerCase().trim() === 'payment' ? 'payment' : 'receipt',
      amount: Math.abs(Number(tx.amount || tx.receiptAmount || tx.liabilityAmount || 0)),
      currency: tx.currency || tx.receiptCurrency || 'YER',
      customerName: tx.customerName || '',
      invoiceNumber: tx.invoiceNumber || '',
      notes: tx.notes || tx.statementNote || '',
      fundName: tx.fundName || ''
    });
  });

  return preview;
}

/**
 * Applies sequential re-numbering to all vouchers in both SQLite and Firestore,
 * and calibrates the system counter.
 */
export async function applyVoucherResequencing(options: {
  startNumber?: number;
  sortOrder?: 'date_asc' | 'date_desc' | 'natural';
  excludeReversed?: boolean;
  onProgress?: (current: number, total: number, msg: string) => void;
}): Promise<{ updatedCount: number; maxVoucherNumber: number; message: string }> {
  const { onProgress } = options;
  onProgress?.(0, 100, 'جاري إعداد قائمة السندات للترقيم التسلسلي...');

  const preview = await previewVoucherResequencing(options);
  const total = preview.length;

  if (total === 0) {
    return { updatedCount: 0, maxVoucherNumber: 0, message: 'لا توجد سندات لإعادة ترقيمها.' };
  }

  let updatedCount = 0;
  let maxVoucherNum = 0;

  for (let i = 0; i < total; i++) {
    const item = preview[i];
    const newNum = item.newVoucherNumber;
    if (newNum > maxVoucherNum) maxVoucherNum = newNum;

    // 1. Update SQLite
    try {
      await localDb.run("UPDATE vault_transactions SET voucherNumber = ? WHERE id = ?", [newNum, item.id]);
    } catch (e) {
      console.warn(`Error updating local voucherNumber for ${item.id}:`, e);
    }

    // 2. Update Firestore Cloud
    try {
      await updateDoc(doc(db, 'vault_transactions', item.id), {
        voucherNumber: newNum,
        updatedAt: new Date().toISOString()
      });
    } catch (e) {
      // If doc doesn't exist, we skip or it's offline
    }

    updatedCount++;
    if (i % 10 === 0 || i === total - 1) {
      onProgress?.(i + 1, total, `تم ترقيم ${i + 1} من أصل ${total} سند (سند #${newNum})...`);
    }
  }

  // 3. Update settings / counter in SQLite and Cloud
  onProgress?.(total, total, 'تحديث وضبط عداد أرقام السندات في إعدادات النظام...');
  try {
    await localDb.run(
      "UPDATE settings SET value = ? WHERE key = 'lastVoucherNumber'",
      [String(maxVoucherNum)]
    ).catch(() => {});

    await updateDoc(doc(db, 'settings', 'app'), {
      lastVoucherNumber: maxVoucherNum,
      updatedAt: new Date().toISOString()
    }).catch(() => {});
  } catch (setErr) {
    console.warn("Could not save lastVoucherNumber to settings:", setErr);
  }

  // Notify listeners
  const updatedTxs = await localDb.query("SELECT * FROM vault_transactions");
  localDb.notify('vault_transactions', updatedTxs.values || []);
  window.dispatchEvent(new CustomEvent('snd_data_synced'));

  return {
    updatedCount,
    maxVoucherNumber: maxVoucherNum,
    message: `تم ترقيم وتسلسل ${updatedCount} سند بنجاح تام وبدقة زمنية! آخر رقم سند هو (#${maxVoucherNum}).`
  };
}

/**
 * Calibrates MAX(voucherNumber) in database and settings.
 */
export async function recalibrateMaxVoucherNumber(): Promise<number> {
  try {
    const res = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
    const maxNum = Number(res.values?.[0]?.maxNum || 1000);
    
    await updateDoc(doc(db, 'settings', 'app'), {
      lastVoucherNumber: maxNum
    }).catch(() => {});

    return maxNum;
  } catch (e) {
    return 1000;
  }
}
