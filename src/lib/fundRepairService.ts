import { localDb } from './local-db';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { db, doc, updateDoc } from '../firebase';

/**
 * Reconciles and repairs fund balances across SQLite and Firestore
 * by calculating the true mathematical balance from vault_transactions.
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
      cloudTxs = txsSnap.docs ? txsSnap.docs.map((d: any) => d.data()) : [];
    } catch (e) {
      console.warn("Could not fetch cloud vault_transactions during fund repair:", e);
    }

    const txMap = new Map<string, any>();
    localTxs.forEach((t: any) => txMap.set(t.id, t));
    cloudTxs.forEach((t: any) => txMap.set(t.id, t));
    const allTxs = Array.from(txMap.values());

    // 2. Fetch funds from both Local and Cloud
    const localFundsRes = await localDb.query("SELECT * FROM fin_funds");
    const localFunds = localFundsRes.values || [];

    let cloudFunds: any[] = [];
    try {
      const fundsSnap = await FirebaseProviderInstance.getDocs('fin_funds');
      cloudFunds = fundsSnap.docs ? fundsSnap.docs.map((d: any) => d.data()) : [];
    } catch (e) {
      console.warn("Could not fetch cloud fin_funds during fund repair:", e);
    }

    const fundMap = new Map<string, any>();
    localFunds.forEach((f: any) => fundMap.set(f.id, f));
    cloudFunds.forEach((f: any) => fundMap.set(f.id, f));
    const allFunds = Array.from(fundMap.values());

    // 3. Recalculate true balance for each fund
    for (const fund of allFunds) {
      if (!fund.id) continue;
      const fundTxs = allTxs.filter(tx => tx.fundId === fund.id);
      let calculatedBalance = 0;

      fundTxs.forEach(tx => {
        const amt = Math.abs(Number(tx.amount || 0));
        if (tx.type === 'receipt') {
          calculatedBalance += amt;
        } else if (tx.type === 'payment' || tx.type === 'disbursement') {
          calculatedBalance -= amt;
        }
      });

      const oldLocalBal = fund.balance;
      details.push({
        fundName: fund.name || fund.id,
        oldBalance: oldLocalBal,
        newBalance: calculatedBalance
      });

      // Update Local SQLite
      await localDb.run('UPDATE fin_funds SET balance = ? WHERE id = ?', [calculatedBalance, fund.id]);

      // Update Firestore Cloud
      try {
        await updateDoc(doc(db, 'fin_funds', fund.id), { balance: calculatedBalance });
      } catch (e) {
        console.warn(`Could not update cloud balance for fund ${fund.id}:`, e);
      }
    }

    // Notify components that fin_funds has updated
    const updatedLocalFunds = await localDb.query("SELECT * FROM fin_funds");
    localDb.notify('fin_funds', updatedLocalFunds.values || []);

    return { repairedCount: allFunds.length, details };
  } catch (err) {
    console.error("Failed to repair fund balances:", err);
    throw err;
  }
}
