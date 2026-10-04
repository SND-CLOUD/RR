import { sharePdfFile, openWhatsApp, sendUniversalReminder } from '../lib/shareHelper';
import { generateOptimizedPdfFromElement, downloadPdfBlob } from '../lib/pdfHelper';
import { getItemBillableCost, isItemRefusedOrFailed, calculateInvoiceBillableTotal } from '../lib/billableService';
import { resolveLiveInvoiceNumber, resolveVoucherDynamicStatement } from '../lib/voucherDisplayService';
import PrintPreviewOverlay from './PrintPreviewOverlay';
import { tafqeet } from '../lib/tafqeet';
import { parseFundBalance, formatMoney, getCurrencySymbol } from '../lib/fundUtils';
import { isAccountingTransactionValid, roundCurrencyAmount, normalizeCurrencyCode, repairAllFundBalances } from '../lib/fundRepairService';
import { SyncEngine } from '../data/SyncEngine';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { localDb } from '../lib/local-db';
import { ProviderFactory } from '../data/ProviderFactory';
import { User, ShopConfig, isPurchaseInvoice } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { usePermissions } from '../hooks/usePermissions';
import BankAccountsFooter from './BankAccountsFooter';
import { parseDate, formatDateTime, parseTxDate, formatTxDate } from '../lib/dateUtils';
import { 
  CircleDollarSign,
  X,
  Calendar,
  User as UserIcon,
  Tag,
  CheckCircle2,
  ArrowRight,
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  Percent,
  TrendingUp as ProfitIcon,
  Search,
  Plus,
  Bookmark,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Filter,
  Layers,
  FileSpreadsheet,
  Users,
  Wallet,
  Coins,
  FileText,
  Printer,
  ArrowLeft,
  LogOut,
  Phone,
  Smartphone,
  MessageCircle,
  Facebook,
  MapPin,
  BarChart,
  PieChart,
  Activity,
  LineChart,
  Eye,
  Check,
  ArrowUpDown,
  Save,
  Loader2,
  Trash2,
  RefreshCw,
  CloudDownload,
  Download,
  Share2
} from 'lucide-react';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { sanitizeDocumentStyles, sanitizeElementInlineStyles, cleanOklchInStyleText } from '../lib/html2canvasHelper';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { doc, getDoc, db, setDoc, collection, addDoc, deleteDoc, updateDoc, serverTimestamp } from '../firebase';

interface VaultTransaction {
  linkedTxId?: string;
  id: string;
  currency: string;
  amount: number;
  customerName: string;
  invoiceNumber: string;
  userName: string;
  userNumber?: number;
  userId?: string;
  timestamp: string; // ISO string
  type: 'receipt' | 'payment';
  notes: string;
  updatedAt?: string;
  voucherNumber: number;
  transactionCategory: string;
  fundId: string;
  fundName: string;
  customerId?: string;
  isReversed?: number | boolean;
  isReversal?: number | boolean;
  reversalOf?: string;
  status?: string;
  paymentType?: number;
  liabilityCurrency?: string;
  liabilityAmount?: number;
  receiptCurrency?: string;
  receiptAmount?: number;
  bankDetails?: string;
}

interface FinFund {
  id: string;
  name: string;
  type: string;
  currency: string;
  description: string;
  status: string;
  balance: number;
}

interface FinCurrency {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  status: string;
}

interface FinTransactionType {
  id: string;
  name: string;
  type: 'receipt' | 'payment';
}

interface DB_Customer {
  id: string;
  name: string;
  companyName?: string;
  phone1?: string;
}

interface DB_Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  currency: string;
  totalCost: number;
  amountPaid: number;
  status: string;
  createdAt: string;
}

const WhatsAppIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12.012 2c-5.506 0-9.978 4.471-9.978 9.978 0 1.764.459 3.42 1.258 4.873L2 22l5.312-1.393c1.405.766 3 1.18 4.7 1.18 5.506 0 9.978-4.472 9.978-9.978C21.99 6.471 17.518 2 12.012 2zm6.331 14.161c-.244.686-1.22 1.258-1.687 1.341-.468.084-.935.152-2.903-.631-2.479-.982-4.053-3.522-4.175-3.69-.122-.167-.991-1.319-.991-2.518 0-1.199.631-1.787.854-2.028.223-.241.488-.302.65-.302.162 0 .325.003.467.01.147.007.345-.057.545.421.203.488.691 1.687.752 1.809.061.122.102.264.02.427-.081.162-.122.264-.244.407-.122.142-.256.319-.366.427-.122.122-.249.255-.107.498.142.244.631 1.036 1.354 1.678.932.827 1.714 1.082 1.957 1.204.244.122.386.102.528-.061.142-.162.61-2.008.772-2.313.162-.305.325-.244.548-.162.223.081 1.423.671 1.667.793.244.122.406.183.467.284.061.104.061.59-.183 1.277z" />
  </svg>
);

const DashboardButton = ({ onClick, icon, label, description, color, bg }: { onClick: () => void; icon: React.ReactNode; label: string; description: string; color: string; bg: string }) => (
  <button 
    onClick={onClick}
    className="group w-full flex items-center gap-6 p-5 bg-[#181818] border border-white/5 rounded-2xl hover:border-amber-500/50 hover:bg-[#1c1c1c] transition-all relative overflow-hidden active:scale-[0.98]"
  >
    <div className={`p-3 rounded-xl ${bg} ${color} group-hover:scale-110 transition-transform duration-500`}>
      {React.cloneElement(icon as React.ReactElement, { size: 28 })}
    </div>
    <div className="flex flex-col text-right">
      <span className="text-base font-black text-white font-cairo">{label}</span>
      <span className="text-xs text-gray-500 font-cairo">{description}</span>
    </div>
    <div className="mr-auto opacity-0 group-hover:opacity-100 transition-opacity">
      <ArrowLeft size={20} className={color} />
    </div>
  </button>
);

/**
 * Merges customer name, invoice number, and notes/category into a single descriptive string
 * e.g. "محمد علي عثمان - فاتورة رقم #102 - مشتريات قطع وملحقات"
 */
export function formatFundTxDetails(tx: VaultTransaction): string {
  const parts: string[] = [];

  // 1. Customer Name
  const cust = (tx.customerName || '').trim();
  if (cust && cust !== '-' && cust !== 'عام' && cust !== 'تحويل داخلي' && cust !== 'طرف غير محدد') {
    parts.push(cust);
  } else if (cust === 'تحويل داخلي' || tx.transactionCategory === 'تحويل بين الصناديق') {
    parts.push('تحويل داخلي');
  }

  // 2. Invoice Number
  const inv = tx.invoiceNumber ? String(tx.invoiceNumber).trim() : '';
  if (inv && inv !== '-' && inv !== '0') {
    parts.push(`فاتورة رقم #${inv}`);
  }

  // 3. Notes or Category
  const notes = (tx.notes || '').trim();
  const cat = (tx.transactionCategory || '').trim();
  if (notes && notes !== '-' && notes !== 'حركة نقدية.') {
    parts.push(notes);
  } else if (cat && cat !== '-' && cat !== 'قبض' && cat !== 'صرف') {
    parts.push(cat);
  }

  if (parts.length === 0) {
    const rawType = String(tx.type || '');
    const isRec = rawType === 'receipt' || rawType === 'deposit' || rawType === 'invoice_payment' || rawType === 'inflow';
    return isRec ? 'سند قبض / إيداع نقدي' : 'سند صرف / سحب نقدي';
  }

  return parts.join(' - ');
}

export interface ProcessedFundStatementEntry {
  id: string;
  voucherNumber: string;
  dateStr: string;
  timestamp: number;
  details: string; // Merged: Customer Name + Invoice Number + Notes/Category
  debit: number;   // مدين (وارد / إيداع)
  credit: number;  // دائن (منصرف / سحب)
  runningBalance: number; // الرصيد بعد الحركة
  currency: string;
  rawTx: any;
}

export function computeFundChronologicalStatement(
  fund: FinFund,
  allFundTxs: any[]
): ProcessedFundStatementEntry[] {
  // 1. Sort all transactions chronologically (oldest first)
  const sorted = [...allFundTxs].sort((a, b) => {
    const tA = a.createdAt || a.timestamp;
    const timeA = tA ? (typeof tA?.toDate === 'function' ? tA.toDate().getTime() : new Date(tA).getTime()) : 0;
    const tB = b.createdAt || b.timestamp;
    const timeB = tB ? (typeof tB?.toDate === 'function' ? tB.toDate().getTime() : new Date(tB).getTime()) : 0;
    return timeA - timeB;
  });

  // 2. Accumulate running balance
  let running = 0;
  return sorted.map(tx => {
    const rawType = String(tx.type || '');
    const isReceipt = rawType === 'receipt' || rawType === 'deposit' || rawType === 'invoice_payment' || rawType === 'inflow';
    const amount = Math.abs(Number(tx.amount || 0));
    const debit = isReceipt ? amount : 0;
    const credit = !isReceipt ? amount : 0;

    running += debit - credit;

    const t = tx.createdAt || tx.timestamp;
    const time = t ? (typeof t?.toDate === 'function' ? t.toDate().getTime() : new Date(t).getTime()) : 0;

    return {
      id: String(tx.id || ''),
      voucherNumber: String(tx.voucherNumber || ''),
      dateStr: formatTxDate(tx),
      timestamp: time,
      details: formatFundTxDetails(tx),
      debit,
      credit,
      runningBalance: running,
      currency: String(tx.currency || fund.currency || ''),
      rawTx: tx
    };
  });
}

