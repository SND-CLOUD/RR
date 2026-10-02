import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  CircleDollarSign, 
  Printer, 
  FileSpreadsheet, 
  Search, 
  Filter, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownLeft, 
  ArrowRightLeft, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  RefreshCw, 
  Eye, 
  Layers, 
  FileText, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Coins,
  Building,
  Check,
  X
} from 'lucide-react';
import { localDb } from '../lib/local-db';
import { db, collection, getDocs } from '../firebase';
import { parseFundBalance, formatMoney, getCurrencySymbol } from '../lib/fundUtils';
import { isAccountingTransactionValid, roundCurrencyAmount } from '../lib/fundRepairService';
import { parseDate, formatDateTime, formatTxDate } from '../lib/dateUtils';
import { User, ShopConfig } from '../types';
import { WhatsAppIcon } from './ReportActions';

interface FinFund {
  id: string;
  name: string;
  type: string;
  currency: string;
  description: string;
  status: string;
  balance: number;
}

interface VaultTx {
  id: string;
  voucherNumber: number;
  timestamp: string;
  type: 'receipt' | 'payment' | 'deposit' | 'disbursement' | 'expense' | 'invoice_payment';
  transactionCategory: string;
  customerName: string;
  customerId?: string;
  invoiceNumber?: string;
  invoiceId?: string;
  amount: number;
  currency: string;
  fundId?: string;
  fundName?: string;
  notes?: string;
  userName?: string;
  userNumber?: number;
  status?: string;
  isReversed?: number | boolean;
  isReversal?: number | boolean;
  receiptCurrency?: string;
  receiptAmount?: number;
  liabilityCurrency?: string;
  liabilityAmount?: number;
  paymentType?: number;
}

interface CurrencySummaryItem {
  totalBalance: number;
  inFlow: number;
  outFlow: number;
  count: number;
}

interface FinancialReportsTabProps {
  user: User;
  shopConfig: ShopConfig | null;
  onPrintPreview: (previewData: any) => void;
  canPrint?: boolean;
}

