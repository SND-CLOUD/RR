import React, { useState } from 'react';
import { 
  Database, 
  Search, 
  Hash, 
  Copy, 
  Layers, 
  CheckCircle, 
  AlertTriangle 
} from 'lucide-react';
import { localDb } from '../../lib/local-db';
import { LocalProviderInstance } from '../../data/LocalProvider';
import { SyncEngine } from '../../data/SyncEngine';
import { db, doc, updateDoc } from '../../firebase';
import { isPurchaseInvoice, isSaleInvoice } from '../../types';

interface OtherAuditReport {
  total: number;
  numbered: number;
  unnumbered: number;
  maxNumber: number;
  minNumber: number;
  duplicatesCount: number;
  duplicateNumbers: { number: string; count: number; sampleNames: string[] }[];
  unnumberedSamples: { id: string; customerName: string; createdAt: string; totalCost: number; typeStr: string }[];
}

export default function OtherInvoicesTab() {
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<OtherAuditReport | null>(null);

  const [activeRunningTool, setActiveRunningTool] = useState<number | null>(null);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [executionResult, setExecutionResult] = useState<{ tool: number; type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [customStartNumber, setCustomStartNumber] = useState<number>(1001);
  const [prefix, setPrefix] = useState<string>('O-');
  const [showRenumberConfirm, setShowRenumberConfirm] = useState(false);

  // Helper to filter Other invoices (purchases, software, outside maintenance, parts sales)
  const isOtherInvoice = (inv: any) => isPurchaseInvoice(inv) || isSaleInvoice(inv);

  // Parse pure number from string like O-1001 or 1001
  const parseNum = (str?: string) => {
    if (!str) return 0;
    const clean = String(str).replace('#', '').replace('O-', '').replace('PUR-', '').replace('SALE-', '').replace('SRV-', '').trim();
    const n = parseInt(clean, 10);
    return isNaN(n) ? 0 : n;
  };

  // Tool 1: Audit Read-Only
  const runAuditOnly = async () => {
    setAuditLoading(true);
    setExecutionResult(null);

    try {
      const res = await localDb.query("SELECT id, invoiceNumber, customerName, totalCost, createdAt, invoiceType, templateType, type, isPurchase, notes FROM invoices ORDER BY createdAt ASC, rowid ASC");
      const rows = (res.values || []).filter(isOtherInvoice);
      const total = rows.length;

      let numbered = 0;
      let unnumbered = 0;
      let maxNum = 1000;
      let minNum = Infinity;
      const numFreq: Record<string, string[]> = {};
      const unnumberedList: any[] = [];

      rows.forEach((inv: any) => {
        const rawStr = String(inv.invoiceNumber || '').trim();
        const n = parseNum(rawStr);

        if (n > 0) {
          numbered++;
          if (n > maxNum) maxNum = n;
          if (n < minNum) minNum = n;
          if (!numFreq[rawStr]) numFreq[rawStr] = [];
          numFreq[rawStr].push(inv.customerName || 'مورد/عميل غير محدد');
        } else {
          unnumbered++;
          if (unnumberedList.length < 5) {
            let typeLabel = 'خدمات ومبيعات';
            if (isPurchaseInvoice(inv)) typeLabel = 'فاتورة مشتريات';
            else if (inv.invoiceType === 'sale_software') typeLabel = 'خدمات برمجية';
            else if (inv.invoiceType === 'sale_maintenance') typeLabel = 'صيانة خارجية';
            else if (inv.invoiceType === 'sale_parts') typeLabel = 'بيع قطع غيار';

            unnumberedList.push({
              id: inv.id,
              customerName: inv.customerName || '---',
              createdAt: inv.createdAt || 'غير محدد',
              totalCost: inv.totalCost || 0,
              typeStr: typeLabel
            });
          }
        }
      });

      const duplicateNumbers: { number: string; count: number; sampleNames: string[] }[] = [];
      let totalDuplicateRows = 0;
      Object.entries(numFreq).forEach(([numStr, names]) => {
        if (names.length > 1) {
          duplicateNumbers.push({
            number: numStr,
            count: names.length,
            sampleNames: names.slice(0, 3)
          });
          totalDuplicateRows += (names.length - 1);
        }
      });

      setAuditReport({
        total,
        numbered,
        unnumbered,
        maxNumber: maxNum > 1000 ? maxNum : 1000,
        minNumber: minNum === Infinity ? 0 : minNum,
        duplicatesCount: totalDuplicateRows,
        duplicateNumbers,
        unnumberedSamples: unnumberedList
      });

      if (maxNum > 1000) setCustomStartNumber(maxNum + 1);

    } catch (err: any) {
      console.error("[OtherAudit] error:", err);
      setExecutionResult({ tool: 1, type: 'error', message: `فشل فحص الفواتير الأخرى: ${err?.message || err}` });
    } finally {
      setAuditLoading(false);
    }
  };

  // Tool 2: Fill Missing
  const executeFillMissingOnly = async () => {
    setActiveRunningTool(2);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query("SELECT id, invoiceNumber, createdAt, invoiceType, templateType, type, isPurchase, notes FROM invoices ORDER BY createdAt ASC, rowid ASC");
      const rows = (res.values || []).filter(isOtherInvoice);

      let currentMax = 1000;
      rows.forEach((inv: any) => {
        const n = parseNum(inv.invoiceNumber);
        if (n > currentMax) currentMax = n;
      });

      const unnumbered = rows.filter((inv: any) => parseNum(inv.invoiceNumber) <= 0);

      if (unnumbered.length === 0) {
        setExecutionResult({ tool: 2, type: 'info', message: 'كافة الفواتير الأخرى مرقمة بالفعل بنجاح!' });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      let nextNum = currentMax;
      let count = 0;

      for (let i = 0; i < unnumbered.length; i++) {
        const inv = unnumbered[i];
        nextNum++;
        const pct = Math.round(10 + ((i + 1) / unnumbered.length) * 80);
        setProgressPercent(pct);
        setProgressText(`ترقيم الفاتورة (${i + 1} من ${unnumbered.length}) برقم ${prefix}${nextNum}...`);

        const nowIso = new Date().toISOString();
        const strNum = `${prefix}${nextNum}`;

        await localDb.run("UPDATE invoices SET invoiceNumber = ?, updatedAt = ? WHERE id = ?", [strNum, nowIso, inv.id]);
        await localDb.run("UPDATE invoice_items SET invoiceNumber = ? WHERE invoiceId = ?", [strNum, inv.id]);

        await LocalProviderInstance.updateDoc('invoices', inv.id, { invoiceNumber: strNum, updatedAt: nowIso });
        try {
          await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: strNum, updatedAt: nowIso });
        } catch (e) {}

        count++;
      }

      setProgressPercent(95);
      setProgressText('استئناف المزامنة وإخطار النظام...');

      const updatedInvs = await localDb.query("SELECT * FROM invoices");
      localDb.notify('invoices', updatedInvs.values || []);
      const updatedItems = await localDb.query("SELECT * FROM invoice_items");
      localDb.notify('invoice_items', updatedItems.values || []);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snd_data_synced'));

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn(err));

      setProgressPercent(100);
      setExecutionResult({ tool: 2, type: 'success', message: `تم بنجاح ترقيم ${count} فاتورة أخرى مفقودة. أحدث رقم هو ${prefix}${nextNum}.` });
      runAuditOnly();

    } catch (err: any) {
      console.error("[OtherTool2] error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({ tool: 2, type: 'error', message: `حدث خطأ أثناء ترقيم الفواتير: ${err?.message || err}` });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // Tool 3: Fix Duplicates
  const executeFixDuplicatesOnly = async () => {
    setActiveRunningTool(3);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query("SELECT id, invoiceNumber, createdAt, invoiceType, templateType, type, isPurchase, notes FROM invoices ORDER BY createdAt ASC, rowid ASC");
      const rows = (res.values || []).filter(isOtherInvoice);

      let currentMax = 1000;
      const seen = new Set<string>();
      const duplicates: any[] = [];

      rows.forEach((inv: any) => {
        const raw = String(inv.invoiceNumber || '').trim();
        const n = parseNum(raw);
        if (n > currentMax) currentMax = n;

        if (raw && raw !== '' && raw !== '0') {
          if (seen.has(raw)) duplicates.push(inv);
          else seen.add(raw);
        }
      });

      if (duplicates.length === 0) {
        setExecutionResult({ tool: 3, type: 'info', message: 'فحص الفواتير الأخرى سليم 100%! لا يوجد تكرار في الأرقام.' });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      let nextNum = currentMax;
      let count = 0;

      for (let i = 0; i < duplicates.length; i++) {
        const inv = duplicates[i];
        nextNum++;
        const pct = Math.round(15 + ((i + 1) / duplicates.length) * 75);
        setProgressPercent(pct);
        setProgressText(`إصلاح الفاتورة المكررة (${i + 1} من ${duplicates.length}) ونقلها للرقم ${prefix}${nextNum}...`);

        const nowIso = new Date().toISOString();
        const strNum = `${prefix}${nextNum}`;

        await localDb.run("UPDATE invoices SET invoiceNumber = ?, updatedAt = ? WHERE id = ?", [strNum, nowIso, inv.id]);
        await localDb.run("UPDATE invoice_items SET invoiceNumber = ? WHERE invoiceId = ?", [strNum, inv.id]);

        await LocalProviderInstance.updateDoc('invoices', inv.id, { invoiceNumber: strNum, updatedAt: nowIso });
        try {
          await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: strNum, updatedAt: nowIso });
        } catch (e) {}

        count++;
      }

      const updatedInvs = await localDb.query("SELECT * FROM invoices");
      localDb.notify('invoices', updatedInvs.values || []);
      const updatedItems = await localDb.query("SELECT * FROM invoice_items");
      localDb.notify('invoice_items', updatedItems.values || []);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snd_data_synced'));

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn(err));

      setProgressPercent(100);
      setExecutionResult({ tool: 3, type: 'success', message: `تمت معالجة وإلغاء التكرار لـ ${count} فاتورة بنجاح وترقيمها بأرقام جديدة تبدأ من ${prefix}${currentMax + 1} حتى ${prefix}${nextNum}.` });
      runAuditOnly();

    } catch (err: any) {
      console.error("[OtherTool3] error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({ tool: 3, type: 'error', message: `حدث خطأ أثناء معالجة التكرار: ${err?.message || err}` });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // Tool 4: Full Renumber
  const executeFullRenumber = async () => {
    setShowRenumberConfirm(false);
    setActiveRunningTool(4);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query("SELECT id, invoiceNumber, createdAt, invoiceType, templateType, type, isPurchase, notes FROM invoices ORDER BY createdAt ASC, rowid ASC");
      const rows = (res.values || []).filter(isOtherInvoice);

      if (rows.length === 0) {
        setExecutionResult({ tool: 4, type: 'info', message: 'لا توجد فواتير أخرى في قاعدة البيانات لإعادة ترقيمها.' });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      const start = Number(customStartNumber) || 1001;
      const total = rows.length;

      for (let i = 0; i < total; i++) {
        const inv = rows[i];
        const assignedNum = start + i;
        const strNum = `${prefix}${assignedNum}`;
        const pct = Math.round(10 + ((i + 1) / total) * 80);
        setProgressPercent(pct);
        setProgressText(`إعادة ترقيم الفاتورة (${i + 1} من ${total}) برقم ${strNum}...`);

        const nowIso = new Date().toISOString();
        await localDb.run("UPDATE invoices SET invoiceNumber = ?, updatedAt = ? WHERE id = ?", [strNum, nowIso, inv.id]);
        await localDb.run("UPDATE invoice_items SET invoiceNumber = ? WHERE invoiceId = ?", [strNum, inv.id]);

        // Keep linked transactions in sync by invoiceId OR previous invoiceNumber
        const oldNum = String(inv.invoiceNumber || '').trim();
        await localDb.run(
          "UPDATE vault_transactions SET invoiceNumber = ?, invoiceId = ?, updatedAt = ? WHERE invoiceId = ? OR ((invoiceNumber = ? OR invoiceNumber = ?) AND (customerId = ? OR customerId IS NULL))",
          [strNum, inv.id, nowIso, inv.id, oldNum, '#' + oldNum, inv.customerId || '']
        );

        await LocalProviderInstance.updateDoc('invoices', inv.id, { invoiceNumber: strNum, updatedAt: nowIso });
        try {
          await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: strNum, updatedAt: nowIso });
        } catch (e) {}
      }

      const updatedInvs = await localDb.query("SELECT * FROM invoices");
      localDb.notify('invoices', updatedInvs.values || []);
      const updatedItems = await localDb.query("SELECT * FROM invoice_items");
      localDb.notify('invoice_items', updatedItems.values || []);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('snd_data_synced'));

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn(err));

      setProgressPercent(100);
      const finalNum = start + total - 1;
      setExecutionResult({ tool: 4, type: 'success', message: `اكتملت إعادة الترقيم التسلسلي الشامل لـ ${total} فاتورة أخرى بنجاح من ${prefix}${start} حتى ${prefix}${finalNum}.` });
      runAuditOnly();

    } catch (err: any) {
      console.error("[OtherTool4] error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({ tool: 4, type: 'error', message: `حدث خطأ أثناء إعادة الترقيم الشامل: ${err?.message || err}` });
    } finally {
      setActiveRunningTool(null);
    }
  };

  return (
    <div className="bg-white dark:bg-[#1a1a1a] border-2 border-purple-500/50 rounded-3xl p-5 sm:p-6 shadow-md space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
            <Database size={22} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              المحور الرابع: صيانة فواتير أخرى والمبيعات والمشتريات
              <span className="text-[10px] bg-purple-500/20 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-md font-mono font-bold">
                other_services & purchases
              </span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-gray-400 mt-0.5">
              أدوات مفردة ومعزولة لفحص وتدقيق وترقيم فواتير الخدمات البرمجية، الصيانة الخارجية، بيع القطع، والمشتريات
            </p>
          </div>
        </div>
      </div>

      {activeRunningTool !== null && (
        <div className="p-4 bg-purple-50 dark:bg-black/40 rounded-2xl border border-purple-300 dark:border-purple-500/30 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-purple-800 dark:text-purple-300">
            <span>{progressText}</span>
            <span className="font-mono text-sm">{progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-3 overflow-hidden">
            <div className="bg-purple-500 h-full rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

      {executionResult && (
        <div className={`p-4 rounded-2xl text-xs font-bold border flex items-start gap-2.5 shadow-sm ${
          executionResult.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-300'
            : executionResult.type === 'error'
            ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-900 dark:text-rose-300'
            : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30 text-indigo-900 dark:text-indigo-300'
        }`}>
          {executionResult.type === 'success' ? <CheckCircle size={18} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle size={18} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />}
          <span className="leading-relaxed">{executionResult.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tool 1 */}
        <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">1</span>
                <h3 className="font-black text-sm text-slate-900 dark:text-white">استعراض وتدقيق فواتير أخرى</h3>
              </div>
              <span className="text-[10px] bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-300 px-2 py-0.5 rounded font-bold">قراءة فقط</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
              فحص شامل لسجلات فواتير المبيعات والمشتريات والخدمات، حصر المرقمة وغير المرقمة والتكرارات دون تعديل أي بايت.
            </p>

            {auditReport && (
              <div className="mt-3 p-3 bg-white dark:bg-black/50 rounded-xl border border-slate-200 dark:border-white/10 text-xs space-y-2">
                <div className="grid grid-cols-4 gap-1 text-center font-mono">
                  <div className="p-1 bg-slate-100 dark:bg-white/5 rounded">
                    <span className="block text-[9px] text-slate-500 dark:text-gray-400 font-sans">الإجمالي</span>
                    <strong className="text-slate-900 dark:text-white">{auditReport.total}</strong>
                  </div>
                  <div className="p-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded">
                    <span className="block text-[9px] font-sans">مرقمة</span>
                    <strong>{auditReport.numbered}</strong>
                  </div>
                  <div className="p-1 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 rounded">
                    <span className="block text-[9px] font-sans">بدون رقم</span>
                    <strong>{auditReport.unnumbered}</strong>
                  </div>
                  <div className="p-1 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded">
                    <span className="block text-[9px] font-sans">أعلى رقم</span>
                    <strong>#{auditReport.maxNumber}</strong>
                  </div>
                </div>

                {auditReport.duplicatesCount > 0 && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-bold">
                    ⚠ توجد أرقام مكررة: {auditReport.duplicateNumbers.map(d => `${d.number} (${d.count} مرات)`).join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={runAuditOnly}
            disabled={auditLoading || activeRunningTool !== null}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Search size={14} className={auditLoading ? 'animate-spin' : ''} />
            <span>{auditLoading ? 'جاري الفحص والتدقيق...' : 'فحص وتدقيق فواتير أخرى'}</span>
          </button>
        </div>

        {/* Tool 2 */}
        <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black text-xs">2</span>
                <h3 className="font-black text-sm text-slate-900 dark:text-white">ترقيم الفواتير غير المرقمة فقط</h3>
              </div>
              <span className="text-[10px] bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-bold">إجراء آمن</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
              حصر الفواتير الأخرى التي لا تحمل رقماً ومنحها أرقاماً تسلسلية بالبادئة المحددة تبدأ من بعد أعلى رقم مسجل.
            </p>
          </div>

          <button
            type="button"
            onClick={executeFillMissingOnly}
            disabled={activeRunningTool !== null}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Hash size={14} />
            <span>ترقيم الفواتير المفقودة فقط</span>
          </button>
        </div>

        {/* Tool 3 */}
        <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black text-xs">3</span>
                <h3 className="font-black text-sm text-slate-900 dark:text-white">فحص ومعالجة الأرقام المكررة</h3>
              </div>
              <span className="text-[10px] bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-bold">تصحيح التعارض</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
              كشف الفواتير التي تحمل نفس الرقم، وإبقاء الفاتورة الأولى، ونقل النسخ المكررة التالية إلى أرقام حصرية جديدة تلي أعلى رقم.
            </p>
          </div>

          <button
            type="button"
            onClick={executeFixDuplicatesOnly}
            disabled={activeRunningTool !== null}
            className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Copy size={14} />
            <span>معالجة تكرار أرقام الفواتير</span>
          </button>
        </div>

        {/* Tool 4 */}
        <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-black text-xs">4</span>
                <h3 className="font-black text-sm text-slate-900 dark:text-white">إعادة الترقيم التسلسلي الشامل للفواتير الأخرى</h3>
              </div>
              <span className="text-[10px] bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded font-bold">إعادة هيكلة</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
              ترتيب كافة الفواتير الأخرى زمنياً وإعادة ترقيمها تسلسلياً بالكامل بالبادئة ورقم البداية الذي يحدده المدير.
            </p>

            <div className="mt-3 flex items-center gap-2 bg-white dark:bg-black/50 p-2 rounded-xl border border-slate-200 dark:border-white/10">
              <span className="text-xs text-slate-700 dark:text-gray-300 font-bold whitespace-nowrap">البادئة:</span>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                disabled={activeRunningTool !== null}
                className="w-16 bg-slate-100 dark:bg-black/60 border border-slate-300 dark:border-white/20 rounded-lg px-2 py-1 text-xs font-mono font-bold text-center text-purple-600 dark:text-purple-400"
              />
              <span className="text-xs text-slate-700 dark:text-gray-300 font-bold whitespace-nowrap mr-2">البداية:</span>
              <input
                type="number"
                value={customStartNumber}
                onChange={(e) => setCustomStartNumber(Math.max(1, parseInt(e.target.value) || 1001))}
                disabled={activeRunningTool !== null}
                className="w-20 bg-slate-100 dark:bg-black/60 border border-slate-300 dark:border-white/20 rounded-lg px-2 py-1 text-xs font-mono font-bold text-center text-purple-600 dark:text-purple-400"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowRenumberConfirm(true)}
            disabled={activeRunningTool !== null}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Layers size={14} />
            <span>إعادة ترقيم الفواتير الأخرى</span>
          </button>
        </div>
      </div>

      {showRenumberConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" dir="rtl">
          <div className="bg-white dark:bg-[#1e1e1e] border-2 border-purple-500/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400">
              <AlertTriangle size={28} />
              <h3 className="text-base font-black text-slate-900 dark:text-white">تأكيد إعادة ترقيم الفواتير الأخرى</h3>
            </div>
            <div className="text-xs text-slate-700 dark:text-gray-300 space-y-2.5 leading-relaxed bg-slate-50 dark:bg-black/40 p-4 rounded-xl border border-slate-200 dark:border-white/10 font-medium">
              <p>
                سيتم ترتيب كافة فواتير المبيعات والخدمات والمشتريات زمنياً، وإعادة ترقيمها تسلسلياً بالكامل بصيغة <strong>{prefix}{customStartNumber}</strong> وما بعدها.
              </p>
              <p className="text-purple-700 dark:text-purple-400 font-bold">
                ✓ سيتم تنفيذ التعديل بحاوية مغلقة وإيقاف المزامنة لحظياً حتى اكتمال الترقيم 100%.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={executeFullRenumber}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                تأكيد وإعادة الترقيم
              </button>
              <button
                type="button"
                onClick={() => setShowRenumberConfirm(false)}
                className="flex-1 py-3 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 text-slate-800 dark:text-white rounded-xl font-bold text-xs transition-all cursor-pointer"
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
