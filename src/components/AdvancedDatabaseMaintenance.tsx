import React, { useState } from 'react';
import { 
  Wrench, 
  FileText, 
  Users, 
  Receipt, 
  CheckCircle, 
  AlertTriangle, 
  Play, 
  ArrowRight, 
  ShieldCheck, 
  Clock, 
  Database, 
  Search, 
  Hash, 
  Copy, 
  Layers, 
  Sparkles, 
  Calculator,
  UserCheck,
  UserPlus,
  PhoneCall,
  ChevronDown
} from 'lucide-react';
import { localDb } from '../lib/local-db';
import { LocalProviderInstance } from '../data/LocalProvider';
import { SyncEngine } from '../data/SyncEngine';
import { isAccountingTransactionValid, roundCurrencyAmount } from '../lib/fundRepairService';
import { db, doc, updateDoc } from '../firebase';
import MaintenanceInvoicesTab from './maintenance/MaintenanceInvoicesTab';
import OtherInvoicesTab from './maintenance/OtherInvoicesTab';
import ComprehensiveMaintenanceTab from './maintenance/ComprehensiveMaintenanceTab';

// Reports interfaces
interface VoucherAuditReport {
  total: number;
  numbered: number;
  unnumbered: number;
  maxNumber: number;
  minNumber: number;
  duplicatesCount: number;
  duplicateNumbers: { number: number; count: number }[];
  unnumberedSamples: { id: string; timestamp: string; amount: number; currency: string; type: string }[];
}

interface CustomerAuditReport {
  total: number;
  numbered: number;
  unnumbered: number;
  maxNumber: number;
  minNumber: number;
  duplicateNumbersCount: number;
  duplicateNumbers: { number: number; count: number; customerNames: string[] }[];
  duplicatePhonesCount: number;
  duplicatePhones: { phone: string; count: number; customerNames: string[] }[];
  unnumberedSamples: { id: string; name: string; phone: string; createdAt: string }[];
}

interface Props {
  onBack?: () => void;
  onClose?: () => void;
}

