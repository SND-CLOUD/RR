import { localDb } from './local-db';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { LocalProviderInstance } from '../data/LocalProvider';
import { db, doc, updateDoc, collection, addDoc, serverTimestamp } from '../firebase';
import { parseFundBalance } from './fundUtils';

/**
 * Checks whether a vault transaction is strictly valid and active.
 * Excludes reversed vouchers, reversal vouchers, cancelled or deleted transactions.
 */
export function isAccountingTransactionValid(tx: any): boolean {
  if (!tx) return false;
  // 1. Reversed flags (number 1, boolean true, or string '1')
  if (tx.isReversed === 1 || tx.isReversed === true || tx.isReversed === '1') return false;
  // 2. Reversal voucher flags (the counter-voucher created when reversing)
  if (tx.isReversal === 1 || tx.isReversal === true || tx.isReversal === '1') return false;
  // 3. Status text checks
  const st = (tx.status || '').toLowerCase().trim();
  if (st === 'reversed' || st === 'reversal' || st === 'cancelled' || st === 'deleted' || st === 'void') return false;
  // 4. Soft deletion flags
  if (tx.isDeleted === 1 || tx.isDeleted === true || tx.isDeleted === '1') return false;
  if (tx.deleted === true || tx.deleted === 1 || tx.deleted === '1') return false;
  return true;
}

/**
 * Standard rounding helper according to currency specifications.
 * E.g., YER is rounded to integer (0 decimals), while USD/SAR/EUR round to 2 decimals.
 */
export function roundCurrencyAmount(amount: number, currency?: string): number {
  if (isNaN(amount) || !isFinite(amount)) return 0;
  const curr = (currency || '').toUpperCase().trim();
  if (curr === 'YER' || curr === 'ر.ي' || curr === 'يمني' || curr === 'ريال يمني' || curr === 'ريال') {
    return Math.round(amount);
  }
  // Standard two decimal places for SAR, USD, EUR, etc. (normalized to float)
  return Number((Math.round(amount * 100) / 100).toFixed(2));
}

/**
 * Normalizes currency string for accurate comparison across all modules
 */
export function normalizeCurrencyCode(curr?: string): string {
  if (!curr) return 'USD';
  const c = curr.toUpperCase().trim();
  if (c === 'SAR' || c === 'ر.س' || c === 'سعودي' || c === 'ريال سعودي') return 'SAR';
  if (c === 'YER' || c === 'ر.ي' || c === 'يمني' || c === 'ريال يمني' || c === 'ريال') return 'YER';
  if (c === 'USD' || c === '$' || c === 'دولار' || c === 'امريكي' || c === 'أمريكي') return 'USD';
  if (c === 'EUR' || c === '€' || c === 'يورو') return 'EUR';
  return c;
}

/**
 * Reconciles and repairs fund balances across SQLite and Firestore
 * strictly by calculating the true mathematical balance from active, non-reversed vault_transactions.
 * NOTE: Every financial amount in funds MUST have a corresponding accounting voucher.
 */