export default function Vault({ 
  user, 
  shopConfig, 
  onBack,
  initialSegment,
  initialCustomerName,
  initialCustomerId,
  initialLiabilityCurrency,
  initialShowAddModal,
  initialInvoiceNumber,
  initialInvoiceId,
  onClearInitialProps
}: { 
  user: User; 
  shopConfig: ShopConfig | null; 
  onBack: () => void;
  initialSegment?: 'dashboard' | 'receipt' | 'payment' | 'discounts' | 'transfer' | 'funds' | 'customer-ledger' | 'reports';
  initialCustomerName?: string;
  initialCustomerId?: string;
  initialLiabilityCurrency?: string;
  initialShowAddModal?: boolean;
  initialInvoiceNumber?: string;
  initialInvoiceId?: string;
  onClearInitialProps?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { hasPermission, canAdd, canEdit, canDelete, canPrint } = usePermissions(user, 'vault');

  if (!hasPermission('view')) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500">
          <CircleDollarSign size={32} />
        </div>
        <h2 className="text-xl font-bold text-white">عذراً، ليس لديك صلاحية الوصول</h2>
        <p className="text-gray-400 max-w-md">يرجى التواصل مع المسؤول للحصول على الصلاحيات اللازمة لعرض الحسابات.</p>
        <button 
          onClick={onBack} 
          className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 flex items-center justify-center"
          title="خروج للرئيسية"
        >
          <LogOut size={20} className="rotate-180" />
        </button>
      </div>
    );
  }
  // Navigation
  const [activeSegment, setActiveSegment] = useState<'dashboard' | 'receipt' | 'payment' | 'discounts' | 'transfer' | 'funds' | 'customer-ledger' | 'reports'>(initialSegment || 'dashboard');
  const [reportSubSegment, setReportSubSegment] = useState<'revenues' | 'expenses' | 'profits' | 'fund-balances' | 'outstanding-debts'>('revenues');
  const [showAddModal, setShowAddModal] = useState(initialShowAddModal || false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [previewData, setPreviewData] = useState<{ type: 'invoice' | 'voucher' | 'statement' | 'table'; data: any } | null>(null);
  const [reversalTxToConfirm, setReversalTxToConfirm] = useState<VaultTransaction | null>(null);
  const [txToDelete, setTxToDelete] = useState<VaultTransaction | any | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState<boolean>(false);

  const [globalSearch, setGlobalSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [voucherSortConfig, setVoucherSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'voucherNumber', direction: 'desc' });
  const [showVoucherSort, setShowVoucherSort] = useState(false);
  const [showFundTxSort, setShowFundTxSort] = useState(false);

  // DISCOUNTS STATES
  const [discountSearchTerm, setDiscountSearchTerm] = useState<string>('');
  const [discountSortConfig, setDiscountSortConfig] = useState<{ key: 'date' | 'amount' | 'invoiceNumber' | 'customer', direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' });
  const [showDiscountSort, setShowDiscountSort] = useState(false);
  const [discountStatusFilter, setDiscountStatusFilter] = useState<'all' | 'delivered' | 'pending'>('all');
  const [discountToDelete, setDiscountToDelete] = useState<any | null>(null);
  const [isDeletingDiscount, setIsDeletingDiscount] = useState<boolean>(false);
  const [deleteLinkedReceipts, setDeleteLinkedReceipts] = useState<boolean>(true);

  // CUSTOMER LEDGER TAB STATES
  const [ledgerCustomerId, setLedgerCustomerId] = useState<string>('');
  const [ledgerCurrency, setLedgerCurrency] = useState<string>('USD');
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState<string>('');

  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState<boolean>(false);
  const [ledgerModalTab, setLedgerModalTab] = useState<'invoices' | 'transactions'>('invoices');
  const [ledgerListPage, setLedgerListPage] = useState<number>(1);

  // FUND REPORT MODAL & STATEMENT STATES
  const [selectedFundForReport, setSelectedFundForReport] = useState<FinFund | null>(null);
  const [fundReportDateFrom, setFundReportDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [fundReportDateTo, setFundReportDateTo] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [fundReportSearch, setFundReportSearch] = useState<string>('');
  const [fundReportType, setFundReportType] = useState<'all' | 'receipt' | 'payment'>('all');

  // Movement table filters
  const [fundMovementSelectedFund, setFundMovementSelectedFund] = useState<string>('all');
  const [fundMovementSelectedType, setFundMovementSelectedType] = useState<string>('all');
  const [fundMovementShowReversed, setFundMovementShowReversed] = useState<'active' | 'all' | 'reversed'>('active');

  // Database lists
  const [funds, setFunds] = useState<FinFund[]>([]);
  const [currencies, setCurrencies] = useState<FinCurrency[]>([]);
  const [txTypes, setTxTypes] = useState<FinTransactionType[]>([]);
  const [customers, setCustomers] = useState<DB_Customer[]>([]);
  const [invoices, setInvoices] = useState<DB_Invoice[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<VaultTransaction[]>([]);

  const sortedTransactions = useMemo(() => {
    let sorted = [...transactions];
    sorted.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (voucherSortConfig.key) {
        case 'voucherNumber':
          valA = Number(a.voucherNumber || 0);
          valB = Number(b.voucherNumber || 0);
          break;
        case 'alpha':
          valA = a.customerName || '';
          valB = b.customerName || '';
          break;
        case 'category':
          valA = a.transactionCategory || '';
          valB = b.transactionCategory || '';
          break;
        case 'amount':
          valA = Math.abs(Number(a.amount || 0));
          valB = Math.abs(Number(b.amount || 0));
          break;
        case 'date':
        default:
          valA = (a.timestamp || a.updatedAt) ? new Date(a.timestamp || a.updatedAt || 0).getTime() : 0;
          valB = (b.timestamp || b.updatedAt) ? new Date(b.timestamp || b.updatedAt || 0).getTime() : 0;
          break;
      }

      if (valA < valB) return voucherSortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return voucherSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [transactions, voucherSortConfig]);

  useBackHandler(reversalTxToConfirm !== null, () => setReversalTxToConfirm(null));
  useBackHandler(txToDelete !== null, () => setTxToDelete(null));
  useBackHandler(discountToDelete !== null, () => setDiscountToDelete(null));
  useBackHandler(showPrintPreview, () => setShowPrintPreview(false));
  useBackHandler(showAddModal, () => {
    setShowAddModal(false);
    resetForm();
    onClearInitialProps?.();
  });
  useBackHandler(isLedgerModalOpen, () => setIsLedgerModalOpen(false));
  useBackHandler(selectedFundForReport !== null, () => setSelectedFundForReport(null));
  useBackHandler(activeSegment !== 'dashboard' && !showAddModal && !showPrintPreview && !reversalTxToConfirm && !isLedgerModalOpen && !selectedFundForReport && !discountToDelete, () => {
    setActiveSegment('dashboard');
    resetForm();
    onClearInitialProps?.();
  });

  // LEDGER CUSTOMER MATH & HELPERS
  const getInvoiceItemsForInvoice = (invoiceNumber: string) => {
    return items.filter(it => it.invoiceNumber === invoiceNumber);
  };

  const getInvoiceActualCost = (invoiceItems: any[], invoice?: any) => {
    if (invoice) {
      const isPurchase = isPurchaseInvoice(invoice);
      const explicitType = String(invoice.invoiceType || invoice.templateType || invoice.type || '').toLowerCase();
      if (isPurchase || explicitType.startsWith('sale_') || String(invoice.invoiceNumber || '').startsWith('O-')) {
        return Number(invoice.totalCost || invoice.batchTotalCost || invoice.amountPaid || 0);
      }
    }

    const billableSum = invoiceItems.reduce((sum, item) => {
      if (['10', '20', '25', '30', '35', '40', 'new', 'in_progress', 'awaiting_parts', 'awaiting_approval', 'repairing'].includes(item.status)) {
        return sum;
      }
      if (isItemRefusedOrFailed(item)) {
        return sum;
      }
      return sum + getItemBillableCost(item);
    }, 0);
    const discount = invoice ? Number(invoice.discount !== undefined ? invoice.discount : (invoice.discountAmount || 0)) : 0;
    const tax = invoice ? Number(invoice.tax !== undefined ? invoice.tax : (invoice.taxAmount || 0)) : 0;
    return Math.max(0, billableSum - discount + tax);
  };

  const ledgerCustomerInvoices = invoices.filter(inv => inv.customerId === ledgerCustomerId && (inv.currency || 'USD') === ledgerCurrency);
  const ledgerCustomerTransactions = transactions.filter(tx => tx.customerId === ledgerCustomerId && (tx.currency || 'USD') === ledgerCurrency);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeSegment, globalSearch, ledgerSearchTerm]);
  
  const filteredVaultTransactions = useMemo(() => {
    return sortedTransactions.filter(tx => {
      // Exclude permanently deleted items
      if (tx.isDeleted === 1 || tx.isDeleted === true || tx.isDeleted === '1') return false;
      if (tx.deleted === true || tx.deleted === 1 || tx.deleted === '1') return false;

      // Determine reversal state
      const isRev = tx.isReversed === 1 || tx.isReversed === true || tx.isReversed === '1' ||
                    tx.isReversal === 1 || tx.isReversal === true || tx.isReversal === '1' ||
                    (tx.status || '').toLowerCase().trim() === 'reversed' ||
                    (tx.status || '').toLowerCase().trim() === 'reversal';

      if (fundMovementShowReversed === 'active' && isRev) return false;
      if (fundMovementShowReversed === 'reversed' && !isRev) return false;

      // Global search string matching
      const searchStr = (globalSearch || '').toLowerCase().trim();
      if (searchStr) {
        const matchSearch =
          (tx.customerName || '').toLowerCase().includes(searchStr) || 
          (tx.fundName || '').toLowerCase().includes(searchStr) ||
          String(tx.voucherNumber || '').toLowerCase().includes(searchStr) ||
          String(tx.invoiceNumber || '').toLowerCase().includes(searchStr) ||
          (tx.notes || '').toLowerCase().includes(searchStr) ||
          (tx.transactionCategory || '').toLowerCase().includes(searchStr) ||
          String(tx.amount || '').includes(searchStr);
        if (!matchSearch) return false;
      }

      // Fund filter
      if (fundMovementSelectedFund !== 'all') {
        const tFundId = String(tx.fundId || '').trim();
        const tFundName = String(tx.fundName || '').trim();
        if (tFundId !== fundMovementSelectedFund && tFundName !== fundMovementSelectedFund) {
          return false;
        }
      }

      // Type filter (inclusive of all aliases so entries never disappear unexpectedly)
      if (fundMovementSelectedType !== 'all') {
        const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment' || (tx.type as string) === 'inflow';
        const isPayment = tx.type === 'payment' || tx.type === 'disbursement' || tx.type === 'expense' || (tx.type as string) === 'outflow';
        const isTransfer = tx.type === 'transfer' || tx.transactionCategory === 'تحويل بين الصناديق' || tx.customerName === 'تحويل داخلي';

        if (fundMovementSelectedType === 'receipt' && !isReceipt) return false;
        if (fundMovementSelectedType === 'payment' && !isPayment) return false;
        if (fundMovementSelectedType === 'transfer' && !isTransfer) return false;
        if (fundMovementSelectedType === 'reversed' && !isRev) return false;
      }

      return true;
    });
  }, [sortedTransactions, globalSearch, fundMovementSelectedFund, fundMovementSelectedType, fundMovementShowReversed]);

  const totalVaultPages = Math.max(1, Math.ceil(filteredVaultTransactions.length / itemsPerPage));
  const safeVaultCurrentPage = Math.min(currentPage, totalVaultPages);
  const currentVaultTransactions = filteredVaultTransactions.slice((safeVaultCurrentPage - 1) * itemsPerPage, safeVaultCurrentPage * itemsPerPage);

  // Quick print a fund's statement directly
  const handleQuickPrintFund = (fund: FinFund) => {
    const fundTxs = transactions.filter(tx => {
      if (!isAccountingTransactionValid(tx)) return false;
      const tFundId = String(tx.fundId || '').trim();
      const tFundName = String(tx.fundName || '').trim();
      return tFundId === fund.id || tFundName === fund.name;
    });

    const entries = computeFundChronologicalStatement(fund, fundTxs);
    const totalIn = entries.reduce((s, e) => s + e.debit, 0);
    const totalOut = entries.reduce((s, e) => s + e.credit, 0);
    const lastBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : parseFundBalance(fund.balance);

    const rows = entries.map(e => [
      e.voucherNumber ? `#${e.voucherNumber}` : '-',
      e.dateStr,
      e.details,
      e.debit > 0 ? e.debit.toLocaleString('en-US') : '-',
      e.credit > 0 ? e.credit.toLocaleString('en-US') : '-',
      `${e.runningBalance.toLocaleString('en-US')} ${getCurrencySymbol(fund.currency)}`
    ]);

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: `كشف حساب حركة صندوق: ${fund.name}`,
          subtitle: `النوع: ${fund.type === 'cash' ? 'نقدي' : 'حساب بنكي'} | العملة: ${fund.currency} | الرصيد الحالي: ${parseFundBalance(fund.balance).toLocaleString('en-US')} ${fund.currency}`,
          headers: ['رقم السند', 'التاريخ والوقت', 'البيان والتفاصيل', 'مدين (وارد)', 'دائن (منصرف)', 'الرصيد'],
          rows,
          footerNotes: `إجمالي المدين (الوارد): ${totalIn.toLocaleString('en-US')} ${fund.currency} | إجمالي الدائن (المنصرف): ${totalOut.toLocaleString('en-US')} ${fund.currency} | الرصيد الفعلي المتوفر: ${lastBalance.toLocaleString('en-US')} ${fund.currency}`
        }
      }
    });
  };

  // Print filtered fund statement from the modal
  const handlePrintFundStatement = (fund: FinFund, entries: ProcessedFundStatementEntry[]) => {
    const totalIn = entries.reduce((s, e) => s + e.debit, 0);
    const totalOut = entries.reduce((s, e) => s + e.credit, 0);
    const lastBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : parseFundBalance(fund.balance);

    const rows = entries.map(e => [
      e.voucherNumber ? `#${e.voucherNumber}` : '-',
      e.dateStr,
      e.details,
      e.debit > 0 ? e.debit.toLocaleString('en-US') : '-',
      e.credit > 0 ? e.credit.toLocaleString('en-US') : '-',
      `${e.runningBalance.toLocaleString('en-US')} ${getCurrencySymbol(fund.currency)}`
    ]);

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: `كشف حساب حركات الصندوق: ${fund.name}`,
          subtitle: `الفترة من: ${fundReportDateFrom || 'البداية'} إلى: ${fundReportDateTo || 'الآن'} | العملة: ${fund.currency} | الرصيد: ${parseFundBalance(fund.balance).toLocaleString('en-US')} ${fund.currency}`,
          headers: ['رقم السند', 'التاريخ والوقت', 'البيان والتفاصيل', 'مدين (وارد)', 'دائن (منصرف)', 'الرصيد'],
          rows,
          footerNotes: `إجمالي المدين (الوارد): ${totalIn.toLocaleString('en-US')} ${fund.currency} | إجمالي الدائن (المنصرف): ${totalOut.toLocaleString('en-US')} ${fund.currency} | الرصيد الختامي للفترة: ${lastBalance.toLocaleString('en-US')} ${fund.currency}`
        }
      }
    });
  };

  // Export fund statement as CSV
  const handleExportFundCSV = (fund: FinFund, entries: ProcessedFundStatementEntry[]) => {
    const totalIn = entries.reduce((s, e) => s + e.debit, 0);
    const totalOut = entries.reduce((s, e) => s + e.credit, 0);
    const lastBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : parseFundBalance(fund.balance);

    const headers = ['رقم السند', 'التاريخ والوقت', 'البيان والتفاصيل', 'مدين (وارد)', 'دائن (منصرف)', 'الرصيد', 'العملة'];
    const rows: (string | number)[][] = entries.map(e => [
      e.voucherNumber || '',
      e.dateStr,
      `"${e.details.replace(/"/g, '""')}"`,
      e.debit > 0 ? e.debit : 0,
      e.credit > 0 ? e.credit : 0,
      e.runningBalance,
      fund.currency
    ]);

    // Totals row at bottom
    rows.push([
      'الإجمالي',
      '',
      'إجمالي الحركات المعروضة للفترة',
      totalIn,
      totalOut,
      lastBalance,
      fund.currency
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `كشف_حساب_${fund.name}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // WhatsApp share for fund statement
  const handleShareFundWhatsApp = (fund: FinFund, entries: ProcessedFundStatementEntry[]) => {
    const totalIn = entries.reduce((s, e) => s + e.debit, 0);
    const totalOut = entries.reduce((s, e) => s + e.credit, 0);
    const lastBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : parseFundBalance(fund.balance);

    let message = `📊 *كشف حساب صندوق: ${fund.name}*\n`;
    message += `🏛️ المتجر: ${shopConfig?.shopName || 'المتجر'}\n`;
    message += `💰 العملة: ${fund.currency}\n`;
    message += `🏦 الرصيد الختامي: ${lastBalance.toLocaleString('en-US')} ${fund.currency}\n`;
    message += `📥 إجمالي المدين (الوارد): +${totalIn.toLocaleString('en-US')} ${fund.currency}\n`;
    message += `📤 إجمالي الدائن (المنصرف): -${totalOut.toLocaleString('en-US')} ${fund.currency}\n`;
    message += `🔢 عدد العمليات: ${entries.length}\n`;
    message += `📅 التاريخ: ${new Date().toLocaleDateString('ar-YE')}\n`;

    const encoded = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  // Print movements table below funds
  const handlePrintFundMovementsTable = () => {
    const rows = filteredVaultTransactions.map(tx => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment' || (tx.type as string) === 'inflow';
      const amount = Math.abs(Number(tx.amount || 0));
      const debit = isReceipt ? amount : 0;
      const credit = !isReceipt ? amount : 0;

      return [
        tx.voucherNumber ? `#${tx.voucherNumber}` : '-',
        formatTxDate(tx),
        getFundDisplayName(tx),
        formatFundTxDetails(tx),
        debit > 0 ? debit.toLocaleString('en-US') : '-',
        credit > 0 ? credit.toLocaleString('en-US') : '-',
        `${amount.toLocaleString('en-US')} ${getCurrencySymbol(tx.currency)}`
      ];
    });

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'سجل حركات وسندات الصناديق المالية',
          subtitle: `تاريخ التقرير: ${new Date().toLocaleDateString('ar-YE')} | إجمالي السندات المعروضة: ${filteredVaultTransactions.length}`,
          headers: ['رقم السند', 'التاريخ والوقت', 'الصندوق', 'البيان والتفاصيل', 'مدين (وارد)', 'دائن (منصرف)', 'المبلغ والعملة'],
          rows,
          footerNotes: `طبع بواسطة: ${(user as any)?.displayName || (user as any)?.name || user?.email || 'المسؤول'}`
        }
      }
    });
  };

  // Export movements table to CSV
  const handleExportFundMovementsCSV = () => {
    const headers = ['رقم السند', 'التاريخ والوقت', 'الصندوق', 'البيان والتفاصيل', 'مدين (وارد)', 'دائن (منصرف)', 'المبلغ', 'العملة', 'المستخدم'];
    const rows = filteredVaultTransactions.map(tx => {
      const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment' || (tx.type as string) === 'inflow';
      const amount = Math.abs(Number(tx.amount || 0));
      const debit = isReceipt ? amount : 0;
      const credit = !isReceipt ? amount : 0;

      return [
        tx.voucherNumber || '',
        formatTxDate(tx),
        `"${getFundDisplayName(tx).replace(/"/g, '""')}"`,
        `"${formatFundTxDetails(tx).replace(/"/g, '""')}"`,
        debit,
        credit,
        amount,
        tx.currency,
        `"${(tx.userName || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `حركات_وسندات_الصناديق_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Print active report from the reports view
  const handlePrintActiveReport = () => {
    let title = 'تقرير الحسابات المالية';
    let subtitle = '';
    let headers: string[] = [];
    let rows: (string | number)[][] = [];

    if (reportSubSegment === 'revenues') {
      title = 'تقرير الإيرادات والنقود الواردة وسندات القبض';
      subtitle = `إجمالي سندات القبض: ${receiptTransactions.length} سند`;
      headers = ['رقم السند', 'التاريخ', 'التصنيف', 'الجهة المستلم منها', 'الصندوق', 'المبلغ'];
      rows = receiptTransactions.map(tx => [
        tx.voucherNumber || '-',
        formatTxDate(tx),
        tx.transactionCategory || '-',
        tx.customerName || '-',
        getFundDisplayName(tx),
        `+${Math.abs(Number(tx.amount || 0)).toLocaleString('en-US')} ${tx.currency}`
      ]);
    } else if (reportSubSegment === 'expenses') {
      title = 'تقرير المصروفات والمبالغ الصادرة وسندات الصرف';
      subtitle = `إجمالي سندات الصرف: ${paymentTransactions.length} سند`;
      headers = ['رقم السند', 'التاريخ', 'التصنيف المصروف', 'الصرف لصالح', 'المصدر (الصندوق)', 'المبلغ'];
      rows = paymentTransactions.map(tx => [
        tx.voucherNumber || '-',
        formatTxDate(tx),
        tx.transactionCategory || '-',
        tx.customerName || '-',
        getFundDisplayName(tx),
        `-${Math.abs(Number(tx.amount || 0)).toLocaleString('en-US')} ${tx.currency}`
      ]);
    } else if (reportSubSegment === 'fund-balances') {
      title = 'تقرير أرصدة ومحتويات الصناديق المالية';
      subtitle = `عدد الصناديق: ${funds.length} صندوق`;
      headers = ['اسم الصندوق المالي', 'النوع', 'العملة الأساسية', 'الرصيد الفعلي الحالي'];
      rows = funds.map(f => [
        f.name,
        f.type === 'cash' ? 'نقدي' : 'حساب بنك',
        f.currency,
        `${parseFundBalance(f.balance).toLocaleString('en-US')} ${f.currency}`
      ]);
    } else if (reportSubSegment === 'profits') {
      title = 'تقرير الأرباح وصافي الميزان المالي';
      headers = ['العملة', 'إجمالي الوارد', 'إجمالي المنصرف', 'صافي الربح / الفائض'];
      rows = allUsedCurrencies.map(curr => {
        const rev = revenueCurrencyTotals[curr] || 0;
        const exp = expenseCurrencyTotals[curr] || 0;
        const net = rev - exp;
        return [
          getArabicCurrencyName(curr),
          `+${rev.toLocaleString('en-US')} ${curr}`,
          `-${exp.toLocaleString('en-US')} ${curr}`,
          `${net >= 0 ? '+' : ''}${net.toLocaleString('en-US')} ${curr}`
        ];
      });
    } else if (reportSubSegment === 'outstanding-debts') {
      title = 'سجل الديون والمديونيات المستحقة للعملاء';
      headers = ['اسم العميل', 'اسم الشركة', 'رقم الهاتف', 'المبلغ المتبقي'];
      rows = customers.map(cust => {
        const custInvs = invoices.filter(inv => inv.customerId === cust.id);
        const totalCost = custInvs.reduce((a, b) => {
          const invItems = getInvoiceItemsForInvoice(b.invoiceNumber);
          return a + getInvoiceActualCost(invItems, b);
        }, 0);
        const totalPaid = custInvs.reduce((a, b) => a + Number(b.amountPaid || 0), 0);
        const extCollections = transactions
          .filter(t => t.customerId === cust.id && t.type === 'receipt' && (!t.invoiceNumber || String(t.invoiceNumber).trim() === ''))
          .reduce((a, b) => a + Number(b.amount || 0), 0);
        const debt = Math.max(0, totalCost - (totalPaid + extCollections));
        return { cust, debt };
      }).filter(x => x.debt > 0).map(x => [
        x.cust.name,
        x.cust.companyName || '-',
        x.cust.phone1 || '-',
        `${x.debt.toLocaleString('en-US')} ${x.cust.liabilityCurrency || 'USD'}`
      ]);
    }

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title,
          subtitle,
          headers,
          rows,
          footerNotes: `طبع بتاريخ: ${new Date().toLocaleDateString('ar-YE')} | ${shopConfig?.shopName || ''}`
        }
      }
    });
  };

  // Export active report to CSV
  const handleExportActiveReportCSV = () => {
    const filename = `تقرير_${reportSubSegment}_${new Date().toISOString().split('T')[0]}.csv`;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];

    if (reportSubSegment === 'revenues') {
      headers = ['رقم السند', 'التاريخ', 'التصنيف', 'الجهة المستلم منها', 'الصندوق', 'المبلغ', 'العملة'];
      rows = receiptTransactions.map(tx => [
        tx.voucherNumber || '',
        formatTxDate(tx),
        `"${(tx.transactionCategory || '').replace(/"/g, '""')}"`,
        `"${(tx.customerName || '').replace(/"/g, '""')}"`,
        `"${getFundDisplayName(tx).replace(/"/g, '""')}"`,
        Math.abs(Number(tx.amount || 0)),
        tx.currency
      ]);
    } else if (reportSubSegment === 'expenses') {
      headers = ['رقم السند', 'التاريخ', 'التصنيف المصروف', 'الصرف لصالح', 'الصندوق', 'المبلغ', 'العملة'];
      rows = paymentTransactions.map(tx => [
        tx.voucherNumber || '',
        formatTxDate(tx),
        `"${(tx.transactionCategory || '').replace(/"/g, '""')}"`,
        `"${(tx.customerName || '').replace(/"/g, '""')}"`,
        `"${getFundDisplayName(tx).replace(/"/g, '""')}"`,
        Math.abs(Number(tx.amount || 0)),
        tx.currency
      ]);
    } else if (reportSubSegment === 'fund-balances') {
      headers = ['اسم الصندوق', 'النوع', 'العملة', 'الرصيد الفعلي'];
      rows = funds.map(f => [
        `"${f.name.replace(/"/g, '""')}"`,
        f.type === 'cash' ? 'نقدي' : 'بنك',
        f.currency,
        parseFundBalance(f.balance)
      ]);
    } else if (reportSubSegment === 'profits') {
      headers = ['العملة', 'إجمالي الوارد', 'إجمالي المصروف', 'صافي الربح'];
      rows = allUsedCurrencies.map(curr => [
        curr,
        revenueCurrencyTotals[curr] || 0,
        expenseCurrencyTotals[curr] || 0,
        (revenueCurrencyTotals[curr] || 0) - (expenseCurrencyTotals[curr] || 0)
      ]);
    } else if (reportSubSegment === 'outstanding-debts') {
      headers = ['اسم العميل', 'اسم الشركة', 'الهاتف', 'الديون المتبقية', 'العملة'];
      rows = customers.map(cust => {
        const custInvs = invoices.filter(inv => inv.customerId === cust.id);
        const totalCost = custInvs.reduce((a, b) => {
          const invItems = getInvoiceItemsForInvoice(b.invoiceNumber);
          return a + getInvoiceActualCost(invItems, b);
        }, 0);
        const totalPaid = custInvs.reduce((a, b) => a + Number(b.amountPaid || 0), 0);
        const extCollections = transactions
          .filter(t => t.customerId === cust.id && t.type === 'receipt' && (!t.invoiceNumber || String(t.invoiceNumber).trim() === ''))
          .reduce((a, b) => a + Number(b.amount || 0), 0);
        const debt = Math.max(0, totalCost - (totalPaid + extCollections));
        return { cust, debt };
      }).filter(x => x.debt > 0).map(x => [
        `"${x.cust.name.replace(/"/g, '""')}"`,
        `"${(x.cust.companyName || '').replace(/"/g, '""')}"`,
        x.cust.phone1 || '',
        x.debt,
        x.cust.liabilityCurrency || 'USD'
      ]);
    }

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalLedgerInvoicesPages = Math.max(1, Math.ceil(ledgerCustomerInvoices.length / itemsPerPage));
  const safeLedgerInvoicesPage = Math.min(currentPage, totalLedgerInvoicesPages);
  const currentLedgerInvoices = ledgerCustomerInvoices.slice((safeLedgerInvoicesPage - 1) * itemsPerPage, safeLedgerInvoicesPage * itemsPerPage);

  const totalLedgerTransactionsPages = Math.max(1, Math.ceil(ledgerCustomerTransactions.length / itemsPerPage));
  const safeLedgerTransactionsPage = Math.min(currentPage, totalLedgerTransactionsPages);
  const currentLedgerTransactions = ledgerCustomerTransactions.slice((safeLedgerTransactionsPage - 1) * itemsPerPage, safeLedgerTransactionsPage * itemsPerPage);

  // Page level stats
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // VOUCHER FORM STATES (Shared structure)
  const [nextVoucherNum, setNextVoucherNum] = useState<number>(1001);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('');
  const [voucherAmount, setVoucherAmount] = useState<string>('');
  const [voucherNotes, setVoucherNotes] = useState<string>('');
  const [selectedFundId, setSelectedFundId] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [depositorName, setDepositorName] = useState<string>('');
  const [liabilityCurrency, setLiabilityCurrency] = useState<string>('USD');
  const [liabilityAmount, setLiabilityAmount] = useState<string>('');
  const [selectedInvoiceNumber, setSelectedInvoiceNumber] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  
  // EXCHANGE RATE STATES
  const [voucherExchangeRate, setVoucherExchangeRate] = useState<string>('1');

  // TRANSFER TAB STATES
  const [transferSourceFundId, setTransferSourceFundId] = useState<string>('');
  const [transferDestFundId, setTransferDestFundId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [transferNotes, setTransferNotes] = useState<string>('');
  
  const [transferExchangeRate, setTransferExchangeRate] = useState<string>('1');

  // Track active user input in voucher & transfer forms to protect against background sync wipes
  const isFormDirty = Boolean(
    voucherAmount.trim() || 
    customerSearch.trim() || 
    voucherNotes.trim() || 
    depositorName.trim() || 
    referenceNumber.trim() ||
    transferAmount.trim() ||
    transferNotes.trim()
  );
  const isFormDirtyRef = useRef(false);
  isFormDirtyRef.current = isFormDirty;

  const showAddModalRef = useRef(false);
  showAddModalRef.current = showAddModal;

  const getFundDisplayName = (tx: any) => {
    if (tx.fundName && tx.fundName.trim() && tx.fundName !== 'غير معروف') return tx.fundName;
    if (tx.fundId) {
      const matched = funds.find(f => f.id === tx.fundId);
      if (matched && matched.name) return matched.name;
    }
    if (tx.paymentType === 2) return 'حساب بنكي';
    if (tx.paymentType === 1) return 'الخزينة الرئيسية';
    return 'الخزينة الرئيسية';
  };

  const getCustomerCurrencyLabel = (customerId: string) => {
    const customerInvs = invoices.filter(inv => inv.customerId === customerId);
    const currencies = Array.from(new Set(customerInvs.map(inv => inv.currency || 'USD')));
    if (currencies.length === 0) return 'USD';
    return currencies.join(' / ');
  };

  const normalizeCurrency = (curr?: string): string => {
    if (!curr) return 'USD';
    const c = curr.trim().toUpperCase();
    if (c === 'USD' || c === 'دولار' || c === '$' || c.includes('دولار') || c === 'US DOLLAR') return 'USD';
    if (c === 'SAR' || c === 'ريال سعودي' || c === 'سعودي' || c === 'ر.س') return 'SAR';
    if (c === 'YER' || c === 'ريال يمني' || c === 'يمني' || c === 'ر.ي') return 'YER';
    return c;
  };

  const getArabicCurrencyName = (currCode: string) => {
    if (!currCode) return 'دولار';
    const norm = normalizeCurrency(currCode);
    if (norm === 'USD') return 'دولار';
    if (norm === 'YER') return 'ريال يمني';
    if (norm === 'SAR') return 'ريال سعودي';
    if (currCode.toUpperCase().includes('USD') && currCode.toUpperCase().includes('YER')) return 'دولار / ريال يمني';
    return currCode;
  };

  const [isGeneratingPDF, setIsGeneratingPDF] = useState<boolean>(false);
  const [currentOutput, setCurrentOutput] = useState<any>(null);

  // Fetch all core data from local implementation
  const loadDatabaseData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      // 1. Funds
      const fundsRes = await localDb.query("SELECT * FROM fin_funds ORDER BY name ASC");
      let activeFunds = (fundsRes.values || []).filter((f: any) => f.status === 'active') as FinFund[];
      if (activeFunds.length === 0 && fundsRes.values && fundsRes.values.length > 0) {
        activeFunds = fundsRes.values as FinFund[];
      }
      setFunds(activeFunds);

      // 2. Currencies
      const currRes = await localDb.query("SELECT * FROM fin_currencies WHERE status = 'active' ORDER BY name ASC");
      const activeCurrs = (currRes.values || []) as FinCurrency[];
      setCurrencies(activeCurrs);

      // 3. Types
      const typesRes = await localDb.query("SELECT * FROM fin_transaction_types ORDER BY name ASC");
      const rawTypes = (typesRes.values || []) as FinTransactionType[];
      const uniqueTypes: FinTransactionType[] = [];
      const seenTypeKeys = new Set<string>();
      for (const t of rawTypes) {
        const key = `${(t.name || '').trim().toLowerCase()}_${t.type}`;
        if (!seenTypeKeys.has(key)) {
          seenTypeKeys.add(key);
          uniqueTypes.push(t);
        }
      }
      setTxTypes(uniqueTypes);

      // 4. Customers
      const custRes = await localDb.query("SELECT id, name, companyName, phone1, liabilityCurrency FROM customers ORDER BY name ASC");
      setCustomers((custRes.values || []) as DB_Customer[]);

      // 5. Invoices
      const invRes = await localDb.query("SELECT * FROM invoices");
      setInvoices((invRes.values || []) as DB_Invoice[]);

      // 5.5. Invoice Items
      const itemsRes = await localDb.query("SELECT * FROM invoice_items");
      setItems(itemsRes.values || []);

      // 6. Transactions
      const txRes = await localDb.query("SELECT * FROM vault_transactions ORDER BY timestamp DESC");
      setTransactions((txRes.values || []) as VaultTransaction[]);

      // Reset Form defaults when data shifts (ONLY if not already set, and user is NOT in modal or typing)
      setSelectedFundId(prev => {
        if (prev) return prev;
        if (showAddModalRef.current || isFormDirtyRef.current) return prev;
        return activeFunds.length > 0 ? activeFunds[0].id : '';
      });

      setSelectedCurrency(prev => {
        if (prev) return prev;
        if (showAddModalRef.current || isFormDirtyRef.current) return prev;
        return activeCurrs.length > 0 ? activeCurrs[0].name : '';
      });

    } catch (err: any) {
      console.error('Error loading vault data:', err);
      if (!isBackground) setErrorMsg('فشل تحميل حسابات الخزينة');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // Run initial fetch and listen to live updates
  useEffect(() => {
    loadDatabaseData();

    // Subscribe to local DB updates in silent background mode
    const unsubFunds = localDb.subscribe('fin_funds', () => {
      loadDatabaseData(true);
    });
    const unsubTx = localDb.subscribe('vault_transactions', () => {
      loadDatabaseData(true);
      if (!isFormDirtyRef.current && !showAddModalRef.current) {
        calculateNextVoucherNumber();
      }
    });
    const unsubCustomers = localDb.subscribe('customers', () => {
      loadDatabaseData(true);
    });
    const unsubInvoices = localDb.subscribe('invoices', () => {
      loadDatabaseData(true);
    });

    const fetchShopConfig = async () => {
      try {
        const snap = await getDoc(doc(db, 'company_details', 'main_details'));
        if (snap.exists()) {
          // setShopConfig(snap.data() as any);
        } else {
          // Fallback to SQLite
          const localRes = await localDb.query("SELECT * FROM company_details LIMIT 1");
          if (localRes.values && localRes.values.length > 0) {
            // setShopConfig(localRes.values[0]);
          }
        }
      } catch (err) {
        console.error("Error fetching shop config:", err);
      }
    };
    fetchShopConfig();

    const handleSyncEvent = () => {
      loadDatabaseData(true);
      if (!isFormDirtyRef.current && !showAddModalRef.current) {
        calculateNextVoucherNumber();
      }
    };
    window.addEventListener('snd_data_synced', handleSyncEvent);

    return () => {
      if (typeof unsubFunds === 'function') unsubFunds();
      if (typeof unsubTx === 'function') unsubTx();
      if (typeof unsubCustomers === 'function') unsubCustomers();
      if (typeof unsubInvoices === 'function') unsubInvoices();
      window.removeEventListener('snd_data_synced', handleSyncEvent);
    };
  }, []);

  const [isSyncingFunds, setIsSyncingFunds] = useState(false);

  const handleForcePullFromCloud = async () => {
    setIsSyncingFunds(true);
    try {
      const res = await SyncEngine.forcePullFinancialDataFromCloud();
      setSuccessMsg(res.message);
      await loadDatabaseData();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      console.error('Failed to pull from cloud:', e);
      setErrorMsg(`فشل سحب البيانات من السحابة: ${e?.message || e}`);
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setIsSyncingFunds(false);
    }
  };

  const handleRecalculateFunds = async () => {
    setIsSyncingFunds(true);
    try {
      const res = await repairAllFundBalances();
      setSuccessMsg(`تمت موازنة وتسوية أرصدة ${res.repairedCount} صندوق مع السحابة والقيود بنجاح.`);
      await loadDatabaseData();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      console.error('Failed to recalculate funds:', e);
      setErrorMsg(`فشلت إعادة احتساب الأرصدة: ${e?.message || e}`);
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setIsSyncingFunds(false);
    }
  };

  // Fetch & Calculate Next Voucher Index
  const calculateNextVoucherNumber = async () => {
    // If modal is open and user has entered data, do not overwrite expected voucher number
    if (showAddModalRef.current && isFormDirtyRef.current) {
      return;
    }
    try {
      const res = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
      const max = res.values?.[0]?.maxNum || 1000;
      setNextVoucherNum(Number(max) + 1);
    } catch (err) {
      setNextVoucherNum(1001);
    }
  };

  const resetForm = () => {
    // 1. Reset Voucher States
    setSelectedCategory('');
    setCustomerSearch('');
    setSelectedCustomerId('');
    setShowCustomerDropdown(false);
    setSelectedCurrency('');
    setVoucherAmount('');
    setVoucherNotes('');
    setSelectedFundId('');
    setReferenceNumber('');
    setDepositorName('');
    setLiabilityCurrency('USD');
    setLiabilityAmount('');
    setSelectedInvoiceNumber('');
    setSelectedInvoiceId('');
    setVoucherExchangeRate('1');

    // 2. Reset Transfer States
    setTransferSourceFundId('');
    setTransferDestFundId('');
    setTransferAmount('');
    setTransferNotes('');
    setTransferExchangeRate('1');

    // 3. Clear messages/preview
    setErrorMsg(null);
    setShowPrintPreview(false);
  };

  const isInitializedRef = useRef(false);
  useEffect(() => {
    if (initialCustomerName || initialCustomerId || initialLiabilityCurrency || initialSegment || initialShowAddModal || initialInvoiceNumber || initialInvoiceId) {
      if (initialCustomerName) {
        setCustomerSearch(initialCustomerName);
      }
      if (initialCustomerId) {
        setSelectedCustomerId(initialCustomerId);
      }
      if (initialLiabilityCurrency) {
        setLiabilityCurrency(initialLiabilityCurrency);
      }
      if (initialInvoiceNumber) {
        setSelectedInvoiceNumber(initialInvoiceNumber);
      }
      if (initialInvoiceId) {
        setSelectedInvoiceId(initialInvoiceId);
      }
      if (initialSegment) {
        setActiveSegment(initialSegment);
      }
      if (initialShowAddModal) {
        setShowAddModal(true);
      }
      onClearInitialProps?.();
    }
  }, [initialCustomerName, initialCustomerId, initialLiabilityCurrency, initialSegment, initialShowAddModal, initialInvoiceNumber, initialInvoiceId]);

  useEffect(() => {
    return () => {
      onClearInitialProps?.();
    };
  }, []);

  const prevSegmentRef = useRef(activeSegment);

  // Recalculate voucher number on mount and when segment changes
  useEffect(() => {
    calculateNextVoucherNumber();
    // Only reset form and close modal when activeSegment actually changes (user switches tabs)
    if (prevSegmentRef.current !== activeSegment) {
      prevSegmentRef.current = activeSegment;
      resetForm();
      setShowAddModal(false);
    }
  }, [activeSegment]);

  // Set default category when txTypes are loaded or segment changes, without resetting the form or closing the modal
  useEffect(() => {
    const matchingCats = txTypes.filter(cat => cat.type === activeSegment);
    if (matchingCats.length > 0) {
      setSelectedCategory(prev => {
        if (prev) return prev;
        return matchingCats[0]?.name || '';
      });
    }
  }, [activeSegment, txTypes]);

  const prevCustomerSearchRef = useRef<string>('');
  // Sync liabilityCurrency when customerSearch changes
  useEffect(() => {
    const trimmed = String(customerSearch || '').trim();
    if (prevCustomerSearchRef.current === trimmed) {
      return;
    }
    prevCustomerSearchRef.current = trimmed;
    if (!trimmed) {
      return;
    }
    const matched = customers.find(c => String(c.name || '').trim().toLowerCase() === trimmed.toLowerCase());
    if (matched && matched.liabilityCurrency) {
      setLiabilityCurrency(matched.liabilityCurrency);
    }
  }, [customerSearch, customers]);

  const prevCurrencyPairRef = useRef({ selected: '', liability: '' });
  // Automatically set default exchange rate to 3.8 if SAR is involved
  useEffect(() => {
    if (
      prevCurrencyPairRef.current.selected === selectedCurrency &&
      prevCurrencyPairRef.current.liability === liabilityCurrency
    ) {
      return;
    }
    prevCurrencyPairRef.current = { selected: selectedCurrency, liability: liabilityCurrency };

    if (selectedCurrency && liabilityCurrency && selectedCurrency !== liabilityCurrency) {
      setVoucherExchangeRate(prev => {
        if (prev && prev !== '1' && prev !== '3.8') return prev;
        if ((selectedCurrency === 'SAR' && liabilityCurrency === 'USD') || (selectedCurrency === 'USD' && liabilityCurrency === 'SAR')) {
          return '3.8';
        }
        return '1';
      });
    } else {
      setVoucherExchangeRate('1');
    }
  }, [selectedCurrency, liabilityCurrency]);

  const prevTransferPairRef = useRef({ src: '', dest: '' });
  useEffect(() => {
    const src = funds.find(f => f.id === transferSourceFundId);
    const dest = funds.find(f => f.id === transferDestFundId);
    const srcCurr = src?.currency || '';
    const destCurr = dest?.currency || '';

    if (
      prevTransferPairRef.current.src === srcCurr &&
      prevTransferPairRef.current.dest === destCurr
    ) {
      return;
    }
    prevTransferPairRef.current = { src: srcCurr, dest: destCurr };

    if (src && dest && src.currency !== dest.currency) {
      setTransferExchangeRate(prev => {
        if (prev && prev !== '1' && prev !== '3.8') return prev;
        if ((src.currency === 'SAR' && dest.currency === 'USD') || (src.currency === 'USD' && dest.currency === 'SAR')) {
          return '3.8';
        }
        return '1';
      });
    } else {
      setTransferExchangeRate('1');
    }
  }, [transferSourceFundId, transferDestFundId, funds]);

  // Synchronize currency automatically with selected fund
  useEffect(() => {
    if (selectedFundId && funds.length > 0) {
      const fund = funds.find(f => f.id === selectedFundId);
      if (fund) {
        setSelectedCurrency(fund.currency);
      }
    }
  }, [selectedFundId, funds]);

  // Form Validity check
  const isFormValid = () => {
    if (!selectedFundId) return false;
    if (!voucherAmount || !voucherAmount.trim()) return false;
    const amountVal = parseFloat(voucherAmount);
    if (isNaN(amountVal) || amountVal <= 0) return false;
    


    if (!customerSearch || !customerSearch.trim()) return false;
    if (!selectedCategory || !selectedCategory.trim()) return false;

    // Additional checks for bank fund mode
    const matchedFund = funds.find(f => f.id === selectedFundId);
    if (matchedFund && matchedFund.type !== 'cash') {
      if (!referenceNumber || !referenceNumber.trim()) return false;
      if (!depositorName || !depositorName.trim()) return false;
    }

    return true;
  };

  // Handle smooth scroll on focus for mobile devices
  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target;
    setTimeout(() => {
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
  };

  // POST / REASSIGN Voucher to Ledger
  const handlePostVoucher = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isFormValid() || isPosting) return false;

    setIsPosting(true);
    try {
      const isReceipt = activeSegment === 'receipt';
      const parsedAmount = parseFloat(voucherAmount);
      const matchedFund = funds.find(f => f.id === selectedFundId);
      if (!matchedFund) {
        setErrorMsg('الصندوق المحدد غير موجود');
        setIsPosting(false);
        return false;
      }

      const txId = `vtx-${Math.random().toString(36).substring(2, 8)}`;
      const timestampIso = new Date().toISOString();

      let computedLiabilityAmount = parsedAmount;
      let finalVoucherNotes = voucherNotes.trim();
      let customerStatementNote = '';

      if (liabilityCurrency && liabilityCurrency !== selectedCurrency) {
        const vRate = parseFloat(voucherExchangeRate) || 1;
        computedLiabilityAmount = vRate > 0 ? Math.round((parsedAmount / vRate) * 100) / 100 : 0;
        finalVoucherNotes += ` [سعر الصرف: ${vRate} لعملة ${liabilityCurrency} مقابل ${selectedCurrency}]`;
      } else {
        computedLiabilityAmount = parsedAmount;
      }
      
      const statementKeyword = isReceipt ? 'لكم' : 'عليكم';
      const currencyNameText = currencies.find(c => c.name === liabilityCurrency)?.name || liabilityCurrency || '';
      customerStatementNote = `${voucherNotes.trim()} ${statementKeyword} مبلغ ${tafqeet(computedLiabilityAmount)} ${currencyNameText} مقابل ${selectedCategory}`;

      const finalLiabilityCurrency = liabilityCurrency || selectedCurrency;
      const finalLiabilityAmount = computedLiabilityAmount;
      const finalPaymentType = (liabilityCurrency && liabilityCurrency !== selectedCurrency) ? 2 : 1;
      const finalReceiptCurrency = selectedCurrency;
      const finalReceiptAmount = parsedAmount;
      const finalBankDetails = matchedFund.type !== 'cash' ? { referenceNumber: referenceNumber.trim(), depositorName: depositorName.trim() } : {};

      // Ensure statementNote column exists (hot-reload safety)
      try {
        await localDb.run('ALTER TABLE vault_transactions ADD COLUMN statementNote TEXT');
      } catch (e) {}

      // Resolve invoiceNumber and invoiceId properly
      let finalInvoiceNumber = selectedInvoiceNumber || initialInvoiceNumber || '';
      let finalInvoiceId = selectedInvoiceId || initialInvoiceId || '';

      if (finalInvoiceNumber && !finalInvoiceId) {
        const cleanNo = String(finalInvoiceNumber).replace('#', '').trim();
        const matchedInv = invoices.find(inv => String(inv.invoiceNumber || '').replace('#', '').trim() === cleanNo);
        if (matchedInv) {
          finalInvoiceId = matchedInv.id;
        }
      } else if (!finalInvoiceNumber && finalInvoiceId) {
        const matchedInv = invoices.find(inv => inv.id === finalInvoiceId);
        if (matchedInv) {
          finalInvoiceNumber = String(matchedInv.invoiceNumber || '').replace('#', '').trim();
        }
      }

      // 1. Insert into database
      const txData1 = {
        id: txId, 
        currency: selectedCurrency, 
        amount: isReceipt ? parsedAmount : -parsedAmount, 
        customerName: customerSearch.trim() || 'جهة عامة أخرى', 
        invoiceNumber: finalInvoiceNumber,
        invoiceId: finalInvoiceId,
        userName: user.name || 'المدير العام', 
        userNumber: user.userNumber || 1, 
        userId: user.id || 'none', 
        timestamp: timestampIso, 
        type: isReceipt ? 'receipt' : 'payment',
        notes: matchedFund.type !== 'cash' ? `رقم المرجع: ${referenceNumber.trim()} | المودع: ${depositorName.trim()} | الملاحظات: ${finalVoucherNotes}` : finalVoucherNotes,
        updatedAt: timestampIso, 
        voucherNumber: nextVoucherNum, 
        transactionCategory: selectedCategory, 
        fundId: matchedFund.id, 
        fundName: matchedFund.name,
        customerId: selectedCustomerId || '', 
        isReversed: 0, 
        isReversal: 0, 
        reversalOf: '', 
        paymentType: finalPaymentType, 
        liabilityCurrency: finalLiabilityCurrency,
        liabilityAmount: finalLiabilityAmount, 
        receiptCurrency: finalReceiptCurrency, 
        receiptAmount: finalReceiptAmount, 
        bankDetails: JSON.stringify(finalBankDetails), 
        statementNote: customerStatementNote
      };
      await ProviderFactory.getProvider().setDoc('vault_transactions', txId, txData1);

      // 2. Adjust target box fund balance in database
      const balanceAdjustment = isReceipt ? parsedAmount : -parsedAmount;
      await ProviderFactory.getProvider().updateDoc('fin_funds', matchedFund.id, { balance: { type: 'increment', value: balanceAdjustment } });

      // Successfully processed
      setSuccessMsg(`تم ترحيل السند رقم (${nextVoucherNum}) بنجاح وتحديث الصناديق.`);
      setTimeout(() => setSuccessMsg(null), 3000);
      setShowPrintPreview(false);
      setShowAddModal(false);

      resetForm();
      onClearInitialProps?.();
      
      // Reload everything
      await loadDatabaseData();
      await calculateNextVoucherNumber();
      return true;

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'فشل ترحيل قيد الحسابات');
      return false;
    } finally {
      setIsPosting(false);
    }
  };

  const handleSaveAndCommit = async () => {
    return await handlePostVoucher();
  };

  const handleSaveAndPrint = async () => {
    const internalBtn = document.getElementById('internal-print-btn');
    if (internalBtn) {
      (internalBtn as HTMLElement).click();
    }
    return await handlePostVoucher();
  };

  const handleSaveAndWhatsApp = async () => {
    const internalWaBtn = document.getElementById('internal-wa-btn');
    if (internalWaBtn) {
      (internalWaBtn as HTMLElement).click();
    }
    return await handlePostVoucher();
  };

  const handlePostTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPosting) return;
    
    if (!transferSourceFundId || !transferDestFundId || !transferAmount || parseFloat(transferAmount) <= 0) {
      setErrorMsg('الرجاء تعبئة بيانات التحويل بشكل صحيح والمبلغ أكبر من صفر');
      return;
    }

    if (transferSourceFundId === transferDestFundId) {
      setErrorMsg('لا يمكن التحويل لنفس الصندوق');
      return;
    }

    const sourceFund = funds.find(f => f.id === transferSourceFundId);
    const destFund = funds.find(f => f.id === transferDestFundId);

    if (!sourceFund || !destFund) {
      setErrorMsg('أحد الصناديق غير موجود');
      return;
    }

    if (sourceFund.currency !== destFund.currency) {
      const rate = parseFloat(transferExchangeRate);
      if (isNaN(rate) || rate <= 0) {
        setErrorMsg('الرجاء إدخال سعر صرف صحيح أكبر من الصفر');
        return;
      }
    }

    setIsPosting(true);
    try {
      const parsedAmount = parseFloat(transferAmount);
      const timestampIso = new Date().toISOString();

      let destAmount = parsedAmount;
      let finalTransferNotesSrc = transferNotes ? ' - ' + transferNotes : '';
      let finalTransferNotesDest = transferNotes ? ' - ' + transferNotes : '';

      if (sourceFund.currency !== destFund.currency) {
        const rate = parseFloat(transferExchangeRate) || 1;
        destAmount = rate > 0 ? Math.round((parsedAmount / rate) * 100) / 100 : 0;
        
        const rateNotes = ` [سعر الصرف: ${rate} لعملة ${sourceFund.currency} مقابل ${destFund.currency}]`;
        finalTransferNotesSrc += rateNotes;
        finalTransferNotesDest += rateNotes;
      }

      // Create transaction for Source (payment/outgoing)
      const txIdOut = `vtx-${Math.random().toString(36).substring(2, 8)}`;
      const txIdIn = `vtx-${Math.random().toString(36).substring(2, 8)}`;
      await ProviderFactory.getProvider().setDoc('vault_transactions', txIdOut, {
          linkedTxId: txIdIn,
          id: txIdOut, currency: sourceFund.currency, amount: -parsedAmount, customerName: 'تحويل داخلي', invoiceNumber: '',
          userName: user.name || 'المدير العام', userNumber: user.userNumber || 1, userId: user.id || 'none', timestamp: timestampIso, type: 'payment',
          notes: `تحويل صادر إلى الصندوق: ${destFund.name}${finalTransferNotesSrc}`, updatedAt: timestampIso, voucherNumber: nextVoucherNum, transactionCategory: 'تحويل بين الصناديق',
          fundId: sourceFund.id, fundName: sourceFund.name, customerId: ''
      });

      // Create transaction for Dest (receipt/incoming)
      await ProviderFactory.getProvider().setDoc('vault_transactions', txIdIn, {
          linkedTxId: txIdOut,
          id: txIdIn, currency: destFund.currency, amount: destAmount, customerName: 'تحويل داخلي', invoiceNumber: '',
          userName: user.name || 'المدير العام', userNumber: user.userNumber || 1, userId: user.id || 'none', timestamp: timestampIso, type: 'receipt',
          notes: `تحويل وارد من الصندوق: ${sourceFund.name}${finalTransferNotesDest}`, updatedAt: timestampIso, voucherNumber: Number(nextVoucherNum) + 1, transactionCategory: 'تحويل بين الصناديق',
          fundId: destFund.id, fundName: destFund.name, customerId: ''
      });

      // Adjust balances
      await ProviderFactory.getProvider().updateDoc('fin_funds', sourceFund.id, { balance: { type: 'increment', value: -parsedAmount } });
      await ProviderFactory.getProvider().updateDoc('fin_funds', destFund.id, { balance: { type: 'increment', value: destAmount } });

      setSuccessMsg(`تم التحويل بنجاح من ${sourceFund.name} إلى ${destFund.name}`);
      setTimeout(() => setSuccessMsg(null), 3000);
      
      resetForm();
      
      await loadDatabaseData();
      await calculateNextVoucherNumber();

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'فشل عملية التحويل');
    } finally {
      setIsPosting(false);
    }
  };

  const handleReverseEntry = async (tx: VaultTransaction) => {
    console.log("handleReverseEntry called", { tx, isPosting, userRole: user.role });
    if (isPosting) {
      console.log("handleReverseEntry aborted: isPosting is true");
      return;
    }
    
    // Check permissions
    if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'data_entry') {
      console.log("handleReverseEntry aborted: permission denied", user.role);
      setErrorMsg('عذراً، فقط المستخدمين المخولين لديهم صلاحية عكس القيد');
      return;
    }

    if (tx.isReversed || tx.isReversal || tx.status === 'reversed' || tx.status === 'reversal') {
      console.log("handleReverseEntry aborted: already reversed", tx);
      setErrorMsg('هذا القيد معكوس بالفعل أو أنه قيد عكسي ولا يمكن عكسه مجدداً');
      return;
    }

    setIsPosting(true);
    console.log("handleReverseEntry proceeding to post reversal");
    try {
      const timestampIso = new Date().toISOString();
      
      let txsToReverse = [tx];
      if (tx.linkedTxId) {
         try {
           const resLinked = await localDb.query("SELECT * FROM vault_transactions WHERE id = ?", [tx.linkedTxId]);
           if (resLinked.values && resLinked.values.length > 0) {
             txsToReverse.push(resLinked.values[0]);
           }
         } catch(e) {}
      }

      // Get next voucher number
      const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
      let currentNextNum = (resNum.values?.[0]?.maxNum || 1000);

      for (const t of txsToReverse) {
          if (t.isReversed || t.isReversal) continue;
          currentNextNum += 1;

          const reverseAmount = -Number(t.amount);
          const originalVoucherNotes = t.notes || '';
          const updatedOriginalNotes = `${originalVoucherNotes} [تم عكس القيد بواسطة القيد رقم ${currentNextNum}]`;
          const reversalNotes = `[قيد عكسي] للمستند رقم ${t.voucherNumber} - ${originalVoucherNotes}`;
          const reversalTxId = `vtx-${Math.random().toString(36).substring(2, 8)}`;

          let reversalInvId = t.invoiceId || '';
          if (t.invoiceNumber && !reversalInvId) {
            const cleanNo = String(t.invoiceNumber).replace('#', '').trim();
            const invs = await localDb.query("SELECT id FROM invoices WHERE invoiceNumber = ? OR invoiceNumber = ?", [cleanNo, `#${cleanNo}`]);
            if (invs.values && invs.values.length > 0) {
              reversalInvId = invs.values[0].id;
            }
          }

          // 1. Update original transaction in SQLite
          await ProviderFactory.getProvider().updateDoc('vault_transactions', t.id, { isReversed: 1, notes: updatedOriginalNotes, updatedAt: timestampIso });

          // 2. Insert reversal counter-transaction
          await ProviderFactory.getProvider().setDoc('vault_transactions', reversalTxId, {
            id: reversalTxId, currency: t.currency, amount: reverseAmount, customerName: t.customerName, invoiceNumber: t.invoiceNumber || '',
            invoiceId: reversalInvId,
            userName: user.name || 'المدير العام', userNumber: user.userNumber || 1, userId: user.id || 'none', timestamp: timestampIso,
            type: t.type === 'receipt' ? 'payment' : 'receipt', notes: reversalNotes, updatedAt: timestampIso, voucherNumber: currentNextNum,
            transactionCategory: 'عكس قيد مال', fundId: t.fundId || '', fundName: t.fundName || '', customerId: t.customerId || '',
            isReversed: 0, isReversal: 1, reversalOf: t.id
          });

          // 3. Update SQLite fund balance
          if (t.fundId) {
            await ProviderFactory.getProvider().updateDoc('fin_funds', t.fundId, { balance: { type: 'increment', value: reverseAmount } });
          }

          // 3b. Update invoice if linked
          if (t.invoiceNumber) {
            // Find invoice
            const invs = await localDb.query("SELECT id FROM invoices WHERE invoiceNumber = ?", [t.invoiceNumber]);
            if (invs.values && invs.values.length > 0) {
              const invId = invs.values[0].id;
              // If it's a receipt being reversed, we decrease amountPaid. (reverseAmount is negative)
              // Wait, reverseAmount logic:
              // If original was receipt (amount > 0), reverseAmount = -t.amount
              // To update amountPaid, we add reverseAmount
              await ProviderFactory.getProvider().updateDoc('invoices', invId, { amountPaid: { type: 'increment', value: reverseAmount } });
            }
          }

          // 4. Update Firestore if the transaction can be found there
          try {
            const originalDocRef = doc(db, 'vault_transactions', t.id);
            const origSnap = await getDoc(originalDocRef);
            if (origSnap.exists()) {
              await setDoc(originalDocRef, {
                ...origSnap.data(),
                isReversed: 1,
                status: 'reversed',
                notes: updatedOriginalNotes,
                updatedAt: timestampIso
              });
            }

            const reversalDocRef = doc(db, 'vault_transactions', reversalTxId);
            await setDoc(reversalDocRef, {
              id: reversalTxId,
              currency: t.currency,
              amount: reverseAmount,
              customerName: t.customerName,
              invoiceNumber: t.invoiceNumber || '',
              invoiceId: reversalInvId,
              userName: user.name || 'المدير العام',
              userNumber: user.userNumber || 1,
              userId: user.id || 'none',
              timestamp: timestampIso,
              type: t.type === 'receipt' ? 'payment' : 'receipt',
              notes: reversalNotes,
              updatedAt: timestampIso,
              voucherNumber: currentNextNum,
              transactionCategory: 'عكس قيد مال',
              fundId: t.fundId || '',
              fundName: t.fundName || '',
              customerId: t.customerId || '',
              isReversed: 0,
              isReversal: 1,
              reversalOf: t.id,
              status: 'reversal'
            });
          } catch (e) {
            console.error("Firestore sync error for reversal", e);
          }
      }

      setSuccessMsg('تم عكس القيد بنجاح');
      setTimeout(() => setSuccessMsg(null), 3000);
      
      await loadDatabaseData();
      await calculateNextVoucherNumber();

    } catch (err: any) {
      console.error("Reversal error:", err);
      setErrorMsg(err.message || 'فشل عكس القيد');
    } finally {
      setIsPosting(false);
    }
  };

  const handleDeleteTransaction = async (tx: any) => {
    if (!tx || !tx.id) return;
    setIsDeletingTx(true);
    try {
      // 1. Delete from Provider (Firestore / Firebase / Local sync)
      try {
        await ProviderFactory.getProvider().deleteDoc('vault_transactions', tx.id);
      } catch (e) {
        console.warn("Provider deleteDoc error:", e);
      }

      // 2. Direct Firestore delete if available
      try {
        const firestoreDocRef = doc(db, 'vault_transactions', tx.id);
        const snap = await getDoc(firestoreDocRef);
        if (snap.exists()) {
          await deleteDoc(firestoreDocRef);
        }
      } catch (e) {
        console.warn("Direct Firestore delete error:", e);
      }

      // 3. SQLite delete if available
      try {
        await localDb.run("DELETE FROM vault_transactions WHERE id = ?", [tx.id]);
      } catch (e) {
        console.warn("SQLite delete error:", e);
      }

      // 4. Adjust linked invoice amountPaid if applicable
      const invNo = tx.invoiceNumber ? String(tx.invoiceNumber).replace('#', '').trim() : '';
      let targetInvId = tx.invoiceId;
      if (!targetInvId && invNo) {
        const matched = invoices.find((i: any) => String(i.invoiceNumber).replace('#', '').trim() === invNo);
        if (matched) targetInvId = matched.id;
      }

      if (targetInvId) {
        const txLiabilityVal = Math.abs(Number(tx.liabilityAmount !== undefined && tx.liabilityAmount !== null ? tx.liabilityAmount : tx.amount || 0));
        
        if (tx.type === 'receipt' || tx.type === 'invoice_payment') {
          const reduceVal = -txLiabilityVal;
          try {
            await ProviderFactory.getProvider().updateDoc('invoices', targetInvId, {
              amountPaid: { type: 'increment', value: reduceVal }
            });
          } catch (e) {}

          try {
            await localDb.run("UPDATE invoices SET amountPaid = MAX(0, COALESCE(amountPaid, 0) - ?) WHERE id = ?", [txLiabilityVal, targetInvId]);
          } catch (e) {}

          setInvoices(prevInvs => prevInvs.map(i => {
            if (i.id === targetInvId) {
              return { ...i, amountPaid: Math.max(0, Number(i.amountPaid || 0) - txLiabilityVal) };
            }
            return i;
          }));
        } else if (tx.type === 'payment') {
          try {
            await ProviderFactory.getProvider().updateDoc('invoices', targetInvId, {
              amountPaid: { type: 'increment', value: txLiabilityVal }
            });
          } catch (e) {}

          try {
            await localDb.run("UPDATE invoices SET amountPaid = COALESCE(amountPaid, 0) + ? WHERE id = ?", [txLiabilityVal, targetInvId]);
          } catch (e) {}

          setInvoices(prevInvs => prevInvs.map(i => {
            if (i.id === targetInvId) {
              return { ...i, amountPaid: Number(i.amountPaid || 0) + txLiabilityVal };
            }
            return i;
          }));
        }
      }

      // 5. Adjust fund balance if fundId is set
      if (tx.fundId) {
        const balanceAdj = (tx.type === 'receipt' || tx.type === 'invoice_payment')
          ? -Math.abs(Number(tx.amount || 0))
          : Math.abs(Number(tx.amount || 0));
        try {
          await ProviderFactory.getProvider().updateDoc('fin_funds', tx.fundId, {
            balance: { type: 'increment', value: balanceAdj }
          });
          await localDb.run("UPDATE fin_funds SET balance = balance + ? WHERE id = ?", [balanceAdj, tx.fundId]);
        } catch (e) {}
      }

      // 6. Update local state
      setTransactions(prev => prev.filter(t => t.id !== tx.id));
      setSuccessMsg('تم حذف السند وتحديث المبالغ والحسابات المرتبطة بنجاح');
      setTimeout(() => setSuccessMsg(null), 3000);

      setTxToDelete(null);
      await loadDatabaseData();
    } catch (err: any) {
      console.error("Delete transaction error:", err);
      setErrorMsg(err.message || 'حدث خطأ أثناء حذف السند');
    } finally {
      setIsDeletingTx(false);
    }
  };

  // DISCOUNTS LOGIC & COMPUTATIONS
  const discountedInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const disc = Number(inv.discount !== undefined ? inv.discount : (inv as any).discountAmount || 0);
      return disc > 0;
    });
  }, [invoices]);

  const filteredDiscounts = useMemo(() => {
    let list = [...discountedInvoices];

    // Status filter
    if (discountStatusFilter === 'delivered') {
      list = list.filter(inv => inv.status === '60');
    } else if (discountStatusFilter === 'pending') {
      list = list.filter(inv => inv.status !== '60');
    }

    // Search filter
    if (discountSearchTerm.trim()) {
      const term = discountSearchTerm.toLowerCase().trim();
      list = list.filter(inv => {
        const invNum = String(inv.invoiceNumber || '').toLowerCase();
        const custName = String(inv.customerName || '').toLowerCase();
        const discVal = String(inv.discount || (inv as any).discountAmount || '');
        const phone = customers.find(c => c.id === inv.customerId)?.phone1 || '';
        return invNum.includes(term) || custName.includes(term) || discVal.includes(term) || phone.includes(term);
      });
    }

    // Sort
    list.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      const discA = Number(a.discount !== undefined ? a.discount : (a as any).discountAmount || 0);
      const discB = Number(b.discount !== undefined ? b.discount : (b as any).discountAmount || 0);

      switch (discountSortConfig.key) {
        case 'amount':
          valA = discA;
          valB = discB;
          break;
        case 'invoiceNumber':
          valA = Number(String(a.invoiceNumber || '0').replace(/\D/g, '')) || 0;
          valB = Number(String(b.invoiceNumber || '0').replace(/\D/g, '')) || 0;
          break;
        case 'customer':
          valA = a.customerName || '';
          valB = b.customerName || '';
          break;
        case 'date':
        default:
          valA = (a.createdAt || (a as any).date) ? new Date(a.createdAt || (a as any).date).getTime() : 0;
          valB = (b.createdAt || (b as any).date) ? new Date(b.createdAt || (b as any).date).getTime() : 0;
          break;
      }

      if (valA < valB) return discountSortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return discountSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [discountedInvoices, discountStatusFilter, discountSearchTerm, discountSortConfig, customers]);

  const handleConfirmDeleteDiscount = async (inv: any, alsoDeleteReceipts: boolean) => {
    if (!inv) return;
    setIsDeletingDiscount(true);
    try {
      const invId = inv.id;
      const invNo = inv.invoiceNumber ? String(inv.invoiceNumber).replace('#', '').trim() : '';

      // 1. Recalculate billable total safely
      const matchingItems = items.filter(it => {
        const itNo = String(it.invoiceNumber || '').replace('#', '').trim();
        return (invNo && itNo === invNo) || (it.invoiceId && it.invoiceId === invId);
      });

      const currentDiscount = Number(inv.discount !== undefined ? inv.discount : (inv as any).discountAmount || 0);
      let newTotalCost = 0;
      if (matchingItems.length > 0) {
        try {
          newTotalCost = calculateInvoiceBillableTotal({ ...inv, discount: 0 }, matchingItems);
        } catch (calcErr) {
          console.warn("calculateInvoiceBillableTotal error, fallback:", calcErr);
          newTotalCost = Math.max(0, Number(inv.totalCost || 0) + currentDiscount);
        }
      } else {
        newTotalCost = Math.max(0, Number(inv.totalCost || 0) + currentDiscount);
      }

      // 2. Delete linked receipts if requested
      if (alsoDeleteReceipts && invNo) {
        const linkedReceipts = transactions.filter(t => {
          const tInvNo = String(t.invoiceNumber || '').replace('#', '').trim();
          return tInvNo === invNo && (t.type === 'receipt' || t.type === 'deposit');
        });

        for (const rc of linkedReceipts) {
          try {
            await handleDeleteTransaction(rc);
          } catch (rcErr) {
            console.warn("Failed to delete linked receipt:", rcErr);
          }
        }
      }

      // 3. Update invoice discount = 0 in database
      if (invId) {
        // Provider update
        try {
          await ProviderFactory.getProvider().updateDoc('invoices', invId, {
            discount: 0,
            discountAmount: 0,
            totalCost: newTotalCost,
            updatedAt: new Date().toISOString()
          });
        } catch (provErr) {
          console.warn("Provider updateDoc error:", provErr);
        }

        // Direct Firestore update
        try {
          const invDocRef = doc(db, 'invoices', invId);
          const snap = await getDoc(invDocRef);
          if (snap.exists()) {
            await updateDoc(invDocRef, {
              discount: 0,
              discountAmount: 0,
              totalCost: newTotalCost,
              updatedAt: serverTimestamp()
            });
          }
        } catch (fsErr) {
          console.warn("Firestore updateDoc error:", fsErr);
        }

        // SQLite update
        try {
          await localDb.run(
            "UPDATE invoices SET discount = 0, totalCost = ? WHERE id = ? OR invoiceNumber = ?",
            [newTotalCost, invId, invNo || invId]
          );
        } catch (sqlErr) {
          console.warn("SQLite update error:", sqlErr);
        }
      }

      // 4. Update React state immediately
      setInvoices(prev => prev.map(item => {
        const itemNo = String(item.invoiceNumber || '').replace('#', '').trim();
        if (item.id === invId || (invNo && itemNo === invNo)) {
          return { ...item, discount: 0, totalCost: newTotalCost };
        }
        return item;
      }));

      setSuccessMsg(`تم حذف الخصم بنجاح للفاتورة #${invNo || invId} وإعادة ضبط الحسابات.`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      console.error("Failed to delete discount:", err);
      setErrorMsg(err?.message || "حدث خطأ أثناء محاولة حذف الخصم");
    } finally {
      setIsDeletingDiscount(false);
      setDiscountToDelete(null);
      await loadDatabaseData(true);
    }
  };

  // Suggest filtered customer autocomplete search
  const filteredCustomers = customers.filter(c => 
    (c.name || '').toLowerCase().includes((customerSearch || '').toLowerCase()) ||
    (c.phone1 && c.phone1.includes(customerSearch))
  );

  // LEDGER CUSTOMER MATH
  const selectedLedgerCustomer = customers.find(c => c.id === ledgerCustomerId);

  // Accounting aggregates for the specific customer ledger using verified actual/repaired costs
  const totalInvoicesCost = ledgerCustomerInvoices.reduce((acc, curr) => {
    const invItems = getInvoiceItemsForInvoice(curr.invoiceNumber);
    return acc + getInvoiceActualCost(invItems, curr);
  }, 0);

  const totalInvoicesPaid = ledgerCustomerInvoices.reduce((acc, curr) => acc + Number(curr.amountPaid || 0), 0);
  const totalSeparateCollections = ledgerCustomerTransactions
    .filter(tx => tx.type === 'receipt' && (!tx.invoiceNumber || String(tx.invoiceNumber).trim() === ''))
    .reduce((acc, curr) => acc + Math.abs(Number(curr.amount || 0)), 0);

  // Net Debt calculation (Invoices cost minus paid on invoice minus general receipts collections)
  const customerUnpaidBalance = Math.max(0, totalInvoicesCost - totalInvoicesPaid - totalSeparateCollections);

  const getCustomerUnpaidBalance = (customerId: string) => {
    const custInvs = invoices.filter(inv => inv.customerId === customerId);
    const cost = custInvs.reduce((acc, curr) => {
      const invItems = items.filter(it => it.invoiceNumber === curr.invoiceNumber);
      return acc + getInvoiceActualCost(invItems, curr);
    }, 0);
    const paid = custInvs.reduce((acc, curr) => acc + Number(curr.amountPaid || 0), 0);
    
    const custTxs = transactions.filter(tx => tx.customerId === customerId);
    const collections = custTxs
      .filter(tx => tx.type === 'receipt' && (!tx.invoiceNumber || String(tx.invoiceNumber).trim() === ''))
      .reduce((acc, curr) => acc + Math.abs(Number(curr.amount || 0)), 0);
      
    return Math.max(0, cost - paid - collections);
  };

  const customerStats = React.useMemo(() => {
    const stats: any[] = [];
    customers.forEach(cust => {
      const custInvs = invoices.filter(inv => inv.customerId === cust.id);
      const custTxs = transactions.filter(tx => tx.customerId === cust.id);
      
      const currencies = Array.from(new Set([
        ...custInvs.map(inv => inv.currency || 'USD'),
        ...custTxs.map(tx => tx.currency || 'USD')
      ]));

      // If no activity at all, maybe push a default USD stat with 0?
      if (currencies.length === 0) {
        stats.push({
          customer: cust,
          currency: 'USD',
          totalInvoicesCount: 0,
          totalInvoicesCost: 0,
          totalInvoicesPaid: 0,
          unpaidBalance: 0,
          lastActivityDate: null
        });
        return;
      }

      currencies.forEach(currency => {
        const invsForCurr = custInvs.filter(inv => (inv.currency || 'USD') === currency);
        const txsForCurr = custTxs.filter(tx => (tx.currency || 'USD') === currency);
        
        if (invsForCurr.length === 0 && txsForCurr.length === 0) return;

        const custCost = invsForCurr.reduce((acc, curr) => {
          const invItems = items.filter(it => it.invoiceNumber === curr.invoiceNumber);
          return acc + getInvoiceActualCost(invItems, curr);
        }, 0);
        const custPaid = invsForCurr.reduce((acc, curr) => acc + Number(curr.amountPaid || 0), 0);
        
        const custCollections = txsForCurr
          .filter(tx => tx.type === 'receipt' && (!tx.invoiceNumber || String(tx.invoiceNumber).trim() === ''))
          .reduce((acc, curr) => acc + Math.abs(Number(curr.amount || 0)), 0);
          
        const unpaid = Math.max(0, custCost - custPaid - custCollections);
        
        let lastActivity: Date | null = null;
        invsForCurr.forEach(inv => {
          const d = parseDate(inv.createdAt) || new Date();
          if (!lastActivity || d > lastActivity) {
            lastActivity = d;
          }
        });
        txsForCurr.forEach(tx => {
          const d = parseTxDate(tx) || new Date();
          if (!lastActivity || d > lastActivity) {
            lastActivity = d;
          }
        });

        stats.push({
          customer: cust,
          currency: currency,
          totalInvoicesCount: invsForCurr.length,
          totalInvoicesCost: custCost,
          totalInvoicesPaid: custPaid + custCollections,
          unpaidBalance: unpaid,
          lastActivityDate: lastActivity
        });
      });
    });
    return stats;
  }, [customers, invoices, items, transactions]);

  const sortedCustomerStats = React.useMemo(() => {
    return [...customerStats].sort((a, b) => {
      if (a.lastActivityDate && b.lastActivityDate) {
        return b.lastActivityDate.getTime() - a.lastActivityDate.getTime();
      }
      if (a.lastActivityDate) return -1;
      if (b.lastActivityDate) return 1;
      return a.customer.name.localeCompare(b.customer.name);
    });
  }, [customerStats]);

  const filteredLedgerStats = React.useMemo(() => {
    let stats = sortedCustomerStats.filter(stat => stat.unpaidBalance > 0.01);
    if (!ledgerSearchTerm.trim()) return stats;
    const term = (ledgerSearchTerm || '').toLowerCase();
    return stats.filter(stat => 
      (stat.customer?.name || '').toLowerCase().includes(term) ||
      (stat.customer?.companyName && (stat.customer.companyName || '').toLowerCase().includes(term)) ||
      (stat.customer?.phone1 && stat.customer.phone1.includes(term))
    );
  }, [sortedCustomerStats, ledgerSearchTerm]);

  const totalLedgerListPages = Math.max(1, Math.ceil(filteredLedgerStats.length / itemsPerPage));
  const safeLedgerListPage = Math.min(ledgerListPage, totalLedgerListPages);
  const currentLedgerListStats = React.useMemo(() => {
    return filteredLedgerStats.slice((safeLedgerListPage - 1) * itemsPerPage, safeLedgerListPage * itemsPerPage);
  }, [filteredLedgerStats, safeLedgerListPage]);

  // Generate statement entries chronologically for Selected Customer inside Vault
  const getStatementEntries = (customerId: string, currency: string) => {
    const entries: {
      id: string;
      date: Date;
      type: string;
      label: string;
      reference: string;
      notes: string;
      debit: number;
      credit: number;
    }[] = [];

    // 1. Get customer invoices
    const customerInvs = invoices.filter(inv => inv.customerId === customerId && (inv.currency || 'USD') === currency);
    customerInvs.forEach(inv => {
      const invItems = items.filter(it => it.invoiceNumber === inv.invoiceNumber);
      const actualCost = getInvoiceActualCost(invItems, inv);

      const explicitType = inv.invoiceType || inv.templateType || inv.type || '';
      let invTypeTitle = 'فاتورة صيانة';
      let invLabel = 'فاتورة صيانة أجهزة فنية';
      const isPurchase = explicitType === 'purchase' || String(explicitType).startsWith('purchase') || inv.type === 'purchase' || String(inv.invoiceNumber).startsWith('PUR-') || String(inv.invoiceNumber).startsWith('DIS-');

      if (isPurchase) {
        invTypeTitle = 'فاتورة شراء';
        invLabel = inv.batchName ? `فاتورة شراء - دفعة تفكيك (${inv.batchName})` : 'فاتورة شراء قطع وملحقات';
      } else if (explicitType === 'sale_software') {
        invTypeTitle = 'فاتورة خدمات برمجية';
        invLabel = 'فاتورة مبيعات - خدمات برمجية';
      } else if (explicitType === 'sale_parts') {
        invTypeTitle = 'فاتورة بيع قطع غيار';
        invLabel = 'فاتورة مبيعات - بيع قطع غيار';
      } else if (explicitType === 'sale_maintenance') {
        invTypeTitle = 'فاتورة صيانة خارجية';
        invLabel = 'فاتورة مبيعات - صيانة خارجية';
      } else if (typeof explicitType === 'string' && explicitType.startsWith('sale_')) {
        invTypeTitle = `فاتورة مبيعات (${explicitType.replace('sale_', '')})`;
        invLabel = `فاتورة مبيعات - ${explicitType.replace('sale_', '')}`;
      } else if (inv.invoiceNumber && String(inv.invoiceNumber).startsWith('O-')) {
        invTypeTitle = 'فاتورة مبيعات قطع/خدمات';
        invLabel = 'فاتورة مبيعات أجهزة وقطع غيار';
      } else {
        invTypeTitle = 'فاتورة صيانة';
        invLabel = 'فاتورة صيانة أجهزة فنية';
      }

      const itemNotes = invItems.map(i => {
        const nameStr = i.deviceName || i.deviceType || '';
        const brandStr = i.brand ? `- ${i.brand}` : '';
        return `${nameStr} ${brandStr}`.trim();
      }).filter(Boolean).join(' | ');

      let resolvedNotes = '';
      if (inv.notes && inv.notes.trim() && inv.notes.trim() !== 'لا يوجد' && inv.notes.trim() !== invLabel) {
        const cleanInvNote = inv.notes.replace(/^فاتورة شراء (قطع وملحقات من المورد|– دفعة تفكيك [^\)]+\)):?\s*/, '').trim();
        resolvedNotes = cleanInvNote || (itemNotes || 'لا يوجد');
      } else if (itemNotes) {
        resolvedNotes = itemNotes;
      } else {
        resolvedNotes = 'لا يوجد';
      }

      entries.push({
        id: `inv-${inv.id}`,
        date: parseDate(inv.createdAt) || new Date(),
        type: invTypeTitle,
        label: invLabel,
        reference: String(inv.invoiceNumber).replace(/#/g, ''),
        notes: resolvedNotes,
        debit: isPurchase ? 0 : actualCost,
        credit: isPurchase ? actualCost : 0
      });
    });

    // 2. Get separate receipts and payments
    const customerTransactions = transactions.filter(tx => 
      tx.customerId === customerId && 
      (tx.liabilityCurrency || tx.currency || 'USD') === currency &&
      !tx.isReversed &&
      !tx.isReversal &&
      tx.status !== 'reversed' &&
      tx.status !== 'reversal'
    );
    customerTransactions.forEach(tx => {
      const txDate = parseTxDate(tx) || new Date();
      const liabilityAmount = tx.liabilityAmount || Math.abs(Number(tx.amount || 0));
      const liveInvNum = resolveLiveInvoiceNumber(tx, invoices);
      const dynamicStatement = resolveVoucherDynamicStatement(tx, invoices);
      const refStr = tx.voucherNumber ? String(tx.voucherNumber) : (liveInvNum || '0000');

      if (tx.type === 'receipt' || tx.type === 'invoice_payment') {
        entries.push({
          id: `tx-${tx.id}`,
          date: txDate,
          type: 'سند قبض',
          label: dynamicStatement,
          reference: refStr,
          notes: dynamicStatement,
          debit: 0,
          credit: liabilityAmount
        });
      } else if (tx.type === 'payment') {
        entries.push({
          id: `tx-${tx.id}`,
          date: txDate,
          type: 'سند صرف',
          label: dynamicStatement,
          reference: refStr,
          notes: dynamicStatement,
          debit: liabilityAmount,
          credit: 0
        });
      }
    });

    // 3. Sort chronologically
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 4. Filter entries that have active financial impact (debit > 0 or credit > 0)
    const activeEntries = entries.filter(e => e.debit > 0.001 || e.credit > 0.001);

    // 5. Compute running balance
    let balance = 0;
    return activeEntries.map(entry => {
      balance += entry.debit - entry.credit;
      return {
        ...entry,
        runningBalance: balance
      };
    });
  };

  const handleWhatsAppShare = async (customerId: string) => {
    const cust = customers.find(c => c.id === customerId);
    if (!cust) return;

    setIsGeneratingPDF(true);

    const originalGetComputedStyle = window.getComputedStyle;
    let tempEl: HTMLDivElement | null = null;
    let restore: (() => void) | null = null;

    try {
      const element = document.getElementById('print-area');
      if (!element) {
        setIsGeneratingPDF(false);
        return;
      }

      tempEl = document.createElement('div');
      tempEl.style.display = 'none';
      document.body.appendChild(tempEl);

      const convertToRgb = (color: string) => {
        if (!color || (!color.includes('oklch') && !color.includes('oklab'))) return color;
        try {
          if (!tempEl) return 'rgb(0, 0, 0)';
          tempEl.style.color = '';
          tempEl.style.color = color;
          const rgb = originalGetComputedStyle.call(window, tempEl).color;
          if (rgb && !rgb.includes('oklch') && !rgb.includes('oklab')) {
            return rgb;
          }
          return 'rgb(0, 0, 0)';
        } catch (e) {
          return 'rgb(0, 0, 0)';
        }
      };

      const cleanOklchString = (val: string): string => {
        if (typeof val !== 'string') return val;
        if (!val.includes('oklch') && !val.includes('oklab')) return val;
        return val.replace(/(oklch|oklab)\([^)]+\)/g, (match) => convertToRgb(match));
      };

      const customGetComputedStyle = function (elt: Element, pseudoElt?: string) {
        const style = originalGetComputedStyle.call(window, elt, pseudoElt);
        return new Proxy(style, {
          get(target, prop) {
            if (prop === 'getPropertyValue') {
              return function(propertyName: string) {
                const val = target.getPropertyValue(propertyName);
                if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab'))) {
                  return cleanOklchString(val);
                }
                return val;
              };
            }
            const val = (target as any)[prop];
            if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab'))) {
              return cleanOklchString(val);
            }
            if (typeof val === 'function') {
              return val.bind(target);
            }
            return val;
          }
        });
      } as any;

      // Apply globally
      window.getComputedStyle = customGetComputedStyle;

      restore = await sanitizeDocumentStyles();
      sanitizeElementInlineStyles(element);

      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const printDate = `${year}-${month}-${day}`;
      const filename = `كشف حساب_${cust.name}_${printDate}.pdf`;

      const pdfResult = await generateOptimizedPdfFromElement(element, {
        filename,
        pixelRatio: 1.25,
        quality: 0.74,
        backgroundColor: '#ffffff'
      });

      const pdf = pdfResult.pdf;

      // 2. Prepare PDF Base64 details & save to database folder and sqlite saved_pdfs
      let pdfBase64 = pdfResult.base64;
      if (!pdfBase64) {
        try {
          pdfBase64 = pdf.output('datauristring').split(',')[1];
        } catch (err) {
          console.error('Failed to get PDF Base64 string:', err);
        }
      }

      // Save to Capacitor filesystem folder
      try {
        await Filesystem.writeFile({
          path: `SND_App/تقارير/${filename}`,
          data: pdfBase64,
          directory: Directory.Documents,
          recursive: true
        });
        console.log('PDF file saved successfully to SND_App/تقارير directory.');
      } catch (fsError) {
        console.warn('Skipping Device Filesystem save:', fsError);
      }

      // Save to SQLite database table (saved_pdfs history log)
      try {
        // Create table dynamically in sqlite if not created
        await localDb.run(`
          CREATE TABLE IF NOT EXISTS saved_pdfs (
            id TEXT PRIMARY KEY,
            customerId TEXT,
            customerName TEXT,
            filename TEXT,
            createdAt TEXT,
            fileSize TEXT,
            fileData TEXT
          )
        `);
        const docId = `pdf_${Date.now()}`;
        const fileSize = `${Math.round(pdfBase64.length * 0.75 / 1024)} KB`;
        await localDb.run(
          `INSERT INTO saved_pdfs (id, customerId, customerName, filename, createdAt, fileSize, fileData) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [docId, customerId, cust.name, filename, new Date().toISOString(), fileSize, pdfBase64]
        );
        console.log('PDF saved to local database saved_pdfs table!');
      } catch (dbError) {
        console.warn('Failed to save to SQLite database table saved_pdfs:', dbError);
      }

      pdf.save(filename);

      // 3. Launch WhatsApp link or Native Share
      const totalCost = totalInvoicesCost;
      const totalPaid = totalInvoicesPaid + totalSeparateCollections;
      const diff = totalCost - totalPaid;
      const currency = 'USD';

      let statusText = '';
      if (diff < -0.01) {
        statusText = `رصيد دائن للعميل بفائض: ${Math.abs(diff).toLocaleString('en-US')} ${currency}`;
      } else if (diff > 0.01) {
        statusText = `متبقي عليه كديون متراكمة: ${Math.abs(diff).toLocaleString('en-US')} ${currency}`;
      } else {
        statusText = `الحساب متزن بالكامل (0.00)`;
      }

      let message = `*كشف حساب مالي رسمي وموحد (منقولات الخزينة) بصيغة PDF* 📄\n\n`;
      message += `عزيزي العميل *${cust.name}*،\n`;
      message += `تجدون أدناه الملخص المالي لحسابات الخزينة وقسم الصيانة والقيود المسجلة لدينا. كما تم تنزيل وحفظ مستند الـ PDF للتقرير في مجلد قاعدة البيانات.\n\n`;
      message += `- *الرصيد الصافي:* ${statusText}\n`;
      message += `- *إجمالي قيمة صيانة الأجهزة المقبولة:* ${totalCost.toLocaleString('en-US')} ${currency}\n`;
      message += `- *إجمالي المقبوضات والسندات:* ${totalPaid.toLocaleString('en-US')} ${currency}\n\n`;
      message += `يرجى مشاركة وإرسال كشف مستند الـ PDF المحفوظ الآن بنجاح على جهازكم.`;

      // Native Share API if supported (to attach actual PDF sheet on mobile)
      let sharedNatively = false;
      try {
        const pdfBlob = pdf.output('blob');
        sharedNatively = await sharePdfFile(pdfBlob, filename, message, 'report');
      } catch (shareErr) {
        console.warn('Native share was skipped:', shareErr);
      }

      if (!sharedNatively) {
        openWhatsApp(message, cust.phone1 || '');
      }
    } catch (e) {
      console.error('Failed to export PDF & share:', e);
    } finally {
      if (restore) restore();
      window.getComputedStyle = originalGetComputedStyle;
      if (tempEl && tempEl.parentNode) {
        tempEl.parentNode.removeChild(tempEl);
      }
      setIsGeneratingPDF(false);
    }
  };

  // --- REVENUE & EXPENSE REPORT STATISTICS ---
  const isValidTx = (tx: VaultTransaction) => isAccountingTransactionValid(tx);

  // Internal transfers and opening balances are non-operational for profit & loss calculations
  const isInternalTransfer = (tx: VaultTransaction) => 
    tx.transactionCategory === 'تحويل بين الصناديق' || 
    tx.customerName === 'تحويل داخلي' || 
    (tx.notes && tx.notes.includes('تحويل مالي بين الصناديق'));

  const isOpeningBalance = (tx: VaultTransaction) =>
    tx.transactionCategory === 'رصيد افتتاحي' ||
    (tx.notes && tx.notes.includes('رصيد افتتاحي'));

  // All active valid receipts and payments for display in tabs
  const receiptTransactions = transactions.filter(tx => (tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment') && isValidTx(tx));
  const paymentTransactions = transactions.filter(tx => (tx.type === 'payment' || tx.type === 'disbursement' || tx.type === 'expense') && isValidTx(tx));

  // Operational revenues and expenses strictly for Profit & Loss (excludes capital opening balances and internal asset transfers)
  const operationalRevenueTransactions = receiptTransactions.filter(tx => !isInternalTransfer(tx) && !isOpeningBalance(tx));
  const operationalExpenseTransactions = paymentTransactions.filter(tx => !isInternalTransfer(tx));

  // Calculates sums of values dynamically grouped by normalized currency code/symbol
  const computeCurrencyTotals = (txs: VaultTransaction[]) => {
    const sums: Record<string, number> = {};
    txs.forEach(tx => {
      const code = normalizeCurrencyCode(tx.currency || 'USD');
      sums[code] = (sums[code] || 0) + Math.abs(Number(tx.amount || 0));
    });
    return sums;
  };

  const revenueCurrencyTotals = computeCurrencyTotals(operationalRevenueTransactions);
  const expenseCurrencyTotals = computeCurrencyTotals(operationalExpenseTransactions);
  const allReceiptCurrencyTotals = computeCurrencyTotals(receiptTransactions);
  const allPaymentCurrencyTotals = computeCurrencyTotals(paymentTransactions);

  // Build unique normalized currencies checklist for calculations (eliminates duplicate USD / دولار)
  const allUsedCurrencies = Array.from(new Set([
    ...Object.keys(revenueCurrencyTotals),
    ...Object.keys(expenseCurrencyTotals),
    ...funds.map(f => normalizeCurrencyCode(f.currency)),
    ...currencies.map(c => normalizeCurrencyCode(c.id || c.name || c.symbol))
  ].filter(Boolean)));

  return (
    <div className="financial-vault-container min-h-full flex flex-col text-right pb-16 w-full" dir="rtl">
      


      {/* Notifications banner */}
      {successMsg && (
        <div className="mx-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-4 rounded-2xl flex items-center gap-2 text-xs font-cairo transition-all animate-bounce">
          <CheckCircle2 size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mx-4 bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-2xl flex items-center justify-between gap-2 text-xs font-cairo transition-all">
          <div className="flex items-center gap-2">
            <X size={18} />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-[10px] bg-white/5 px-2 py-0.5 rounded hover:bg-white/10">إخفاء</button>
        </div>
      )}

      {/* Primary Layout Wrapper */}
      <div className="flex-1 grid grid-cols-1 gap-4">

      {/* LEFT WORKSPACE CARD */}
      <div className={`${activeSegment === 'dashboard' ? 'lg:col-span-4 bg-transparent border-0 !p-0 shadow-none' : 'lg:col-span-4 bg-[#101010] border-y border-white/5 p-0'} flex flex-col overflow-y-auto`}>
          
          {/* Dashboard View */}
          {activeSegment === 'dashboard' && (
            <div className="w-full bg-[#101010] border border-white/5 rounded-[2rem] p-6 sm:p-8 my-auto shadow-2xl">
              <div>
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4 font-cairo text-right pr-1">{t('vault.treeTitle', 'شجرة النظام المالي')}</h3>
                


                <div className="space-y-3">
                   <div className="px-1 text-[11px] font-bold text-[#e5e7eb]/40 uppercase tracking-wider font-cairo text-right mb-2">{t('vault.transferSection', 'سندات التحويل المالي')}</div>
                   
                   {/* Receipt Row */}
                   <button 
                     onClick={() => { setActiveSegment('receipt'); setGlobalSearch(''); }}
                     className="w-full flex items-center justify-between p-3.5 px-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-950/20 transition-all active:scale-[0.98] group"
                   >
                     <div className="flex items-center gap-3">
                        <TrendingUp size={18} className="text-white" />
                        <span className="text-xs font-bold font-cairo leading-none">{t('vault.receiptIncoming', 'سند قبض ونقد وارد')}</span>
                     </div>
                     <span className="px-2.5 py-1 rounded-lg bg-[#000000]/20 text-[9px] font-bold text-white font-cairo">{t('vault.incoming', 'وارد')}</span>
                   </button>

                   {/* Payment Row */}
                   <button 
                     onClick={() => { setActiveSegment('payment'); setGlobalSearch(''); }}
                     className="w-full flex items-center justify-between p-3.5 px-5 bg-[#181818] hover:bg-[#202020] border border-white/5 rounded-2xl transition-all active:scale-[0.98] group"
                   >
                     <div className="flex items-center gap-3">
                        <TrendingDown size={18} className="text-amber-500" />
                        <span className="text-xs font-bold text-gray-300 font-cairo leading-none">{t('vault.paymentOutgoing', 'سند صرف ونفقات صادرة')}</span>
                     </div>
                     <span className="px-2.5 py-1 rounded-lg bg-white/5 text-[9px] font-bold text-gray-500 font-cairo">{t('vault.outgoing', 'صادر')}</span>
                   </button>

                   {/* Discounts Row */}
                   <button 
                     onClick={() => { setActiveSegment('discounts'); setGlobalSearch(''); }}
                     className="w-full flex items-center justify-between p-3.5 px-5 bg-[#181818] hover:bg-[#202020] border border-white/5 rounded-2xl transition-all active:scale-[0.98] group cursor-pointer"
                   >
                     <div className="flex items-center gap-3">
                        <Percent size={18} className="text-purple-400" />
                        <span className="text-xs font-bold text-gray-300 font-cairo leading-none">عرض الخصومات في النظام</span>
                     </div>
                     <span className="px-2.5 py-1 rounded-lg bg-purple-500/10 text-[9px] font-bold text-purple-400 font-cairo border border-purple-500/20 font-mono">
                       {discountedInvoices.length} خصم
                     </span>
                   </button>

                   {/* Transfer Row */}
                   <button 
                     onClick={() => { setActiveSegment('transfer'); setGlobalSearch(''); }}
                     className="w-full flex items-center justify-between p-3.5 px-5 bg-[#181818] hover:bg-[#202020] border border-white/5 rounded-2xl transition-all active:scale-[0.98] group"
                   >
                     <div className="flex items-center gap-3">
                        <ArrowRightLeft size={18} className="text-blue-400" />
                        <span className="text-xs font-bold text-gray-300 font-cairo leading-none">التحويل بين الصناديق</span>
                     </div>
                     <span className="px-2.5 py-1 rounded-lg bg-white/5 text-[9px] font-bold text-gray-500 font-cairo">داخلي</span>
                   </button>

                   <div className="pt-1 space-y-1">
                     <button 
                       onClick={() => setActiveSegment('funds')}
                       className="w-full flex items-center justify-between p-3 px-5 bg-transparent hover:bg-white/5 rounded-xl transition-all"
                     >
                       <div className="flex items-center gap-3">
                          <Wallet size={18} className="text-blue-500" />
                          <span className="text-xs font-bold text-gray-300 font-cairo leading-none">{t('vault.fundBalances', 'رصيد وحركات الصناديق المال')}</span>
                       </div>
                     </button>

                     <button 
                       onClick={() => setActiveSegment('customer-ledger')}
                       className="w-full flex items-center justify-between p-3 px-5 bg-transparent hover:bg-white/5 rounded-xl transition-all"
                     >
                       <div className="flex items-center gap-3">
                          <Users size={18} className="text-purple-500" />
                          <span className="text-xs font-bold text-gray-300 font-cairo leading-none">{t('vault.customersLedger', 'كشف حساب العملاء')}</span>
                       </div>
                     </button>
                   </div>
                </div>

                {/* Reports Section */}
                <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
                   <div className="px-1 text-[11px] font-bold text-[#e5e7eb]/40 uppercase tracking-wider font-cairo text-right mb-2">{t('vault.reportsSection', 'التقارير والمؤشرات المالية')}</div>
                   
                   <div className="space-y-0.5">
                      {[
                        { name: t('vault.reportRevenues', 'الإيرادات والمداخيل'), key: 'revenues' },
                        { name: t('vault.reportExpenses', 'المصروفات والمدفوعات'), key: 'expenses' },
                        { name: t('vault.reportProfits', 'الأرباح والصافي'), key: 'profits' },
                        { name: t('vault.reportFundBalances', 'أرصدة كتل الصناديق'), key: 'fund-balances' },
                        { name: t('vault.reportOutstandingDebts', 'مديونيات وحقوق معلقة'), key: 'outstanding-debts' }
                      ].map((report, idx) => (
                        <div 
                          key={idx} 
                          onClick={() => { setActiveSegment('reports'); setReportSubSegment(report.key); setErrorMsg(null); }}
                          className="flex items-center justify-between p-2.5 px-4 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer group text-right"
                        >
                          <span className="text-xs font-bold font-cairo">{report.name}</span>
                          <div className="w-1.5 h-1.5 bg-gray-700 rounded-sm group-hover:bg-amber-500 transition-all ml-1" />
                        </div>
                      ))}
                   </div>
                </div>
              </div>
            </div>
          )}

          {/* 1. RECEIPT OR PAYMENT VOUCHERS LIST VIEW */}
          {(activeSegment === 'receipt' || activeSegment === 'payment') && !showAddModal && (() => {
            const filteredVouchers = sortedTransactions
              .filter(tx => tx.type === activeSegment)
              .filter(tx => {
                if (!globalSearch) return true;
                const searchLower = (globalSearch || '').toLowerCase();
                return (tx.customerName || '').toLowerCase().includes(searchLower) || String(tx.voucherNumber || '').includes(searchLower);
              });

            return (
              <div className="space-y-5 p-4 sm:p-6 pb-48">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-bold text-white font-cairo">
                      {activeSegment === 'receipt' ? 'سندات القبض' : 'سندات الصرف'}
                    </h3>
                    <button 
                      onClick={() => {
                        setActiveSegment('dashboard');
                        resetForm();
                        onClearInitialProps?.();
                      }}
                      className="p-1.5 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                   <div className="flex items-center justify-between text-[11px] text-gray-500 font-bold px-1" dir="rtl">
                      <span>البحث المباشر:</span>
                   </div>

                   <div className="flex gap-3">
                      <div className="flex-1 relative group">
                         <Search className="absolute right-4 top-3 text-gray-600 group-focus-within:text-amber-500 transition-colors" size={16} />
                         <input 
                           type="text" 
                           placeholder="ابدأ بكتابة اسم العميل أو رقم السند..."
                           value={globalSearch}
                           onChange={(e) => setGlobalSearch(e.target.value)}
                           className="w-full bg-[#161616] border border-white/5 rounded-xl pr-11 pl-4 py-3 text-[11px] font-cairo text-white outline-none focus:border-amber-500/50 transition-all font-bold placeholder:text-gray-700"
                         />
                      </div>
                      
                      {canAdd && (
                        <button 
                           onClick={() => setShowAddModal(true)}
                           className="p-3 bg-amber-600/10 text-amber-500 border border-amber-500/20 rounded-xl hover:bg-amber-600 hover:text-white transition-all flex items-center justify-center active:scale-95"
                           title="إضافة سند جديد"
                        >
                           <Plus size={20} />
                        </button>
                      )}
                   </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1" dir="rtl">
                     <div className="flex items-center gap-2">
                        <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-xl">
                           <FileText size={16} />
                        </div>
                        <span className="text-xs font-bold text-gray-300 font-cairo">جدول جميع السندات المسجلة في النظام</span>
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full font-mono">
                           {filteredVouchers.length} سند
                        </span>
                     </div>
                     <div className="relative">
                       <button 
                         onClick={() => setShowVoucherSort(!showVoucherSort)}
                         className="p-2 bg-white/5 border border-white/5 rounded-lg text-gray-400 hover:text-white transition-all flex items-center gap-1.5"
                       >
                          <span className="text-[10px] font-bold font-cairo sm:block hidden">ترتيب وفرز</span>
                          <ArrowUpDown size={14} />
                       </button>
                       {showVoucherSort && (
                          <div className="absolute z-50 left-0 mt-2 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl p-1.5 w-48">
                            <button onClick={() => { setVoucherSortConfig({ key: 'voucherNumber', direction: 'desc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب رقم السند (الأحدث)</button>
                            <button onClick={() => { setVoucherSortConfig({ key: 'alpha', direction: 'asc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب اسم العميل (أ - ي)</button>
                            <button onClick={() => { setVoucherSortConfig({ key: 'alpha', direction: 'desc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب اسم العميل (ي - أ)</button>
                            <button onClick={() => { setVoucherSortConfig({ key: 'category', direction: 'asc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب نوع العملية</button>
                            <button onClick={() => { setVoucherSortConfig({ key: 'amount', direction: 'desc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">مبلغ السند (الأكبر)</button>
                            <button onClick={() => { setVoucherSortConfig({ key: 'amount', direction: 'asc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">مبلغ السند (الأصغر)</button>
                            <button onClick={() => { setVoucherSortConfig({ key: 'date', direction: 'desc' }); setShowVoucherSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-amber-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب التاريخ (الأحدث)</button>
                          </div>
                       )}
                     </div>
                  </div>

                  <div className="border border-white/5 rounded-2xl overflow-x-auto bg-black/10 scrollbar-thin">
                    <table className="w-full text-right text-[11px] whitespace-nowrap">
                      <thead>
                        <tr className="bg-white/5 text-gray-400 font-bold border-b border-white/5 uppercase">
                          <th className="px-4 py-3">رقم السند</th>
                          <th className="px-4 py-3">اسم العميل / الجهة</th>
                          <th className="px-4 py-3 text-center">نوع العملية</th>
                          <th className="px-4 py-3 text-center">مبلغ السند</th>
                          <th className="px-4 py-3 text-center">الحالة / عكس القيد</th>
                          <th className="px-4 py-3 text-left">التاريخ</th>
                          <th className="px-4 py-3 text-center">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredVouchers.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-12 text-gray-500 font-cairo font-bold">
                              {globalSearch ? 'لا توجد أي سندات تطابق البحث المحدد' : 'لا توجد أي سندات مسجلة في هذا القسم حتى الآن'}
                            </td>
                          </tr>
                        ) : (
                          filteredVouchers.map(tx => (
                            <tr key={tx.id} className="hover:bg-white/5 bg-[#141414] transition-all group">
                              <td className="px-4 py-3 font-mono font-bold text-amber-500">{tx.voucherNumber}</td>
                              <td className="px-4 py-3 font-bold text-gray-200">{tx.customerName}</td>
                              <td className="px-4 py-3 text-center">
                                 <span className={`px-2 py-1 rounded text-[10px] font-bold ${activeSegment === 'receipt' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                    {tx.transactionCategory || (activeSegment === 'receipt' ? 'قبض' : 'صرف')}
                                 </span>
                              </td>
                              <td className={`px-4 py-3 text-center font-bold text-xs ${activeSegment === 'receipt' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {Math.abs(tx.amount).toLocaleString('en-US')} <span className="text-[9px] opacity-70 font-sans">{tx.currency}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {tx.isReversed ? (
                                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20" title={tx.notes}>
                                    تم العكس
                                  </span>
                                ) : tx.isReversal ? (
                                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20" title={tx.notes}>
                                    قيد عكسي
                                  </span>
                                ) : (user.role === 'admin' || user.role === 'manager' || user.role === 'data_entry') ? (
                                  <button
                                    onClick={() => {
                                      console.log("Setting transaction for custom confirmation modal:", tx.id);
                                      setReversalTxToConfirm(tx);
                                    }}
                                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 hover:bg-amber-600 hover:text-white border border-amber-500/20 transition-all cursor-pointer"
                                  >
                                    عكس القيد
                                  </button>
                                ) : (
                                  <span className="text-gray-500 text-[10px] italic">سليم</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-left text-gray-500 font-mono italic">
                                {formatTxDate(tx)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => setPreviewData({ type: 'voucher', data: { voucher: tx } })}
                                    className="p-1.5 rounded-lg text-blue-400 hover:text-white hover:bg-blue-600/80 transition-all cursor-pointer bg-blue-500/10 border border-blue-500/20"
                                    title="معاينة وطباعة السند"
                                  >
                                    <Printer size={13} />
                                  </button>
                                  {(user.role === 'admin' || user.role === 'manager' || canDelete || hasPermission('delete')) && (
                                    <button
                                      onClick={() => setTxToDelete(tx)}
                                      className="p-1.5 rounded-lg text-rose-400 hover:text-white hover:bg-rose-600/80 transition-all cursor-pointer bg-rose-500/10 border border-rose-500/20"
                                      title="حذف السند المكرر أو الخاطئ نهائياً"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* End of vouchers table indicator & bottom buffer */}
                  <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-400 bg-[#141414] border border-white/5 rounded-xl px-4 py-3 font-cairo">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                      <span>إجمالي السندات المسجلة: <strong className="text-white font-mono">{filteredVouchers.length}</strong> سند</span>
                    </div>
                    <span className="text-gray-500 text-[10px]">نهاية جدول السندات المسجلة ✓</span>
                  </div>

                  {/* Guaranteed extra bottom clearance space */}
                  <div className="h-16 w-full pointer-events-none" />
                </div>
              </div>
            );
          })()}

          {/* 1.5. DISCOUNTS LIST VIEW */}
          {activeSegment === 'discounts' && (() => {
            return (
              <div className="space-y-5 p-4 sm:p-6 pb-48 font-cairo">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl">
                      <Percent size={20} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">سجل الخصومات في النظام</h3>
                      <p className="text-[11px] text-gray-400">عرض وإدارة وحذف كافة الخصومات المعتمدة على الفواتير</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setActiveSegment('dashboard')}
                    className="p-1.5 px-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <span>الرئيسية</span>
                    <ArrowRight size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative group">
                      <Search className="absolute right-4 top-3 text-gray-600 group-focus-within:text-purple-400 transition-colors" size={16} />
                      <input 
                        type="text" 
                        placeholder="البحث برقم الفاتورة، اسم العميل، قيمة الخصم، أو الهاتف..."
                        value={discountSearchTerm}
                        onChange={(e) => setDiscountSearchTerm(e.target.value)}
                        className="w-full bg-[#161616] border border-white/5 rounded-xl pr-11 pl-4 py-3 text-[11px] text-white outline-none focus:border-purple-500/50 transition-all font-bold placeholder:text-gray-700"
                      />
                    </div>

                    <div className="relative">
                      <button 
                        onClick={() => setShowDiscountSort(!showDiscountSort)}
                        className="h-full px-4 py-2.5 bg-white/5 border border-white/5 rounded-xl text-gray-300 hover:text-white transition-all flex items-center gap-2 text-xs cursor-pointer whitespace-nowrap"
                      >
                        <Filter size={15} className="text-purple-400" />
                        <span>ترتيب وفرز</span>
                        <ChevronDown size={14} className="text-gray-500" />
                      </button>
                      {showDiscountSort && (
                        <div className="absolute z-50 left-0 mt-2 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl p-1.5 w-52 text-right">
                          <button onClick={() => { setDiscountSortConfig({ key: 'date', direction: 'desc' }); setShowDiscountSort(false); }} className="w-full text-right px-3 py-1.5 text-[11px] hover:bg-purple-600 hover:text-white text-slate-300 rounded font-bold transition-colors">الأحدث تاريخاً</button>
                          <button onClick={() => { setDiscountSortConfig({ key: 'date', direction: 'asc' }); setShowDiscountSort(false); }} className="w-full text-right px-3 py-1.5 text-[11px] hover:bg-purple-600 hover:text-white text-slate-300 rounded font-bold transition-colors">الأقدم تاريخاً</button>
                          <button onClick={() => { setDiscountSortConfig({ key: 'amount', direction: 'desc' }); setShowDiscountSort(false); }} className="w-full text-right px-3 py-1.5 text-[11px] hover:bg-purple-600 hover:text-white text-slate-300 rounded font-bold transition-colors">قيمة الخصم (الأعلى)</button>
                          <button onClick={() => { setDiscountSortConfig({ key: 'amount', direction: 'asc' }); setShowDiscountSort(false); }} className="w-full text-right px-3 py-1.5 text-[11px] hover:bg-purple-600 hover:text-white text-slate-300 rounded font-bold transition-colors">قيمة الخصم (الأقل)</button>
                          <button onClick={() => { setDiscountSortConfig({ key: 'invoiceNumber', direction: 'desc' }); setShowDiscountSort(false); }} className="w-full text-right px-3 py-1.5 text-[11px] hover:bg-purple-600 hover:text-white text-slate-300 rounded font-bold transition-colors">رقم الفاتورة (تنازلي)</button>
                          <button onClick={() => { setDiscountSortConfig({ key: 'customer', direction: 'asc' }); setShowDiscountSort(false); }} className="w-full text-right px-3 py-1.5 text-[11px] hover:bg-purple-600 hover:text-white text-slate-300 rounded font-bold transition-colors">اسم العميل (أ - ي)</button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDiscountStatusFilter('all')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        discountStatusFilter === 'all'
                          ? 'bg-purple-600 text-white shadow-md shadow-purple-900/30'
                          : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      الكل ({discountedInvoices.length})
                    </button>
                    <button
                      onClick={() => setDiscountStatusFilter('delivered')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        discountStatusFilter === 'delivered'
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                          : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      فواتير مسلمة ({discountedInvoices.filter(i => i.status === '60').length})
                    </button>
                    <button
                      onClick={() => setDiscountStatusFilter('pending')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        discountStatusFilter === 'pending'
                          ? 'bg-amber-600 text-white shadow-md shadow-amber-900/30'
                          : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      فواتير قيد الصيانة / جاهزة ({discountedInvoices.filter(i => i.status !== '60').length})
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1" dir="rtl">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-300">قائمة الفواتير التي تحتوي على خصم:</span>
                      <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-0.5 rounded-full font-mono">
                        {filteredDiscounts.length} فاتورة
                      </span>
                    </div>
                  </div>

                  <div className="border border-white/5 rounded-2xl overflow-x-auto bg-black/10 scrollbar-thin">
                    <table className="w-full text-right text-[11px] whitespace-nowrap">
                      <thead>
                        <tr className="bg-white/5 text-gray-400 font-bold border-b border-white/5 uppercase">
                          <th className="px-4 py-3">رقم الفاتورة</th>
                          <th className="px-4 py-3">اسم العميل / الجهة</th>
                          <th className="px-4 py-3 text-center">مبلغ الخصم</th>
                          <th className="px-4 py-3 text-center">إجمالي الفاتورة</th>
                          <th className="px-4 py-3 text-center">حالة الفاتورة</th>
                          <th className="px-4 py-3 text-left">التاريخ</th>
                          <th className="px-4 py-3 text-center">حذف الخصم</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredDiscounts.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-12 text-gray-500 font-bold">
                              <div className="flex flex-col items-center justify-center gap-2">
                                <Percent size={32} className="text-gray-600 opacity-40" />
                                <span>لا توجد خصومات مسجلة تطابق البحث</span>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredDiscounts.map((inv) => {
                            const discVal = Number(inv.discount !== undefined ? inv.discount : (inv as any).discountAmount || 0);
                            const curr = inv.currency || 'USD';
                            const cust = customers.find(c => c.id === inv.customerId);
                            const isDelivered = inv.status === '60';

                            return (
                              <tr key={inv.id || inv.invoiceNumber} className="hover:bg-white/5 transition-colors">
                                <td className="px-4 py-3 font-mono font-bold text-amber-500">
                                  #{inv.invoiceNumber}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-col">
                                    <span className="font-bold text-white">{inv.customerName || cust?.name || 'عميل نقدي'}</span>
                                    {cust?.phone1 && (
                                      <span className="text-[10px] text-gray-500 font-mono" dir="ltr">{cust.phone1}</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="font-mono font-black text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-lg text-xs">
                                    {discVal.toLocaleString('en-US')} {curr}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center font-mono font-bold text-gray-200">
                                  {Number(inv.totalCost || 0).toLocaleString('en-US')} {curr}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {isDelivered ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      مسلّمة
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                      قيد العمل / جاهزة
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-left font-mono text-gray-500 text-[10px]" dir="ltr">
                                  {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('ar-YE') : '-'}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {(user.role === 'admin' || user.role === 'manager' || canDelete || hasPermission('delete')) && (
                                    <button
                                      onClick={() => setDiscountToDelete(inv)}
                                      className="p-1.5 px-2.5 rounded-lg text-rose-400 hover:text-white hover:bg-rose-600 transition-all cursor-pointer bg-rose-500/10 border border-rose-500/20 flex items-center gap-1 mx-auto"
                                      title="حذف الخصم نهائياً من قاعدة البيانات"
                                    >
                                      <Trash2 size={13} />
                                      <span className="text-[10px] font-bold">حذف الخصم</span>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-400 bg-[#141414] border border-white/5 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500 inline-block"></span>
                      <span>إجمالي الفواتير ذات الخصم: <strong className="text-white font-mono">{filteredDiscounts.length}</strong> فاتورة</span>
                    </div>
                    <span className="text-gray-500 text-[10px]">نهاية جدول الخصومات ✓</span>
                  </div>

                  <div className="h-16 w-full pointer-events-none" />
                </div>
              </div>
            );
          })()}

          {/* 1. RECEIPT OR PAYMENT VOUCHERS SUBMIT SEGMENTS (Now as a modal or dedicated state) */}
          {(activeSegment === 'receipt' || activeSegment === 'payment') && showAddModal && (() => {
            const currentVoucherData = {
              id: 'preview',
              voucherNumber: nextVoucherNum,
              reference: nextVoucherNum,
              type: activeSegment, // 'receipt' or 'payment'
              amount: parseFloat(voucherAmount) || 0,
              currency: selectedCurrency,
              liabilityCurrency: liabilityCurrency,
              liabilityAmount: (liabilityCurrency && liabilityCurrency !== selectedCurrency && (parseFloat(voucherExchangeRate) || 1) > 0)
                ? Math.round(((parseFloat(voucherAmount) || 0) / (parseFloat(voucherExchangeRate) || 1)) * 100) / 100
                : (parseFloat(voucherAmount) || 0),
              exchangeRate: parseFloat(voucherExchangeRate) || 1,
              customerName: customerSearch.trim() || 'جهة عامة أخرى',
              customerId: selectedCustomerId || '',
              customerPhone: customers.find(c => c.id === selectedCustomerId)?.phone1 || '',
              fundName: funds.find(f => f.id === selectedFundId)?.name || 'الصندوق الرئيسي',
              fundType: funds.find(f => f.id === selectedFundId)?.type || 'cash',
              category: selectedCategory,
              transactionCategory: selectedCategory,
              details: voucherNotes.trim() || 'لا توجد تفاصيل.',
              notes: voucherNotes.trim(),
              referenceNumber: referenceNumber.trim(),
              depositorName: depositorName.trim(),
              timestamp: new Date().toISOString(),
              date: new Date().toISOString(),
              userName: user?.name || 'المدير العام',
              userNumber: user?.userNumber || 100
            };

            return (
              <div className="space-y-6 animate-fade-in pb-48">
                {/* Standard PrintPreviewOverlay */}
                {showPrintPreview && (
                  <PrintPreviewOverlay
                    type="voucher"
                    data={{ voucher: currentVoucherData }}
                    shopConfig={shopConfig}
                    user={user}
                    onClose={() => setShowPrintPreview(false)}
                    onSave={handleSaveAndCommit}
                    onPrint={handleSaveAndPrint}
                    onWhatsApp={handleSaveAndWhatsApp}
                    isSaving={isPosting}
                  />
                )}

                <div className="space-y-4">
                  {/* Header Title */}
                  <div className="border-b border-white/5 pb-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddModal(false);
                          resetForm();
                          onClearInitialProps?.();
                        }}
                        className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 flex items-center justify-center cursor-pointer"
                        title="إلغاء والعودة للقائمة"
                      >
                        <ArrowRight size={18} />
                      </button>
                      <h3 className="text-base font-black text-white font-cairo">
                         {activeSegment === 'receipt' ? 'بناء سند قبض جديد' : 'بناء سند صرف جديد'}
                      </h3>
                    </div>
                    <div className="bg-[#141414] px-3 py-1 rounded-xl border border-white/5 flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 font-bold font-cairo">رقم السند المتوقع:</span>
                      <span className="text-sm font-mono font-black text-amber-500">{nextVoucherNum}</span>
                    </div>
                  </div>

                  
                  {/* FORM BODY - Unified Compact Layout */}
                  <div className="max-w-xl mx-auto bg-[#141414] border border-white/5 rounded-2xl p-3.5 space-y-1.5 font-cairo">
                     
                     {/* 1. الصندوق المالي */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                        <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                          الصندوق المالي:
                        </label>
                        <select 
                          value={selectedFundId}
                          onFocus={handleInputFocus} onChange={(e) => setSelectedFundId(e.target.value)}
                          className="flex-1 max-w-xs bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none focus:border-amber-500/50 text-right appearance-none font-semibold"
                          required
                        >
                           <option value="" className="bg-[#1c1c1c]">-- اختر الصندوق --</option>
                           {funds.map(f => {
                             const mCur = currencies.find(c => c.name === f.currency);
                             const curSym = mCur ? mCur.symbol : f.currency;
                             const typeStr = f.type === 'cash' ? 'نقدي' : 'بنكي';
                             return (
                               <option key={f.id} value={f.id} className="bg-[#1c1c1c]">
                                 {`${f.name} / ${curSym} / ${typeStr}`}
                               </option>
                             );
                           })}
                        </select>
                     </div>

                     {/* 2. نوع العملية */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                        <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                          نوع العملية:
                        </label>
                        <select 
                          value={selectedCategory}
                          onFocus={handleInputFocus} onChange={(e) => setSelectedCategory(e.target.value)}
                          className="flex-1 max-w-xs bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none focus:border-amber-500/50 appearance-none text-right font-semibold"
                          required
                        >
                           {txTypes
                             .filter(cat => cat.type === activeSegment)
                             .map(cat => (
                               <option key={cat.id} value={cat.name} className="bg-[#1c1c1c]">{cat.name}</option>
                             ))
                           }
                        </select>
                     </div>

                     {/* 3. اسم العميل */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                        <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                          اسم العميل / المستفيد:
                        </label>
                        <div className="flex-1 max-w-xs relative bg-transparent text-right">
                           <div className="flex gap-1">
                             <input 
                               type="text"
                               placeholder="ابحث بالحرف أو اختر من السهم..."
                               value={customerSearch}
                               onChange={(e) => {
                                  setCustomerSearch(e.target.value);
                                  setSelectedCustomerId('');
                                  setShowCustomerDropdown(true);
                               }}
                               onFocus={(e) => { setShowCustomerDropdown(true); handleInputFocus(e); }}
                               className="flex-1 bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none focus:border-amber-500/50"
                             />
                             <button 
                               type="button"
                               onClick={() => setShowCustomerDropdown(!showCustomerDropdown)}
                               className="px-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 border border-white/5"
                             >
                               <ArrowUpDown size={14} />
                             </button>
                           </div>

                           {/* Combobox Dropdown */}
                           {showCustomerDropdown && (
                              <div className="absolute top-full right-0 w-full mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden z-30 shadow-2xl max-h-40 overflow-y-auto">
                                {customers
                                  .filter(c => 
                                    !customerSearch || 
                                    (c.name || '').toLowerCase().includes((customerSearch || '').toLowerCase()) ||
                                    (c.phone1 && c.phone1.includes(customerSearch))
                                  )
                                  .map(c => (
                                    <button 
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                         setCustomerSearch(c.name);
                                         setSelectedCustomerId(c.id);
                                         setLiabilityCurrency(c.liabilityCurrency || 'USD');
                                         setShowCustomerDropdown(false);
                                      }}
                                      className="w-full text-right px-3 py-2 text-[10px] text-gray-300 hover:bg-amber-600/20 hover:text-white transition-all font-cairo border-b border-white/5 last:border-0"
                                    >
                                      {c.name} {c.companyName ? `(${c.companyName})` : ''}
                                    </button>
                                  ))}
                                  {customers.filter(c => !customerSearch || (c.name || '').toLowerCase().includes((customerSearch || '').toLowerCase())).length === 0 && (
                                     <div className="p-3 text-center text-xs text-gray-650">لا توجد نتائج مسبقة، السند سيسجل باسم جديد</div>
                                  )}
                              </div>
                           )}
                        </div>
                     </div>

                     {/* 4. عملة الذمة */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                        <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                          عملة الذمة (الحساب):
                        </label>
                        <select 
                          value={liabilityCurrency}
                          disabled={true}
                          className="flex-1 max-w-xs bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none text-right appearance-none font-semibold opacity-70 cursor-not-allowed pointer-events-none"
                          required
                        >
                           {currencies.map(c => (
                             <option key={c.id} value={c.name} className="bg-[#1c1c1c]">
                               {`${c.name} - ${c.symbol}`}
                             </option>
                           ))}
                        </select>
                     </div>

                     {/* 5. المبلغ المدفوع الحالي */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                        <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                          المبلغ المدفوع الحالي:
                        </label>
                        <div className="flex-1 max-w-xs relative text-right">
                           <input 
                             type="text"
                             inputMode="decimal"
                             dir="ltr"
                             lang="en"
                             onFocus={e => { e.target.select(); handleInputFocus(e); }}
                             placeholder="0.00"
                             value={voucherAmount}
                             onChange={(e) => {
                               const val = e.target.value.replace(/[^0-9.]/g, '');
                               const parts = val.split('.');
                               if (parts.length > 2) return;
                               setVoucherAmount(val);
                             }}
                             className="w-full bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-emerald-400 font-bold font-mono outline-none focus:border-amber-500/50 placeholder:text-gray-800 text-left"
                             required
                           />
                           {selectedCurrency && (
                             <span className="absolute right-3 top-1 text-[9px] text-gray-500 font-bold">{selectedCurrency}</span>
                           )}
                        </div>
                     </div>

                     {/* 6. صرف الدفع + 7. المبلغ المسدد */}
                     <div className="flex flex-col gap-2 py-2 border-b border-white/5">
                       <div className="grid grid-cols-2 gap-2">
                         <div>
                           <label className="block text-[9px] text-gray-400 font-bold mb-1 font-cairo text-center">
                             صرف الدفع
                           </label>
                           <input
                             type="text"
                             inputMode="decimal"
                             dir="ltr"
                             lang="en"
                             value={selectedCurrency === liabilityCurrency ? '1' : voucherExchangeRate}
                             disabled={selectedCurrency === liabilityCurrency || !selectedCurrency || !liabilityCurrency}
                             onFocus={e => e.target.select()}
                             onChange={(e) => {
                               const val = e.target.value.replace(/[^0-9.]/g, '');
                               const parts = val.split('.');
                               if (parts.length > 2) return;
                               setVoucherExchangeRate(val);
                             }}
                             className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-2 py-1 text-xs font-bold font-mono focus:outline-none focus:border-blue-500 text-center text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                             placeholder="1.00"
                           />
                         </div>
                         <div>
                           <label className="block text-[9px] text-blue-400 font-bold mb-1 font-cairo text-center">
                             المبلغ المسدد بالذمة
                           </label>
                           <div className="w-full h-9 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center text-center font-mono text-xs font-black text-blue-300" dir="ltr">
                             {(() => {
                               if (selectedCurrency === liabilityCurrency) return (parseFloat(voucherAmount) || 0).toFixed(2);
                               const rate = parseFloat(voucherExchangeRate) || 1;
                               return rate > 0 ? ((parseFloat(voucherAmount) || 0) / rate).toFixed(2) : '0.00';
                             })()}
                           </div>
                         </div>
                       </div>
                     </div>

                     {/* Bank specific fields */}
                     {(() => {
                        const matchedFund = funds.find(f => f.id === selectedFundId);
                        if (matchedFund && matchedFund.type !== 'cash') {
                          return (
                            <>
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                                 <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                                   اسم المودع الشخصي:
                                 </label>
                                 <input 
                                   type="text"
                                   placeholder="أدخل اسم مودع المبلغ بالكامل..."
                                   value={depositorName}
                                   onFocus={handleInputFocus} onChange={(e) => setDepositorName(e.target.value)}
                                   className="flex-1 max-w-xs bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none focus:border-amber-500/50"
                                   required
                                 />
                              </div>
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1 border-b border-white/5">
                                 <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                                   رقم المرجع البنكي:
                                 </label>
                                 <input 
                                   type="text"
                                   placeholder="أدخل رقم المرجع أو الشيك..."
                                   value={referenceNumber}
                                   onFocus={handleInputFocus} onChange={(e) => setReferenceNumber(e.target.value)}
                                   className="flex-1 max-w-xs bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none focus:border-amber-500/50 font-mono text-left"
                                   required
                                 />
                              </div>
                            </>
                          );
                        }
                        return null;
                     })()}

                     {/* 10. ملاحظات السند */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 py-1">
                        <label className="text-[11px] font-bold text-gray-400 min-w-[120px]">
                          البيان والملاحظات:
                        </label>
                        <input 
                          type="text"
                          placeholder="أدخل ملاحظات السند..."
                          value={voucherNotes}
                          onFocus={handleInputFocus} onChange={(e) => setVoucherNotes(e.target.value)}
                          className="flex-1 max-w-xs bg-black/40 border border-white/5 rounded-xl px-3 py-1 text-xs text-white outline-none focus:border-amber-500/50"
                        />
                     </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pt-4 border-t border-white/5 max-w-xl mx-auto gap-3">
                     <button 
                        onClick={() => {
                          setShowAddModal(false);
                          resetForm();
                          onClearInitialProps?.();
                        }}
                        className="p-2.5 bg-white/5 hover:bg-red-500/10 text-gray-400 hover:text-red-500 rounded-xl transition-all active:scale-95 border border-white/5 flex items-center justify-center gap-2 w-full sm:w-auto cursor-pointer"
                        title="رجوع وإلغاء"
                     >
                        <ArrowRight size={20} className="sm:block hidden" />
                        <span className="sm:hidden font-bold font-cairo text-xs">رجوع وإلغاء</span>
                     </button>
                     
                     <button 
                       onClick={() => setShowPrintPreview(true)}
                       disabled={!isFormValid()}
                       className={`flex items-center justify-center gap-1.5 px-8 py-2.5 rounded-xl font-bold font-cairo text-xs text-white transition-all shadow-md active:scale-95 w-full sm:w-auto cursor-pointer ${!isFormValid() ? 'bg-gray-700 cursor-not-allowed opacity-50' : 'bg-amber-600 hover:bg-amber-500 text-black font-black'}`}
                     >
                        <Eye size={14} />
                        إجراء معاينة للمراجعة
                     </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TRANSFER FUNDS VIEW */}
          {activeSegment === 'transfer' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
                    <ArrowRightLeft size={18} />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white font-cairo leading-none">التحويل بين الصناديق</h2>
                    <p className="text-[10px] text-gray-400 font-cairo mt-1">نقل الأموال بين الصناديق المختلفة بنفس العملة</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handlePostTransfer} className="bg-[#141414] border border-white/5 rounded-2xl p-4 sm:p-5">
                <div className="max-w-xl mx-auto space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Source Fund */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-400 font-cairo flex items-center gap-1.5">
                        <Wallet size={12} className="text-rose-400" />
                        الصندوق المُحول منه (الرصيد يقل)
                      </label>
                      <select
                        value={transferSourceFundId}
                        onChange={(e) => setTransferSourceFundId(e.target.value)}
                        className="w-full bg-[#101010] border border-white/10 rounded-xl px-3 py-2 text-[11px] font-cairo text-white focus:border-blue-500/50 outline-none transition-all"
                        required
                      >
                        <option value="" disabled className="text-gray-600">اختر الصندوق المصدر...</option>
                        {funds.filter(f => f.status === 'active').map(f => (
                          <option key={f.id} value={f.id} className="bg-[#1c1c1c]">{f.name} ({f.currency}) - الرصيد: {parseFundBalance(f.balance).toLocaleString('en-US')}</option>
                        ))}
                      </select>
                    </div>

                    {/* Destination Fund */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-400 font-cairo flex items-center gap-1.5">
                        <Wallet size={12} className="text-emerald-400" />
                        الصندوق المُحول إليه (الرصيد يزداد)
                      </label>
                      <select
                        value={transferDestFundId}
                        onChange={(e) => setTransferDestFundId(e.target.value)}
                        className="w-full bg-[#101010] border border-white/10 rounded-xl px-3 py-2 text-[11px] font-cairo text-white focus:border-blue-500/50 outline-none transition-all"
                        required
                      >
                        <option value="" disabled className="text-gray-600">اختر الصندوق الوجهة...</option>
                        {funds.filter(f => f.status === 'active').map(f => (
                          <option key={f.id} value={f.id} className="bg-[#1c1c1c]">{f.name} ({f.currency}) - الرصيد: {parseFundBalance(f.balance).toLocaleString('en-US')}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-400 font-cairo">المبلغ المراد تحويله</label>
                    <div className="relative">
                      <input 
                        type="number"
                        min="0.01"
                        step="0.01"
                        dir="ltr"
                        lang="en"
                        onFocus={e => { e.target.select(); handleInputFocus(e); }}
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-[#101010] border border-white/10 rounded-xl px-3 py-2 text-base font-mono font-bold text-blue-400 focus:border-blue-500/50 outline-none transition-all text-center"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 py-2 border-t border-white/5 mt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] text-gray-400 font-bold mb-1 font-cairo text-center">
                          صرف التحويل
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          lang="en"
                          value={(() => {
                            const src = funds.find(f => f.id === transferSourceFundId);
                            const dest = funds.find(f => f.id === transferDestFundId);
                            return (src && dest && src.currency === dest.currency) ? '1' : transferExchangeRate;
                          })()}
                          disabled={(() => {
                            const src = funds.find(f => f.id === transferSourceFundId);
                            const dest = funds.find(f => f.id === transferDestFundId);
                            return !src || !dest || src.currency === dest.currency;
                          })()}
                          onFocus={e => e.target.select()}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            const parts = val.split('.');
                            if (parts.length > 2) return;
                            setTransferExchangeRate(val);
                          }}
                          className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-2 py-1 text-xs font-bold font-mono focus:outline-none focus:border-blue-500 text-center text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          placeholder="1.00"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-blue-400 font-bold mb-1 font-cairo text-center">
                          المعادل بالوجهة
                        </label>
                        <div className="w-full h-9 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center text-center font-mono text-xs font-black text-blue-300" dir="ltr">
                          {(() => {
                            const src = funds.find(f => f.id === transferSourceFundId);
                            const dest = funds.find(f => f.id === transferDestFundId);
                            if (src && dest && src.currency === dest.currency) return (parseFloat(transferAmount) || 0).toFixed(2);
                            const rate = parseFloat(transferExchangeRate) || 1;
                            return rate > 0 ? ((parseFloat(transferAmount) || 0) / rate).toFixed(2) : '0.00';
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-400 font-cairo flex items-center gap-1.5">
                      <FileText size={12} />
                      البيان / ملاحظات التحويل
                    </label>
                    <textarea 
                      value={transferNotes}
                      onChange={(e) => setTransferNotes(e.target.value)}
                      placeholder="أدخل سبب أو ملاحظات التحويل (اختياري)..."
                      className="w-full bg-[#101010] border border-white/10 rounded-xl px-3 py-2 text-[11px] font-cairo text-white focus:border-blue-500/50 outline-none transition-all resize-none h-16"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end">
                    <button 
                      type="submit"
                      disabled={isPosting || !transferSourceFundId || !transferDestFundId || !transferAmount || parseFloat(transferAmount) <= 0}
                      className="flex items-center gap-1.5 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold font-cairo transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                    >
                      {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      تنفيذ التحويل المالي
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* 2. BOX FUNDS REAL-TIME OVERLAY */}
          {activeSegment === 'funds' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setActiveSegment('dashboard')}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all ml-2"
                  >
                    <ArrowRight size={20} />
                  </button>
                  <div>
                    <h3 className="text-xl font-black text-white font-cairo flex items-center gap-2">
                      <Wallet className="text-blue-400" size={22} />
                      أرصدة وحركات الصناديق المالية
                    </h3>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <div className="relative group flex-1 sm:flex-none sm:w-56">
                    <Search className="absolute right-3 top-2.5 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={16} />
                    <input 
                      type="text" 
                      placeholder="بحث في الصناديق..."
                      value={globalSearch}
                      onChange={(e) => setGlobalSearch(e.target.value)}
                      className="w-full bg-[#181818] border border-white/5 rounded-xl pr-10 pl-4 py-2 text-xs font-cairo text-white outline-none focus:border-blue-500/50 transition-all"
                    />
                  </div>

                  {/* Sync from Cloud Button */}
                  <button 
                    onClick={handleForcePullFromCloud}
                    disabled={isSyncingFunds}
                    className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 hover:text-white border border-purple-500/30 rounded-xl transition-all text-xs font-bold font-cairo flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                    title="سحب وتحديث أرصدة الصناديق والقيد من السحابة"
                  >
                    {isSyncingFunds ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
                    <span className="hidden sm:inline">سحب من السحابة</span>
                  </button>

                  {/* Recalculate and Reconcile Button */}
                  <button 
                    onClick={handleRecalculateFunds}
                    disabled={isSyncingFunds}
                    className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 hover:text-white border border-emerald-500/30 rounded-xl transition-all text-xs font-bold font-cairo flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                    title="موازنة وإعادة احتساب الأرصدة مع القيود"
                  >
                    {isSyncingFunds ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    <span className="hidden sm:inline">إعادة احتساب الأرصدة</span>
                  </button>

                  {/* Add New Fund / Movement Button */}
                  <button 
                    onClick={() => {
                        setActiveSegment('receipt');
                        setShowAddModal(true);
                    }}
                    className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-95"
                    title="إضافة حركة نقدية جديدة"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {funds.map((fund) => {
                  const fundTxs = transactions.filter(t => (t.fundId === fund.id || (!t.fundId && t.fundName === fund.name)) && isAccountingTransactionValid(t));
                  const inSum = fundTxs.filter(t => t.type === 'receipt' || t.type === 'deposit' || t.type === 'invoice_payment').reduce((acc, curr) => {
                    const rawAmt = curr.receiptAmount !== undefined && curr.receiptAmount !== null && curr.receiptAmount !== '' ? Number(curr.receiptAmount) : Number(curr.amount || 0);
                    return acc + Math.abs(isNaN(rawAmt) ? 0 : rawAmt);
                  }, 0);
                  const outSum = fundTxs.filter(t => t.type === 'payment' || t.type === 'disbursement' || t.type === 'expense').reduce((acc, curr) => {
                    const rawAmt = curr.receiptAmount !== undefined && curr.receiptAmount !== null && curr.receiptAmount !== '' ? Number(curr.receiptAmount) : Number(curr.amount || 0);
                    return acc + Math.abs(isNaN(rawAmt) ? 0 : rawAmt);
                  }, 0);

                  return (
                    <div key={fund.id} className="bg-[#181818] border border-white/5 rounded-2xl p-5 flex flex-col justify-between gap-4 hover:border-blue-500/30 transition-all group">
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-black text-white font-cairo">{fund.name}</h4>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black ${fund.type === 'cash' ? 'bg-amber-500/15 text-amber-500' : 'bg-blue-500/15 text-blue-400'}`}>
                            {fund.type === 'cash' ? 'نقدي' : 'بنك'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 font-cairo mt-1">{fund.description || 'لا يوجد وصف للمجمع التلقائي للمال.'}</p>
                      </div>

                      <div className="bg-[#121212] p-3 rounded-xl border border-white/5 grid grid-cols-2 gap-2 text-center">
                        <div>
                          <p className="text-[9px] text-gray-500 font-cairo leading-none">مجموع الواردات</p>
                          <p className="font-mono text-xs font-bold text-green-400 mt-1">+{inSum.toLocaleString('en-US')}</p>
                        </div>
                        <div className="border-r border-white/5">
                          <p className="text-[9px] text-gray-500 font-cairo leading-none">مجموع النفقات</p>
                          <p className="font-mono text-xs font-bold text-red-500 mt-1">-{outSum.toLocaleString('en-US')}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-white/5 pt-3">
                        <span className="text-xs text-gray-400 font-cairo">متوفر حالياً بالصندوق:</span>
                        <span className="font-mono text-lg font-black text-emerald-400">
                          {parseFundBalance(fund.balance).toLocaleString('en-US')} <span className="text-[11px] font-sans text-gray-500">{fund.currency}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2 border-t border-white/5 pt-3">
                        <button
                          type="button"
                          onClick={() => setSelectedFundForReport(fund)}
                          className="flex-1 py-2 px-3 bg-blue-600/15 hover:bg-blue-600/30 text-blue-400 hover:text-white border border-blue-500/20 rounded-xl text-xs font-bold font-cairo transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <FileText size={14} />
                          <span>كشف حساب الصندوق</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickPrintFund(fund)}
                          className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl border border-white/5 transition-all cursor-pointer"
                          title="طباعة كشف حركات الصندوق A4"
                        >
                          <Printer size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Fund Movements Table below boxes */}
              <div className="mt-8 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-xs font-black text-white uppercase tracking-widest font-cairo mr-1 flex items-center gap-1.5">
                      <FileText size={15} className="text-blue-400" />
                      سجل حركات وسندات الصناديق والقيود
                    </h4>
                    <span className="px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] font-mono text-blue-300 font-bold">
                      {filteredVaultTransactions.length} قيد معروض
                    </span>
                    {filteredVaultTransactions.length !== sortedTransactions.length && (
                      <span className="text-[10px] text-gray-500 font-cairo">
                        (من إجمالي {sortedTransactions.length})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    {/* Fund filter */}
                    <select
                      value={fundMovementSelectedFund}
                      onChange={(e) => setFundMovementSelectedFund(e.target.value)}
                      className="bg-[#1a1a1a] border border-white/10 text-white text-xs px-2.5 py-1.5 rounded-lg font-cairo outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="all">كل الصناديق</option>
                      {funds.map(f => (
                        <option key={f.id} value={f.id}>{f.name} ({f.currency})</option>
                      ))}
                    </select>

                    {/* Type filter */}
                    <select
                      value={fundMovementSelectedType}
                      onChange={(e) => setFundMovementSelectedType(e.target.value)}
                      className="bg-[#1a1a1a] border border-white/10 text-white text-xs px-2.5 py-1.5 rounded-lg font-cairo outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="all">كل الحركات والقيود</option>
                      <option value="receipt">سندات القبض (وارد)</option>
                      <option value="payment">سندات الصرف (صادر)</option>
                      <option value="transfer">التحويل بين الصناديق</option>
                      <option value="reversed">القيود المعكوسة/الملغاة</option>
                    </select>

                    {/* Status filter (Active vs Reversed) */}
                    <select
                      value={fundMovementShowReversed}
                      onChange={(e) => setFundMovementShowReversed(e.target.value as any)}
                      className="bg-[#1a1a1a] border border-white/10 text-white text-xs px-2.5 py-1.5 rounded-lg font-cairo outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="active">السندات النشطة فقط</option>
                      <option value="all">عرض الكل (نشطة وملغاة)</option>
                      <option value="reversed">المعكوسة والملغاة فقط</option>
                    </select>

                    {/* Reset Filters button if any filter is active */}
                    {(fundMovementSelectedFund !== 'all' || fundMovementSelectedType !== 'all' || fundMovementShowReversed !== 'active' || globalSearch) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFundMovementSelectedFund('all');
                          setFundMovementSelectedType('all');
                          setFundMovementShowReversed('active');
                          setGlobalSearch('');
                        }}
                        className="p-1.5 px-2 bg-rose-600/15 hover:bg-rose-600/25 text-rose-400 border border-rose-500/20 rounded-lg transition-all text-xs font-bold font-cairo flex items-center gap-1 cursor-pointer"
                        title="إعادة ضبط الفلاتر وإظهار كافة السندات"
                      >
                        <X size={13} />
                        <span className="hidden lg:inline text-[10px]">إظهار الكل</span>
                      </button>
                    )}

                    {/* Print table button */}
                    <button
                      type="button"
                      onClick={handlePrintFundMovementsTable}
                      className="p-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-white border border-blue-500/30 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold font-cairo cursor-pointer"
                      title="طباعة سجل الحركات A4"
                    >
                      <Printer size={14} />
                      <span className="hidden md:inline">طباعة</span>
                    </button>

                    {/* Export CSV button */}
                    <button
                      type="button"
                      onClick={handleExportFundMovementsCSV}
                      className="p-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-white border border-emerald-500/30 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold font-cairo cursor-pointer"
                      title="تصدير إلى Excel (CSV)"
                    >
                      <Download size={14} />
                      <span className="hidden md:inline">تصدير CSV</span>
                    </button>

                    {/* Sort button */}
                    <div className="relative">
                      <button 
                        onClick={() => setShowFundTxSort(!showFundTxSort)}
                        className="p-2 bg-white/5 border border-white/5 rounded-lg text-gray-400 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                         <span className="text-[10px] font-bold font-cairo sm:block hidden">ترتيب</span>
                         <ArrowUpDown size={14} />
                      </button>
                      {showFundTxSort && (
                         <div className="absolute z-50 left-0 mt-2 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl p-1.5 w-48">
                           <button onClick={() => { setVoucherSortConfig({ key: 'date', direction: 'desc' }); setShowFundTxSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-blue-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب التاريخ (الأحدث)</button>
                           <button onClick={() => { setVoucherSortConfig({ key: 'alpha', direction: 'asc' }); setShowFundTxSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-blue-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب الصندوق (أ - ي)</button>
                           <button onClick={() => { setVoucherSortConfig({ key: 'alpha', direction: 'desc' }); setShowFundTxSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-blue-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب الصندوق (ي - أ)</button>
                           <button onClick={() => { setVoucherSortConfig({ key: 'category', direction: 'asc' }); setShowFundTxSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-blue-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب نوع الحركة</button>
                           <button onClick={() => { setVoucherSortConfig({ key: 'amount', direction: 'desc' }); setShowFundTxSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-blue-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">المبلغ (الأكبر)</button>
                           <button onClick={() => { setVoucherSortConfig({ key: 'amount', direction: 'asc' }); setShowFundTxSort(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-blue-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">المبلغ (الأصغر)</button>
                         </div>
                      )}
                    </div>
                  </div>
                </div>

                {filteredVaultTransactions.length === 0 ? (
                  <div className="border border-white/5 rounded-2xl p-8 text-center bg-black/20 space-y-3">
                    <FileText size={36} className="mx-auto text-gray-600 opacity-60" />
                    <p className="text-xs font-bold text-gray-400 font-cairo">لا توجد حركات أو سندات مطابقة لمعايير الفلترة الحالية</p>
                    <button
                      type="button"
                      onClick={() => {
                        setFundMovementSelectedFund('all');
                        setFundMovementSelectedType('all');
                        setFundMovementShowReversed('all');
                        setGlobalSearch('');
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold font-cairo transition-all cursor-pointer shadow-lg shadow-blue-600/20"
                    >
                      إظهار كافة السندات والقيود بدون فلتر ({sortedTransactions.length} قيد)
                    </button>
                  </div>
                ) : (
                  <div className="border border-white/5 rounded-2xl overflow-auto bg-black/20 max-h-[32rem] scrollbar-thin">
                    <table className="w-full text-right text-[11px] whitespace-nowrap min-w-[720px] table-auto">
                      <thead>
                        <tr className="bg-white/5 text-gray-300 font-bold border-b border-white/5 font-cairo">
                          <th className="px-2.5 py-3 text-center w-14 sm:w-16 shrink-0">رقم السند</th>
                          <th className="px-2.5 py-3 text-center w-28 sm:w-32 shrink-0">التاريخ والوقت</th>
                          <th className="px-2.5 py-3 w-24 sm:w-28 shrink-0">الصندوق</th>
                          <th className="px-3.5 py-3 min-w-[200px] w-full">البيان والتفاصيل</th>
                          <th className="px-2.5 py-3 text-center text-emerald-400 w-20 sm:w-24 shrink-0">مدين (وارد)</th>
                          <th className="px-2.5 py-3 text-center text-rose-400 w-20 sm:w-24 shrink-0">دائن (منصرف)</th>
                          <th className="px-3 py-3 text-left w-24 sm:w-28 shrink-0">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-cairo">
                        {currentVaultTransactions.map(tx => {
                          const isReceipt = tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'invoice_payment' || (tx.type as string) === 'inflow';
                          const amount = Math.abs(Number(tx.amount || 0));
                          const debit = isReceipt ? amount : 0;
                          const credit = !isReceipt ? amount : 0;
                          const isRev = tx.isReversed === 1 || tx.isReversed === true || tx.isReversed === '1' ||
                                        tx.isReversal === 1 || tx.isReversal === true || tx.isReversal === '1' ||
                                        (tx.status || '').toLowerCase().trim() === 'reversed' ||
                                        (tx.status || '').toLowerCase().trim() === 'reversal';

                          return (
                            <tr key={tx.id} className={`hover:bg-white/5 transition-colors ${isRev ? 'opacity-60 bg-red-950/10' : 'bg-[#141414]'}`}>
                              <td className="px-2.5 py-2.5 font-mono font-bold text-amber-500 text-center whitespace-nowrap">
                                {tx.voucherNumber ? `#${tx.voucherNumber}` : '-'}
                              </td>
                              <td className="px-2.5 py-2.5 text-gray-400 font-mono text-[10px] text-center whitespace-nowrap">
                                {formatTxDate(tx)}
                              </td>
                              <td className="px-2.5 py-2.5 font-bold text-gray-300 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px]">
                                  {getFundDisplayName(tx)}
                                </span>
                              </td>
                              <td className="px-3.5 py-2.5 whitespace-normal">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-bold text-white text-xs leading-tight">
                                    {formatFundTxDetails(tx)}
                                  </span>
                                  {tx.userName && (
                                    <span className="text-[9px] text-gray-500">
                                      بواسطة: {tx.userName}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2.5 py-2.5 text-center font-mono font-bold text-emerald-400 whitespace-nowrap">
                                {debit > 0 ? debit.toLocaleString('en-US') : <span className="text-gray-600 font-normal">-</span>}
                              </td>
                              <td className="px-2.5 py-2.5 text-center font-mono font-bold text-rose-400 whitespace-nowrap">
                                {credit > 0 ? credit.toLocaleString('en-US') : <span className="text-gray-600 font-normal">-</span>}
                              </td>
                              <td className="px-3 py-2.5 text-left font-mono font-black text-white whitespace-nowrap">
                                <span>{amount.toLocaleString('en-US')}</span>
                                <span className="text-[11px] text-gray-400 font-cairo mr-1 font-semibold">{getCurrencySymbol(tx.currency)}</span>
                                {isRev && (
                                  <span className="mr-1.5 px-1.5 py-0.5 rounded text-[9px] bg-rose-500/20 text-rose-400 font-bold">ملغي</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination Controls */}
                {totalVaultPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-black/10 rounded-xl">
                    <span className="text-[10px] text-gray-500 font-bold font-cairo">
                      عرض {((safeVaultCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeVaultCurrentPage * itemsPerPage, filteredVaultTransactions.length)} من أصل {filteredVaultTransactions.length} حركة
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={safeVaultCurrentPage === 1}
                        className="p-1.5 rounded-lg bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <ArrowLeft size={14} className="rotate-180" />
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalVaultPages, p + 1))}
                        disabled={safeVaultCurrentPage === totalVaultPages}
                        className="p-1.5 rounded-lg bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <ArrowLeft size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. CLIENT STATEMENT LEDGERS */}
          {activeSegment === 'customer-ledger' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setActiveSegment('dashboard')}
                    className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all ml-2 cursor-pointer active:scale-95"
                  >
                    <ArrowRight size={20} />
                  </button>
                  <div>
                    <h3 className="text-xl font-black text-white font-cairo flex items-center gap-2">
                      <Users className="text-purple-400" size={22} />
                      كشف حسابات العملاء والديون
                    </h3>
                    <p className="text-[10px] sm:text-xs text-gray-400 font-cairo mt-0.5">مراقبة كشوفات الحسابات الشاملة وتحصيل الديون المترتبة على العملاء.</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 relative">
                  <div className="relative group flex-1 sm:flex-none sm:w-96">
                    <Search className="absolute right-3 top-2.5 text-gray-500 group-focus-within:text-purple-500 transition-colors" size={16} />
                    <input 
                      type="text" 
                      placeholder="ابحث باسم العميل أو الشركة أو الهاتف..."
                      value={ledgerSearchTerm}
                      onChange={(e) => {
                        setLedgerSearchTerm(e.target.value);
                        setLedgerListPage(1); // Reset page on search
                      }}
                      className="w-full bg-[#181818] border border-white/5 rounded-xl pr-10 pl-4 py-2 text-xs font-cairo text-white outline-none focus:border-purple-500/50 transition-all font-bold"
                    />

                    {/* Auto-suggest Autocomplete Dropdown */}
                    {ledgerSearchTerm.trim() !== '' && (
                      <div className="absolute right-0 left-0 mt-2 bg-[#121212] border border-white/10 rounded-2xl shadow-2xl z-[90] max-h-64 overflow-y-auto divide-y divide-white/5 font-cairo">
                        {customers
                          .filter(c => 
                            (c.name || '').toLowerCase().includes((ledgerSearchTerm || '').toLowerCase()) || 
                            (c.companyName && (c.companyName || '').toLowerCase().includes((ledgerSearchTerm || '').toLowerCase())) || 
                            (c.phone1 && c.phone1.includes(ledgerSearchTerm))
                          )
                          .slice(0, 8)
                          .map(cust => {
                            const unpaid = getCustomerUnpaidBalance(cust.id);
                            return (
                              <div
                                key={cust.id}
                                onClick={() => {
                                  setLedgerCustomerId(cust.id);
                                  setIsLedgerModalOpen(true);
                                  setLedgerSearchTerm(''); // clear search
                                }}
                                className="p-3 hover:bg-purple-600/10 cursor-pointer flex items-center justify-between text-right transition-colors"
                              >
                                <div className="text-right">
                                  <span className="text-xs font-bold text-white block">{cust.name}</span>
                                  {cust.companyName && <span className="text-[10px] text-gray-400 block">{cust.companyName}</span>}
                                </div>
                                <div className="text-left font-mono">
                                  <span className={`text-[9px] px-2 py-0.5 rounded font-black ${unpaid > 0.01 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                    {unpaid > 0.01 ? `${unpaid.toFixed(2)} USD` : 'خالٍ من الديون'}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        }
                        {customers.filter(c => 
                          (c.name || '').toLowerCase().includes((ledgerSearchTerm || '').toLowerCase()) || 
                          (c.companyName && (c.companyName || '').toLowerCase().includes((ledgerSearchTerm || '').toLowerCase())) || 
                          (c.phone1 && c.phone1.includes(ledgerSearchTerm))
                        ).length === 0 && (
                          <div className="p-4 text-center text-gray-500 text-xs font-bold font-cairo">لا توجد نتائج مطابقة لبحثك.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Add New Customer Button Removed per user request */}
                </div>
              </div>

              {/* Bento Quick Debt Stats cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-[#181818] p-3 sm:p-4 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="p-2 sm:p-3 bg-purple-600/10 rounded-xl text-purple-400 shrink-0">
                    <Users size={20} className="sm:w-[22px] sm:h-[22px]" />
                  </div>
                  <div>
                    <span className="text-[9px] sm:text-[10px] text-gray-500 font-cairo block leading-none">النشطون</span>
                    <span className="font-mono text-sm sm:text-lg font-black text-white mt-1 block">{customers.length}</span>
                  </div>
                </div>

                <div className="bg-[#181818] p-3 sm:p-4 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="p-2 sm:p-3 bg-red-600/10 rounded-xl text-red-400 shrink-0">
                    <TrendingDown size={20} className="sm:w-[22px] sm:h-[22px]" />
                  </div>
                  <div>
                    <span className="text-[9px] sm:text-[10px] text-gray-500 font-cairo block leading-none">المدينون</span>
                    <span className="font-mono text-sm sm:text-lg font-black text-rose-500 mt-1 block">
                      {new Set(customerStats.filter(stat => stat.unpaidBalance > 0.01).map(stat => stat.customer.id)).size}
                    </span>
                  </div>
                </div>

                <div className="col-span-2 md:col-span-1 bg-[#181818] p-3 sm:p-4 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="p-2 sm:p-3 bg-amber-600/10 rounded-xl text-amber-400 shrink-0">
                    <Coins size={20} className="sm:w-[22px] sm:h-[22px]" />
                  </div>
                  <div>
                    <span className="text-[9px] sm:text-[10px] text-gray-500 font-cairo block leading-none">إجمالي الديون المعلقة</span>
                    <span className="font-mono text-[10px] sm:text-xs md:text-sm font-black text-amber-500 mt-1 block flex flex-wrap gap-1 leading-tight">
                      {Object.entries(
                        customerStats.reduce((acc, stat) => {
                          if (stat.unpaidBalance > 0.01) {
                            acc[stat.currency] = (acc[stat.currency] || 0) + stat.unpaidBalance;
                          }
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([curr, amount], idx, arr) => (
                        <span key={curr}>
                          {(amount as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[8px] sm:text-[9px] text-gray-400">{curr}</span>
                          {idx < arr.length - 1 && <span className="mx-1 text-gray-600">|</span>}
                        </span>
                      ))}
                      {customerStats.filter(stat => stat.unpaidBalance > 0.01).length === 0 && '0.00'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Structured Customer Debt Table */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <h4 className="text-xs font-black text-white font-cairo flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></span>
                    سجل ديون العملاء ({filteredLedgerStats.length})
                  </h4>
                  {ledgerSearchTerm && (
                    <button 
                      onClick={() => setLedgerSearchTerm('')}
                      className="text-[10px] text-purple-400 font-bold hover:underline font-cairo"
                    >
                      مسح التصفية
                    </button>
                  )}
                </div>

                <div className="bg-[#121212] border border-white/5 rounded-2xl overflow-hidden shadow-xl text-xs w-full">
                  <div className="w-full">
                    <table className="w-full border-collapse text-right table-fixed">
                      <thead>
                        <tr className="bg-white/[0.03] border-b border-white/5 text-gray-400 font-cairo font-bold text-[9px] sm:text-[11px]">
                          <th className="py-2 sm:py-3 px-2 sm:px-4 w-[35%]">العميل</th>
                          <th className="py-2 sm:py-3 px-2 sm:px-4 hidden md:table-cell w-[15%]">الهاتف</th>
                          <th className="py-2 sm:py-3 px-2 sm:px-4 hidden lg:table-cell w-[15%]">آخر نشاط</th>
                          <th className="py-2 sm:py-3 px-2 sm:px-4 w-[35%]">صافي الدين</th>
                          <th className="py-2 sm:py-3 px-2 sm:px-4 text-center w-[15%] sm:w-28">إجراء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-gray-300 font-mono">
                        {currentLedgerListStats.map((stat, idx) => {
                          const hasDebt = stat.unpaidBalance > 0.01;
                          return (
                            <tr 
                              key={`${stat.customer.id}-${stat.currency}` || idx} 
                              onClick={() => {
                                setLedgerCustomerId(stat.customer.id);
                                setLedgerCurrency(stat.currency);
                                setIsLedgerModalOpen(true);
                              }}
                              className="hover:bg-white/[0.03] transition-colors cursor-pointer group"
                            >
                              {/* Customer Name */}
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-right overflow-hidden max-w-[120px] sm:max-w-[200px]">
                                <span className="font-bold text-white block group-hover:text-purple-400 transition-colors font-cairo text-xs sm:text-sm truncate">
                                  {stat.customer.name}
                                </span>
                                {stat.customer.companyName && (
                                  <span className="text-[9px] text-gray-500 block font-cairo mt-0.5 truncate">
                                    {stat.customer.companyName}
                                  </span>
                                )}
                              </td>

                              {/* Phone */}
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-right font-mono text-[11px] text-gray-400 hidden md:table-cell">
                                {stat.customer.phone1 ? (
                                  <span className="flex items-center gap-1.5 justify-start truncate">
                                    <Phone size={12} className="text-gray-600 shrink-0" />
                                    <span className="truncate">{stat.customer.phone1}</span>
                                  </span>
                                ) : (
                                  <span className="text-gray-600 font-cairo">لا يوجد</span>
                                )}
                              </td>

                              {/* Last Activity */}
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-right font-cairo text-xs text-gray-400 hidden lg:table-cell">
                                {stat.lastActivityDate ? (
                                  <span className="font-mono text-[11px] text-gray-300 font-bold block truncate">
                                    {stat.lastActivityDate.toLocaleDateString('ar-YE', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                                  </span>
                                ) : (
                                  <span className="text-gray-600 font-bold text-[10px] truncate">بدون حركة</span>
                                )}
                              </td>

                              {/* Outstanding Debt */}
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-right font-mono">
                                <span className={`inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-black truncate max-w-full ${hasDebt ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                  {hasDebt ? `${stat.unpaidBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stat.currency}` : 'خالٍ من المديونية'}
                                </span>
                              </td>

                              {/* Action */}
                              <td className="py-2 sm:py-3 px-1 sm:px-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => {
                                    setLedgerCustomerId(stat.customer.id);
                                    setLedgerCurrency(stat.currency);
                                    setIsLedgerModalOpen(true);
                                  }}
                                  className="px-2 sm:px-3 py-1.5 bg-purple-600/10 hover:bg-purple-600 text-purple-400 hover:text-white rounded-lg transition-all border border-purple-500/20 text-[9px] sm:text-[10px] font-black cursor-pointer inline-flex items-center justify-center gap-1 hover:scale-105 active:scale-95 w-full sm:w-auto"
                                >
                                  <Eye size={12} className="shrink-0" />
                                  <span className="hidden sm:inline">كشف الحساب</span>
                                  <span className="sm:hidden">كشف</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}

                        {currentLedgerListStats.length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center py-10 text-gray-500 font-cairo font-bold text-xs">لا يوجد عملاء مطابقين لخيارات البحث المحددة.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Main List Pagination */}
                  {totalLedgerListPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-white/[0.01]">
                      <span className="text-[10px] text-gray-400 font-bold font-cairo">
                        عرض الصفحة {safeLedgerListPage} من {totalLedgerListPages} (إجمالي {filteredLedgerStats.length} عميل)
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setLedgerListPage(p => Math.max(1, p - 1))}
                          disabled={safeLedgerListPage === 1}
                          className="p-1.5 rounded-lg bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <ArrowLeft size={14} className="rotate-180" />
                        </button>
                        <button
                          onClick={() => setLedgerListPage(p => Math.min(totalLedgerListPages, p + 1))}
                          disabled={safeLedgerListPage === totalLedgerListPages}
                          className="p-1.5 rounded-lg bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <ArrowLeft size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 4. FINANCIAL REPORTS VIEW */}
          {activeSegment === 'reports' && (
            <div className="space-y-4 animate-fade-in">
              
              {/* Report Category Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setActiveSegment('dashboard')}
                    className="p-1.5 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all"
                    title="العودة لشجرة النظام المالي"
                  >
                    <ArrowRight size={16} />
                  </button>
                  <h3 className="text-sm md:text-base font-bold text-white font-cairo flex items-center gap-2">
                    <FileSpreadsheet className="text-emerald-400" size={16} />
                    <span>تقارير الحسابات المالية:</span>
                    <span className="text-amber-500 font-bold">
                      {reportSubSegment === 'revenues' && 'الإيرادات والنقود الواردة'}
                      {reportSubSegment === 'expenses' && 'المصروفات والمبالغ الصادرة'}
                      {reportSubSegment === 'profits' && 'الأرباح وصافي الميزان'}
                      {reportSubSegment === 'fund-balances' && 'رصيد ومحتويات الصناديق'}
                      {reportSubSegment === 'outstanding-debts' && 'سجل الديون والمديونيات المستحقة'}
                    </span>
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrintActiveReport}
                    className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-600/20"
                    title="طباعة التقرير الحالي A4"
                  >
                    <Printer size={14} />
                    <span>طباعة التقرير</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportActiveReportCSV}
                    className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
                    title="تصدير التقرير إلى Excel (CSV)"
                  >
                    <Download size={14} />
                    <span>تصدير Excel</span>
                  </button>
                </div>
              </div>

              {/* SECTION: REVENUES (وارد) */}
              {reportSubSegment === 'revenues' && (
                <div className="space-y-3">
                  {/* Currencies stats */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {allUsedCurrencies.map(curr => {
                      const sum = revenueCurrencyTotals[curr] || 0;
                      return (
                        <div key={curr} className="bg-green-600/10 border border-green-500/15 p-3 rounded-xl flex items-center justify-between">
                          <span className="text-[10px] sm:text-[11px] text-green-400 font-cairo font-bold">وارد الإيرادات ({getArabicCurrencyName(curr)})</span>
                          <p className="font-mono text-base md:text-lg font-black text-white">{sum.toLocaleString('en-US')} <span className="text-[10px] text-green-400 font-bold">{getArabicCurrencyName(curr)}</span></p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Vouchers Receipt ledger list */}
                  <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden">
                    <div className="bg-white/5 px-3 py-2 font-cairo font-bold text-[11px] text-white">سندات القبض المسجلة بالدخول:</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right border-collapse text-xs min-w-[500px]">
                        <thead>
                          <tr className="border-b border-white/5 text-gray-500 font-cairo font-bold bg-[#1a1a1a]">
                            <th className="py-2 px-3">رقم السند</th>
                            <th className="py-2 px-3">التاريخ</th>
                            <th className="py-2 px-3">التصنيف</th>
                            <th className="py-2 px-3">الجهة المستلمة</th>
                            <th className="py-2 px-3">الصندوق</th>
                            <th className="py-2 px-3 text-left">المبلغ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono text-[11px] text-gray-300">
                          {receiptTransactions.map(tx => (
                            <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                              <td className="py-2 px-3 text-white font-bold">{tx.voucherNumber}</td>
                              <td className="py-2 px-3 font-sans text-[10px] text-gray-500">{formatTxDate(tx)}</td>
                              <td className="py-2 px-3 text-emerald-400 font-cairo">{tx.transactionCategory}</td>
                              <td className="py-2 px-3 font-cairo text-gray-400">{tx.customerName}</td>
                              <td className="py-2 px-3 font-cairo text-gray-400">{getFundDisplayName(tx)}</td>
                              <td className="py-2 px-3 text-left font-bold text-green-400 font-mono">+{Math.abs(tx.amount).toLocaleString('en-US')} <span className="text-[9px]">{tx.currency}</span></td>
                            </tr>
                          ))}
                          {receiptTransactions.length === 0 && (
                            <tr>
                              <td colSpan={6} className="text-center py-6 text-gray-600 font-cairo font-bold">لا توجد أي سندات مقبوضات حتى الآن.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION: EXPENSES (مصروف) */}
              {reportSubSegment === 'expenses' && (
                <div className="space-y-3">
                  {/* Currencies stats */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {allUsedCurrencies.map(curr => {
                      const sum = expenseCurrencyTotals[curr] || 0;
                      return (
                        <div key={curr} className="bg-red-600/10 border border-red-500/15 p-3 rounded-xl flex items-center justify-between">
                          <span className="text-[10px] sm:text-[11px] text-red-400 font-cairo font-bold">إجمالي المصروفات ({getArabicCurrencyName(curr)})</span>
                          <p className="font-mono text-base md:text-lg font-black text-white">{sum.toLocaleString('en-US')} <span className="text-[10px] text-red-400 font-bold">{getArabicCurrencyName(curr)}</span></p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Vouchers payment table */}
                  <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden">
                    <div className="bg-white/5 px-3 py-2 font-cairo font-bold text-[11px] text-white">سندات الصرف والنفقات المسجلة:</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right border-collapse text-xs min-w-[500px]">
                        <thead>
                          <tr className="border-b border-white/5 text-gray-500 font-cairo font-bold bg-[#1a1a1a]">
                            <th className="py-2 px-3">رقم السند</th>
                            <th className="py-2 px-3">التاريخ</th>
                            <th className="py-2 px-3">التصنيف المصروف</th>
                            <th className="py-2 px-3">الصرف لصالح</th>
                            <th className="py-2 px-3">المصدر (الصندوق)</th>
                            <th className="py-2 px-3 text-left">المبلغ المنصرف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono text-[11px] text-gray-300">
                          {paymentTransactions.map(tx => (
                            <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                              <td className="py-2 px-3 text-white font-bold">{tx.voucherNumber}</td>
                              <td className="py-2 px-3 font-sans text-[10px] text-gray-500">{formatTxDate(tx)}</td>
                              <td className="py-2 px-3 text-amber-500 font-cairo">{tx.transactionCategory}</td>
                              <td className="py-2 px-3 font-cairo text-gray-400">{tx.customerName}</td>
                              <td className="py-2 px-3 font-cairo text-gray-400">{getFundDisplayName(tx)}</td>
                              <td className="py-2 px-3 text-left font-bold text-red-400 font-mono">-{Math.abs(tx.amount).toLocaleString('en-US')} <span className="text-[9px]">{tx.currency}</span></td>
                            </tr>
                          ))}
                          {paymentTransactions.length === 0 && (
                            <tr>
                              <td colSpan={6} className="text-center py-6 text-gray-600 font-cairo font-bold">لا توجد أي نفقات أو سندات صرف حتى الآن.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION: PROFITS (صافي الميزان) */}
              {reportSubSegment === 'profits' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-gray-400 font-cairo">صافي الربح يتم احتسابه بطرح إجمالي النفقات والمصروفات من إجمالي النقدية الواردة عبر السندات والفواتير المدمجة.</p>

                  <div className="space-y-2">
                    {allUsedCurrencies.map(curr => {
                      const totalIn = revenueCurrencyTotals[curr] || 0;
                      const totalOut = expenseCurrencyTotals[curr] || 0;
                      const netProfit = totalIn - totalOut;
                      
                      return (
                        <div key={curr} className="bg-[#141414] border border-white/5 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <span className="text-[11px] font-bold text-white font-cairo">مؤشر أرباح عملة: {getArabicCurrencyName(curr)}</span>
                            <div className="flex gap-4 text-[10px] text-gray-400 font-cairo">
                              <span>إجمالي الوارد: <strong className="text-emerald-400 font-mono">{totalIn.toLocaleString('en-US')}</strong> <span className="text-[9px] text-gray-500 font-bold">{getArabicCurrencyName(curr)}</span></span>
                              <span>إجمالي المنصرف: <strong className="text-red-500 font-mono">{totalOut.toLocaleString('en-US')}</strong> <span className="text-[9px] text-gray-500 font-bold">{getArabicCurrencyName(curr)}</span></span>
                            </div>
                          </div>

                          <div className="text-left mt-2 md:mt-0 flex items-center gap-3">
                            <span className="text-[10px] text-gray-400 font-cairo">صافي ربح الصندوق</span>
                            <p className={`font-mono text-base md:text-lg font-black ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                              {netProfit >= 0 ? '+' : ''}{netProfit.toLocaleString('en-US')} <span className="text-[10px] text-gray-400 font-bold font-cairo">{getArabicCurrencyName(curr)}</span>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION: FUND BALANCES (أرصدة الصناديق) */}
              {reportSubSegment === 'fund-balances' && (
                <div className="space-y-3">
                  <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden w-full">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs min-w-[400px]">
                        <thead>
                          <tr className="bg-[#1a1a1a] text-gray-400 font-cairo font-bold border-b border-white/5">
                            <th className="py-2 px-3">اسم الصندوق المالي</th>
                            <th className="py-2 px-3">النوع</th>
                            <th className="py-2 px-3">العملة الأساسية</th>
                            <th className="py-2 px-3 text-left">الرصيد الفعلي المتوقع</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-gray-300 font-mono text-[11px]">
                          {funds.map(f => (
                            <tr key={f.id} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 px-3 font-bold font-cairo text-white">{f.name}</td>
                              <td className="py-2.5 px-3 font-cairo text-gray-400">{f.type === 'cash' ? 'نقدي' : 'حساب بنك'}</td>
                              <td className="py-2.5 px-3 font-cairo text-gray-400">{f.currency}</td>
                              <td className="py-2.5 px-3 text-left font-mono font-black text-emerald-400">{parseFundBalance(f.balance).toLocaleString('en-US')} <span className="text-[9px]">{f.currency}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION: OUTSTANDING DEBTS (المديونيات) */}
              {reportSubSegment === 'outstanding-debts' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-gray-400 font-cairo">سجل بمطالبات العملاء الذين لديهم فواتير معلقة تفوق مبالغ سدادهم الحالية.</p>

                  <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right border-collapse text-xs min-w-[500px]">
                        <thead>
                        <tr className="bg-white/5 border-b border-white/5 text-gray-400 font-cairo font-bold">
                          <th className="py-2.5 px-3">اسم العميل بالكامل</th>
                          <th className="py-2.5 px-3">اسم الشركة المستهدفة</th>
                          <th className="py-2.5 px-3">رقم الهاتف للتواصل</th>
                          <th className="py-2.5 px-3 text-left text-red-400 font-bold">الديون المتبقية لصالحه</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-gray-300">
                        {customers.map(cust => {
                          const custInvs = invoices.filter(inv => inv.customerId === cust.id);
                          const totalCost = custInvs.reduce((a, b) => {
                            const invItems = getInvoiceItemsForInvoice(b.invoiceNumber);
                            return a + getInvoiceActualCost(invItems, b);
                          }, 0);
                          const totalPaid = custInvs.reduce((a, b) => a + Number(b.amountPaid || 0), 0);
                          const extCollections = transactions
                            .filter(t => t.customerId === cust.id && t.type === 'receipt' && (!t.invoiceNumber || String(t.invoiceNumber).trim() === ''))
                            .reduce((a, b) => a + Math.abs(Number(b.amount || 0)), 0);

                          const unpaid = Math.max(0, totalCost - totalPaid - extCollections);
                          if (unpaid <= 0) return null; // Only show debtor customers

                          return (
                            <tr key={cust.id} className="hover:bg-white/5">
                              <td className="py-2.5 px-3 font-bold font-cairo text-white">{cust.name}</td>
                              <td className="py-2.5 px-3 font-cairo text-gray-500">{cust.companyName || 'بدون شركة'}</td>
                              <td className="py-2.5 px-3 font-mono text-gray-400">{cust.phone1 || 'لم يدخل هاتف'}</td>
                              <td className="py-2.5 px-3 text-left font-bold text-red-500 font-mono flex items-center justify-end gap-3">
                                {unpaid.toLocaleString('en-US')} USD
                                <button
                                  onClick={() => {
                                    if (!cust.phone1) {
                                      alert('لا يوجد رقم هاتف مسجل لهذا العميل');
                                      return;
                                    }
                                    
                                    sendUniversalReminder({
                                      customerName: cust.name,
                                      phone: cust.phone1,
                                      amount: unpaid,
                                      currency: 'USD',
                                      hasWhatsapp: cust.hasWhatsapp !== undefined ? cust.hasWhatsapp : true,
                                      countryCode: shopConfig?.countryCode,
                                      shopName: shopConfig?.shopName
                                    });
                                  }}
                                  className="px-3 py-1.5 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600 hover:to-teal-600 text-emerald-500 hover:text-white rounded-lg transition-all cursor-pointer border border-emerald-500/10 flex items-center gap-1.5 group"
                                  title="إرسال تذكير سداد"
                                >
                                  <MessageCircle size={14} className="group-hover:scale-110 transition-transform" />
                                  <span className="text-[10px] font-black font-cairo">إرسال تذكير</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {customers.length === 0 && (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-gray-500 font-cairo">لا يوجد أي عملاء مسجلين بنظام المديونيات.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

      </div>

      {/* 5. DEDICATED ACCOUNTS STATEMENT DETAIL MODAL */}
      <AnimatePresence>
        {isLedgerModalOpen && ledgerCustomerId && selectedLedgerCustomer && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0e0e0e] overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full h-full flex flex-col py-6 space-y-6 overflow-y-auto text-right text-gray-200"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/5 pb-4 px-4 md:px-8">
                <div className="flex items-center gap-4 w-full">
                  <div className="p-3 bg-purple-600/10 text-purple-400 rounded-xl">
                    <FileText size={24} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg md:text-xl font-black text-purple-400 font-cairo">
                      كشف الحساب المالي التفصيلي
                    </h3>
                    <h4 className="text-sm md:text-base font-bold text-white font-cairo mt-1">
                      {selectedLedgerCustomer.name}
                      {selectedLedgerCustomer.companyName && (
                        <span className="text-gray-500 mr-2 text-xs">| {selectedLedgerCustomer.companyName}</span>
                      )}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsLedgerModalOpen(false);
                      setLedgerCustomerId('');
                    }}
                    className="p-3 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-xl text-gray-400 transition-all cursor-pointer"
                    title="إغلاق"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Stat boxes inside modal */}
              <div className="flex flex-col sm:flex-row gap-3 px-2 sm:px-4 md:px-8">
                <div className="bg-[#141414] p-4 rounded-xl border border-white/5 flex flex-col justify-between flex-1">
                  <span className="text-[11px] text-gray-500 font-cairo leading-none font-bold">إجمالي فواتير الصيانة</span>
                  <p className="font-mono text-base md:text-lg font-black text-white mt-2">
                    {totalInvoicesCost.toLocaleString('en-US')} <span className="text-[10px] font-sans text-gray-500">{ledgerCurrency}</span>
                  </p>
                  <span className="text-[9px] text-gray-600 font-cairo mt-1">عدد الفواتير المسجلة: {ledgerCustomerInvoices.length}</span>
                </div>

                <div className="flex flex-row gap-3 flex-[2]">
                  <div className="bg-[#141414] p-4 rounded-xl border border-white/5 flex flex-col justify-between flex-1">
                    <span className="text-[11px] text-green-400 font-cairo leading-none font-bold">مجموع المبالغ المسددة</span>
                    <p className="font-mono text-base md:text-lg font-black text-green-400 mt-2">
                      {(totalInvoicesPaid + totalSeparateCollections).toLocaleString('en-US')} <span className="text-[10px] font-sans text-gray-500">{ledgerCurrency}</span>
                    </p>
                    <span className="text-[9px] text-gray-500 font-cairo mt-1">فواتير: {totalInvoicesPaid} + قبض مستقل: {totalSeparateCollections}</span>
                  </div>

                  <div className="bg-[#141414] p-4 rounded-xl border border-white/5 flex flex-col justify-between flex-1">
                    <span className="text-[11px] text-rose-400 font-cairo leading-none font-bold">صافي المديونية المتبقية</span>
                    <p className={`font-mono text-base md:text-lg font-black mt-2 ${customerUnpaidBalance > 0.01 ? 'text-rose-500' : 'text-emerald-400'}`}>
                      {customerUnpaidBalance.toLocaleString('en-US')} <span className="text-[10px] font-sans text-gray-500">{ledgerCurrency}</span>
                    </p>
                    <span className="text-[9px] text-gray-600 font-cairo mt-1">مستحق بذمة العميل للمركز</span>
                  </div>
                </div>
              </div>

              {/* Tabs for Invoices vs Transactions */}
              <div className="flex items-center gap-2 border-b border-white/5 pb-1 px-2 sm:px-4 md:px-8">
                <button
                  onClick={() => setLedgerModalTab('invoices')}
                  className={`px-4 py-2 text-xs font-bold font-cairo border-b-2 transition-all ${ledgerModalTab === 'invoices' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                  دفتر الفواتير والديون ({ledgerCustomerInvoices.length})
                </button>
                <button
                  onClick={() => setLedgerModalTab('transactions')}
                  className={`px-4 py-2 text-xs font-bold font-cairo border-b-2 transition-all ${ledgerModalTab === 'transactions' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                  حركات السندات والمقبوضات ({ledgerCustomerTransactions.length})
                </button>
              </div>

              {/* Modal Active Tab Content */}
              <div className="flex-1 min-h-[250px] space-y-4">
                {ledgerModalTab === 'invoices' ? (
                  <div className="space-y-3">
                    <div className="bg-[#121212] border-y border-white/5 overflow-x-auto text-xs w-full">
                      <table className="w-full border-collapse text-right min-w-[600px]">
                        <thead>
                          <tr className="bg-white/5 border-b border-white/5 text-gray-400 font-cairo font-bold">
                            <th className="py-2.5 px-3">رقم الفاتورة</th>
                            <th className="py-2.5 px-3">تاريخ الفاتورة</th>
                            <th className="py-2.5 px-3">قيمة الفاتورة</th>
                            <th className="py-2.5 px-3 text-green-400">المسدد منها</th>
                            <th className="py-2.5 px-3 text-red-500">المبلغ المتبقي</th>
                            <th className="py-2.5 px-3 text-center">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-gray-300 font-mono">
                          {currentLedgerInvoices.map(inv => {
                            const invItems = getInvoiceItemsForInvoice(inv.invoiceNumber);
                            const actualCost = getInvoiceActualCost(invItems, inv);
                            const unpaid = Math.max(0, actualCost - inv.amountPaid);
                            return (
                              <tr key={inv.id} className="hover:bg-white/5 font-mono text-[11px]">
                                <td className="py-2.5 px-3 text-white font-bold">#{inv.invoiceNumber}</td>
                                <td className="py-2.5 px-3 text-gray-400">
                                  {parseDate(inv.createdAt)
                                    ? parseDate(inv.createdAt)!.toLocaleDateString('ar-YE', { year: 'numeric', month: '2-digit', day: '2-digit' })
                                    : '---'}
                                </td>
                                <td className="py-2.5 px-3">{actualCost?.toLocaleString('en-US')} {inv.currency}</td>
                                <td className="py-2.5 px-3 text-green-400">{inv.amountPaid?.toLocaleString('en-US')} {inv.currency}</td>
                                <td className="py-2.5 px-3 text-rose-500 font-bold">{unpaid.toLocaleString('en-US')} {inv.currency}</td>
                                <td className="py-2.5 px-3 text-center font-cairo">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${inv.status === 'delivered' ? 'bg-green-600/15 text-green-400' : 'bg-amber-600/15 text-amber-500'}`}>
                                    {inv.status === 'delivered' ? 'مكتملة ومسلمة' : 'قيد الصيانة'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                          {ledgerCustomerInvoices.length === 0 && (
                            <tr>
                              <td colSpan={6} className="text-center py-8 text-gray-500 font-cairo text-xs font-bold px-3">لا توجد فواتير صيانة مسجلة لهذا العميل.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination for Invoices */}
                    {totalLedgerInvoicesPages > 1 && (
                      <div className="flex items-center justify-between mx-2 px-4 py-2 border border-white/5 bg-black/10 rounded-xl">
                        <span className="text-[10px] text-gray-500 font-bold font-cairo">
                          صفحة {safeLedgerInvoicesPage} من {totalLedgerInvoicesPages}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={safeLedgerInvoicesPage === 1}
                            className="p-1 rounded bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <ArrowLeft size={12} className="rotate-180" />
                          </button>
                          <button
                            onClick={() => setCurrentPage(p => Math.min(totalLedgerInvoicesPages, p + 1))}
                            disabled={safeLedgerInvoicesPage === totalLedgerInvoicesPages}
                            className="p-1 rounded bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <ArrowLeft size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-[#121212] border-y border-white/5 divide-y divide-white/5">
                      {currentLedgerTransactions.map(tx => (
                        <div key={tx.id} className="px-3 py-3.5 text-xs flex items-center justify-between hover:bg-white/5 transition-colors">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white font-mono text-xs">سند رقم: {tx.voucherNumber}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${tx.type === 'receipt' ? 'bg-green-600/15 text-green-400' : 'bg-amber-600/15 text-amber-500'}`}>
                                {tx.type === 'receipt' ? 'سند قبض مالي' : 'سند صرف للعميل'}
                              </span>
                              <span className="text-[10px] text-purple-400 font-cairo">({tx.transactionCategory})</span>
                            </div>
                            <p className="text-[10px] text-gray-400 font-cairo leading-relaxed">{tx.notes || 'سند مالي مستحق على الدفاتر.'}</p>
                            <span className="text-[9px] text-gray-600 font-mono">
                              {formatTxDate(tx)}
                            </span>
                          </div>
                          
                          <div className="text-left font-mono">
                            <span className={`text-xs sm:text-sm font-black ${tx.type === 'receipt' ? 'text-green-500' : 'text-amber-500'}`}>
                              {tx.type === 'receipt' ? '+' : '-'}{Math.abs(tx.amount).toLocaleString('en-US')} {tx.currency}
                            </span>
                            <p className="text-[9px] text-gray-500 font-cairo mt-0.5">{getFundDisplayName(tx)}</p>
                          </div>
                        </div>
                      ))}
                      {ledgerCustomerTransactions.length === 0 && (
                        <div className="text-center py-8 text-gray-500 font-cairo text-xs font-bold px-3">لا يوجد سندات قبض أو صرف مسجلة لهذا العميل.</div>
                      )}
                    </div>

                    {/* Pagination for Transactions */}
                    {totalLedgerTransactionsPages > 1 && (
                      <div className="flex items-center justify-between mx-2 px-4 py-2 border border-white/5 bg-black/10 rounded-xl">
                        <span className="text-[10px] text-gray-500 font-bold font-cairo">
                          صفحة {safeLedgerTransactionsPage} من {totalLedgerTransactionsPages}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={safeLedgerTransactionsPage === 1}
                            className="p-1 rounded bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <ArrowLeft size={12} className="rotate-180" />
                          </button>
                          <button
                            onClick={() => setCurrentPage(p => Math.min(totalLedgerTransactionsPages, p + 1))}
                            disabled={safeLedgerTransactionsPage === totalLedgerTransactionsPages}
                            className="p-1 rounded bg-white/5 text-gray-400 disabled:opacity-30 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <ArrowLeft size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/5 pt-4 pb-2 mt-auto px-4 md:px-8">
                <p className="text-[10px] sm:text-xs text-gray-400 font-cairo font-bold leading-relaxed text-right flex-1 w-full">
                  استخرج ملف PDF تفصيلي بكشف الحساب للطباعة أو الإرسال.
                </p>
                <div className="w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const entries = getStatementEntries(ledgerCustomerId, ledgerCurrency);
                      
                      const formattedEntries = entries.map((entry) => {
                        const year = entry.date.getFullYear();
                        const month = String(entry.date.getMonth() + 1).padStart(2, '0');
                        const day = String(entry.date.getDate()).padStart(2, '0');
                        const hours = String(entry.date.getHours()).padStart(2, '0');
                        const minutes = String(entry.date.getMinutes()).padStart(2, '0');
                        const formattedDate = `${year}/${month}/${day} ${hours}:${minutes}`;

                        return {
                          ...entry,
                          formattedDate
                        };
                      });
                      
                      setPreviewData({
                        type: 'statement',
                        data: {
                          statement: {
                            customerName: selectedLedgerCustomer.name,
                            companyName: selectedLedgerCustomer.companyName || '',
                            customerPhone: selectedLedgerCustomer.phone1 || '',
                            customerNumber: selectedLedgerCustomer.customerNumber || selectedLedgerCustomer.id?.substring(0, 5) || '',
                            currency: ledgerCurrency,
                            liabilityCurrency: selectedLedgerCustomer.liabilityCurrency || 'USD',
                            entries: formattedEntries
                          }
                        }
                      });
                    }}
                    className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs sm:text-sm font-bold font-cairo shadow-lg shadow-purple-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 hover:shadow-purple-500/40"
                  >
                    <Printer size={16} />
                    <span>إصدار كشف الحساب التفصيلي</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>



      {previewData && (
        <PrintPreviewOverlay
          type={previewData.type}
          data={previewData.data}
          onClose={() => setPreviewData(null)}
          shopConfig={shopConfig}
          user={user}
        />
      )}

      {reversalTxToConfirm && (
        <div className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-xl">
                <ArrowRightLeft size={22} className="rotate-90" />
              </div>
              <div className="text-right">
                <h3 className="text-sm font-black text-white font-cairo">تأكيد عملية عكس القيد</h3>
                <p className="text-[10px] text-gray-400 font-cairo mt-0.5">يرجى تأكيد رغبتكم في عكس هذا القيد المالي</p>
              </div>
            </div>

            <div className="space-y-3 bg-white/5 p-4 rounded-xl text-right">
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">رقم السند:</span>
                <span className="font-mono font-bold text-amber-500">#{reversalTxToConfirm.voucherNumber}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">اسم العميل / الجهة:</span>
                <span className="font-bold text-white">{reversalTxToConfirm.customerName}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">نوع العملية:</span>
                <span className="font-bold text-gray-200">{reversalTxToConfirm.transactionCategory || (reversalTxToConfirm.type === 'receipt' ? 'قبض' : 'صرف')}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">المبلغ:</span>
                <span className="font-mono font-black text-rose-500">{Math.abs(reversalTxToConfirm.amount).toLocaleString('en-US')} {reversalTxToConfirm.currency}</span>
              </div>
              <div className="flex justify-between items-start text-xs font-cairo border-t border-white/5 pt-2 mt-2" dir="rtl">
                <span className="text-gray-400 shrink-0 ml-4">البيان / الملاحظات:</span>
                <span className="text-slate-300 font-medium break-all">{reversalTxToConfirm.notes || 'لا يوجد'}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                disabled={isPosting}
                onClick={async () => {
                  await handleReverseEntry(reversalTxToConfirm);
                  setReversalTxToConfirm(null);
                }}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold font-cairo transition-all cursor-pointer shadow-lg shadow-rose-600/20 active:scale-95 flex items-center justify-center gap-2"
              >
                {isPosting ? <Loader2 size={16} className="animate-spin" /> : null}
                <span>تأكيد وعكس القيد</span>
              </button>
              <button
                type="button"
                disabled={isPosting}
                onClick={() => setReversalTxToConfirm(null)}
                className="flex-1 py-3 bg-[#1e1e1e] hover:bg-[#252525] border border-white/5 disabled:opacity-50 text-gray-300 rounded-xl text-xs font-bold font-cairo transition-all cursor-pointer text-center"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Transaction Confirmation Modal */}
      {txToDelete && (
        <div className="fixed inset-0 z-[160] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-xl">
                <Trash2 size={22} />
              </div>
              <div className="text-right">
                <h3 className="text-sm font-black text-white font-cairo">تأكيد حذف السند نهائياً</h3>
                <p className="text-[10px] text-gray-400 font-cairo mt-0.5">سيتم حذف هذا السند وتعديل الفواتير والحسابات المربوطة فوراً</p>
              </div>
            </div>

            <div className="space-y-3 bg-white/5 p-4 rounded-xl text-right">
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">رقم السند:</span>
                <span className="font-mono font-bold text-amber-500">#{txToDelete.voucherNumber}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">اسم العميل / الجهة:</span>
                <span className="font-bold text-white">{txToDelete.customerName}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">نوع العملية:</span>
                <span className="font-bold text-gray-200">{txToDelete.transactionCategory || (txToDelete.type === 'receipt' ? 'قبض' : 'صرف')}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-cairo">
                <span className="text-gray-400">المبلغ:</span>
                <span className="font-mono font-black text-rose-500">{Math.abs(txToDelete.amount).toLocaleString('en-US')} {txToDelete.currency}</span>
              </div>
              {txToDelete.invoiceNumber && (
                <div className="flex justify-between items-center text-xs font-cairo">
                  <span className="text-gray-400">مربوط بالفاتورة رقم:</span>
                  <span className="font-mono font-bold text-blue-400">#{txToDelete.invoiceNumber}</span>
                </div>
              )}
              <div className="flex justify-between items-start text-xs font-cairo border-t border-white/5 pt-2 mt-2" dir="rtl">
                <span className="text-gray-400 shrink-0 ml-4">البيان / الملاحظات:</span>
                <span className="text-slate-300 font-medium break-all">{txToDelete.notes || 'لا يوجد'}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                disabled={isDeletingTx}
                onClick={() => handleDeleteTransaction(txToDelete)}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold font-cairo transition-all cursor-pointer shadow-lg shadow-rose-600/20 active:scale-95 flex items-center justify-center gap-2"
              >
                {isDeletingTx ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                <span>تأكيد الحذف النهائي</span>
              </button>
              <button
                type="button"
                disabled={isDeletingTx}
                onClick={() => setTxToDelete(null)}
                className="flex-1 py-3 bg-[#1e1e1e] hover:bg-[#252525] border border-white/5 disabled:opacity-50 text-gray-300 rounded-xl text-xs font-bold font-cairo transition-all cursor-pointer text-center"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Discount Confirmation Modal */}
      {discountToDelete && (() => {
        const inv = discountToDelete;
        const discVal = Number(inv.discount !== undefined ? inv.discount : (inv as any).discountAmount || 0);
        const curr = inv.currency || 'USD';
        const invNum = String(inv.invoiceNumber || '').replace('#', '').trim();

        // Linked receipts
        const linkedReceipts = transactions.filter(t => {
          const tInvNo = String(t.invoiceNumber || '').replace('#', '').trim();
          return invNum && tInvNo === invNum && (t.type === 'receipt' || t.type === 'deposit');
        });

        return (
          <div className="fixed inset-0 z-[160] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" dir="rtl">
            <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl font-cairo">
              <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-xl">
                  <Trash2 size={22} />
                </div>
                <div className="text-right">
                  <h3 className="text-sm font-black text-white">تأكيد حذف الخصم نهائياً</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">سيتم تصفير الخصم وإعادة احتساب قيمة الفاتورة الأصلية</p>
                </div>
              </div>

              <div className="space-y-2.5 bg-white/5 p-4 rounded-xl text-right text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">رقم الفاتورة:</span>
                  <span className="font-mono font-bold text-amber-500">#{inv.invoiceNumber}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">اسم العميل:</span>
                  <span className="font-bold text-white">{inv.customerName || 'عميل نقدي'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">مبلغ الخصم المحذوف:</span>
                  <span className="font-mono font-black text-rose-400">{discVal.toLocaleString('en-US')} {curr}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">إجمالي الفاتورة الحالي:</span>
                  <span className="font-mono font-bold text-gray-300">{Number(inv.totalCost || 0).toLocaleString('en-US')} {curr}</span>
                </div>
                
                {linkedReceipts.length > 0 && (
                  <div className="border-t border-white/10 pt-2.5 mt-2.5 space-y-2">
                    <div className="flex items-center justify-between text-amber-400 text-[11px] font-bold">
                      <span>سندات القبض المرتبطة ({linkedReceipts.length}):</span>
                      <span className="font-mono text-xs">
                        {linkedReceipts.map(r => `#${r.voucherNumber}`).join(', ')}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-rose-300 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20 select-none">
                      <input 
                        type="checkbox"
                        checked={deleteLinkedReceipts}
                        onChange={(e) => setDeleteLinkedReceipts(e.target.checked)}
                        className="rounded border-white/20 bg-black/40 text-rose-600 focus:ring-rose-500 w-3.5 h-3.5 accent-rose-600 cursor-pointer"
                      />
                      <span>حذف سند القبض المالي المرتبط بهذه الفاتورة وتعديل رصيد الخزينة</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDeletingDiscount}
                  onClick={() => handleConfirmDeleteDiscount(inv, deleteLinkedReceipts)}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-rose-600/20 active:scale-95 flex items-center justify-center gap-2"
                >
                  {isDeletingDiscount ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  <span>تأكيد حذف الخصم</span>
                </button>
                <button
                  type="button"
                  disabled={isDeletingDiscount}
                  onClick={() => setDiscountToDelete(null)}
                  className="flex-1 py-3 bg-[#1e1e1e] hover:bg-[#252525] border border-white/5 disabled:opacity-50 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Fund Statement & Movement Report Modal */}
      {selectedFundForReport && (() => {
        const fund = selectedFundForReport;
        const allFundTxs = transactions.filter(tx => {
          if (!isAccountingTransactionValid(tx)) return false;
          const tFundId = String(tx.fundId || '');
          const tFundName = String(tx.fundName || '').trim();
          return tFundId === fund.id || tFundName === fund.name;
        });

        const allStatementEntries = computeFundChronologicalStatement(fund, allFundTxs);

        const filteredEntries = allStatementEntries.filter(entry => {
          // Date filter
          const rawDate = entry.rawTx.createdAt || entry.rawTx.timestamp;
          const txDate = rawDate ? (typeof (rawDate as any)?.toDate === 'function' ? (rawDate as any).toDate().toISOString() : String(rawDate)) : '';
          const txDay = txDate.split('T')[0] || '';
          if (fundReportDateFrom && txDay && txDay < fundReportDateFrom) return false;
          if (fundReportDateTo && txDay && txDay > fundReportDateTo) return false;

          // Type filter
          if (fundReportType === 'receipt' && entry.debit <= 0) return false;
          if (fundReportType === 'payment' && entry.credit <= 0) return false;

          // Search filter
          if (fundReportSearch) {
            const s = fundReportSearch.toLowerCase().trim();
            const match = (entry.details || '').toLowerCase().includes(s) ||
                          String(entry.voucherNumber || '').toLowerCase().includes(s) ||
                          (entry.rawTx.customerName || '').toLowerCase().includes(s) ||
                          (entry.rawTx.notes || '').toLowerCase().includes(s) ||
                          String(entry.rawTx.invoiceNumber || '').toLowerCase().includes(s);
            if (!match) return false;
          }

          return true;
        });

        const totalIn = filteredEntries.reduce((s, e) => s + e.debit, 0);
        const totalOut = filteredEntries.reduce((s, e) => s + e.credit, 0);
        const netFlow = totalIn - totalOut;
        const currentDisplayedBalance = filteredEntries.length > 0 ? filteredEntries[filteredEntries.length - 1].runningBalance : parseFundBalance(fund.balance);

        return (
          <div className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in" dir="rtl">
            <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#181818]">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl">
                    <FileText size={22} />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white font-cairo flex items-center gap-2">
                      <span>كشف حساب وحركات:</span>
                      <span className="text-blue-400 font-bold">{fund.name}</span>
                    </h3>
                    <p className="text-[11px] text-gray-400 font-cairo mt-0.5">
                      النوع: {fund.type === 'cash' ? 'صندوق نقدي' : 'حساب بنكي'} | العملة الأساسية: {fund.currency}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintFundStatement(fund, filteredEntries)}
                    className="py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold font-cairo transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-600/20"
                    title="معاينة وطباعة كشف الحساب وتصدير ملف PDF خفيف (بحدود 200 ك.ب أو أقل)"
                  >
                    <Printer size={15} />
                    <span className="hidden sm:inline">طباعة / تصدير PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportFundCSV(fund, filteredEntries)}
                    className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold font-cairo transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
                    title="تصدير إلى ملف Excel (CSV)"
                  >
                    <Download size={15} />
                    <span className="hidden sm:inline">تصدير Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShareFundWhatsApp(fund, filteredEntries)}
                    className="py-2 px-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-xs font-bold font-cairo transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-green-600/20"
                    title="مشاركة الملخص عبر واتساب"
                  >
                    <Share2 size={15} />
                    <span className="hidden sm:inline">واتساب</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFundForReport(null)}
                    className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl border border-white/5 transition-all cursor-pointer mr-1"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Filter & Summary Section */}
              <div className="p-4 sm:p-5 border-b border-white/5 bg-[#121212] space-y-4 overflow-y-auto">
                {/* Stats cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[#1a1a1a] border border-white/5 p-3 rounded-xl">
                    <span className="text-[10px] text-gray-400 font-cairo block">الرصيد في نهاية الفترة</span>
                    <span className="text-base sm:text-lg font-black font-mono text-emerald-400">
                      {currentDisplayedBalance.toLocaleString('en-US')} <span className="text-[10px] font-sans text-gray-500">{fund.currency}</span>
                    </span>
                  </div>
                  <div className="bg-emerald-950/20 border border-emerald-500/20 p-3 rounded-xl">
                    <span className="text-[10px] text-emerald-400 font-cairo block">إجمالي الوارد (مدين)</span>
                    <span className="text-base sm:text-lg font-black font-mono text-emerald-300">
                      +{totalIn.toLocaleString('en-US')} <span className="text-[10px] font-sans text-emerald-500">{fund.currency}</span>
                    </span>
                  </div>
                  <div className="bg-rose-950/20 border border-rose-500/20 p-3 rounded-xl">
                    <span className="text-[10px] text-rose-400 font-cairo block">إجمالي المنصرف (دائن)</span>
                    <span className="text-base sm:text-lg font-black font-mono text-rose-300">
                      -{totalOut.toLocaleString('en-US')} <span className="text-[10px] font-sans text-rose-500">{fund.currency}</span>
                    </span>
                  </div>
                  <div className="bg-[#1a1a1a] border border-white/5 p-3 rounded-xl">
                    <span className="text-[10px] text-gray-400 font-cairo block">صافي حركة الفترة</span>
                    <span className={`text-base sm:text-lg font-black font-mono ${netFlow >= 0 ? 'text-blue-400' : 'text-amber-400'}`}>
                      {netFlow >= 0 ? '+' : ''}{netFlow.toLocaleString('en-US')} <span className="text-[10px] font-sans text-gray-500">{fund.currency}</span>
                    </span>
                  </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[10px] text-gray-400 font-cairo block mb-1">من تاريخ:</label>
                    <input
                      type="date"
                      value={fundReportDateFrom}
                      onChange={(e) => setFundReportDateFrom(e.target.value)}
                      className="w-full bg-[#181818] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-cairo block mb-1">إلى تاريخ:</label>
                    <input
                      type="date"
                      value={fundReportDateTo}
                      onChange={(e) => setFundReportDateTo(e.target.value)}
                      className="w-full bg-[#181818] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-cairo block mb-1">نوع الحركة:</label>
                    <select
                      value={fundReportType}
                      onChange={(e) => setFundReportType(e.target.value as any)}
                      className="w-full bg-[#181818] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-cairo outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="all">كل الحركات</option>
                      <option value="receipt">قبض / إيداع فقط (مدين)</option>
                      <option value="payment">صرف / سحب فقط (دائن)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-cairo block mb-1">بحث في القيود:</label>
                    <input
                      type="text"
                      placeholder="بحث بالعميل، السند، البيان..."
                      value={fundReportSearch}
                      onChange={(e) => setFundReportSearch(e.target.value)}
                      className="w-full bg-[#181818] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-cairo outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Transactions Table Body */}
              <div className="flex-1 overflow-auto p-4 sm:p-5 scrollbar-thin">
                {filteredEntries.length === 0 ? (
                  <div className="py-12 text-center text-gray-500 font-cairo">
                    <FileText size={40} className="mx-auto text-gray-600 mb-2 opacity-50" />
                    <p className="text-sm font-bold">لا توجد حركات مسجلة لهذا الصندوق وفقاً لمعايير التصفية المختارة</p>
                    <p className="text-xs text-gray-600 mt-1">جرّب تغيير نطاق التواريخ أو تصفية نوع الحركات</p>
                  </div>
                ) : (
                  <div className="border border-white/10 rounded-xl overflow-x-auto w-full scrollbar-thin bg-black/20 shadow-inner">
                    <table className="w-full text-right text-xs whitespace-nowrap min-w-[720px] table-auto">
                      <thead>
                        <tr className="bg-white/5 text-gray-300 font-bold border-b border-white/5 font-cairo">
                          <th className="px-2.5 py-3 text-center w-14 sm:w-16 shrink-0">رقم السند</th>
                          <th className="px-2.5 py-3 text-center w-28 sm:w-32 shrink-0">التاريخ والوقت</th>
                          <th className="px-3.5 py-3 min-w-[220px] w-full">البيان والتفاصيل</th>
                          <th className="px-2.5 py-3 text-center text-emerald-400 w-20 sm:w-24 shrink-0">مدين (وارد)</th>
                          <th className="px-2.5 py-3 text-center text-rose-400 w-20 sm:w-24 shrink-0">دائن (منصرف)</th>
                          <th className="px-3 py-3 text-left w-24 sm:w-28 shrink-0">الرصيد</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-cairo">
                        {filteredEntries.map(entry => (
                          <tr key={entry.id} className="hover:bg-white/5 transition-colors">
                            <td className="px-2.5 py-2.5 font-mono font-bold text-amber-500 text-center whitespace-nowrap">
                              {entry.voucherNumber ? `#${entry.voucherNumber}` : '-'}
                            </td>
                            <td className="px-2.5 py-2.5 font-mono text-gray-400 text-[10px] text-center whitespace-nowrap">{entry.dateStr}</td>
                            <td className="px-3.5 py-2.5 whitespace-normal">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-bold text-white text-xs leading-tight">
                                  {entry.details}
                                </span>
                                {entry.rawTx.userName && (
                                  <span className="text-[10px] text-gray-500">
                                    المستخدم: {entry.rawTx.userName}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2.5 py-2.5 text-center font-mono font-bold text-emerald-400 whitespace-nowrap">
                              {entry.debit > 0 ? `+${entry.debit.toLocaleString('en-US')}` : <span className="text-gray-600 font-normal">-</span>}
                            </td>
                            <td className="px-2.5 py-2.5 text-center font-mono font-bold text-rose-400 whitespace-nowrap">
                              {entry.credit > 0 ? `-${entry.credit.toLocaleString('en-US')}` : <span className="text-gray-600 font-normal">-</span>}
                            </td>
                            <td className="px-3 py-2.5 text-left font-mono font-black text-blue-400 whitespace-nowrap">
                              <span>{entry.runningBalance.toLocaleString('en-US')}</span>
                              <span className="text-[11px] text-blue-300/80 font-cairo mr-1 font-semibold">{getCurrencySymbol(fund.currency)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-3 sm:p-4 border-t border-white/10 bg-[#181818] flex items-center justify-between text-xs font-cairo text-gray-400">
                <span>إجمالي الحركات المعروضة: <strong className="text-white font-mono">{filteredEntries.length}</strong> حركة</span>
                <button
                  type="button"
                  onClick={() => setSelectedFundForReport(null)}
                  className="py-1.5 px-4 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
