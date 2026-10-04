import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Search, 
  Link2, 
  Layers, 
  CheckCircle, 
  AlertTriangle, 
  DollarSign, 
  Sparkles,
  RefreshCw,
  HelpCircle
} from 'lucide-react';
import { localDb } from '../../lib/local-db';
import { LocalProviderInstance } from '../../data/LocalProvider';
import { SyncEngine } from '../../data/SyncEngine';
import { db, doc, updateDoc } from '../../firebase';
import { isItemRefusedOrFailed, getItemBillableCost } from '../../lib/billableService';

interface ComprehensiveAuditReport {
  totalItems: number;
  mismatchedItemsCount: number;
  mismatchedItems: Array<{
    id: string;
    deviceName: string;
    itemInvoiceNum: string;
    parentInvoiceNum: string;
    customerName: string;
  }>;

  totalTransactions: number;
  unboundTransactionsCount: number;
  unboundTransactions: Array<{
    id: string;
    voucherNumber: number;
    invoiceNumber: string;
    customerName: string;
    amount: number;
    currency: string;
  }>;

  nonBillableWithCostCount: number;
  totalCostToZero: number;
  nonBillableSamples: Array<{
    id: string;
    deviceName: string;
    statusText: string;
    cost: number;
    invoiceNumber: string;
  }>;
}