export async function repairAllFundBalances(): Promise<{ repairedCount: number, details: Array<{ fundName: string, oldBalance: any, newBalance: number }> }> {
  const details: Array<{ fundName: string, oldBalance: any, newBalance: number }> = [];
  try {
    // 1. Fetch transactions from both Local and Cloud
    const localTxsRes = await localDb.query("SELECT * FROM vault_transactions");
    const localTxs = localTxsRes.values || [];

    let cloudTxs: any[] = [];
    try {
      const txsSnap = await FirebaseProviderInstance.getDocs('vault_transactions');
      cloudTxs = txsSnap.docs ? txsSnap.docs.map((d: any) => {
        const raw = d.data ? (typeof d.data === 'function' ? d.data() : d.data) : d;
        return { ...(raw || {}), id: d.id || raw?.id };
      }) : [];
    } catch (e) {
      console.warn("Could not fetch cloud vault_transactions during fund repair:", e);
    }

    const txMap = new Map<string, any>();
    localTxs.forEach((t: any) => { if (t?.id) txMap.set(t.id, t); });
    
    // Save any missing cloud transactions into Local SQLite
    for (const ct of cloudTxs) {
      if (ct?.id) {
        const existing = txMap.get(ct.id);
        const merged = { ...(existing || {}), ...ct };
        txMap.set(ct.id, merged);
        if (!existing) {
          try {
            await LocalProviderInstance.setDoc('vault_transactions', ct.id, merged, undefined, 'BYPASS_OUTBOX');
          } catch (e) {}
        }
      }
    }
    const allTxs = Array.from(txMap.values());

    // 2. Fetch funds from both Local and Cloud
    const localFundsRes = await localDb.query("SELECT * FROM fin_funds");
    const localFunds = localFundsRes.values || [];

    let cloudFunds: any[] = [];
    try {
      const fundsSnap = await FirebaseProviderInstance.getDocs('fin_funds');
      cloudFunds = fundsSnap.docs ? fundsSnap.docs.map((d: any) => {
        const raw = d.data ? (typeof d.data === 'function' ? d.data() : d.data) : d;
        return { ...(raw || {}), id: d.id || raw?.id };
      }) : [];
    } catch (e) {
      console.warn("Could not fetch cloud fin_funds during fund repair:", e);
    }

    const fundMap = new Map<string, any>();
    localFunds.forEach((f: any) => { if (f?.id) fundMap.set(f.id, f); });
    cloudFunds.forEach((f: any) => {
      if (f?.id) {
        const existing = fundMap.get(f.id);
        fundMap.set(f.id, { ...(existing || {}), ...f, balance: parseFundBalance(f.balance) });
      }
    });
    const allFunds = Array.from(fundMap.values());

    // 3. Recalculate true mathematical balance for each fund strictly from valid accounting vouchers
    for (const fund of allFunds) {
      if (!fund.id) continue;
      
      const fundNameTrimmed = (fund.name || '').trim().toLowerCase();
      const fundCurrencyNorm = normalizeCurrencyCode(fund.currency);

      // Filter transactions belonging to this fund AND strictly valid
      const fundTxs = allTxs.filter(tx => {
        if (!isAccountingTransactionValid(tx)) return false;

        // Direct fundId match
        if (tx.fundId && tx.fundId === fund.id) return true;

        // Fallback fundName match for legacy vouchers missing fundId
        if (!tx.fundId && tx.fundName && tx.fundName.trim().toLowerCase() === fundNameTrimmed) return true;

        return false;
      });
      
      let calculatedBalance = 0;

      fundTxs.forEach(tx => {
        // Use receiptAmount if present, else fallback to liabilityAmount or amount
        const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
          ? Number(tx.receiptAmount)
          : (tx.amount !== undefined && tx.amount !== null ? Number(tx.amount) : 0);
          
        const amt = Math.abs(isNaN(rawAmt) ? 0 : rawAmt);
        if (amt === 0) return;
        
        const type = (tx.type || '').toLowerCase().trim();
        if (type === 'receipt' || type === 'deposit' || type === 'invoice_payment' || type === 'income' || type === 'inflow') {
          calculatedBalance += amt;
        } else if (type === 'payment' || type === 'disbursement' || type === 'expense' || type === 'withdraw' || type === 'outflow') {
          calculatedBalance -= amt;
        }
      });

      // Calculate final balance purely based on valid accounting transactions
      const finalBalance = roundCurrencyAmount(calculatedBalance, fund.currency);

      const oldLocalBal = fund.balance;
      details.push({
        fundName: fund.name || fund.id,
        oldBalance: oldLocalBal,
        newBalance: finalBalance
      });

      // Update Local SQLite
      await localDb.run('UPDATE fin_funds SET balance = ? WHERE id = ?', [finalBalance, fund.id]);
      await localDb.run("DELETE FROM outbox WHERE tableName = 'fin_funds' AND recordId = ?", [fund.id]).catch(() => {});

      // Update Firestore Cloud with unified typed number
      try {
        await updateDoc(doc(db, 'fin_funds', fund.id), { 
          balance: finalBalance,
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn(`Could not update cloud balance for fund ${fund.id}:`, e);
      }
    }

    // Notify components that fin_funds has updated
    const updatedLocalFunds = await localDb.query("SELECT * FROM fin_funds");
    localDb.notify('fin_funds', updatedLocalFunds.values || []);

    const updatedLocalTxs = await localDb.query("SELECT * FROM vault_transactions");
    localDb.notify('vault_transactions', updatedLocalTxs.values || []);

    window.dispatchEvent(new CustomEvent('snd_data_synced'));

    return { repairedCount: allFunds.length, details };
  } catch (err) {
    console.error("Failed to repair fund balances:", err);
    throw err;
  }
}