export default function FinancialReportsTab({
  user,
  shopConfig,
  onPrintPreview,
  canPrint = true
}: FinancialReportsTabProps) {
  const [funds, setFunds] = useState<FinFund[]>([]);
  const [transactions, setTransactions] = useState<VaultTx[]>([]);
  const [invoicesMap, setInvoicesMap] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter States
  const [selectedFundId, setSelectedFundId] = useState<string>('all');
  const [selectedTxType, setSelectedTxType] = useState<string>('all'); // all, receipt, payment, transfer
  const [selectedInvoiceLinkage, setSelectedInvoiceLinkage] = useState<'all' | 'linked' | 'orphaned' | 'direct'>('all');
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'custom' | 'all'>('month');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Selected Fund Modal for single-fund statement
  const [activeFundStatement, setActiveFundStatement] = useState<FinFund | null>(null);

  // Collapsible funds state (each fund row can be collapsed into a single line or opened)
  const [expandedFundIds, setExpandedFundIds] = useState<Record<string, boolean>>({});

  const toggleFundCollapse = (fundId: string) => {
    setExpandedFundIds(prev => ({
      ...prev,
      [fundId]: !prev[fundId]
    }));
  };

  const collapseAllFunds = () => {
    setExpandedFundIds({});
  };

  const expandAllFunds = () => {
    const allExp: Record<string, boolean> = {};
    funds.forEach(f => { allExp[f.id] = true; });
    setExpandedFundIds(allExp);
  };

  // Load Data
  const loadData = async () => {
    try {
      setIsRefreshing(true);
      
      // 1. Funds
      let loadedFunds: FinFund[] = [];
      try {
        const localFunds = await localDb.query("SELECT * FROM fin_funds ORDER BY name ASC");
        if (localFunds.values && localFunds.values.length > 0) {
          loadedFunds = localFunds.values as FinFund[];
        }
      } catch (e) {
        console.warn('Local DB funds query failed, falling back to Firebase:', e);
      }
      if (loadedFunds.length === 0) {
        const snap = await getDocs(collection(db, 'fin_funds'));
        loadedFunds = snap.docs.map(d => ({ id: d.id, ...d.data() } as FinFund));
      }
      setFunds(loadedFunds);

      // 2. Transactions
      let loadedTxs: VaultTx[] = [];
      try {
        const localTxs = await localDb.query("SELECT * FROM vault_transactions ORDER BY timestamp DESC");
        if (localTxs.values && localTxs.values.length > 0) {
          loadedTxs = localTxs.values as VaultTx[];
        }
      } catch (e) {
        console.warn('Local DB transactions query failed, falling back to Firebase:', e);
      }
      if (loadedTxs.length === 0) {
        const snap = await getDocs(collection(db, 'vault_transactions'));
        loadedTxs = snap.docs.map(d => ({ id: d.id, ...d.data() } as VaultTx));
      }
      // Sort newest first
      loadedTxs.sort((a, b) => {
        const numA = Number(a.voucherNumber) || 0;
        const numB = Number(b.voucherNumber) || 0;
        if (numB !== numA) return numB - numA;
        const dateA = new Date(a.timestamp || 0).getTime();
        const dateB = new Date(b.timestamp || 0).getTime();
        return dateB - dateA;
      });
      setTransactions(loadedTxs);

      // 3. Invoices map for linking check
      const invMap = new Map<string, any>();
      try {
        const localInvs = await localDb.query("SELECT id, invoiceNumber, customerId, customerName, totalCost, status FROM invoices");
        if (localInvs.values) {
          localInvs.values.forEach((inv: any) => {
            if (inv.id) invMap.set(String(inv.id), inv);
            if (inv.invoiceNumber) {
              const raw = String(inv.invoiceNumber).trim();
              const clean = raw.replace('#', '').trim();
              invMap.set(raw, inv);
              invMap.set(clean, inv);
            }
          });
        }
      } catch (e) {
        // Fallback to firestore
        const snap = await getDocs(collection(db, 'invoices'));
        snap.docs.forEach(d => {
          const inv: any = { id: d.id, ...d.data() };
          invMap.set(d.id, inv);
          if (inv.invoiceNumber) {
            const raw = String(inv.invoiceNumber).trim();
            const clean = raw.replace('#', '').trim();
            invMap.set(raw, inv);
            invMap.set(clean, inv);
          }
        });
      }
      setInvoicesMap(invMap);

    } catch (err) {
      console.error('Failed to load financial reports data:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Helper to get Fund Display Name
  const getFundName = (fundId?: string, fundName?: string) => {
    if (fundName && fundName.trim() && fundName !== 'غير معروف') return fundName;
    if (fundId) {
      const f = funds.find(item => item.id === fundId);
      if (f && f.name) return f.name;
    }
    return 'غير محدد';
  };

  // Helper to check invoice linkage status
  const getInvoiceLinkageStatus = (tx: VaultTx) => {
    const rawNo = tx.invoiceNumber ? String(tx.invoiceNumber).replace('#', '').trim() : '';
    if (!rawNo && !tx.invoiceId) {
      return { status: 'direct', label: 'سند مباشر (حر)', isOrphaned: false };
    }
    const matched = (tx.invoiceId && invoicesMap.get(String(tx.invoiceId))) ||
                    (rawNo && invoicesMap.get(rawNo)) ||
                    (tx.invoiceNumber && invoicesMap.get(String(tx.invoiceNumber)));
    
    if (matched) {
      return { 
        status: 'linked', 
        label: `فاتورة #${matched.invoiceNumber || rawNo}`, 
        isOrphaned: false, 
        invoice: matched 
      };
    }

    return { 
      status: 'orphaned', 
      label: `فاتورة #${rawNo || tx.invoiceId} (محذوفة أو غير موجودة)`, 
      isOrphaned: true 
    };
  };

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    const now = new Date();

    return transactions.filter(tx => {
      // 1. Accounting validity (exclude soft-deleted or reversals)
      if (!isAccountingTransactionValid(tx)) return false;

      // 2. Fund filter
      if (selectedFundId !== 'all') {
        const txFundId = tx.fundId || '';
        const txFundName = tx.fundName || '';
        const targetFund = funds.find(f => f.id === selectedFundId);
        if (targetFund) {
          const matchId = txFundId === targetFund.id;
          const matchName = txFundName === targetFund.name;
          if (!matchId && !matchName) return false;
        }
      }

      // 3. Type filter
      if (selectedTxType !== 'all') {
        const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
        const isPayment = tx.type === 'payment' || tx.type === 'disbursement' || tx.type === 'expense';
        const isTransfer = (tx.transactionCategory || '').includes('تحويل') || (tx.notes || '').includes('تحويل');

        if (selectedTxType === 'receipt' && !isReceipt) return false;
        if (selectedTxType === 'payment' && !isPayment) return false;
        if (selectedTxType === 'transfer' && !isTransfer) return false;
      }

      // 4. Time range filter
      if (timeRange !== 'all') {
        const txDate = tx.timestamp ? parseDate(tx.timestamp) : null;
        if (!txDate || isNaN(txDate.getTime())) return false;

        if (timeRange === 'today') {
          if (txDate.getFullYear() !== now.getFullYear() ||
              txDate.getMonth() !== now.getMonth() ||
              txDate.getDate() !== now.getDate()) {
            return false;
          }
        } else if (timeRange === 'week') {
          const weekAgo = new Date();
          weekAgo.setDate(now.getDate() - 7);
          weekAgo.setHours(0, 0, 0, 0);
          if (txDate < weekAgo) return false;
        } else if (timeRange === 'month') {
          const monthAgo = new Date();
          monthAgo.setMonth(now.getMonth() - 1);
          monthAgo.setHours(0, 0, 0, 0);
          if (txDate < monthAgo) return false;
        } else if (timeRange === 'custom') {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (txDate < start || txDate > end) return false;
        }
      }

      // 5. Invoice linkage filter
      if (selectedInvoiceLinkage !== 'all') {
        const link = getInvoiceLinkageStatus(tx);
        if (selectedInvoiceLinkage === 'linked' && link.status !== 'linked') return false;
        if (selectedInvoiceLinkage === 'orphaned' && !link.isOrphaned) return false;
        if (selectedInvoiceLinkage === 'direct' && link.status !== 'direct') return false;
      }

      // 6. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const voucherStr = String(tx.voucherNumber || '');
        const cust = (tx.customerName || '').toLowerCase();
        const cat = (tx.transactionCategory || '').toLowerCase();
        const notes = (tx.notes || '').toLowerCase();
        const invNum = (tx.invoiceNumber || '').toLowerCase();
        const fund = (getFundName(tx.fundId, tx.fundName)).toLowerCase();

        const match = voucherStr.includes(q) ||
                      cust.includes(q) ||
                      cat.includes(q) ||
                      notes.includes(q) ||
                      invNum.includes(q) ||
                      fund.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [transactions, funds, selectedFundId, selectedTxType, timeRange, startDate, endDate, selectedInvoiceLinkage, searchQuery, invoicesMap]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedFundId, selectedTxType, selectedInvoiceLinkage, timeRange, startDate, endDate, searchQuery]);

  // Summary Metrics grouped by currency
  const currencySummaries = useMemo<Record<string, CurrencySummaryItem>>(() => {
    const summary: Record<string, CurrencySummaryItem> = {};

    // Static funds balances
    funds.forEach(f => {
      const curr = (f.currency || 'USD').toUpperCase().trim();
      if (!summary[curr]) {
        summary[curr] = { totalBalance: 0, inFlow: 0, outFlow: 0, count: 0 };
      }
      summary[curr].totalBalance += parseFundBalance(f.balance);
    });

    // Inflows and outflows from filtered transactions
    filteredTransactions.forEach(tx => {
      const curr = (tx.currency || 'USD').toUpperCase().trim();
      if (!summary[curr]) {
        summary[curr] = { totalBalance: 0, inFlow: 0, outFlow: 0, count: 0 };
      }
      const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
        ? Number(tx.receiptAmount)
        : Number(tx.amount || 0);
      const absAmt = Math.abs(isNaN(rawAmt) ? 0 : rawAmt);

      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      if (isReceipt) {
        summary[curr].inFlow += absAmt;
      } else {
        summary[curr].outFlow += absAmt;
      }
      summary[curr].count += 1;
    });

    return summary;
  }, [funds, filteredTransactions]);

  // Orphaned count across all transactions
  const orphanedTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (!isAccountingTransactionValid(tx)) return false;
      const link = getInvoiceLinkageStatus(tx);
      return link.isOrphaned;
    });
  }, [transactions, invoicesMap]);

  // Paginated transactions
  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedTransactions = filteredTransactions.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);

  // Running balances when a specific fund is selected (or map of running balances)
  const fundChronologicalBalances = useMemo(() => {
    if (selectedFundId === 'all') return new Map<string, number>();

    const targetFund = funds.find(f => f.id === selectedFundId);
    const targetName = targetFund ? targetFund.name : '';

    const fundTxs = transactions
      .filter(t => (t.fundId === selectedFundId || (!t.fundId && t.fundName === targetName)) && isAccountingTransactionValid(t))
      .sort((a, b) => {
        const tA = (a as any).createdAt || a.timestamp;
        const timeA = tA ? (typeof tA?.toDate === 'function' ? tA.toDate().getTime() : new Date(tA).getTime()) : 0;
        const tB = (b as any).createdAt || b.timestamp;
        const timeB = tB ? (typeof tB?.toDate === 'function' ? tB.toDate().getTime() : new Date(tB).getTime()) : 0;
        return timeA - timeB;
      });

    let running = 0;
    const balanceMap = new Map<string, number>();
    fundTxs.forEach(tx => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
        ? Number(tx.receiptAmount)
        : Number(tx.amount || 0);
      const debit = isReceipt ? Math.abs(rawAmt) : 0;
      const credit = !isReceipt ? Math.abs(rawAmt) : 0;
      running += debit - credit;
      balanceMap.set(tx.id, running);
    });

    return balanceMap;
  }, [transactions, selectedFundId, funds]);

  // Unified Details Formatter matching customer statement
  const formatTxDetailsString = (tx: VaultTx): string => {
    const parts: string[] = [];

    // 1. Customer name
    const cust = (tx.customerName || '').trim();
    if (cust && cust !== '-' && cust !== 'جهة عامة أخرى' && cust !== 'عام') {
      parts.push(cust);
    }

    // 2. Invoice number
    if (tx.invoiceNumber && String(tx.invoiceNumber).trim() !== '') {
      const cleanInv = String(tx.invoiceNumber).replace('#', '').trim();
      parts.push(`فاتورة رقم ${cleanInv}`);
    }

    // 3. Category & Notes
    const cat = (tx.transactionCategory || '').trim();
    const notes = (tx.notes || '').trim();
    if (notes && notes !== '-' && notes !== 'حركة نقدية.' && notes !== 'حركة نقدية') {
      if (cat && cat !== '-' && cat !== 'عام' && cat !== 'قبض' && cat !== 'صرف' && !notes.includes(cat)) {
        parts.push(`${cat} (${notes})`);
      } else {
        parts.push(notes);
      }
    } else if (cat && cat !== '-' && cat !== 'عام' && cat !== 'قبض' && cat !== 'صرف') {
      parts.push(cat);
    }

    if (parts.length === 0) {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      return isReceipt ? 'سند قبض / وارد نقدي' : 'سند صرف / منصرف نقدي';
    }

    return parts.join(' - ');
  };

  // Time Range Label helper
  const getTimeRangeLabel = () => {
    if (timeRange === 'all') return 'جميع الأوقات';
    if (timeRange === 'today') return 'اليوم';
    if (timeRange === 'week') return 'خلال 7 أيام';
    if (timeRange === 'month') return 'خلال 30 يوماً';
    if (timeRange === 'custom') return `من ${startDate} إلى ${endDate}`;
    return '';
  };

  // Export to CSV / Excel
  const handleExportCSV = () => {
    if (filteredTransactions.length === 0) return;

    const headers = [
      'م',
      'رقم السند',
      'التاريخ والوقت',
      'الصندوق',
      'البيان والتفاصيل',
      'مدين (وارد)',
      'دائن (منصرف)',
      selectedFundId !== 'all' ? 'الرصيد' : 'المبلغ والعملة',
      'العملة',
      'المستخدم'
    ];

    const clean = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.join(',')];

    filteredTransactions.forEach((tx, idx) => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
        ? Number(tx.receiptAmount)
        : Number(tx.amount || 0);
      const absAmt = Math.abs(rawAmt);
      const debitStr = isReceipt ? `+${absAmt}` : '0';
      const creditStr = !isReceipt ? `-${absAmt}` : '0';
      const balStr = selectedFundId !== 'all' ? String(fundChronologicalBalances.get(tx.id) ?? '') : `${isReceipt ? '+' : '-'}${absAmt}`;

      rows.push([
        idx + 1,
        clean(tx.voucherNumber),
        clean(formatTxDate(tx as any)),
        clean(getFundName(tx.fundId, tx.fundName)),
        clean(formatTxDetailsString(tx)),
        clean(debitStr),
        clean(creditStr),
        clean(balStr),
        clean(tx.currency || 'USD'),
        clean(tx.userName || tx.userNumber || '---')
      ].join(','));
    });

    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const fundNamePart = selectedFundId !== 'all' ? `_${getFundName(selectedFundId)}` : '';
    link.setAttribute('download', `كشف_حساب_الصناديق${fundNamePart}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // WhatsApp Export
  const handleExportWhatsApp = () => {
    let msg = `📊 *تقرير الحسابات والمالية والصناديق*\n`;
    msg += `🏢 ${shopConfig?.shopName || 'مركز الصيانة المعتمد'}\n`;
    msg += `📅 الفترة: ${getTimeRangeLabel()}\n`;
    if (selectedFundId !== 'all') {
      msg += `💼 الصندوق: ${getFundName(selectedFundId)}\n`;
    }
    msg += `---------------------------------\n`;
    
    // Currency balances
    msg += `💰 *أرصدة الصناديق الحالية:*\n`;
    (Object.entries(currencySummaries) as [string, CurrencySummaryItem][]).forEach(([curr, s]) => {
      msg += `• ${curr}: ${s.totalBalance.toLocaleString('en-US')} (وارد: +${s.inFlow.toLocaleString('en-US')} | صرف: -${s.outFlow.toLocaleString('en-US')})\n`;
    });
    msg += `---------------------------------\n`;
    msg += `📋 إجمالي العمليات المسجلة: ${filteredTransactions.length} عملية\n\n`;

    // Last 10 operations
    const sample = filteredTransactions.slice(0, 10);
    sample.forEach((tx, i) => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      const sign = isReceipt ? '🟢 مدين (وارد)' : '🔴 دائن (منصرف)';
      msg += `${i + 1}. [سند #${tx.voucherNumber}] ${sign} ${Math.abs(tx.amount || 0).toLocaleString('en-US')} ${tx.currency} - ${formatTxDetailsString(tx)}\n`;
    });
    if (filteredTransactions.length > 10) {
      msg += `... وغيرها (${filteredTransactions.length - 10} عملية أخرى)\n`;
    }

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  // Print Official Tabular Report (A4)
  const handlePrintFullReport = () => {
    const tableHeaders = [
      'رقم السند',
      'التاريخ والوقت',
      'الصندوق',
      'البيان والتفاصيل',
      'مدين (وارد)',
      'دائن (منصرف)',
      selectedFundId !== 'all' ? 'الرصيد' : 'المبلغ والعملة'
    ];
    
    const rows = filteredTransactions.map(tx => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
        ? Number(tx.receiptAmount)
        : Number(tx.amount || 0);
      const absAmt = Math.abs(rawAmt);
      const debitStr = isReceipt ? `${absAmt.toLocaleString('en-US')} ${getCurrencySymbol(tx.currency)}` : '-';
      const creditStr = !isReceipt ? `${absAmt.toLocaleString('en-US')} ${getCurrencySymbol(tx.currency)}` : '-';
      
      let balanceOrAmtStr = '';
      if (selectedFundId !== 'all') {
        const bal = fundChronologicalBalances.get(tx.id) ?? 0;
        balanceOrAmtStr = `${bal.toLocaleString('en-US')} ${getCurrencySymbol(tx.currency)}`;
      } else {
        balanceOrAmtStr = `${absAmt.toLocaleString('en-US')} ${getCurrencySymbol(tx.currency)}`;
      }

      return [
        String(tx.voucherNumber || '---'),
        formatTxDate(tx as any),
        getFundName(tx.fundId, tx.fundName),
        formatTxDetailsString(tx),
        debitStr,
        creditStr,
        balanceOrAmtStr
      ];
    });

    const fundNameHeader = selectedFundId !== 'all' ? ` | صندوق: ${getFundName(selectedFundId)}` : ' | جميع الصناديق';
    
    onPrintPreview({
      type: 'table',
      data: {
        table: {
          title: 'كشف حساب حركات الصناديق والقيود المالية',
          subtitle: `الفترة: ${getTimeRangeLabel()}${fundNameHeader} | إجمالي العمليات: ${filteredTransactions.length}`,
          headers: tableHeaders,
          rows: rows,
          footerNotes: `تم استخراج هذا الكشف المالي رسمياً ومطابقته بدقة وفق معايير الحسابات الدائنة والمدينة.`
        }
      }
    });
  };

  // Print Single Fund Statement
  const handlePrintFundStatement = (fund: FinFund) => {
    const fundTxs = transactions
      .filter(t => (t.fundId === fund.id || (!t.fundId && t.fundName === fund.name)) && isAccountingTransactionValid(t))
      .sort((a, b) => {
        const tA = (a as any).createdAt || a.timestamp;
        const timeA = tA ? (typeof tA?.toDate === 'function' ? tA.toDate().getTime() : new Date(tA).getTime()) : 0;
        const tB = (b as any).createdAt || b.timestamp;
        const timeB = tB ? (typeof tB?.toDate === 'function' ? tB.toDate().getTime() : new Date(tB).getTime()) : 0;
        return timeA - timeB;
      });

    const tableHeaders = ['رقم السند', 'التاريخ والوقت', 'البيان والتفاصيل', 'مدين (وارد)', 'دائن (منصرف)', 'الرصيد'];
    
    let running = 0;
    const rows = fundTxs.map(tx => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
      const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
        ? Number(tx.receiptAmount)
        : Number(tx.amount || 0);
      const absAmt = Math.abs(rawAmt);
      const debit = isReceipt ? absAmt : 0;
      const credit = !isReceipt ? absAmt : 0;
      running += debit - credit;

      return [
        String(tx.voucherNumber || '---'),
        formatTxDate(tx as any),
        formatTxDetailsString(tx),
        debit > 0 ? `${debit.toLocaleString('en-US')} ${getCurrencySymbol(fund.currency)}` : '-',
        credit > 0 ? `${credit.toLocaleString('en-US')} ${getCurrencySymbol(fund.currency)}` : '-',
        `${running.toLocaleString('en-US')} ${getCurrencySymbol(fund.currency)}`
      ];
    });

    onPrintPreview({
      type: 'table',
      data: {
        table: {
          title: `كشف حساب حركات صندوق: ${fund.name}`,
          subtitle: `العملة: ${fund.currency} | النوع: ${fund.type === 'cash' ? 'نقدي' : 'بنكي'} | الرصيد الحالي: ${parseFundBalance(fund.balance).toLocaleString('en-US')} ${fund.currency}`,
          headers: tableHeaders,
          rows: rows,
          footerNotes: `الرصيد الفعلي المسجل بالصندوق: ${parseFundBalance(fund.balance).toLocaleString('en-US')} ${fund.currency} | إجمالي عدد الحركات المقيدة: ${fundTxs.length}`
        }
      }
    });
  };

  return (
    <div className="space-y-6 font-cairo animate-fade-in" dir="rtl">
      
      {/* 1. Header with Export & Refresh Actions */}
      <div className="bg-[#141414] border border-white/5 p-5 md:p-6 rounded-[2rem] shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/15 text-amber-500 rounded-2xl shadow-[0_0_20px_rgba(245,158,11,0.2)]">
            <Coins size={28} />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
              تقارير الحسابات والمالية والصناديق
            </h2>
            <p className="text-xs text-gray-400 mt-1 font-medium">
              متابعة أرصدة الصناديق، كشوفات السندات، الحركات والقيود المحاسبية، وتدقيق الفواتير المرتبطة.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
          {/* Refresh Button */}
          <button
            type="button"
            onClick={loadData}
            disabled={isRefreshing}
            className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl border border-white/5 transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="تحديث البيانات فوراً"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-amber-500' : ''} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          {/* Export WhatsApp Button */}
          <button
            type="button"
            onClick={handleExportWhatsApp}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95 cursor-pointer"
            title="مشاركة ملخص عبر الواتساب"
          >
            <WhatsAppIcon className="w-4 h-4" />
            <span>مشاركة واتساب</span>
          </button>

          {/* Export Excel CSV Button */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3.5 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-green-600/20 active:scale-95 cursor-pointer"
            title="تصدير كشف الحسابات إلى ملف Excel"
          >
            <FileSpreadsheet size={16} />
            <span>تصدير Excel</span>
          </button>

          {/* Print A4 Report Button */}
          {canPrint && (
            <button
              type="button"
              onClick={handlePrintFullReport}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95 cursor-pointer"
              title="معاينة وطباعة تقرير الحسابات A4"
            >
              <Printer size={16} />
              <span>طباعة كشف شامل</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Top Currency Balances & Inflow/Outflow Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(Object.entries(currencySummaries) as [string, CurrencySummaryItem][]).map(([curr, s]) => {
          const net = s.inFlow - s.outFlow;
          return (
            <div key={curr} className="bg-[#141414] border border-white/5 p-4 rounded-2xl flex flex-col justify-between gap-3 shadow-md hover:border-amber-500/25 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-400">إجمالي رصيد {curr}</span>
                <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-500 font-mono text-xs font-bold">
                  {getCurrencySymbol(curr)}
                </span>
              </div>

              <div>
                <p className="font-mono text-2xl font-black text-white">
                  {s.totalBalance.toLocaleString('en-US')} <span className="text-xs font-normal text-gray-400 font-cairo">{curr}</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[11px] font-mono">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-500 font-cairo">وارد الفترة (+)</span>
                  <span className="text-emerald-400 font-bold">+{s.inFlow.toLocaleString('en-US')}</span>
                </div>
                <div className="flex flex-col text-left border-r border-white/5 pr-2">
                  <span className="text-[9px] text-gray-500 font-cairo">منصرف الفترة (-)</span>
                  <span className="text-rose-400 font-bold">-{s.outFlow.toLocaleString('en-US')}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Orphaned / Unmatched Vouchers Card (Direct audit for deleted invoice cases) */}
        <div 
          onClick={() => setSelectedInvoiceLinkage(selectedInvoiceLinkage === 'orphaned' ? 'all' : 'orphaned')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-md ${
            selectedInvoiceLinkage === 'orphaned' 
              ? 'bg-amber-500/20 border-amber-500 text-white' 
              : orphanedTransactions.length > 0 
              ? 'bg-rose-500/10 border-rose-500/30 text-white hover:bg-rose-500/15' 
              : 'bg-[#141414] border-white/5 text-gray-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold font-cairo">سندات بحاجة تدقيق (بدون فاتورة)</span>
            <AlertTriangle size={18} className={orphanedTransactions.length > 0 ? 'text-rose-400 animate-pulse' : 'text-gray-500'} />
          </div>

          <div>
            <p className="font-mono text-2xl font-black text-white">
              {orphanedTransactions.length} <span className="text-xs font-normal text-gray-400 font-cairo">سند مالي</span>
            </p>
          </div>

          <div className="text-[10px] text-gray-400 pt-2 border-t border-white/5 flex items-center justify-between">
            <span>{selectedInvoiceLinkage === 'orphaned' ? 'فلتر مفعل حالياً' : 'اضغط لعرض السندات المحذوف فواتيرها'}</span>
            <ChevronLeft size={14} />
          </div>
        </div>
      </div>

      {/* 3. Individual Funds Grid / Collapsible Rows (أرصدة كل صندوق مع زر فتح/طي سطر واحد) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Wallet size={16} className="text-blue-400" />
            <span>صناديق النظام المالي وكشوفات حساباتها ({funds.length}):</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={collapseAllFunds}
              className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition-all border border-white/5 flex items-center gap-1 cursor-pointer"
              title="طي كل الصناديق لتظهر سطراً واحداً"
            >
              <ChevronUp size={13} className="text-blue-400" />
              <span>طي الكل (سطر واحد)</span>
            </button>
            <button
              type="button"
              onClick={expandAllFunds}
              className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition-all border border-white/5 flex items-center gap-1 cursor-pointer"
              title="توسيع كافة بطاقات الصناديق"
            >
              <ChevronDown size={13} className="text-amber-400" />
              <span>توسيع الكل</span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {funds.map((fund, fIdx) => {
            const isSelected = selectedFundId === fund.id;
            const isExpanded = !!expandedFundIds[fund.id];
            const fundTxs = transactions.filter(t => (t.fundId === fund.id || (!t.fundId && t.fundName === fund.name)) && isAccountingTransactionValid(t));
            const inSum = fundTxs.filter(t => t.type === 'receipt' || t.type === 'deposit' || t.type === 'invoice_payment').reduce((acc, curr) => acc + Math.abs(curr.amount || 0), 0);
            const outSum = fundTxs.filter(t => t.type === 'payment' || t.type === 'disbursement' || t.type === 'expense').reduce((acc, curr) => acc + Math.abs(curr.amount || 0), 0);

            if (!isExpanded) {
              // Collapsed Mode: Clean Single Line
              // Example: الدولار الرئيسي   نقدي   82$    زر فتح
              return (
                <div 
                  key={fund.id ? `fund-col-${fund.id}-${fIdx}` : `fund-col-idx-${fIdx}`}
                  className={`px-4 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isSelected 
                      ? 'bg-blue-600/10 border-blue-500/50 ring-1 ring-blue-500/30 shadow-md' 
                      : 'bg-[#141414] border-white/5 hover:border-white/15'
                  }`}
                >
                  {/* Fund Info in one line: Name, Type, Balance */}
                  <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto no-scrollbar py-0.5">
                    <div className="flex items-center gap-2 shrink-0">
                      {fund.type === 'cash' ? <Wallet size={15} className="text-amber-400 shrink-0" /> : <Building size={15} className="text-blue-400 shrink-0" />}
                      <span className="text-sm font-bold text-white truncate max-w-[180px] sm:max-w-none">{fund.name}</span>
                    </div>

                    <span className={`text-[10px] px-2 py-0.5 rounded font-black shrink-0 ${fund.type === 'cash' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>
                      {fund.type === 'cash' ? 'نقدي' : 'بنكي'}
                    </span>

                    <span className="font-mono text-sm font-black text-emerald-400 shrink-0">
                      {parseFundBalance(fund.balance).toLocaleString('en-US')} <span className="text-[10px] text-gray-400">{fund.currency}</span>
                    </span>

                    {isSelected && (
                      <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-md font-bold shrink-0">
                        محدد بالجدول
                      </span>
                    )}
                  </div>

                  {/* Actions & Collapse Toggle */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedFundId(isSelected ? 'all' : fund.id)}
                      className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isSelected 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                      title={isSelected ? 'إلغاء التحديد وعرض كل الصناديق' : 'تصفية الجدول بحسب هذا الصندوق'}
                    >
                      {isSelected ? 'إلغاء التحديد' : 'تصفية'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePrintFundStatement(fund)}
                      className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl transition-all cursor-pointer"
                      title="طباعة كشف حركات هذا الصندوق"
                    >
                      <Printer size={15} />
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleFundCollapse(fund.id)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold transition-all border border-white/10 cursor-pointer"
                      title="فتح التفاصيل الكاملة لهذا الصندوق"
                    >
                      <ChevronDown size={14} className="text-amber-400" />
                      <span>فتح</span>
                    </button>
                  </div>
                </div>
              );
            }

            // Expanded Mode: Full Detailed Card
            return (
              <div 
                key={fund.id ? `fund-exp-${fund.id}-${fIdx}` : `fund-exp-idx-${fIdx}`}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 bg-[#161616] ${
                  isSelected ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-xl' : 'border-white/10 shadow-md'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white flex items-center gap-1.5 truncate">
                        {fund.type === 'cash' ? <Wallet size={16} className="text-amber-400 shrink-0" /> : <Building size={16} className="text-blue-400 shrink-0" />}
                        <span className="truncate">{fund.name}</span>
                      </h4>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${fund.type === 'cash' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>
                        {fund.type === 'cash' ? 'نقدي' : 'بنكي'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleFundCollapse(fund.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 text-xs font-bold transition-all cursor-pointer"
                      title="طي هذا التبويب ليعود سطر واحد"
                    >
                      <ChevronUp size={14} />
                      <span>طي (سطر واحد)</span>
                    </button>
                  </div>

                  <p className="text-[10px] text-gray-500 mt-1 truncate">{fund.description || 'صندوق مالي معتمد'}</p>
                </div>

                <div className="bg-black/30 p-2.5 rounded-xl border border-white/5 flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">الرصيد المتوفر:</span>
                  <span className="font-mono text-sm font-black text-emerald-400">
                    {parseFundBalance(fund.balance).toLocaleString('en-US')} <span className="text-[10px] text-gray-400">{fund.currency}</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1 text-[10px] font-mono text-gray-400 border-t border-white/5 pt-2">
                  <div>وارد: <strong className="text-emerald-400 font-bold">+{inSum.toLocaleString('en-US')}</strong></div>
                  <div className="text-left">صرف: <strong className="text-rose-400 font-bold">-{outSum.toLocaleString('en-US')}</strong></div>
                </div>

                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setSelectedFundId(isSelected ? 'all' : fund.id)}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                      isSelected 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-white/5 hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    {isSelected ? <Check size={12} /> : null}
                    <span>{isSelected ? 'تم التحديد' : 'تصفية الحركات'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePrintFundStatement(fund)}
                    className="p-1.5 px-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl transition-all cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="طباعة كشف حركات هذا الصندوق"
                  >
                    <Printer size={15} />
                    <span>طباعة كشف</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Filter Toolbar & Search */}
      <div className="bg-[#141414] border border-white/5 p-4 rounded-2xl space-y-3">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-3">
          
          {/* Search */}
          <div className="relative w-full lg:w-80">
            <Search className="absolute right-3 top-2.5 text-gray-500" size={16} />
            <input 
              type="text"
              placeholder="بحث برقم السند، الفاتورة، العميل، البيان..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl pr-9 pl-3 py-2 text-xs font-cairo text-white outline-none focus:border-amber-500/50"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-2.5 text-gray-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5 overflow-x-auto w-full lg:w-auto">
            {(['all', 'today', 'week', 'month', 'custom'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex-1 lg:flex-none cursor-pointer ${
                  timeRange === range ? 'bg-amber-500 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {range === 'all' && 'جميع الأوقات'}
                {range === 'today' && 'اليوم'}
                {range === 'week' && 'أسبوع'}
                {range === 'month' && 'شهر'}
                {range === 'custom' && 'مخصص'}
              </button>
            ))}
          </div>

          {/* Filter by Type & Linkage */}
          <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap">
            {/* Fund Selector */}
            <select
              value={selectedFundId}
              onChange={(e) => setSelectedFundId(e.target.value)}
              className="bg-black/40 border border-white/10 text-white text-xs px-3 py-2 rounded-xl outline-none focus:border-amber-500 font-bold"
            >
              <option value="all">جميع الصناديق</option>
              {funds.map((f, fIdx) => (
                <option key={f.id ? `opt-fund-${f.id}-${fIdx}` : `opt-fund-idx-${fIdx}`} value={f.id}>{f.name} ({f.currency})</option>
              ))}
            </select>

            {/* Type Selector */}
            <select
              value={selectedTxType}
              onChange={(e) => setSelectedTxType(e.target.value)}
              className="bg-black/40 border border-white/10 text-white text-xs px-3 py-2 rounded-xl outline-none focus:border-amber-500 font-bold"
            >
              <option value="all">جميع العمليات</option>
              <option value="receipt">سندات قبض (وارد)</option>
              <option value="payment">سندات صرف (منصرف)</option>
              <option value="transfer">تحويلات مالية</option>
            </select>

            {/* Linkage Selector */}
            <select
              value={selectedInvoiceLinkage}
              onChange={(e) => setSelectedInvoiceLinkage(e.target.value as any)}
              className="bg-black/40 border border-white/10 text-white text-xs px-3 py-2 rounded-xl outline-none focus:border-amber-500 font-bold"
            >
              <option value="all">كل حالات الربط</option>
              <option value="linked">مرتبطة بفواتير نشطة</option>
              <option value="orphaned">⚠️ بدون فاتورة أو محذوفة</option>
              <option value="direct">سندات مباشرة (حرة)</option>
            </select>
          </div>
        </div>

        {/* Custom date range picker */}
        {timeRange === 'custom' && (
          <div className="flex items-center gap-4 pt-3 border-t border-white/5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 font-bold">من تاريخ:</span>
              <input 
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-black/60 border border-white/10 text-white text-xs px-3 py-1.5 rounded-lg outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 font-bold">إلى تاريخ:</span>
              <input 
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-black/60 border border-white/10 text-white text-xs px-3 py-1.5 rounded-lg outline-none focus:border-amber-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* 5. Detailed Ledger Table */}
      <div className="bg-[#141414] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-amber-500" />
            <span className="text-sm font-black text-white">
              سجل القيود والسندات المالية ({filteredTransactions.length} حركة مسجلة)
            </span>
            {selectedFundId !== 'all' && (
              <span className="text-[11px] bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20 font-bold">
                كشف حساب: {getFundName(selectedFundId)}
              </span>
            )}
          </div>

          <div className="text-xs text-gray-500 font-bold">
            صفحة {safeCurrentPage} من {totalPages}
          </div>
        </div>

        <div className="overflow-x-auto w-full scrollbar-thin">
          <table className="w-full text-right text-xs min-w-[720px] table-auto">
            <thead>
              <tr className="bg-[#1a1a1a] text-gray-300 font-bold border-b border-white/5 font-cairo">
                <th className="py-3 px-2.5 text-center w-14 sm:w-16 shrink-0"># السند</th>
                <th className="py-3 px-2.5 text-center w-28 sm:w-32 shrink-0">التاريخ والوقت</th>
                {selectedFundId === 'all' && <th className="py-3 px-2.5 text-center w-24 sm:w-28 shrink-0">الصندوق</th>}
                <th className="py-3 px-3.5 min-w-[220px] w-full">البيان والتفاصيل</th>
                <th className="py-3 px-2.5 text-center text-emerald-400 w-20 sm:w-24 shrink-0">مدين (وارد)</th>
                <th className="py-3 px-2.5 text-center text-rose-400 w-20 sm:w-24 shrink-0">دائن (منصرف)</th>
                <th className="py-3 px-3 text-left w-24 sm:w-28 shrink-0">
                  {selectedFundId !== 'all' ? 'الرصيد' : 'المبلغ'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300 font-cairo text-[11px]">
              {paginatedTransactions.map((tx, txIdx) => {
                const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment';
                const link = getInvoiceLinkageStatus(tx);
                const rawAmt = tx.receiptAmount !== undefined && tx.receiptAmount !== null && tx.receiptAmount !== ''
                  ? Number(tx.receiptAmount)
                  : Number(tx.amount || 0);
                const absAmt = Math.abs(rawAmt);
                const runningBal = fundChronologicalBalances.get(tx.id);
                const currSymbol = getCurrencySymbol(tx.currency);

                return (
                  <tr key={tx.id ? `fin-tx-${tx.id}-${txIdx}` : `fin-tx-idx-${txIdx}`} className="hover:bg-white/5 transition-colors">
                    <td className="py-2.5 px-2.5 text-center font-bold text-amber-500 font-mono whitespace-nowrap">
                      #{tx.voucherNumber}
                    </td>
                    <td className="py-2.5 px-2.5 text-gray-400 font-sans text-[10px] text-center whitespace-nowrap">
                      {formatTxDate(tx as any)}
                    </td>
                    {selectedFundId === 'all' && (
                      <td className="py-2.5 px-2.5 text-gray-300 text-center whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px]">
                          {getFundName(tx.fundId, tx.fundName)}
                        </span>
                      </td>
                    )}
                    <td className="py-2.5 px-3.5 whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {tx.customerName && tx.customerName !== 'جهة عامة أخرى' && (
                            <span className="font-bold text-white text-xs">{tx.customerName}</span>
                          )}
                          {link.status === 'linked' && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-mono text-[10px] border border-blue-500/20 inline-flex items-center gap-1">
                              <CheckCircle2 size={10} className="shrink-0" />
                              <span>فاتورة #{link.invoice?.invoiceNumber || String(tx.invoiceNumber).replace('#', '')}</span>
                            </span>
                          )}
                          {link.status === 'orphaned' && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 font-cairo text-[10px] border border-rose-500/20 inline-flex items-center gap-1" title="فاتورة محذوفة">
                              <AlertTriangle size={10} className="shrink-0" />
                              <span>فاتورة #{String(tx.invoiceNumber).replace('#', '')} (محذوفة)</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-300">
                          {tx.transactionCategory && tx.transactionCategory !== 'عام' && tx.transactionCategory !== 'قبض' && tx.transactionCategory !== 'صرف' && (
                            <span className="font-semibold text-amber-400/90 ml-1">{tx.transactionCategory}:</span>
                          )}
                          <span>{tx.notes || 'حركة نقدية مقيدة'}</span>
                          {tx.userName && (
                            <span className="text-gray-500 text-[10px] mr-1.5">({tx.userName})</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-center font-mono whitespace-nowrap">
                      {isReceipt ? (
                        <span className="font-bold text-emerald-400">
                          {absAmt.toLocaleString('en-US')}
                        </span>
                      ) : (
                        <span className="text-gray-600 font-normal">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-center font-mono whitespace-nowrap">
                      {!isReceipt ? (
                        <span className="font-bold text-rose-400">
                          {absAmt.toLocaleString('en-US')}
                        </span>
                      ) : (
                        <span className="text-gray-600 font-normal">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono whitespace-nowrap">
                      {selectedFundId !== 'all' ? (
                        <span className="font-black text-blue-400 text-sm">
                          {(runningBal ?? 0).toLocaleString('en-US')}{' '}
                          <span className="text-[11px] text-blue-300/80 font-cairo mr-1 font-semibold">{currSymbol}</span>
                        </span>
                      ) : (
                        <span className={`font-bold ${isReceipt ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isReceipt ? '+' : '-'}{absAmt.toLocaleString('en-US')}{' '}
                          <span className="text-[11px] text-gray-400 font-cairo mr-1 font-semibold">{currSymbol}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {paginatedTransactions.length === 0 && (
                <tr>
                  <td colSpan={selectedFundId === 'all' ? 7 : 6} className="py-12 text-center text-gray-500 font-cairo font-bold">
                    لا توجد سندات أو قيود تطابق الفلاتر المحددة حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-white/5 flex items-center justify-between text-xs">
            <div className="text-gray-400">
              إجمالي النتائج: {filteredTransactions.length} قيد مالي
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
              <span className="font-mono text-gray-300 px-2 font-bold">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