export default function AdvancedDatabaseMaintenance({ onBack, onClose }: Props) {
  const handleExit = onBack || onClose || (() => {});

  // Section Selector: 'vouchers' | 'customers' | 'invoices' | 'other' | 'comprehensive'
  const [activeSection, setActiveSection] = useState<'vouchers' | 'customers' | 'invoices' | 'other' | 'comprehensive'>('vouchers');

  // --- Zero Background Activity: No auto-running useEffect ---

  // =========================================================================
  // States: Section 1 (Vouchers & Funds)
  // =========================================================================
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<VoucherAuditReport | null>(null);

  const [activeRunningTool, setActiveRunningTool] = useState<number | null>(null);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [executionResult, setExecutionResult] = useState<{ tool: number; type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [customStartNumber, setCustomStartNumber] = useState<number>(1);
  const [showRenumberConfirm, setShowRenumberConfirm] = useState(false);
  const [fundRepairDetails, setFundRepairDetails] = useState<Array<{ fundName: string; currency: string; oldBalance: number; newBalance: number }>>([]);

  // =========================================================================
  // States: Section 2 (Customer Records & Numbers)
  // =========================================================================
  const [custAuditLoading, setCustAuditLoading] = useState(false);
  const [custAuditReport, setCustAuditReport] = useState<CustomerAuditReport | null>(null);

  const [activeRunningCustTool, setActiveRunningCustTool] = useState<number | null>(null);
  const [custProgressText, setCustProgressText] = useState('');
  const [custProgressPercent, setCustProgressPercent] = useState(0);
  const [custExecutionResult, setCustExecutionResult] = useState<{ tool: number; type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [customCustStartNumber, setCustomCustStartNumber] = useState<number>(1);
  const [showCustRenumberConfirm, setShowCustRenumberConfirm] = useState(false);

  // =========================================================================
  // 📂 المحور الأول: صيانة سندات النظام والخزينة (أدوات 1 إلى 5)
  // =========================================================================

  // 🔹 الأداة (1): استعراض وتدقيق السندات (قراءة فقط - Read Only)
  const runAuditOnly = async () => {
    setAuditLoading(true);
    setExecutionResult(null);

    try {
      const res = await localDb.query(
        "SELECT id, voucherNumber, timestamp, amount, currency, type FROM vault_transactions ORDER BY timestamp ASC"
      );
      const rows = res.values || [];
      const total = rows.length;

      let numbered = 0;
      let unnumbered = 0;
      let maxNum = 0;
      let minNum = Infinity;
      const numberFreq: Record<number, number> = {};
      const unnumberedList: any[] = [];

      rows.forEach((r: any) => {
        const vNum = Number(r.voucherNumber);
        if (vNum && !isNaN(vNum) && vNum > 0) {
          numbered++;
          if (vNum > maxNum) maxNum = vNum;
          if (vNum < minNum) minNum = vNum;
          numberFreq[vNum] = (numberFreq[vNum] || 0) + 1;
        } else {
          unnumbered++;
          if (unnumberedList.length < 5) {
            unnumberedList.push({
              id: r.id,
              timestamp: r.timestamp || 'غير محدد',
              amount: r.amount || 0,
              currency: r.currency || 'USD',
              type: r.type === 'receipt' ? 'قبض' : 'صرف'
            });
          }
        }
      });

      const duplicateNumbers: { number: number; count: number }[] = [];
      let totalDuplicateRows = 0;
      Object.entries(numberFreq).forEach(([numStr, count]) => {
        if (count > 1) {
          const num = Number(numStr);
          duplicateNumbers.push({ number: num, count });
          totalDuplicateRows += (count - 1);
        }
      });

      setAuditReport({
        total,
        numbered,
        unnumbered,
        maxNumber: maxNum,
        minNumber: minNum === Infinity ? 0 : minNum,
        duplicatesCount: totalDuplicateRows,
        duplicateNumbers,
        unnumberedSamples: unnumberedList
      });

      if (maxNum > 0) {
        setCustomStartNumber(maxNum + 1);
      } else {
        setCustomStartNumber(1);
      }

    } catch (err: any) {
      console.error("[Audit] Query error:", err);
      setExecutionResult({
        tool: 1,
        type: 'error',
        message: `فشل فحص السندات: ${err?.message || err}`
      });
    } finally {
      setAuditLoading(false);
    }
  };

  // 🔹 الأداة (2): ترقيم السندات غير المرقمة فقط
  const executeFillMissingOnly = async () => {
    setActiveRunningTool(2);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً لحماية البيانات...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query(
        "SELECT id, voucherNumber, timestamp FROM vault_transactions ORDER BY timestamp ASC"
      );
      const rows = res.values || [];

      let currentMax = 0;
      rows.forEach((r: any) => {
        const v = Number(r.voucherNumber);
        if (v && !isNaN(v) && v > currentMax) {
          currentMax = v;
        }
      });

      const unnumberedRows = rows.filter((r: any) => {
        const v = Number(r.voucherNumber);
        return !v || isNaN(v) || v <= 0;
      });

      if (unnumberedRows.length === 0) {
        setExecutionResult({
          tool: 2,
          type: 'info',
          message: 'كافة السندات مرقمة بالفعل بنجاح! لا توجد أي سندات مفقودة الترقيم.'
        });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      let nextNum = currentMax;
      let count = 0;

      for (let i = 0; i < unnumberedRows.length; i++) {
        const row = unnumberedRows[i];
        nextNum++;
        const pct = Math.round(10 + ((i + 1) / unnumberedRows.length) * 80);
        setProgressPercent(pct);
        setProgressText(`ترقيم السند (${i + 1} من ${unnumberedRows.length}) بالرقم #${nextNum}...`);

        const nowIso = new Date().toISOString();
        await LocalProviderInstance.updateDoc('vault_transactions', row.id, {
          voucherNumber: nextNum,
          updatedAt: nowIso
        });
        count++;
      }

      setProgressPercent(95);
      setProgressText('استئناف المزامنة وجدولة المزامنة السحابية...');

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setProgressPercent(100);
      setExecutionResult({
        tool: 2,
        type: 'success',
        message: `تم بنجاح ترقيم ${count} سند مالي مفقود تسلسلياً. أحدث رقم سند حالياً هو #${nextNum}.`
      });

      runAuditOnly();

    } catch (err: any) {
      console.error("[Tool2] Fill missing error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 2,
        type: 'error',
        message: `حدث خطأ أثناء ترقيم السندات: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // 🔹 الأداة (3): فحص ومعالجة الأرقام المكررة
  const executeFixDuplicatesOnly = async () => {
    setActiveRunningTool(3);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query(
        "SELECT id, voucherNumber, timestamp FROM vault_transactions ORDER BY timestamp ASC"
      );
      const rows = res.values || [];

      let currentMax = 0;
      const seenNumbers = new Set<number>();
      const duplicateRows: any[] = [];

      rows.forEach((r: any) => {
        const v = Number(r.voucherNumber);
        if (v && !isNaN(v) && v > 0) {
          if (v > currentMax) currentMax = v;
          if (seenNumbers.has(v)) {
            duplicateRows.push(r);
          } else {
            seenNumbers.add(v);
          }
        }
      });

      if (duplicateRows.length === 0) {
        setExecutionResult({
          tool: 3,
          type: 'info',
          message: 'فحص التكرار سليم 100%! لا يوجد أي تكرار في أرقام السندات الحالية.'
        });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      let nextNum = currentMax;
      let count = 0;

      for (let i = 0; i < duplicateRows.length; i++) {
        const row = duplicateRows[i];
        nextNum++;
        const pct = Math.round(15 + ((i + 1) / duplicateRows.length) * 75);
        setProgressPercent(pct);
        setProgressText(`إصلاح السند المكرر (${i + 1} من ${duplicateRows.length}) ونقله للرقم #${nextNum}...`);

        const nowIso = new Date().toISOString();
        await LocalProviderInstance.updateDoc('vault_transactions', row.id, {
          voucherNumber: nextNum,
          updatedAt: nowIso
        });
        count++;
      }

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setProgressPercent(100);
      setExecutionResult({
        tool: 3,
        type: 'success',
        message: `تم معالجة وإلغاء التكرار لـ ${count} سند مالي بنجاح، وترقيمها بأرقام جديدة تبدأ من #${currentMax + 1} حتى #${nextNum}.`
      });

      runAuditOnly();

    } catch (err: any) {
      console.error("[Tool3] Fix duplicates error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 3,
        type: 'error',
        message: `حدث خطأ أثناء معالجة التكرار: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // 🔹 الأداة (4): إعادة الترقيم التسلسلي الشامل
  const executeFullRenumber = async () => {
    setShowRenumberConfirm(false);
    setActiveRunningTool(4);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query(
        "SELECT id, voucherNumber, timestamp FROM vault_transactions ORDER BY timestamp ASC"
      );
      const rows = res.values || [];

      if (rows.length === 0) {
        setExecutionResult({
          tool: 4,
          type: 'info',
          message: 'لا توجد سندات في قاعدة البيانات لإعادة ترقيمها.'
        });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      const start = Number(customStartNumber) || 1;
      const total = rows.length;

      for (let i = 0; i < total; i++) {
        const row = rows[i];
        const assignedNum = start + i;
        const pct = Math.round(10 + ((i + 1) / total) * 80);
        setProgressPercent(pct);
        setProgressText(`إعادة ترقيم السند (${i + 1} من ${total}) برقم #${assignedNum}...`);

        const nowIso = new Date().toISOString();
        await LocalProviderInstance.updateDoc('vault_transactions', row.id, {
          voucherNumber: assignedNum,
          updatedAt: nowIso
        });
      }

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setProgressPercent(100);
      const finalNum = start + total - 1;
      setExecutionResult({
        tool: 4,
        type: 'success',
        message: `اكتملت إعادة الترقيم التسلسلي الشامل لـ ${total} سند مالي بنجاح! السندات مرقمة الآن تسلسلياً وزمنياً من #${start} حتى #${finalNum}.`
      });

      runAuditOnly();

    } catch (err: any) {
      console.error("[Tool4] Full renumber error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 4,
        type: 'error',
        message: `حدث خطأ أثناء إعادة الترقيم الشامل: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // 🔹 الأداة (5): إعادة احتساب أرصدة الصناديق
  const executeRecalculateFundBalances = async () => {
    setActiveRunningTool(5);
    setProgressPercent(5);
    setProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً لحماية الأرصدة...');
    setExecutionResult(null);
    setFundRepairDetails([]);

    SyncEngine.pauseSync();

    try {
      const txsRes = await localDb.query("SELECT * FROM vault_transactions");
      const allTxs = txsRes.values || [];

      const fundsRes = await localDb.query("SELECT * FROM fin_funds");
      const allFunds = fundsRes.values || [];

      if (allFunds.length === 0) {
        setExecutionResult({
          tool: 5,
          type: 'info',
          message: 'لا توجد صناديق مسجلة في قاعدة البيانات لاحتساب أرصدتها.'
        });
        SyncEngine.resumeSync();
        setActiveRunningTool(null);
        return;
      }

      const details: Array<{ fundName: string; currency: string; oldBalance: number; newBalance: number }> = [];
      const totalFunds = allFunds.length;

      for (let i = 0; i < totalFunds; i++) {
        const fund = allFunds[i];
        const pct = Math.round(10 + ((i + 1) / totalFunds) * 80);
        setProgressPercent(pct);
        setProgressText(`احتساب رصيد (${fund.name || fund.id})...`);

        const fundNameTrimmed = (fund.name || '').trim().toLowerCase();
        
        const fundTxs = allTxs.filter((tx: any) => {
          if (!isAccountingTransactionValid(tx)) return false;
          if (tx.fundId && tx.fundId === fund.id) return true;
          if (!tx.fundId && tx.fundName && tx.fundName.trim().toLowerCase() === fundNameTrimmed) return true;
          return false;
        });

        let calculatedBalance = 0;
        fundTxs.forEach((tx: any) => {
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

        const finalBalance = roundCurrencyAmount(calculatedBalance, fund.currency);
        const oldBal = Number(fund.balance || 0);

        details.push({
          fundName: fund.name || fund.id,
          currency: fund.currency || 'USD',
          oldBalance: oldBal,
          newBalance: finalBalance
        });

        const nowIso = new Date().toISOString();
        await localDb.run(
          "UPDATE fin_funds SET balance = ? WHERE id = ?",
          [finalBalance, fund.id]
        );
        try {
          await localDb.run("UPDATE fin_funds SET updatedAt = ? WHERE id = ?", [nowIso, fund.id]);
        } catch (e) {}

        await localDb.run("DELETE FROM outbox WHERE tableName = 'fin_funds' AND recordId = ?", [fund.id]).catch(() => {});

        try {
          await updateDoc(doc(db, 'fin_funds', fund.id), { 
            balance: finalBalance,
            updatedAt: nowIso
          });
        } catch (cloudErr) {
          try {
            await LocalProviderInstance.updateDoc('fin_funds', fund.id, {
              balance: finalBalance
            });
          } catch (e) {}
        }
      }

      setProgressPercent(95);
      setProgressText('استئناف المزامنة وإخطار واجهات النظام...');

      const updatedLocalFunds = await localDb.query("SELECT * FROM fin_funds");
      localDb.notify('fin_funds', updatedLocalFunds.values || []);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('snd_data_synced'));
      }

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setFundRepairDetails(details);
      setProgressPercent(100);
      setExecutionResult({
        tool: 5,
        type: 'success',
        message: `تمت بنجاح إعادة احتساب ومطابقة أرصدة ${totalFunds} صناديق وخزائن مالية مع السندات بدقة 100%.`
      });

    } catch (err: any) {
      console.error("[Tool5] Recalculate fund balances error:", err);
      SyncEngine.resumeSync();
      setExecutionResult({
        tool: 5,
        type: 'error',
        message: `حدث خطأ أثناء إعادة احتساب أرصدة الصناديق: ${err?.message || err}`
      });
    } finally {
      setActiveRunningTool(null);
    }
  };

  // =========================================================================
  // 📂 المحور الثاني: صيانة سجلات وأرقام العملاء (أدوات 1 إلى 4)
  // تطبيق نفس آلية الحاوية المغلقة والعزل التام
  // =========================================================================

  // 🔹 الأداة (1 للعملاء): استعراض وتدقيق أرقام العملاء (قراءة فقط - Read Only)
  const runCustomerAuditOnly = async () => {
    setCustAuditLoading(true);
    setCustExecutionResult(null);

    try {
      const res = await localDb.query(
        "SELECT id, customerNumber, name, phone1, phone2, createdAt FROM customers ORDER BY createdAt ASC, rowid ASC"
      );
      const rows = res.values || [];
      const total = rows.length;

      let numbered = 0;
      let unnumbered = 0;
      let maxNum = 0;
      let minNum = Infinity;

      const numberMap: Record<number, string[]> = {};
      const phoneMap: Record<string, string[]> = {};
      const unnumberedList: any[] = [];

      rows.forEach((c: any) => {
        const cNum = Number(c.customerNumber);
        const cName = (c.name || 'عميل غير مسمى').trim();

        if (cNum && !isNaN(cNum) && cNum > 0) {
          numbered++;
          if (cNum > maxNum) maxNum = cNum;
          if (cNum < minNum) minNum = cNum;
          
          if (!numberMap[cNum]) numberMap[cNum] = [];
          numberMap[cNum].push(cName);
        } else {
          unnumbered++;
          if (unnumberedList.length < 5) {
            unnumberedList.push({
              id: c.id,
              name: cName,
              phone: c.phone1 || c.phone2 || '---',
              createdAt: c.createdAt || 'غير محدد'
            });
          }
        }

        // Check phone duplicates
        [c.phone1, c.phone2].forEach(p => {
          if (p && String(p).trim().length >= 6) {
            const cleanPhone = String(p).trim();
            if (!phoneMap[cleanPhone]) phoneMap[cleanPhone] = [];
            phoneMap[cleanPhone].push(cName);
          }
        });
      });

      const duplicateNumbers: { number: number; count: number; customerNames: string[] }[] = [];
      let totalDuplicateNumRows = 0;
      Object.entries(numberMap).forEach(([numStr, names]) => {
        if (names.length > 1) {
          duplicateNumbers.push({
            number: Number(numStr),
            count: names.length,
            customerNames: names
          });
          totalDuplicateNumRows += (names.length - 1);
        }
      });

      const duplicatePhones: { phone: string; count: number; customerNames: string[] }[] = [];
      let totalDuplicatePhoneRows = 0;
      Object.entries(phoneMap).forEach(([phone, names]) => {
        if (names.length > 1) {
          duplicatePhones.push({
            phone,
            count: names.length,
            customerNames: names
          });
          totalDuplicatePhoneRows += (names.length - 1);
        }
      });

      setCustAuditReport({
        total,
        numbered,
        unnumbered,
        maxNumber: maxNum > 0 ? maxNum : 0,
        minNumber: minNum === Infinity ? 0 : minNum,
        duplicateNumbersCount: totalDuplicateNumRows,
        duplicateNumbers,
        duplicatePhonesCount: totalDuplicatePhoneRows,
        duplicatePhones,
        unnumberedSamples: unnumberedList
      });

      if (maxNum > 0) {
        setCustomCustStartNumber(maxNum + 1);
      } else {
        setCustomCustStartNumber(1);
      }

    } catch (err: any) {
      console.error("[CustAudit] Query error:", err);
      setCustExecutionResult({
        tool: 1,
        type: 'error',
        message: `فشل فحص سجلات العملاء: ${err?.message || err}`
      });
    } finally {
      setCustAuditLoading(false);
    }
  };

  // 🔹 الأداة (2 للعملاء): ترقيم العملاء غير المرقمين فقط (الحاوية المغلقة)
  const executeFillMissingCustomersOnly = async () => {
    setActiveRunningCustTool(2);
    setCustProgressPercent(5);
    setCustProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً لحماية بيانات العملاء...');
    setCustExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query(
        "SELECT id, customerNumber, createdAt FROM customers ORDER BY createdAt ASC, rowid ASC"
      );
      const rows = res.values || [];

      let currentMax = 0;
      rows.forEach((c: any) => {
        const n = Number(c.customerNumber);
        if (n && !isNaN(n) && n > currentMax) {
          currentMax = n;
        }
      });

      const unnumberedRows = rows.filter((c: any) => {
        const n = Number(c.customerNumber);
        return !n || isNaN(n) || n <= 0;
      });

      if (unnumberedRows.length === 0) {
        setCustExecutionResult({
          tool: 2,
          type: 'info',
          message: 'كافة العملاء مرقمون بالفعل بنجاح! لا توجد بطاقات عملاء بدون أرقام تسلسلية.'
        });
        SyncEngine.resumeSync();
        setActiveRunningCustTool(null);
        return;
      }

      let nextNum = currentMax;
      let count = 0;

      for (let i = 0; i < unnumberedRows.length; i++) {
        const row = unnumberedRows[i];
        nextNum++;
        const pct = Math.round(10 + ((i + 1) / unnumberedRows.length) * 80);
        setCustProgressPercent(pct);
        setCustProgressText(`ترقيم العميل (${i + 1} من ${unnumberedRows.length}) بالرقم #${nextNum}...`);

        const nowIso = new Date().toISOString();
        await localDb.run(
          "UPDATE customers SET customerNumber = ?, updatedAt = ? WHERE id = ?",
          [nextNum, nowIso, row.id]
        );

        await LocalProviderInstance.updateDoc('customers', row.id, {
          customerNumber: nextNum,
          updatedAt: nowIso
        });

        try {
          await updateDoc(doc(db, 'customers', row.id), {
            customerNumber: nextNum,
            updatedAt: nowIso
          });
        } catch (e) {}

        count++;
      }

      setCustProgressPercent(95);
      setCustProgressText('استئناف المزامنة وإخطار النظام...');

      const updatedCusts = await localDb.query("SELECT * FROM customers");
      localDb.notify('customers', updatedCusts.values || []);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('snd_data_synced'));
      }

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setCustProgressPercent(100);
      setCustExecutionResult({
        tool: 2,
        type: 'success',
        message: `تم بنجاح ترقيم ${count} عميل مفقود الترقيم تسلسلياً. أحدث كود عميل حالياً هو #${nextNum}.`
      });

      runCustomerAuditOnly();

    } catch (err: any) {
      console.error("[CustTool2] Fill missing error:", err);
      SyncEngine.resumeSync();
      setCustExecutionResult({
        tool: 2,
        type: 'error',
        message: `حدث خطأ أثناء ترقيم العملاء: ${err?.message || err}`
      });
    } finally {
      setActiveRunningCustTool(null);
    }
  };

  // 🔹 الأداة (3 للعملاء): فحص ومعالجة أرقام العملاء المكررة (الحاوية المغلقة)
  const executeFixDuplicateCustomersOnly = async () => {
    setActiveRunningCustTool(3);
    setCustProgressPercent(5);
    setCustProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setCustExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query(
        "SELECT id, customerNumber, createdAt FROM customers ORDER BY createdAt ASC, rowid ASC"
      );
      const rows = res.values || [];

      let currentMax = 0;
      const seenNumbers = new Set<number>();
      const duplicateRows: any[] = [];

      rows.forEach((c: any) => {
        const n = Number(c.customerNumber);
        if (n && !isNaN(n) && n > 0) {
          if (n > currentMax) currentMax = n;
          if (seenNumbers.has(n)) {
            duplicateRows.push(c);
          } else {
            seenNumbers.add(n);
          }
        }
      });

      if (duplicateRows.length === 0) {
        setCustExecutionResult({
          tool: 3,
          type: 'info',
          message: 'فحص أكواد العملاء سليم 100%! لا يوجد أي تكرار في أرقام العملاء الحالية.'
        });
        SyncEngine.resumeSync();
        setActiveRunningCustTool(null);
        return;
      }

      let nextNum = currentMax;
      let count = 0;

      for (let i = 0; i < duplicateRows.length; i++) {
        const row = duplicateRows[i];
        nextNum++;
        const pct = Math.round(15 + ((i + 1) / duplicateRows.length) * 75);
        setCustProgressPercent(pct);
        setCustProgressText(`معالجة العميل المكرر (${i + 1} من ${duplicateRows.length}) ومنحه الرقم #${nextNum}...`);

        const nowIso = new Date().toISOString();
        await localDb.run(
          "UPDATE customers SET customerNumber = ?, updatedAt = ? WHERE id = ?",
          [nextNum, nowIso, row.id]
        );

        await LocalProviderInstance.updateDoc('customers', row.id, {
          customerNumber: nextNum,
          updatedAt: nowIso
        });

        try {
          await updateDoc(doc(db, 'customers', row.id), {
            customerNumber: nextNum,
            updatedAt: nowIso
          });
        } catch (e) {}

        count++;
      }

      const updatedCusts = await localDb.query("SELECT * FROM customers");
      localDb.notify('customers', updatedCusts.values || []);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('snd_data_synced'));
      }

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setCustProgressPercent(100);
      setCustExecutionResult({
        tool: 3,
        type: 'success',
        message: `تمت معالجة وإلغاء التكرار لـ ${count} عميل بنجاح، وترقيمهم بأكواد جديدة تبدأ من #${currentMax + 1} حتى #${nextNum}.`
      });

      runCustomerAuditOnly();

    } catch (err: any) {
      console.error("[CustTool3] Fix duplicates error:", err);
      SyncEngine.resumeSync();
      setCustExecutionResult({
        tool: 3,
        type: 'error',
        message: `حدث خطأ أثناء معالجة تكرار أرقام العملاء: ${err?.message || err}`
      });
    } finally {
      setActiveRunningCustTool(null);
    }
  };

  // 🔹 الأداة (4 للعملاء): إعادة الترقيم التسلسلي الشامل للعملاء (الحاوية المغلقة)
  const executeFullCustomerRenumber = async () => {
    setShowCustRenumberConfirm(false);
    setActiveRunningCustTool(4);
    setCustProgressPercent(5);
    setCustProgressText('تطبيق الحاوية المغلقة: إيقاف المزامنة لحظياً...');
    setCustExecutionResult(null);

    SyncEngine.pauseSync();

    try {
      const res = await localDb.query(
        "SELECT id, customerNumber, createdAt FROM customers ORDER BY createdAt ASC, rowid ASC"
      );
      const rows = res.values || [];

      if (rows.length === 0) {
        setCustExecutionResult({
          tool: 4,
          type: 'info',
          message: 'لا توجد سجلات عملاء في قاعدة البيانات لإعادة ترقيمها.'
        });
        SyncEngine.resumeSync();
        setActiveRunningCustTool(null);
        return;
      }

      const start = Number(customCustStartNumber) || 1;
      const total = rows.length;

      for (let i = 0; i < total; i++) {
        const row = rows[i];
        const assignedNum = start + i;
        const pct = Math.round(10 + ((i + 1) / total) * 80);
        setCustProgressPercent(pct);
        setCustProgressText(`إعادة ترقيم العميل (${i + 1} من ${total}) برقم #${assignedNum}...`);

        const nowIso = new Date().toISOString();
        await localDb.run(
          "UPDATE customers SET customerNumber = ?, updatedAt = ? WHERE id = ?",
          [assignedNum, nowIso, row.id]
        );

        await LocalProviderInstance.updateDoc('customers', row.id, {
          customerNumber: assignedNum,
          updatedAt: nowIso
        });

        try {
          await updateDoc(doc(db, 'customers', row.id), {
            customerNumber: assignedNum,
            updatedAt: nowIso
          });
        } catch (e) {}
      }

      const updatedCusts = await localDb.query("SELECT * FROM customers");
      localDb.notify('customers', updatedCusts.values || []);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('snd_data_synced'));
      }

      SyncEngine.resumeSync();
      SyncEngine.syncAll().catch(err => console.warn("[SandboxSync] outbox push deferred:", err));

      setCustProgressPercent(100);
      const finalNum = start + total - 1;
      setCustExecutionResult({
        tool: 4,
        type: 'success',
        message: `اكتملت إعادة الترقيم التسلسلي الشامل لـ ${total} عميل بنجاح! العملاء مرقمون الآن تسلسلياً وزمنياً من #${start} حتى #${finalNum}.`
      });

      runCustomerAuditOnly();

    } catch (err: any) {
      console.error("[CustTool4] Full renumber error:", err);
      SyncEngine.resumeSync();
      setCustExecutionResult({
        tool: 4,
        type: 'error',
        message: `حدث خطأ أثناء إعادة ترقيم العملاء: ${err?.message || err}`
      });
    } finally {
      setActiveRunningCustTool(null);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-6 pb-24 space-y-6 text-right font-cairo" dir="rtl">
      
      {/* Top Navigation Bar: Completely Isolated Page Header */}
      <div className="flex items-center justify-between bg-white dark:bg-[#1a1a1a] p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Wrench size={18} />
          </div>
          <div className="max-w-[280px] sm:max-w-md">
            <h1 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              صيانة متقدمة لقاعدة البيانات
              <span className="text-[9px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                بيئة معزولة
              </span>
            </h1>
            <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
              أدوات مستقلة ومعزولة لإدارة وترقيم جداول النظام بأمان تام وبدون أي تداخل مع شاشة الإعدادات الرئيسية.
            </p>
          </div>
        </div>

        <button
          onClick={handleExit}
          type="button"
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-800 dark:text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer border border-slate-200 dark:border-white/10"
        >
          <ArrowRight size={14} />
          <span className="hidden sm:inline">رجوع</span>
        </button>
      </div>

      {/* Section Switcher: Dropdown Menu */}
      <div className="relative w-full sm:max-w-xs mr-auto">
        <div className="bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm group">
          <select
            value={activeSection}
            onChange={(e) => setActiveSection(e.target.value as any)}
            className="w-full bg-transparent px-4 py-3 text-xs font-black text-slate-900 dark:text-white outline-none cursor-pointer appearance-none text-right pr-11"
          >
            <option value="vouchers">سندات النظام والخزينة</option>
            <option value="customers">سجلات وأرقام العملاء</option>
            <option value="invoices">فواتير الصيانة والأجهزة</option>
            <option value="other">فواتير أخرى ومبيعات</option>
            <option value="comprehensive">معالجة شاملة للروابط</option>
          </select>
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            {activeSection === 'vouchers' && <Receipt size={18} className="text-amber-500" />}
            {activeSection === 'customers' && <Users size={18} className="text-emerald-500" />}
            {activeSection === 'invoices' && <FileText size={18} className="text-blue-500" />}
            {activeSection === 'other' && <Database size={18} className="text-purple-500" />}
            {activeSection === 'comprehensive' && <Sparkles size={18} className="text-rose-500" />}
          </div>
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <ChevronDown size={16} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 📂 عرض المحور الأول: صيانة سندات النظام والخزينة                         */}
      {/* ========================================================================= */}
      {activeSection === 'vouchers' && (
        <div className="bg-white dark:bg-[#1a1a1a] border-2 border-amber-500/50 rounded-3xl p-5 sm:p-6 shadow-md space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Receipt size={22} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  المحور الأول: صيانة سندات النظام والخزينة
                  <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-md font-mono font-bold">
                    vault_transactions & fin_funds
                  </span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-gray-400 mt-0.5">
                  أدوات مفردة ومستقلة: كل أداة تؤدي وظيفة واحدة محددة ومعزولة بدون تشغيل جماعي عشوائي
                </p>
              </div>
            </div>
          </div>

          {/* Progress Indicator */}
          {activeRunningTool !== null && (
            <div className="p-4 bg-amber-50 dark:bg-black/40 rounded-2xl border border-amber-300 dark:border-amber-500/30 space-y-2 animate-pulse">
              <div className="flex items-center justify-between text-xs font-bold text-amber-800 dark:text-amber-300">
                <span>{progressText}</span>
                <span className="font-mono text-sm">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-3 overflow-hidden">
                <div className="bg-amber-500 h-full rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}

          {/* Execution Result Log */}
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

          {/* The 5 Tools Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Tool 1 */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">1</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">استعراض وتدقيق السندات</h3>
                  </div>
                  <span className="text-[10px] bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-300 px-2 py-0.5 rounded font-bold">قراءة فقط</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  فحص السجلات الحالية وعرض تقرير تفصيلي بأعداد السندات، السندات المرقمة، غير المرقمة، والتكرارات دون تعديل أي بايت.
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
                      <div className="p-1 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded">
                        <span className="block text-[9px] font-sans">تكرارات</span>
                        <strong>{auditReport.duplicatesCount}</strong>
                      </div>
                    </div>
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
                <span>{auditLoading ? 'جاري التدقيق والفحص...' : 'فحص وتدقيق السندات الآن'}</span>
              </button>
            </div>

            {/* Tool 2 */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black text-xs">2</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">ترقيم السندات غير المرقمة فقط</h3>
                  </div>
                  <span className="text-[10px] bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-bold">إجراء آمن</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  حصر السندات التي لا تحمل رقماً تسلسلياً ومنحها أرقاماً جديدة تبدأ من بعد أعلى رقم سند موجود في النظام.
                </p>
              </div>
              <button
                type="button"
                onClick={executeFillMissingOnly}
                disabled={activeRunningTool !== null}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Hash size={14} />
                <span>ترقيم السندات المفقودة فقط</span>
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
                  كشف أي سندين أو أكثر يشتركان في نفس الرقم التسلسلي، وإبقاء السند الأول ونقل النسخ المكررة التالية إلى أرقام حصرية جديدة.
                </p>
              </div>
              <button
                type="button"
                onClick={executeFixDuplicatesOnly}
                disabled={activeRunningTool !== null}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Copy size={14} />
                <span>معالجة الأرقام المكررة فقط</span>
              </button>
            </div>

            {/* Tool 4 */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-black text-xs">4</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">إعادة الترقيم التسلسلي الشامل</h3>
                  </div>
                  <span className="text-[10px] bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded font-bold">إعادة هيكلة</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  ترتيب كافة سندات النظام ترتيباً زمنياً صارماً وإعادة ترقيمها تسلسلياً بالكامل بدءاً من الرقم الذي يحدده المدير.
                </p>
                <div className="mt-3 flex items-center gap-2 bg-white dark:bg-black/50 p-2 rounded-xl border border-slate-200 dark:border-white/10">
                  <span className="text-xs text-slate-700 dark:text-gray-300 font-bold whitespace-nowrap">رقم البداية:</span>
                  <input
                    type="number"
                    value={customStartNumber}
                    onChange={(e) => setCustomStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
                    disabled={activeRunningTool !== null}
                    className="w-24 bg-slate-100 dark:bg-black/60 border border-slate-300 dark:border-white/20 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-purple-600 dark:text-purple-400 text-center"
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
                <span>إعادة الترقيم الشامل لكافة السندات</span>
              </button>
            </div>

            {/* Tool 5: Fund Balances */}
            <div className="md:col-span-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-black text-xs">5</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">إعادة احتساب أرصدة الصناديق</h3>
                  </div>
                  <span className="text-[10px] bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 px-2 py-0.5 rounded font-bold border border-teal-300 dark:border-teal-500/20">مطابقة الأرصدة</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  إعادة احتساب الأرصدة الدقيقة لكافة الصناديق والخزائن البنكية من واقع صافي حركات وسندات القبض والصرف الفعلية غير الملغاة بحاوية معزولة، ومطابقتها وتحديثها محلياً وسحابياً.
                </p>

                {fundRepairDetails.length > 0 && (
                  <div className="mt-3 p-3 bg-white dark:bg-black/50 rounded-xl border border-slate-200 dark:border-white/10 text-xs space-y-2">
                    <span className="block text-[11px] font-bold text-slate-700 dark:text-gray-300">
                      تقرير الأرصدة المحتسبة بعد المطابقة من السندات:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {fundRepairDetails.map((f, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-50 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-between">
                          <div>
                            <strong className="block text-xs text-slate-900 dark:text-white font-bold">{f.fundName}</strong>
                            <span className="text-[10px] text-slate-500 dark:text-gray-400">السابق: {f.oldBalance.toLocaleString('en-US')}</span>
                          </div>
                          <div className="text-left font-mono">
                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{f.newBalance.toLocaleString('en-US')}</span>
                            <span className="text-[10px] text-slate-500 dark:text-gray-400 block">{f.currency}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={executeRecalculateFundBalances}
                disabled={activeRunningTool !== null}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Calculator size={14} />
                <span>إعادة احتساب أرصدة الصناديق</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 📂 عرض المحور الثاني: صيانة سجلات وأرقام العملاء                          */}
      {/* ========================================================================= */}
      {activeSection === 'customers' && (
        <div className="bg-white dark:bg-[#1a1a1a] border-2 border-emerald-500/50 rounded-3xl p-5 sm:p-6 shadow-md space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                <Users size={22} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  المحور الثاني: صيانة وترقيم سجلات العملاء
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md font-mono font-bold">
                    customers table
                  </span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-gray-400 mt-0.5">
                  أدوات مفردة ومعزولة لتدقيق وفهرسة وترقيم بطاقات العملاء، كشف وتصحيح التكرارات، وإعادة الترقيم التسلسلي بأمان
                </p>
              </div>
            </div>
          </div>

          {/* Progress Indicator for Customer Tools */}
          {activeRunningCustTool !== null && (
            <div className="p-4 bg-emerald-50 dark:bg-black/40 rounded-2xl border border-emerald-300 dark:border-emerald-500/30 space-y-2 animate-pulse">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300">
                <span>{custProgressText}</span>
                <span className="font-mono text-sm">{custProgressPercent}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-3 overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${custProgressPercent}%` }} />
              </div>
            </div>
          )}

          {/* Customer Execution Result Log */}
          {custExecutionResult && (
            <div className={`p-4 rounded-2xl text-xs font-bold border flex items-start gap-2.5 shadow-sm ${
              custExecutionResult.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-300'
                : custExecutionResult.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-900 dark:text-rose-300'
                : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30 text-indigo-900 dark:text-indigo-300'
            }`}>
              {custExecutionResult.type === 'success' ? <CheckCircle size={18} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle size={18} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />}
              <span className="leading-relaxed">{custExecutionResult.message}</span>
            </div>
          )}

          {/* 4 Customer Discrete Tools Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Cust Tool 1: Audit */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-xs">1</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">استعراض وتدقيق سجلات العملاء</h3>
                  </div>
                  <span className="text-[10px] bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-300 px-2 py-0.5 rounded font-bold">قراءة فقط</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  فحص شامل لبطاقات العملاء في SQLite، حصر العملاء المرقمين وغير المرقمين، وكشف أي أرقام عملاء أو هواتف مكررة دون تعديل البيانات.
                </p>

                {custAuditReport && (
                  <div className="mt-3 p-3 bg-white dark:bg-black/50 rounded-xl border border-slate-200 dark:border-white/10 text-xs space-y-2">
                    <div className="grid grid-cols-4 gap-1 text-center font-mono">
                      <div className="p-1 bg-slate-100 dark:bg-white/5 rounded">
                        <span className="block text-[9px] text-slate-500 dark:text-gray-400 font-sans">إجمالي العملاء</span>
                        <strong className="text-slate-900 dark:text-white">{custAuditReport.total}</strong>
                      </div>
                      <div className="p-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded">
                        <span className="block text-[9px] font-sans">مرقمين</span>
                        <strong>{custAuditReport.numbered}</strong>
                      </div>
                      <div className="p-1 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 rounded">
                        <span className="block text-[9px] font-sans">بدون رقم</span>
                        <strong>{custAuditReport.unnumbered}</strong>
                      </div>
                      <div className="p-1 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded">
                        <span className="block text-[9px] font-sans">أعلى رقم</span>
                        <strong>#{custAuditReport.maxNumber}</strong>
                      </div>
                    </div>

                    {custAuditReport.duplicateNumbersCount > 0 && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 font-bold">
                        ⚠ توجد أرقام عملاء مكررة: {custAuditReport.duplicateNumbers.map(d => `#${d.number} (${d.count} عملاء)`).join(', ')}
                      </p>
                    )}

                    {custAuditReport.duplicatePhonesCount > 0 && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                        ℹ توجد أرقام هواتف مشتركة بين عملاء: {custAuditReport.duplicatePhones.slice(0, 3).map(p => `${p.phone} (${p.count})`).join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={runCustomerAuditOnly}
                disabled={custAuditLoading || activeRunningCustTool !== null}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Search size={14} className={custAuditLoading ? 'animate-spin' : ''} />
                <span>{custAuditLoading ? 'جاري فحص سجلات العملاء...' : 'فحص وتدقيق العملاء الآن'}</span>
              </button>
            </div>

            {/* Cust Tool 2: Fill Missing */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black text-xs">2</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">ترقيم العملاء غير المرقمين فقط</h3>
                  </div>
                  <span className="text-[10px] bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-bold">إجراء آمن</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  حصر بطاقات العملاء التي لا تحمل كوداً أو رقماً تسلسلياً ومنحها أرقاماً جديدة تبدأ من بعد أعلى رقم عميل مسجل بالنظام، مع حماية أرقام العملاء المرقمين مسبقاً.
                </p>
              </div>

              <button
                type="button"
                onClick={executeFillMissingCustomersOnly}
                disabled={activeRunningCustTool !== null}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <UserPlus size={14} />
                <span>ترقيم بطاقات العملاء المفقودة</span>
              </button>
            </div>

            {/* Cust Tool 3: Fix Duplicate Numbers */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black text-xs">3</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">فحص ومعالجة أرقام العملاء المكررة</h3>
                  </div>
                  <span className="text-[10px] bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-bold">تصحيح التعارض</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  كشف أي عميلين أو أكثر يحملون نفس الرقم التسلسلي، وإبقاء العميل الأول كما هو وترقيم السجلات المكررة التالية بأرقام حصرية جديدة تلي أعلى رقم عميل.
                </p>
              </div>

              <button
                type="button"
                onClick={executeFixDuplicateCustomersOnly}
                disabled={activeRunningCustTool !== null}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <UserCheck size={14} />
                <span>معالجة تكرار أرقام العملاء فقط</span>
              </button>
            </div>

            {/* Cust Tool 4: Full Renumbering */}
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-black text-xs">4</span>
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">إعادة الترقيم التسلسلي الشامل للعملاء</h3>
                  </div>
                  <span className="text-[10px] bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded font-bold">إعادة هيكلة</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                  ترتيب كافة سجلات العملاء حسب تاريخ التسجيل وإعادة ترقيمها تسلسلياً بالكامل بدءاً من الرقم الذي يحدده المدير.
                </p>

                <div className="mt-3 flex items-center gap-2 bg-white dark:bg-black/50 p-2 rounded-xl border border-slate-200 dark:border-white/10">
                  <span className="text-xs text-slate-700 dark:text-gray-300 font-bold whitespace-nowrap">رقم البداية:</span>
                  <input
                    type="number"
                    value={customCustStartNumber}
                    onChange={(e) => setCustomCustStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
                    disabled={activeRunningCustTool !== null}
                    className="w-24 bg-slate-100 dark:bg-black/60 border border-slate-300 dark:border-white/20 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-purple-600 dark:text-purple-400 text-center"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCustRenumberConfirm(true)}
                disabled={activeRunningCustTool !== null}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Layers size={14} />
                <span>إعادة ترقيم كافة العملاء</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 📂 عرض المحور الثالث: فواتير الصيانة والأجهزة                              */}
      {/* ========================================================================= */}
      {activeSection === 'invoices' && <MaintenanceInvoicesTab />}

      {/* ========================================================================= */}
      {/* 📂 عرض المحور الرابع: فواتير أخرى والمبيعات والمشتريات                      */}
      {/* ========================================================================= */}
      {activeSection === 'other' && <OtherInvoicesTab />}

      {/* ========================================================================= */}
      {/* 📂 عرض المحور الخامس: المعالجة الشاملة وتسوية الروابط                      */}
      {/* ========================================================================= */}
      {activeSection === 'comprehensive' && <ComprehensiveMaintenanceTab />}

      {/* Confirmation Modal for Tool 4 (Vouchers Full Renumbering) */}
      {showRenumberConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" dir="rtl">
          <div className="bg-white dark:bg-[#1e1e1e] border-2 border-purple-500/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400">
              <AlertTriangle size={28} />
              <h3 className="text-base font-black text-slate-900 dark:text-white">تأكيد إعادة الترقيم التسلسلي الشامل للسندات</h3>
            </div>
            <div className="text-xs text-slate-700 dark:text-gray-300 space-y-2.5 leading-relaxed bg-slate-50 dark:bg-black/40 p-4 rounded-xl border border-slate-200 dark:border-white/10 font-medium">
              <p>
                سيتم ترتيب كافة السندات في النظام من الأقدم إلى الأحدث، وإعادة ترقيمها تسلسلياً بالكامل بدءاً من الرقم <strong>#{customStartNumber}</strong>.
              </p>
              <p className="text-amber-700 dark:text-amber-400 font-bold">
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

      {/* Confirmation Modal for Customer Tool 4 (Customers Full Renumbering) */}
      {showCustRenumberConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" dir="rtl">
          <div className="bg-white dark:bg-[#1e1e1e] border-2 border-purple-500/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400">
              <AlertTriangle size={28} />
              <h3 className="text-base font-black text-slate-900 dark:text-white">تأكيد إعادة ترقيم كافة العملاء</h3>
            </div>
            <div className="text-xs text-slate-700 dark:text-gray-300 space-y-2.5 leading-relaxed bg-slate-50 dark:bg-black/40 p-4 rounded-xl border border-slate-200 dark:border-white/10 font-medium">
              <p>
                سيتم ترتيب كافة بطاقات العملاء في النظام حسب تاريخ الإدخال، وإعادة ترقيمها تسلسلياً بالكامل بدءاً من الكود <strong>#{customCustStartNumber}</strong>.
              </p>
              <p className="text-emerald-700 dark:text-emerald-400 font-bold">
                ✓ سيتم تنفيذ التعديل بحاوية مغلقة وإيقاف المزامنة لحظياً حتى اكتمال الترقيم 100%.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={executeFullCustomerRenumber}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                تأكيد وإعادة ترقيم العملاء
              </button>
              <button
                type="button"
                onClick={() => setShowCustRenumberConfirm(false)}
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