export default function ComprehensiveMaintenanceTab() {
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<ComprehensiveAuditReport | null>(null);

  const [activeRunningTool, setActiveRunningTool] = useState<number | null>(null);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [executionResult, setExecutionResult] = useState<{ tool: number; type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [confirmToolId, setConfirmToolId] = useState<number | null>(null);

  // =========================================================================
  // 🔍 زر التدقيق الشامل (قراءة فقط - Read Only)
  // =========================================================================
  const runAuditOnly = async () => {
    setAuditLoading(true);
    setExecutionResult(null);

    try {
      const invsRes = await localDb.query("SELECT id, invoiceNumber, customerId, customerName, totalCost FROM invoices");
      const itemsRes = await localDb.query("SELECT id, invoiceId, invoiceNumber, customerId, customerName, deviceName, deviceType, cost, unitCost, quantity, status, subStatus, engineerReport, technicalNotes FROM invoice_items");
      const txsRes = await localDb.query("SELECT id, voucherNumber, invoiceId, invoiceNumber, customerId, customerName, amount, currency, liabilityAmount, isReversed, isReversal, status FROM vault_transactions");

      const invoices = invsRes.values || [];
      const items = itemsRes.values || [];
      const txs = txsRes.values || [];

      const invMap = new Map<string, any>();
      invoices.forEach((inv: any) => {
        if (inv.id) invMap.set(inv.id, inv);
      });

      // 1. Mismatched invoice items
      const mismatchedItems: any[] = [];
      items.forEach((item: any) => {
        if (item.invoiceId && invMap.has(item.invoiceId)) {
          const parentInv = invMap.get(item.invoiceId);
          const parentNum = String(parentInv.invoiceNumber || '').trim();
          const itemNum = String(item.invoiceNumber || '').trim();
          if (parentNum && itemNum && parentNum !== itemNum) {
            mismatchedItems.push({
              id: item.id,
              deviceName: item.deviceName || item.deviceType || 'جهاز',
              itemInvoiceNum: itemNum,
              parentInvoiceNum: parentNum,
              customerName: item.customerName || parentInv.customerName || 'غير محدد'
            });
          }
        }
      });

      // 2. Unbound transactions (have invoiceNumber but missing invoiceId)
      const unboundTransactions: any[] = [];
      txs.forEach((tx: any) => {
        if (tx.isReversed || tx.isReversal || tx.status === 'reversed') return;
        const txInvNum = String(tx.invoiceNumber || '').replace('#', '').trim();
        const txInvId = String(tx.invoiceId || '').trim();
        if (txInvNum && !txInvId) {
          unboundTransactions.push({
            id: tx.id,
            voucherNumber: Number(tx.voucherNumber || 0),
            invoiceNumber: txInvNum,
            customerName: tx.customerName || 'جهة عامة',
            amount: Math.abs(Number(tx.liabilityAmount || tx.amount || 0)),
            currency: tx.currency || 'USD'
          });
        }
      });

      // 3. Non-billable devices with cost
      const nonBillableSamples: any[] = [];
      let totalCostToZero = 0;
      items.forEach((item: any) => {
        const itemCost = Number(item.cost || 0);
        if (itemCost > 0 && isItemRefusedOrFailed(item)) {
          totalCostToZero += itemCost;
          let statusText = 'مرفوض / لا يصلح';
          const sub = String(item.subStatus || '').toLowerCase();
          const status = String(item.status || '').toLowerCase();
          if (status === '70' || sub === 'refused') statusText = 'لم يوافق العميل';
          else if (status === '55' || sub === 'unrepairable' || sub === 'failed') statusText = 'لا يصلح';
          else if (status === '45' || sub === 'no_parts') statusText = 'عدم توفر قطع الغيار';

          nonBillableSamples.push({
            id: item.id,
            deviceName: item.deviceName || item.deviceType || 'جهاز',
            statusText,
            cost: itemCost,
            invoiceNumber: String(item.invoiceNumber || '')
          });
        }
      });

      setAuditReport({
        totalItems: items.length,
        mismatchedItemsCount: mismatchedItems.length,
        mismatchedItems,

        totalTransactions: txs.length,
        unboundTransactionsCount: unboundTransactions.length,
        unboundTransactions,

        nonBillableWithCostCount: nonBillableSamples.length,
        totalCostToZero,
        nonBillableSamples
      });

    } catch (err: any) {
      console.error("[ComprehensiveAudit] error:", err);
      setExecutionResult({
        tool: 0,
        type: 'error',
        message: `فشل تشغيل تدقيق المعالجة الشاملة: ${err?.message || err}`
      });
    } finally {
      setAuditLoading(false);
    }
  };

  // =========================================================================
  // 🔹 الأداة (1): مزامنة وتصحيح أرقام الأجهزة مع فواتيرها
  // =========================================================================
  const executeHarmonizeItemNumbers = async () => {
    setConfirmToolId(null);
    setActiveRunningTool(1);
    setProgressPercent(10);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const invsRes = await localDb.query("SELECT id, invoiceNumber FROM invoices");
      const itemsRes = await localDb.query("SELECT id, invoiceId, invoiceNumber FROM invoice_items");

      const invoices = invsRes.values || [];
      const items = itemsRes.values || [];

      const invMap = new Map<string, string>();
      invoices.forEach((inv: any) => {
        if (inv.id && inv.invoiceNumber) {
          invMap.set(inv.id, String(inv.invoiceNumber).trim());
        }
      });

      let updatedCount = 0;
      const total = items.length;
      const nowIso = new Date().toISOString();

      for (let i = 0; i < total; i++) {
        const item = items[i];
        if (item.invoiceId && invMap.has(item.invoiceId)) {
          const parentNum = invMap.get(item.invoiceId)!;
          const currentItemNum = String(item.invoiceNumber || '').trim();
          if (parentNum && currentItemNum !== parentNum) {
            await localDb.run("UPDATE invoice_items SET invoiceNumber = ?, updatedAt = ? WHERE id = ?", [parentNum, nowIso, item.id]);
            await LocalProviderInstance.updateDoc('invoice_items', item.id, { invoiceNumber: parentNum, updatedAt: nowIso });
            try {
              await updateDoc(doc(db, 'invoice_items', item.id), { invoiceNumber: parentNum, updatedAt: nowIso });
            } catch (e) {}
            updatedCount++;
          }
        }
        if (i % 20 === 0 || i === total - 1) {
          const pct = Math.round(10 + ((i + 1) / total) * 80);
          setProgressPercent(pct);
          setProgressText(`مزامنة أجهزة الفواتير (${i + 1} من ${total})...`);
        }
      }

      const updatedItems = await localDb.query("SELECT * FROM invoice_items");
      localDb.notify('invoice_items', updatedItems.values || []);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snd_data_synced'));

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(e => console.warn(e));

      setProgressPercent(100);
      setExecutionResult({
        tool: 1,
        type: 'success',
        message: `تم بنجاح توحيد ومزامنة أرقام ${updatedCount} جهاز وبند مع فواتيرها الأصلية. تم فصل الأجهزة تماماً بين الفواتير المتشابهة.`
      });
      runAuditOnly();

    } catch (err: any) {
      console.error("[HarmonizeItems] error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 1,
        type: 'error',
        message: `حدث خطأ أثناء مزامنة أرقام الأجهزة: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // =========================================================================
  // 🔹 الأداة (2): صيانة وتوحيد ربط السندات بالمعرّف الثابت invoiceId
  // =========================================================================
  const executeBindTransactions = async () => {
    setConfirmToolId(null);
    setActiveRunningTool(2);
    setProgressPercent(10);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const invsRes = await localDb.query("SELECT id, invoiceNumber, customerId FROM invoices");
      const txsRes = await localDb.query("SELECT id, voucherNumber, invoiceNumber, invoiceId, customerId FROM vault_transactions");

      const invoices = invsRes.values || [];
      const txs = txsRes.values || [];

      let boundCount = 0;
      const total = txs.length;
      const nowIso = new Date().toISOString();

      for (let i = 0; i < total; i++) {
        const tx = txs[i];
        const txInvNum = String(tx.invoiceNumber || '').replace('#', '').trim();
        const txInvId = String(tx.invoiceId || '').trim();

        let match = invoices.find((inv: any) => txInvId && inv.id === txInvId);

        if (!match && tx.id && String(tx.id).startsWith('vtx-')) {
          const parts = String(tx.id).split('-');
          if (parts.length >= 2) {
            const potentialInvId = parts[1];
            match = invoices.find((inv: any) => inv.id === potentialInvId);
          }
        }

        if (!match && txInvNum) {
          match = invoices.find((inv: any) => {
            const invNum = String(inv.invoiceNumber || '').replace('#', '').trim();
            const sameNum = invNum === txInvNum;
            const sameCust = !tx.customerId || !inv.customerId || tx.customerId === inv.customerId;
            return sameNum && sameCust;
          });
        }

        if (!match && tx.customerId) {
          const custInvs = invoices.filter((inv: any) => inv.customerId === tx.customerId);
          if (custInvs.length === 1) {
            match = custInvs[0];
          }
        }

        if (match && match.id) {
          const correctInvNum = String(match.invoiceNumber || txInvNum).replace('#', '').trim();
          const needsUpdate = tx.invoiceId !== match.id || tx.invoiceNumber !== correctInvNum;

          if (needsUpdate) {
            await localDb.run(
              "UPDATE vault_transactions SET invoiceId = ?, invoiceNumber = ?, updatedAt = ? WHERE id = ?",
              [match.id, correctInvNum, nowIso, tx.id]
            );
            await LocalProviderInstance.updateDoc('vault_transactions', tx.id, {
              invoiceId: match.id,
              invoiceNumber: correctInvNum,
              updatedAt: nowIso
            });
            try {
              await updateDoc(doc(db, 'vault_transactions', tx.id), {
                invoiceId: match.id,
                invoiceNumber: correctInvNum,
                updatedAt: nowIso
              });
            } catch (e) {}
            boundCount++;
          }
        }

        if (i % 15 === 0 || i === total - 1) {
          const pct = Math.round(10 + ((i + 1) / total) * 80);
          setProgressPercent(pct);
          setProgressText(`صيانة ربط السندات (${i + 1} من ${total})...`);
        }
      }

      const updatedTxs = await localDb.query("SELECT * FROM vault_transactions");
      localDb.notify('vault_transactions', updatedTxs.values || []);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snd_data_synced'));

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(e => console.warn(e));

      setProgressPercent(100);
      setExecutionResult({
        tool: 2,
        type: 'success',
        message: `تم بنجاح ربط ${boundCount} سند مالي بالمعرفات الثابتة لفواتيرها الأصلية. أصبحت السندات محمية من أي تغيير لاحق في أرقام الفواتير.`
      });
      runAuditOnly();

    } catch (err: any) {
      console.error("[BindTransactions] error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 2,
        type: 'error',
        message: `حدث خطأ أثناء صيانة ربط السندات: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // =========================================================================
  // 🔹 الأداة (3): تصفير تكاليف الأجهزة غير المعتمدة والملغاة (نقلت هنا بأمان كامل)
  // =========================================================================
  const executeZeroNonBillableDevices = async () => {
    setConfirmToolId(null);
    setActiveRunningTool(3);
    setProgressPercent(10);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const itemsRes = await localDb.query("SELECT * FROM invoice_items");
      const invsRes = await localDb.query("SELECT * FROM invoices");

      const items = itemsRes.values || [];
      const invoices = invsRes.values || [];

      const affectedInvoiceIds = new Set<string>();
      let zeroedCount = 0;
      let totalAmountZeroed = 0;
      const nowIso = new Date().toISOString();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const cost = Number(item.cost || item.unitCost || 0);

        if (cost > 0 && isItemRefusedOrFailed(item)) {
          totalAmountZeroed += cost;
          await localDb.run("UPDATE invoice_items SET cost = 0, unitCost = 0, updatedAt = ? WHERE id = ?", [nowIso, item.id]);
          await LocalProviderInstance.updateDoc('invoice_items', item.id, { cost: 0, unitCost: 0, updatedAt: nowIso });
          try {
            await updateDoc(doc(db, 'invoice_items', item.id), { cost: 0, unitCost: 0, updatedAt: nowIso });
          } catch (e) {}

          if (item.invoiceId) affectedInvoiceIds.add(item.invoiceId);
          zeroedCount++;
        }
      }

      // Recalculate billable totals for affected invoices
      for (const invId of affectedInvoiceIds) {
        const inv = invoices.find((i: any) => i.id === invId);
        if (!inv) continue;

        // Skip purchases or fixed-price other invoices
        const expType = String(inv.invoiceType || inv.templateType || inv.type || '').toLowerCase();
        if (expType.startsWith('purchase') || expType.startsWith('sale_') || String(inv.invoiceNumber || '').startsWith('O-')) {
          continue;
        }

        const invItems = items.filter((it: any) => it.invoiceId === invId && it.id);
        const billableSum = invItems.reduce((sum: number, it: any) => {
          if (isItemRefusedOrFailed(it)) return sum;
          return sum + getItemBillableCost(it);
        }, 0);

        const discount = Number(inv.discount !== undefined ? inv.discount : (inv.discountAmount || 0));
        const tax = Number(inv.tax !== undefined ? inv.tax : (inv.taxAmount || 0));
        const newTotal = Math.max(0, billableSum - discount + tax);

        await localDb.run("UPDATE invoices SET totalCost = ?, updatedAt = ? WHERE id = ?", [newTotal, nowIso, invId]);
        await LocalProviderInstance.updateDoc('invoices', invId, { totalCost: newTotal, updatedAt: nowIso });
        try {
          await updateDoc(doc(db, 'invoices', invId), { totalCost: newTotal, updatedAt: nowIso });
        } catch (e) {}
      }

      const updatedItems = await localDb.query("SELECT * FROM invoice_items");
      localDb.notify('invoice_items', updatedItems.values || []);
      const updatedInvs = await localDb.query("SELECT * FROM invoices");
      localDb.notify('invoices', updatedInvs.values || []);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snd_data_synced'));

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(e => console.warn(e));

      setProgressPercent(100);
      setExecutionResult({
        tool: 3,
        type: 'success',
        message: `تم بنجاح تصفير تكاليف ${zeroedCount} جهاز غير معتمد (لم يوافق / لا يصلح / عدم توفر قطع) بمبلغ إجمالي ${totalAmountZeroed.toLocaleString('en-US')}$ وتحديث الفواتير المتأثرة.`
      });
      runAuditOnly();

    } catch (err: any) {
      console.error("[ZeroNonBillable] error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 3,
        type: 'error',
        message: `حدث خطأ أثناء تصفير الأجهزة غير المعتمدة: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tool 0: Top Audit Bar */}
      <div className="bg-white dark:bg-[#18181b] border border-slate-200 dark:border-white/10 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white font-cairo">تدقيق وفحص المعالجة الشاملة</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 font-cairo">
                فحص قراءة فقط للتحقق من توافق أرقام الأجهزة والسندات والمعرفات الثابتة دون تعديل.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={auditLoading || activeRunningTool !== null}
            onClick={runAuditOnly}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black font-cairo transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            {auditLoading ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>جاري التدقيق...</span>
              </>
            ) : (
              <>
                <Search size={14} />
                <span>تشغيل تدقيق المعالجة الشاملة</span>
              </>
            )}
          </button>
        </div>

        {/* Audit Results Dashboard */}
        {auditReport && (
          <div className="mt-5 pt-4 border-t border-slate-200 dark:border-white/10 space-y-4 font-cairo">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={`p-4 rounded-xl border ${auditReport.mismatchedItemsCount === 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300'}`}>
                <div className="text-[11px] font-bold">أجهزة بأرقام فواتير قديمة</div>
                <div className="text-xl font-black font-mono mt-1">{auditReport.mismatchedItemsCount} جهاز</div>
                <div className="text-[10px] opacity-75 mt-0.5">
                  {auditReport.mismatchedItemsCount === 0 ? 'جميع الأجهزة متطابقة مع فواتيرها' : 'تحتاج لمزامنة بالأداة (1)'}
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${auditReport.unboundTransactionsCount === 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300' : 'bg-blue-500/10 border-blue-500/20 text-blue-800 dark:text-blue-300'}`}>
                <div className="text-[11px] font-bold">سندات تفتقر للمعرف الثابت invoiceId</div>
                <div className="text-xl font-black font-mono mt-1">{auditReport.unboundTransactionsCount} سند</div>
                <div className="text-[10px] opacity-75 mt-0.5">
                  {auditReport.unboundTransactionsCount === 0 ? 'كافة السندات مربوطة بمعرفات محمية' : 'تحتاج لربط بالأداة (2)'}
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${auditReport.nonBillableWithCostCount === 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-800 dark:text-rose-300'}`}>
                <div className="text-[11px] font-bold">أجهزة مرفوضة/تالفة لها تكلفة</div>
                <div className="text-xl font-black font-mono mt-1">{auditReport.nonBillableWithCostCount} جهاز</div>
                <div className="text-[10px] opacity-75 mt-0.5">
                  {auditReport.nonBillableWithCostCount === 0 ? 'سليمة تماماً ولا توجد مبالغ غير معتمدة' : `إجمالي مبالغها: ${auditReport.totalCostToZero.toLocaleString('en-US')}$`}
                </div>
              </div>
            </div>

            {/* Samples Details */}
            {auditReport.mismatchedItems.length > 0 && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-2">
                <div className="text-xs font-black text-amber-600 dark:text-amber-400">عينة من الأجهزة غير المتطابقة برقم الفاتورة:</div>
                <div className="max-h-36 overflow-y-auto space-y-1 text-[11px]">
                  {auditReport.mismatchedItems.slice(0, 5).map(m => (
                    <div key={m.id} className="flex justify-between items-center py-1 px-2 bg-black/20 rounded">
                      <span className="font-bold text-white">{m.deviceName} ({m.customerName})</span>
                      <span className="font-mono text-amber-400">مسجل: {m.itemInvoiceNum} ⬅ الحقيقي: {m.parentInvoiceNum}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress & Result Alerts */}
      {activeRunningTool !== null && (
        <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-2xl space-y-2 font-cairo">
          <div className="flex justify-between items-center text-xs font-bold text-purple-700 dark:text-purple-300">
            <span>{progressText}</span>
            <span className="font-mono">{progressPercent}%</span>
          </div>
          <div className="w-full bg-black/30 rounded-full h-2 overflow-hidden">
            <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

      {executionResult && (
        <div className={`p-4 rounded-2xl border flex items-start gap-3 font-cairo text-xs ${
          executionResult.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200' 
            : executionResult.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-200'
        }`}>
          {executionResult.type === 'success' ? <CheckCircle size={18} className="shrink-0 text-emerald-500" /> : <AlertTriangle size={18} className="shrink-0 text-rose-500" />}
          <span>{executionResult.message}</span>
        </div>
      )}

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-cairo">
        
        {/* Tool 1 */}
        <div className="bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-white/10 rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-purple-500/30 transition-all">
          <div className="space-y-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Layers size={18} />
            </div>
            <h4 className="text-sm font-black text-slate-800 dark:text-white">1. مزامنة أرقام الأجهزة مع فواتيرها</h4>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
              تحديث رقم الفاتورة على جميع بنود الأجهزة ليتطابق مع رقم الفاتورة الحالي. يمنع اختلاط أجهزة الفواتير ذات الأرقام المتشابهة في الطباعة والمعاينة.
            </p>
          </div>
          <button
            type="button"
            disabled={activeRunningTool !== null}
            onClick={() => setConfirmToolId(1)}
            className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            <span>بدء مزامنة أرقام الأجهزة</span>
          </button>
        </div>

        {/* Tool 2 */}
        <div className="bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-white/10 rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-purple-500/30 transition-all">
          <div className="space-y-2">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Link2 size={18} />
            </div>
            <h4 className="text-sm font-black text-slate-800 dark:text-white">2. صيانة ربط السندات بالمعرف الثابت</h4>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
              ربط السندات المالية التاريخية بمعرفات الفواتير الثابتة (invoiceId)، لحماية علاقة السند بالفاتورة من أي إعادة ترقيم تسلسلي مستقبلاً.
            </p>
          </div>
          <button
            type="button"
            disabled={activeRunningTool !== null}
            onClick={() => setConfirmToolId(2)}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            <span>بدء ربط السندات الثابت</span>
          </button>
        </div>

        {/* Tool 3 */}
        <div className="bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-white/10 rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-purple-500/30 transition-all">
          <div className="space-y-2">
            <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <DollarSign size={18} />
            </div>
            <h4 className="text-sm font-black text-slate-800 dark:text-white">3. تصفير تكاليف الأجهزة غير المعتمدة</h4>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
              تصفير تكلفة الأجهزة ذات القرار الفني (لم يوافق العميل / لا تصلح / عدم توفر قطع) في قاعدة البيانات فورياً وتحديث إجمالي فواتيرها بدقة.
            </p>
          </div>
          <button
            type="button"
            disabled={activeRunningTool !== null}
            onClick={() => setConfirmToolId(3)}
            className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            <span>بدء تصفير الأجهزة الملغاة</span>
          </button>
        </div>

      </div>

      {/* Confirmation Modal */}
      {confirmToolId !== null && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-[#18181b] border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 font-cairo">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mx-auto">
              <AlertTriangle size={24} />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-base font-black text-white">تأكيد تشغيل أداة المعالجة</h3>
              <p className="text-xs text-gray-300 leading-relaxed">
                {confirmToolId === 1 && 'سيتم تحديث رقم الفاتورة على جميع بنود الأجهزة في قاعدة البيانات المحلية والسحابية لتتطابق تماماً مع فواتيرها الحالية.'}
                {confirmToolId === 2 && 'سيتم ربط السندات المالية القديمة بمعرف الفاتورة الثابت invoiceId وهوية العميل، لضمان استقرار العلاقة المحاسبية.'}
                {confirmToolId === 3 && 'سيتم تصفير مبالغ الأجهزة الملغاة وغير المعتمدة وتعديل إجمالي فواتيرها. هل تريد المتابعة؟'}
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (confirmToolId === 1) executeHarmonizeItemNumbers();
                  else if (confirmToolId === 2) executeBindTransactions();
                  else if (confirmToolId === 3) executeZeroNonBillableDevices();
                }}
                className="flex-1 py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-lg"
              >
                تأكيد ومتابعة
              </button>
              <button
                type="button"
                onClick={() => setConfirmToolId(null)}
                className="flex-1 py-2.5 px-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
