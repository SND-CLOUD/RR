import { CustomerAutocomplete } from '../CustomerAutocomplete';
import { resolveEntryDateString } from '../../lib/dateUtils';
import { sharePdfFile, openWhatsApp } from '../../lib/shareHelper';
import { calculateInvoiceBillableTotal, getItemBillableCost, isItemRefusedOrFailed } from '../../lib/billableService';
import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { collection, onSnapshot, doc, writeBatch, getDoc, setDoc, updateDoc, serverTimestamp } from '../../firebase';
import { db } from '../../firebase';
import { Invoice, InvoiceItem, User, isShopMaintenanceItem, isPurchaseInvoice, isSaleInvoice } from '../../types';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Search, Save, X, Info, HardDrive, User as UserIcon, ArrowLeft, ArrowRight, Phone, MapPin, Facebook, Smartphone, ChevronLeft, ChevronRight, SlidersHorizontal, MessageCircle, Wallet, Settings, ArrowUpDown, Scissors, Layers, AlertTriangle } from 'lucide-react';
import { localDb } from '../../lib/local-db';
import { ProviderFactory } from '../../data/ProviderFactory';
import ReportActions from '../ReportActions';
import PrintPreviewOverlay from '../PrintPreviewOverlay';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { sanitizeDocumentStyles, sanitizeElementInlineStyles, cleanOklchInStyleText, applyPrintStylesAndGetRestoreFn } from '../../lib/html2canvasHelper';
import BankAccountsFooter from '../BankAccountsFooter';

function isNoPartsText(text: any): boolean {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    t.includes('عدم توفر') ||
    t.includes('غير متوفر') ||
    t.includes('لا تتوفر') ||
    t.includes('لا توجد قطع') ||
    t.includes('قطع غير متوفرة') ||
    t.includes('no parts') ||
    t.includes('parts not available') ||
    t.includes('parts unavailable') ||
    t.includes('unavailability of parts')
  );
}

function isDeliveredStatus(status: any): boolean {
  return status === '60' || status === 'delivered';
}

function getItemSubStatus(item: InvoiceItem): string {
  if (item.subStatus) {
    return item.subStatus;
  }
  
  // For legacy items, fall back on their status field:
  if (item.status === 'ready') return 'ready';
  if (item.status === 'intact') return 'intact';
  if (item.status === 'unrepairable') return 'unrepairable';
  if (item.status === 'no_parts') return 'no_parts';
  if (item.status === 'refused') {
    const reason = (item.failureReason || '').toLowerCase();
    const report = (item.engineerReport || '').toLowerCase();
    if (isNoPartsText(reason) || isNoPartsText(report)) {
      return 'no_parts';
    }
    return 'refused';
  }
  if (item.status === '70' || item.status === 'cancelled') return 'cancelled';
  
  // If it's the unified code '50' but lacks subStatus (e.g. newly created before our fix):
  if (item.status === '50') {
    const report = (item.engineerReport || '').toLowerCase();
    const reason = (item.failureReason || '').toLowerCase();
    
    if (isNoPartsText(reason) || isNoPartsText(report)) {
      return 'no_parts';
    }
    if (reason.includes('لم يوافق') || report.includes('لم يوافق')) return 'refused';
    if (reason.includes('لا يصلح') || report.includes('لا يصلح') || reason.includes('unrepairable') || report.includes('unrepairable')) return 'unrepairable';
    if (report.includes('سليم') || report.includes('intact')) return 'intact';
    return 'ready';
  }
  
  return item.status || 'new';
}

const getStatusArabic = (status: string) => {
  switch (status) {
    case 'ready': return 'جاهز';
    case 'intact': return 'سليم';
    case 'unrepairable': return 'لا يصلح';
    case 'refused': return 'لم يوافق العميل';
    case 'no_parts': return 'عدم توفر قطع الغيار';
    default: return status || '-';
  }
};

function parseEngineerReport(reportStr: string) {
  const s = reportStr || '';
  const idx = s.indexOf(' | ');
  if (idx !== -1) {
    const technical = s.substring(0, idx);
    const outcome = s.substring(idx + 3);
    return {
      technical: technical.trim(),
      outcome: outcome.trim()
    };
  }
  return {
    technical: s.trim(),
    outcome: ''
  };
}

function normalizeCurrency(curr: string): string {
  if (!curr) return 'USD';
  const c = curr.trim().toUpperCase();
  if (c === 'USD' || c === 'دولار' || c === '$') return 'USD';
  if (c === 'SAR' || c === 'ريال سعودي' || c === 'سعودي' || c === 'ر.س') return 'SAR';
  if (c === 'YER' || c === 'ريال يمني' || c === 'يمني' || c === 'ر.ي') return 'YER';
  return c;
}

export default function DeviceExit({ user, onBack }: { user: User, onBack: () => void }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  const getCustomerPhone = (customerId: string) => {
    const c = customers.find(c => c.id === customerId);
    return c ? (c.phone1 || c.phone2 || '') : '';
  };

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'invoiceNumber', direction: 'desc' });
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('exit_visible_columns');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error(e);
    }
    return {
      invoiceNumber: true,
      customerName: true,
      totalDevices: true,
      exitReadyCount: true,
      unrepairableCount: true,
      intactCount: true,
      refusedCount: true,
      readyCount: true,
    };
  });
  
  useEffect(() => {
    localStorage.setItem('exit_visible_columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);
  
  // Selection
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [exitPaidAmount, setExitPaidAmount] = useState<number>(0);
  const [exitDiscountAmount, setExitDiscountAmount] = useState<number>(0);

  // Partial Split States
  const [targetSplitItem, setTargetSplitItem] = useState<InvoiceItem | null>(null);
  const [splitQuantity, setSplitQuantity] = useState<number>(1);
  const [splitInputText, setSplitInputText] = useState<string>('1');
  const [isSplitting, setIsSplitting] = useState<boolean>(false);
  const splitInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and highlight/select the entire number when the split modal opens
  useEffect(() => {
    if (targetSplitItem) {
      const qty = Number(targetSplitItem.quantity) || 1;
      setSplitQuantity(qty);
      setSplitInputText(String(qty));
      const timer = setTimeout(() => {
        if (splitInputRef.current) {
          splitInputRef.current.focus();
          splitInputRef.current.select();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [targetSplitItem]);

  // Keep invoiceItems in sync when items change while modal is open
  useEffect(() => {
    if (selectedInvoice) {
      const cleanInvNo = String(selectedInvoice.invoiceNumber || '').replace('#', '');
      const currentModalItems = items.filter(i => {
        const itClean = String(i.invoiceNumber || '').replace('#', '');
        return (itClean === cleanInvNo || i.invoiceId === selectedInvoice.id) && (EXIT_READY_STATUSES.includes(i.status) || isDeliveredStatus(i.status));
      });
      // Ensure strict uniqueness by ID
      const uniqueMap = new Map<string, InvoiceItem>();
      currentModalItems.forEach(it => {
        if (it.id) uniqueMap.set(it.id, it);
      });
      setInvoiceItems(Array.from(uniqueMap.values()));
    }
  }, [items, selectedInvoice]);

  // Other Payment Method States
  const [funds, setFunds] = useState<any[]>([]);
  const [showOtherPaymentModal, setShowOtherPaymentModal] = useState(false);
  const [otherPayment, setOtherPayment] = useState<{
    fundId: string;
    fundName: string;
    amount: number;
    currency: string;
    notes: string;
    type: 'cash' | 'bank';
    bankDetails?: { depositorName: string; referenceNumber: string };
    isActive: boolean;
    invoiceRate?: string;
    paymentRate?: string;
  } | null>(null);

  const [modalPaymentType, setModalPaymentType] = useState<'cash' | 'bank'>('cash');
  const [modalSelectedFundId, setModalSelectedFundId] = useState<string>('');
  const [modalAmount, setModalAmount] = useState<number>(0);
  const [modalNotes, setModalNotes] = useState<string>('');
  const [modalDepositorName, setModalDepositorName] = useState<string>('');
  const [modalReferenceNumber, setModalReferenceNumber] = useState<string>('');
  const [modalInvoiceRate, setModalInvoiceRate] = useState<string>('1');
  const [modalPaymentRate, setModalPaymentRate] = useState<string>('1');

  useEffect(() => {
    const fetchFunds = async () => {
      try {
        const res = await localDb.query("SELECT * FROM fin_funds ORDER BY name ASC");
        let activeFunds = res.values?.filter((f: any) => f.status === 'active') || [];
        if (activeFunds.length === 0 && res.values && res.values.length > 0) {
          activeFunds = res.values;
        }
        setFunds(activeFunds);
      } catch (err) {
        console.error("Error fetching funds:", err);
      }
    };
    fetchFunds();
  }, []);

  useEffect(() => {
    setOtherPayment(null);
  }, [selectedInvoice]);

  // Live exchange rate sync based on currency selection
  useEffect(() => {
    if (!showOtherPaymentModal) return;
    
    const invoiceCurrency = selectedInvoice?.currency || 'USD';
    const targetFund = funds.find(f => f.id === modalSelectedFundId);
    const paymentCurrency = targetFund?.currency || 'USD';

    if (normalizeCurrency(invoiceCurrency) === normalizeCurrency(paymentCurrency)) {
      setModalInvoiceRate('1');
      setModalPaymentRate('1');
    } else {
      // If previous rate was 1/1, we set sensible default or let it stay 1
      if (modalInvoiceRate === '1' && modalPaymentRate === '1') {
        const normInv = normalizeCurrency(invoiceCurrency);
        const normPay = normalizeCurrency(paymentCurrency);
        if (normInv === 'USD' && normPay === 'SAR') {
          setModalPaymentRate('3.8');
        } else {
          setModalPaymentRate('1');
        }
      }
    }
  }, [modalSelectedFundId, showOtherPaymentModal, selectedInvoice?.currency, funds]);

  const [isPayOnly, setIsPayOnly] = useState<boolean>(false);
  const [showPayOnlyConfirmModal, setShowPayOnlyConfirmModal] = useState<boolean>(false);
  const [prepaymentSuccessMsg, setPrepaymentSuccessMsg] = useState<string | null>(null);

  const [activePrintData, setActivePrintData] = useState<{
    sessionId?: string;
    timestamp?: string;
    invoice: Invoice;
    items: InvoiceItem[];
    paidAmount: number;
    discountAmount: number;
    taxAmount: number;
    remainingAmount: number;
    selectedCost: number;
    isPayOnly?: boolean;
    voucherData?: any;
    isPartialExit?: boolean;
    currentItemsTotal?: number;
    previousRemaining?: number;
    previousPaid?: number;
    paidForCurrent?: number;
    paidForPrevious?: number;
    totalInvoiceCost?: number;
  } | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const isFinalizingRef = useRef<boolean>(false);
  const finalizedSessionIds = useRef<Set<string>>(new Set());
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [shopConfig, setShopConfig] = useState<any>(null);
  const [currentOutput, setCurrentOutput] = useState<any>(null);
  
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(1123);

  useEffect(() => {
    if (activePrintData && printAreaRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          setContentHeight(entry.contentRect.height);
        }
      });
      resizeObserver.observe(printAreaRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [activePrintData]);

  useEffect(() => {
    const handleResize = () => {
      if (activePrintData && containerRef.current) {
        const containerWidth = containerRef.current.clientWidth - 48; // accounting for padding
        const containerHeight = containerRef.current.clientHeight - 48;
        if (containerWidth > 0 && containerHeight > 0) {
          const scaleW = containerWidth / 794;
          const scaleH = containerHeight / contentHeight;
          
          // Fit entirely without any scroll
          const newScale = Math.min(scaleW, scaleH);
          
          setScale(newScale > 0 ? newScale : 1);
        }
      }
    };

    if (activePrintData) {
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [contentHeight, activePrintData]);

  useEffect(() => {
    getDoc(doc(db, 'company_details', 'main_details')).then((snap) => {
      if (snap.exists()) setShopConfig(snap.data());
    });
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (s) => setInvoices(s.docs.map(d => ({ id: d.id, ...d.data() } as Invoice))));
    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (s) => {
      const rawList = s.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceItem));
      const uMap = new Map<string, InvoiceItem>();
      rawList.forEach(it => {
        if (it.id) uMap.set(it.id, it);
      });
      setItems(Array.from(uMap.values()));
    });
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (s) => setCustomers(s.docs.map(d => ({ ...d.data(), id: d.id } as any))));
    return () => { unsubInvoices(); unsubItems(); unsubCustomers(); };
  }, []);

  const EXIT_READY_STATUSES = ['ready', 'unrepairable', 'intact', 'refused', '50', '70', 'cancelled'];

  const readyInvoices = invoices.filter(inv => {
    // Exclude purchase and sale/other services invoices
    if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) return false;
    // Has at least one ready item that is a maintenance item
    return items.some(item => item.invoiceNumber === inv.invoiceNumber && isShopMaintenanceItem(item, inv) && EXIT_READY_STATUSES.includes(item.status));
  }).filter(inv => 
    (inv.customerName || '').toLowerCase().includes(search.toLowerCase()) || 
    (inv.invoiceNumber || '').includes(search)
  ).sort((a, b) => {
    let valA: any = '';
    let valB: any = '';

    switch (sortConfig.key) {
      case 'invoiceNumber':
        valA = Number(a.invoiceNumber);
        valB = Number(b.invoiceNumber);
        break;
      case 'customerName':
        valA = a.customerName || '';
        valB = b.customerName || '';
        break;
      case 'date':
      default:
        valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        break;
    }

    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const itemsPerPage = 6;
  const totalPages = Math.max(1, Math.ceil(readyInvoices.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  
  const paginatedInvoices = readyInvoices.slice(
    (safeCurrentPage - 1) * itemsPerPage,
    safeCurrentPage * itemsPerPage
  );

  const openInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsPayOnly(false);
    setPrepaymentSuccessMsg(null);
    const cleanInvNo = String(invoice.invoiceNumber || '').replace('#', '');
    const invoiceModalItems = items.filter(i => {
      const itClean = String(i.invoiceNumber || '').replace('#', '');
      return (itClean === cleanInvNo || i.invoiceId === invoice.id) && (EXIT_READY_STATUSES.includes(i.status) || isDeliveredStatus(i.status));
    });
    // Strict uniqueness by ID
    const uniqueMap = new Map<string, InvoiceItem>();
    invoiceModalItems.forEach(it => {
      if (it.id) uniqueMap.set(it.id, it);
    });
    const uniqueList = Array.from(uniqueMap.values());
    setInvoiceItems(uniqueList);
    
    // Select all ready items by default (excluding already delivered status 60 items)
    const activeReadyIds = new Set(uniqueList.filter(i => !isDeliveredStatus(i.status)).map(i => i.id!));
    setSelectedItemIds(activeReadyIds);

    // Default paid amount to 0
    setExitPaidAmount(0);
    setExitDiscountAmount(0);
  };

  const handleToggleItem = (id: string) => {
    const it = invoiceItems.find(i => i.id === id);
    if (it && isDeliveredStatus(it.status)) return;
    const newSet = new Set(selectedItemIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedItemIds(newSet);
  };

  const handleOpenSplitModal = (item: InvoiceItem) => {
    const qty = Number(item.quantity) || 1;
    setTargetSplitItem(item);
    setSplitQuantity(qty);
    setSplitInputText(String(qty));
  };

  const handleSplitInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!targetSplitItem) return;
    const maxQty = Number(targetSplitItem.quantity) || 1;
    const raw = e.target.value;
    
    // Strip non-digits
    const digits = raw.replace(/\D/g, '');
    
    if (digits === '') {
      setSplitInputText('');
      return;
    }

    const num = parseInt(digits, 10);

    // If 0 or greater than maxQty: auto revert to maxQty
    if (num === 0 || num > maxQty) {
      setSplitInputText(String(maxQty));
      setSplitQuantity(maxQty);
      setTimeout(() => {
        splitInputRef.current?.select();
      }, 0);
    } else {
      setSplitInputText(digits);
      setSplitQuantity(num);
    }
  };

  const handleSplitInputBlur = () => {
    if (!targetSplitItem) return;
    const maxQty = Number(targetSplitItem.quantity) || 1;
    const num = parseInt(splitInputText, 10);
    if (!num || num <= 0 || num > maxQty) {
      setSplitInputText(String(maxQty));
      setSplitQuantity(maxQty);
    }
  };

  const handleSplitInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirmSplit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!isSplitting) setTargetSplitItem(null);
    }
  };

  const handleConfirmSplit = async () => {
    if (!targetSplitItem || !selectedInvoice || isSplitting) return;
    const totalQty = Number(targetSplitItem.quantity) || 1;
    let exitQty = parseInt(splitInputText, 10);
    if (!exitQty || exitQty <= 0 || exitQty > totalQty) {
      exitQty = splitQuantity;
    }
    if (!exitQty || exitQty <= 0 || exitQty > totalQty) {
      exitQty = totalQty;
    }

    // If entire quantity is chosen (e.g. 8 out of 8), simply ensure it's selected and close
    if (exitQty === totalQty) {
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        next.add(targetSplitItem.id!);
        return next;
      });
      setTargetSplitItem(null);
      return;
    }

    const remainingQty = totalQty - exitQty;
    const totalCost = Number(targetSplitItem.cost) || 0;
    const unitCost = Number(targetSplitItem.unitCost) || (totalQty > 0 ? totalCost / totalQty : 0);
    const exitCost = exitQty * unitCost;
    const remainingCost = remainingQty * unitCost;

    setIsSplitting(true);
    try {
      const batch = writeBatch(db);

      // 1. Update original item to remaining quantity & cost
      const origRef = doc(db, 'invoice_items', targetSplitItem.id!);
      const splitEntryDate = resolveEntryDateString(targetSplitItem, selectedInvoice);
      const origUpdate = {
        quantity: remainingQty,
        cost: remainingCost,
        unitCost: unitCost,
        entryDate: splitEntryDate,
        updatedAt: serverTimestamp()
      };
      batch.update(origRef, origUpdate);

      // 2. Create new split item for the exiting pieces
      const newSplitRef = doc(collection(db, 'invoice_items'));
      const newSplitId = newSplitRef.id;
      const newSplitData: any = {
        id: newSplitId,
        invoiceId: targetSplitItem.invoiceId || selectedInvoice.id || '',
        invoiceNumber: targetSplitItem.invoiceNumber || selectedInvoice.invoiceNumber || '',
        customerName: targetSplitItem.customerName || selectedInvoice.customerName || '',
        categoryId: targetSplitItem.categoryId || '',
        deviceType: targetSplitItem.deviceType || '',
        deviceName: targetSplitItem.deviceName || '',
        faultType: targetSplitItem.faultType || '',
        customerProblem: targetSplitItem.customerProblem || targetSplitItem.faultType || '',
        deviceNotes: targetSplitItem.deviceNotes || '',
        engineerReport: targetSplitItem.engineerReport || '',
        technicalNotes: targetSplitItem.technicalNotes || '',
        failureReason: targetSplitItem.failureReason || '',
        quantity: exitQty,
        unitCost: unitCost,
        cost: exitCost,
        status: targetSplitItem.status || '50',
        subStatus: targetSplitItem.subStatus || 'ready',
        source: targetSplitItem.source || '',
        technician: targetSplitItem.technician || '',
        entryDate: splitEntryDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      batch.set(newSplitRef, newSplitData);

      await batch.commit();

      // 3. Update selectedItemIds: Select the newly split item (exitQty) and unselect remaining item
      setSelectedItemIds(prev => {
        const nextSet = new Set(prev);
        nextSet.delete(targetSplitItem.id!);
        nextSet.add(newSplitId);
        return nextSet;
      });

      setTargetSplitItem(null);
    } catch (err) {
      console.error('Error during partial split execution:', err);
    } finally {
      setIsSplitting(false);
    }
  };

  const handlePrintDirect = () => {
    const originalStyle = document.createElement('style');
    originalStyle.innerHTML = `
      @media print {
        @page { size: auto; margin: 0; }
        body * {
          visibility: hidden !important;
        }
        #print-preview-area, #print-preview-area * {
          visibility: visible !important;
        }
        #print-preview-area {
          position: absolute;
          left: 0;
          top: 0;
          width: 100% !important;
          margin: 0 !important;
          padding: 10mm !important;
          color: #000000 !important;
          background-color: #ffffff !important;
        }
      }
    `;
    document.head.appendChild(originalStyle);
    window.print();
    document.head.removeChild(originalStyle);
  };

  const handleExportPDFAndWhatsApp = async () => {
    if (!activePrintData) return;
    const { invoice, items: prItems, selectedCost } = activePrintData;
    const currency = invoice.currency || 'USD';

    setIsGeneratingPDF(true);
    let restore: (() => void) | null = null;

    try {
      const printArea = document.getElementById('print-preview-area');
      if (!printArea) {
        setIsGeneratingPDF(false);
        return;
      }

      // Sanitize Tailwind CSS styles for html-to-image compatibility
      restore = await sanitizeDocumentStyles();
      sanitizeElementInlineStyles(printArea);

      // Temporarily remove transform to ensure clean capture
      const parentElement = printArea.parentElement;
      let originalTransform = '';
      if (parentElement) {
        originalTransform = parentElement.style.transform;
        parentElement.style.transform = 'none';
      }

      const canvas = await htmlToImage.toCanvas(printArea, { 
        pixelRatio: 2, 
        backgroundColor: '#ffffff',
      });
      
      if (parentElement) {
        parentElement.style.transform = originalTransform;
      }
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
    
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
      let heightLeft = pdfHeight;
      let position = 0;
    
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight, undefined, 'FAST');
      heightLeft -= pdf.internal.pageSize.getHeight();
    
      while (heightLeft > 0.5) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight, undefined, 'FAST');
        heightLeft -= pdf.internal.pageSize.getHeight();
      }
      
      if (activePrintData.isPayOnly) {
        const formattedDate = new Date().toISOString().split('T')[0];
        const filename = `سند_قبض_مسبق_${invoice.customerName}_${invoice.invoiceNumber}_${formattedDate}.pdf`;
        pdf.save(filename);

        let message = `*سند قبض مالي - سداد مسبق* 📄\n\n`;
        message += `عزيزي العميل *${invoice.customerName}* المحترم،\n`;
        message += `تم استلام دفعة مالية على حساب فاتورة صيانة أجهزتكم رقم *#${invoice.invoiceNumber}*:\n\n`;
        message += `- *رقم السند:* #${activePrintData.voucherData?.voucherNumber || ''}\n`;
        message += `- *المبلغ المستلم:* ${Number(activePrintData.paidAmount).toLocaleString('en-US')} ${currency}\n`;
        message += `- *إجمالي تكلفة الفاتورة:* ${selectedCost.toLocaleString('en-US')} ${currency}\n`;
        message += `- *إجمالي المسدد حتى الآن:* ${(Number(invoice.amountPaid || 0) + Number(activePrintData.paidAmount)).toLocaleString('en-US')} ${currency}\n`;
        message += `- *المبلغ المتبقي:* ${activePrintData.remainingAmount.toLocaleString('en-US')} ${currency}\n`;
        message += `\n*ملاحظة:* أجهزتكم ما زالت في مركز الصيانة وبإمكانكم استلامها في أي وقت.\n`;
        message += `يسعدنا خدمتكم دائمًا. شكرًا لتعاملكم معنا!`;

        let sharedNatively = false;
        try {
          const pdfBlob = pdf.output('blob');
          sharedNatively = await sharePdfFile(pdfBlob, filename, message, 'voucher');
        } catch (err) {
          console.warn('Native sharing failed or was cancelled', err);
        }

        if (!sharedNatively) {
          const targetPhone = selectedInvoice.customerPhone || getCustomerPhone(selectedInvoice.customerId);
          openWhatsApp(message, targetPhone);
        }
        return;
      }

      const formattedDate = new Date().toISOString().split('T')[0];
      const filename = `فاتورة تسليم أجهزة_${invoice.customerName}_${formattedDate}.pdf`;
      pdf.save(filename);

      let message = `*فاتورة صيانة أجهزة* 📄\n\n`;
      message += `عزيزي العميل *${invoice.customerName}* المحترم،\n`;
      message += `تجد أدناه الفاتورة الخاصة باستلام أجهزتكم رقم *${invoice.invoiceNumber}*:\n\n`;
      message += `- *رقم الفاتورة:* ${invoice.invoiceNumber}\n`;
      message += `- *القيمة الإجمالية:* ${selectedCost.toLocaleString('en-US')} ${currency}\n`;
      if (activePrintData && activePrintData.discountAmount > 0) {
        message += `- *مبلغ الخصم:* ${activePrintData.discountAmount.toLocaleString('en-US')} ${currency}\n`;
      }
      if (activePrintData) {
        message += `- *المبلغ المدفوع:* ${activePrintData.paidAmount.toLocaleString('en-US')} ${currency}\n`;
        message += `- *المبلغ المتبقي:* ${activePrintData.remainingAmount.toLocaleString('en-US')} ${currency}\n`;
      }
      message += `\n*الأجهزة المستلمة:*\n`;
      prItems.forEach((item, index) => {
        const rawReport = item.failureReason || item.engineerReport || '';
        const parsed = parseEngineerReport(rawReport);
        const displayReport = parsed.outcome || '';
        const subStatus = getItemSubStatus(item);
        const statusArabic = getStatusArabic(subStatus);
        message += `\n_${index + 1}. *${item.deviceType} - ${item.deviceName || ''}*_\n`;
        message += `   • نتيجة الصيانة: ${statusArabic}${subStatus === 'ready' && displayReport ? ` - ${displayReport}` : ''}\n`;
        message += `   • التكلفة: ${(item.cost || item.unitCost || 0).toLocaleString('en-US')} ${currency}\n`;
      });
      message += `\nيسعدنا خدمتكم دائمًا. شكرًا لتعاملكم معنا!`;

      let sharedNatively = false;
      try {
        const pdfBlob = pdf.output('blob');
        sharedNatively = await sharePdfFile(pdfBlob, filename, message, 'invoice');
      } catch (err) {
        console.warn('Native sharing failed or was cancelled', err);
      }

      if (!sharedNatively) {
        const targetPhone = selectedInvoice.customerPhone || getCustomerPhone(selectedInvoice.customerId);
        openWhatsApp(message, targetPhone);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
    } finally {
      if (restore) {
        try {
          restore();
        } catch (restoreErr) {
          console.warn('Failed to restore document styles:', restoreErr);
        }
      }
      setIsGeneratingPDF(false);
    }
  };

  // 1. All maintenance items of this invoice
  const cleanSelectedInvNo = selectedInvoice ? String(selectedInvoice.invoiceNumber || '').replace('#', '') : '';
  const allInvoiceMaintenanceItems = selectedInvoice
    ? items.filter(i => {
        const itClean = String(i.invoiceNumber || '').replace('#', '');
        return (itClean === cleanSelectedInvNo || i.invoiceId === selectedInvoice.id) && isShopMaintenanceItem(i, selectedInvoice);
      })
    : [];

  const totalDevicesEntered = allInvoiceMaintenanceItems.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);

  // Total invoice amount (accurately derived from billable items only)
  const totalInvoiceAmount = calculateInvoiceBillableTotal(selectedInvoice, allInvoiceMaintenanceItems);

  // 2. Currently selected items cost for exit (excluding status 60 items)
  const currentSelectedCost = selectedInvoice
    ? invoiceItems.filter(i => selectedItemIds.has(i.id!) && !isDeliveredStatus(i.status) && getItemSubStatus(i) === 'ready').reduce((sum, item) => sum + getItemBillableCost(item), 0)
    : 0;

  const selectedCost = currentSelectedCost;
  const subtotal = currentSelectedCost;

  // 3. Previously delivered items cost in this invoice
  const previousDeliveredCost = selectedInvoice
    ? invoiceItems.filter(i => isDeliveredStatus(i.status) && getItemSubStatus(i) === 'ready').reduce((sum, item) => sum + getItemBillableCost(item), 0)
    : 0;

  // 4. Amount paid so far on the invoice
  const previousPaid = Number(selectedInvoice?.amountPaid || 0);

  // 5. Debt left from previous delivery or credit
  const previousDebt = previousDeliveredCost > previousPaid ? (previousDeliveredCost - previousPaid) : 0;
  const availableCredit = previousPaid > previousDeliveredCost ? (previousPaid - previousDeliveredCost) : 0;

  // 6. Current net cost
  const discount = exitDiscountAmount;
  const currentNetCost = Math.max(0, currentSelectedCost - discount);

  // 7. Total Due (المبلغ المستحق)
  const totalDueAmount = Math.max(0, currentNetCost + previousDebt - availableCredit);
  const total = totalDueAmount;

  // 8. Remaining balance
  const remainingCostForSelection = Math.max(0, totalDueAmount - exitPaidAmount);

  // Maximum allowed total coverage (الحد الأقصى المسموح به لمجموع الواصل + الخصم)
  const maxAllowedExitAmount = Math.max(0, currentSelectedCost + previousDebt - availableCredit);
  const totalCoveredAmount = Number(exitPaidAmount || 0) + Number(exitDiscountAmount || 0);
  const isOverAmount = totalCoveredAmount > (maxAllowedExitAmount + 0.001);

  const invoiceCurrency = selectedInvoice?.currency || 'USD';
  const targetFund = funds.find(f => f.id === modalSelectedFundId);
  const paymentCurrency = targetFund?.currency || 'USD';
  const isSameCurrency = normalizeCurrency(invoiceCurrency) === normalizeCurrency(paymentCurrency);

  const rate1 = parseFloat(modalInvoiceRate) || 1;
  const rate2 = parseFloat(modalPaymentRate) || 1;
  const payAmt = parseFloat(modalAmount as any) || 0;
  
  let convertedAmount = payAmt;
  if (!isSameCurrency) {
    if (rate2 > 0) {
      convertedAmount = Math.round((payAmt * (rate1 / rate2)) * 100) / 100;
    } else {
      convertedAmount = 0;
    }
  }
  
  const handleShowPreview = async () => {
    if (!selectedInvoice) return;
    if (!isPayOnly && selectedItemIds.size === 0) return;

    if (isPayOnly) {
      const payAmount = otherPayment?.isActive ? otherPayment.amount : exitPaidAmount;
      if (payAmount <= 0) {
        alert('يرجى كتابة المبلغ الواصل أو تحديد طريقة الدفع أولاً لإنشاء سند القبض.');
        return;
      }
      if (exitPaidAmount > totalDueAmount && !otherPayment?.isActive) {
        alert('المبلغ الواصل أكبر من المبلغ المستحق على الفاتورة!');
        return;
      }

      let nextNum = 1000;
      try {
        const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
        nextNum = (resNum.values?.[0]?.maxNum || 1000) + 1;
      } catch (e) {
        nextNum = 1001;
      }

      const printItems = invoiceItems.filter(i => selectedItemIds.has(i.id!) && !isDeliveredStatus(i.status));
      const sessionId = `prepay-sess-${selectedInvoice.id}-${Date.now()}`;
      const timestampIso = new Date().toISOString();

      const voucherData = {
        id: `preview-vtx-${selectedInvoice.id}`,
        type: 'receipt',
        voucherNumber: nextNum,
        amount: otherPayment?.isActive ? otherPayment.amount : exitPaidAmount,
        currency: otherPayment?.isActive ? otherPayment.currency : (selectedInvoice.currency || 'USD'),
        details: `سداد مسبق على فاتورة صيانة رقم #${selectedInvoice.invoiceNumber} (بدون خروج الأجهزة)`,
        category: 'سداد مسبق أجهزة',
        notes: otherPayment?.isActive 
          ? `طريقة الدفع: ${otherPayment.fundName} - ما يعادل ${exitPaidAmount} ${selectedInvoice.currency || 'USD'}${otherPayment.notes ? ' - ' + otherPayment.notes : ''}`
          : `سداد نقدي في الصندوق`,
        customerName: selectedInvoice.customerName || 'عميل نقدي',
        customerId: selectedInvoice.customerId || '',
        customerPhone: selectedInvoice.customerPhone || getCustomerPhone(selectedInvoice.customerId),
        date: new Date().toLocaleDateString('ar-EG'),
        timestamp: timestampIso,
        userName: user?.name || user?.username || 'مدير النظام',
        fundName: otherPayment?.isActive ? otherPayment.fundName : (funds.find(f => f.type === 'cash')?.name || 'الصندوق الرئيسي')
      };

      setActivePrintData({
        isPayOnly: true,
        voucherData,
        sessionId,
        timestamp: timestampIso,
        invoice: selectedInvoice,
        items: printItems,
        paidAmount: exitPaidAmount,
        discountAmount: 0,
        taxAmount: 0,
        remainingAmount: remainingCostForSelection,
        selectedCost: currentSelectedCost,
        isPartialExit: true,
        currentItemsTotal: currentSelectedCost,
        previousRemaining: previousDebt,
        previousPaid,
        paidForCurrent: exitPaidAmount,
        paidForPrevious: 0,
        totalInvoiceCost: totalInvoiceAmount
      });
      return;
    }

    if (isOverAmount) return;
    
    // Only active items selected for exit (excluding delivered ones)
    const printItems = invoiceItems.filter(i => selectedItemIds.has(i.id!) && !isDeliveredStatus(i.status));
    const currentExitingCount = printItems.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);

    const hasPreviousDelivered = allInvoiceMaintenanceItems.some(i => isDeliveredStatus(i.status));
    const isFullExit = !hasPreviousDelivered && (currentExitingCount === totalDevicesEntered);
    const isPartialExit = !isFullExit;

    let paidForCurrent = Math.min(exitPaidAmount, currentNetCost);
    let paidForPrevious = 0;
    if (exitPaidAmount > currentNetCost && previousDebt > 0) {
      paidForPrevious = Math.min(exitPaidAmount - currentNetCost, previousDebt);
    }

    const sessionId = `exit-sess-${selectedInvoice.id}-${Date.now()}`;
    const timestampIso = new Date().toISOString();

    setActivePrintData({
      isPayOnly: false,
      sessionId,
      timestamp: timestampIso,
      invoice: selectedInvoice,
      items: printItems,
      paidAmount: exitPaidAmount,
      discountAmount: exitDiscountAmount,
      taxAmount: 0,
      remainingAmount: remainingCostForSelection,
      selectedCost: currentSelectedCost,
      isPartialExit,
      currentItemsTotal: currentSelectedCost,
      previousRemaining: previousDebt,
      previousPaid,
      paidForCurrent,
      paidForPrevious,
      totalInvoiceCost: totalInvoiceAmount
    });
  };

  const finalizePrepaymentReceipt = async (): Promise<boolean> => {
    if (!activePrintData || !selectedInvoice) {
      console.warn("finalizePrepaymentReceipt: missing activePrintData or selectedInvoice");
      return false;
    }
    
    const sessionId = activePrintData.sessionId || `prepay-sess-${selectedInvoice.id}-${Date.now()}`;
    if (finalizedSessionIds.current.has(sessionId) || isFinalizingRef.current) {
      return true;
    }

    isFinalizingRef.current = true;
    setIsFinalizing(true);

    try {
      const paidAmount = Number(activePrintData.paidAmount);
      if (paidAmount <= 0) {
        alert('المبلغ الواصل يجب أن يكون أكبر من الصفر لإنشاء سند القبض.');
        return false;
      }

      // Generate the voucher number
      let nextNum = 1000;
      try {
        const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
        nextNum = (resNum.values?.[0]?.maxNum || 1000) + 1;
      } catch (e) {
        nextNum = 1001;
      }

      const txId = `vtx-${selectedInvoice.id}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const timestampIso = activePrintData.timestamp || new Date().toISOString();

      if (otherPayment && otherPayment.isActive) {
        const bankDetailsJson = otherPayment.type === 'bank' && otherPayment.bankDetails
          ? JSON.stringify(otherPayment.bankDetails)
          : '';

        const exchangeRateText = otherPayment.invoiceRate && otherPayment.paymentRate
          ? ` [سعر الصرف: ${otherPayment.invoiceRate} لعملة الفاتورة مقابل ${otherPayment.paymentRate} لعملة الدفع]`
          : '';

        const finalNotes = otherPayment.notes 
          ? `سداد مسبق لفاتورة صيانة رقم ${selectedInvoice.invoiceNumber} (بدون خروج الأجهزة) - ${otherPayment.notes}${exchangeRateText}` 
          : `سداد مسبق لفاتورة صيانة رقم ${selectedInvoice.invoiceNumber} (بدون خروج الأجهزة)${exchangeRateText}`;

        await ProviderFactory.getProvider().setDoc('vault_transactions', txId, {
          id: txId,
          currency: otherPayment.currency,
          amount: otherPayment.amount,
          customerName: selectedInvoice.customerName || 'عميل نقدي',
          invoiceNumber: String(selectedInvoice.invoiceNumber),
          invoiceId: selectedInvoice.id || '',
          userName: user?.name || user?.username || 'مدير النظام',
          userNumber: 1,
          userId: user?.id || 'admin',
          timestamp: timestampIso,
          type: 'receipt',
          notes: finalNotes,
          updatedAt: timestampIso,
          voucherNumber: nextNum,
          transactionCategory: 'سداد مسبق أجهزة',
          tag: `PREPAY_INV_${selectedInvoice.invoiceNumber}`,
          fundId: otherPayment.fundId,
          fundName: otherPayment.fundName,
          customerId: selectedInvoice.customerId || '',
          isReversed: 0,
          isReversal: 0,
          reversalOf: '',
          paymentType: 2,
          liabilityCurrency: selectedInvoice.currency || 'USD',
          liabilityAmount: paidAmount,
          receiptCurrency: otherPayment.currency,
          receiptAmount: otherPayment.amount,
          bankDetails: bankDetailsJson
        });

        await ProviderFactory.getProvider().updateDoc('fin_funds', otherPayment.fundId, { 
          balance: { type: 'increment', value: otherPayment.amount } 
        });
      } else {
        const defaultFund = funds.find(f => f.type === 'cash' && f.currency === (selectedInvoice.currency || 'USD')) || funds.find(f => f.type === 'cash');
        if (defaultFund) {
          await ProviderFactory.getProvider().setDoc('vault_transactions', txId, {
            id: txId,
            currency: selectedInvoice.currency || 'USD',
            amount: paidAmount,
            customerName: selectedInvoice.customerName || 'عميل نقدي',
            invoiceNumber: String(selectedInvoice.invoiceNumber),
            invoiceId: selectedInvoice.id || '',
            userName: user?.name || user?.username || 'مدير النظام',
            userNumber: 1,
            userId: user?.id || 'admin',
            timestamp: timestampIso,
            type: 'receipt',
            notes: `سداد مسبق لفاتورة صيانة رقم ${selectedInvoice.invoiceNumber} (بدون خروج الأجهزة)`,
            updatedAt: timestampIso,
            voucherNumber: nextNum,
            transactionCategory: 'سداد مسبق أجهزة',
            tag: `PREPAY_INV_${selectedInvoice.invoiceNumber}`,
            fundId: defaultFund.id,
            fundName: defaultFund.name,
            customerId: selectedInvoice.customerId || '',
            isReversed: 0,
            isReversal: 0,
            reversalOf: '',
            paymentType: 1,
            liabilityCurrency: selectedInvoice.currency || 'USD',
            liabilityAmount: paidAmount,
            receiptCurrency: selectedInvoice.currency || 'USD',
            receiptAmount: paidAmount,
            bankDetails: ''
          });

          await ProviderFactory.getProvider().updateDoc('fin_funds', defaultFund.id, { 
            balance: { type: 'increment', value: paidAmount } 
          });
        }
      }

      // Update invoice amountPaid
      const newAmountPaid = Number(selectedInvoice.amountPaid || 0) + paidAmount;
      const invoiceRef = doc(db, 'invoices', selectedInvoice.id!);
      await updateDoc(invoiceRef, {
        amountPaid: newAmountPaid,
        updatedAt: serverTimestamp()
      });

      try {
        await localDb.run("UPDATE invoices SET amountPaid = ? WHERE id = ?", [newAmountPaid, selectedInvoice.id]);
      } catch (e) {}

      setSelectedInvoice(prev => prev ? { ...prev, amountPaid: newAmountPaid } : null);
      finalizedSessionIds.current.add(sessionId);

      setPrepaymentSuccessMsg(`تم ترحيل وحفظ سند القبض رقم #${nextNum} بنجاح بمبلغ ${paidAmount} ${selectedInvoice.currency || 'USD'}. تم تحديث حساب الفاتورة (الأجهزة ما زالت في المحل جاهزة للاستلام).`);
      setTimeout(() => setPrepaymentSuccessMsg(null), 9000);

      // Reset payment fields
      setExitPaidAmount(0);
      setOtherPayment(null);
      setIsPayOnly(false);

      return true;
    } catch (err) {
      console.error("Error in finalizePrepaymentReceipt:", err);
      alert('حدث خطأ أثناء حفظ سند القبض. يرجى المحاولة مرة أخرى.');
      return false;
    } finally {
      isFinalizingRef.current = false;
      setIsFinalizing(false);
    }
  };

  const finalizeExit = async (currentItems: InvoiceItem[]): Promise<boolean> => {
    console.log("finalizeExit called", { activePrintData, selectedInvoice, selectedItemIds: Array.from(selectedItemIds), itemsCount: currentItems.length });
    if (!activePrintData || !selectedInvoice) {
      console.warn("finalizeExit: missing activePrintData or selectedInvoice");
      return false;
    }
    
    const sessionId = activePrintData.sessionId || `exit-sess-${selectedInvoice.id}`;
    if (finalizedSessionIds.current.has(sessionId) || isFinalizingRef.current) {
      console.warn("finalizeExit: session already finalized or finalizing in progress", sessionId);
      return true;
    }

    isFinalizingRef.current = true;
    setIsFinalizing(true);

    try {
      console.log("finalizeExit: starting batch commit", { 
        itemCount: selectedItemIds.size, 
        invoiceId: selectedInvoice.id,
        paidAmount: activePrintData.paidAmount,
        discountAmount: activePrintData.discountAmount,
        taxAmount: activePrintData.taxAmount,
        selectedCost: activePrintData.selectedCost
      });
      // Process delivery
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        const itemObj = invoiceItems.find(i => i.id === id);
        if (itemObj && isDeliveredStatus(itemObj.status)) return;
        const itemRef = doc(db, 'invoice_items', id);
        batch.update(itemRef, { status: '60', deliveredAt: new Date().getTime(), updatedAt: serverTimestamp() });
      });

      // Update amountPaid on the Invoice
      const invoiceRef = doc(db, 'invoices', selectedInvoice.id!);
      const newAmountPaid = Number(selectedInvoice.amountPaid || 0) + Number(activePrintData.paidAmount);
      const newDiscount = Number(selectedInvoice.discount || 0) + Number(activePrintData.discountAmount);
      const newTax = Number(selectedInvoice.tax || 0) + Number(activePrintData.taxAmount);
      
      // Check if ALL items of the invoice are now delivered
      const allInvoiceItems = currentItems.filter(i => i.invoiceNumber === selectedInvoice.invoiceNumber);
      const allDelivered = allInvoiceItems.every(i => i.status === '60' || selectedItemIds.has(i.id!));
      
      // Calculate new totalCost of the invoice accurately using billable items only and the updated discount/tax
      const newTotalCost = calculateInvoiceBillableTotal(
        { ...selectedInvoice, discount: newDiscount, tax: newTax },
        allInvoiceItems
      );
      
      const invoiceUpdates: any = {
        totalCost: newTotalCost,
        amountPaid: newAmountPaid,
        discount: newDiscount,
        tax: newTax,
        updatedAt: serverTimestamp(),
        printCount: (selectedInvoice.printCount || 0) + 1
      };
      
      if (allDelivered) {
        invoiceUpdates.status = '60'; // fully delivered
      }
      
      batch.update(invoiceRef, invoiceUpdates);

      // Save transaction in vault_transactions if paid amount is higher than 0
      if (Number(activePrintData.paidAmount) > 0) {
        // Generate the voucher number
        let nextNum = 1000;
        try {
          const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
          nextNum = (resNum.values?.[0]?.maxNum || 1000) + 1;
        } catch (e) {
          nextNum = 1001; // fallback
        }

        // 1. If Other Payment is active
        if (otherPayment && otherPayment.isActive) {
          try {
            const txId = `vtx-${selectedInvoice.id}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
            const timestampIso = activePrintData.timestamp || new Date().toISOString();
            
            const bankDetailsJson = otherPayment.type === 'bank' && otherPayment.bankDetails
              ? JSON.stringify(otherPayment.bankDetails)
              : '';

            const exchangeRateText = otherPayment.invoiceRate && otherPayment.paymentRate
              ? ` [سعر الصرف: ${otherPayment.invoiceRate} لعملة الفاتورة مقابل ${otherPayment.paymentRate} لعملة الدفع]`
              : '';

            const finalNotes = otherPayment.notes 
              ? `سداد في الفاتورة رقم ${selectedInvoice.invoiceNumber} - ${otherPayment.notes}${exchangeRateText}` 
              : `سداد في الفاتورة رقم ${selectedInvoice.invoiceNumber}${exchangeRateText}`;

            
            await ProviderFactory.getProvider().setDoc('vault_transactions', txId, {
                id: txId,
                currency: otherPayment.currency,
                amount: otherPayment.amount,
                customerName: selectedInvoice.customerName || 'عميل نقدي',
                invoiceNumber: String(selectedInvoice.invoiceNumber),
                userName: user?.name || user?.username || 'مدير النظام',
                userNumber: 1,
                userId: user?.id || 'admin',
                timestamp: timestampIso,
                type: 'receipt',
                notes: finalNotes,
                updatedAt: timestampIso,
                voucherNumber: nextNum,
                transactionCategory: 'دفعة أجهزة',
                fundId: otherPayment.fundId,
                fundName: otherPayment.fundName,
                customerId: selectedInvoice.customerId || '',
                isReversed: 0,
                isReversal: 0,
                reversalOf: '',
                paymentType: 2,
                liabilityCurrency: selectedInvoice.currency || 'USD',
                liabilityAmount: Number(activePrintData.paidAmount),
                receiptCurrency: otherPayment.currency,
                receiptAmount: otherPayment.amount,
                bankDetails: bankDetailsJson
            });

            await ProviderFactory.getProvider().updateDoc('fin_funds', otherPayment.fundId, { balance: { type: 'increment', value: otherPayment.amount } });


          } catch (sqliteErr) {
            console.error("Failed to write other payment to SQLite/Firestore:", sqliteErr);
          }
        } else {
          // 2. Standard Cash Payment - Automatic routing to default cash fund for the invoice's currency
          const defaultFund = funds.find(f => f.type === 'cash' && f.currency === (selectedInvoice.currency || 'USD')) || funds.find(f => f.type === 'cash');
          if (defaultFund) {
            try {
              const txId = `vtx-${selectedInvoice.id}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
              const timestampIso = activePrintData.timestamp || new Date().toISOString();
              
              await ProviderFactory.getProvider().setDoc('vault_transactions', txId, {
                  id: txId,
                  currency: selectedInvoice.currency || 'USD',
                  amount: Number(activePrintData.paidAmount),
                  customerName: selectedInvoice.customerName || 'عميل نقدي',
                  invoiceNumber: String(selectedInvoice.invoiceNumber),
                  userName: user?.name || user?.username || 'مدير النظام',
                  userNumber: 1,
                  userId: user?.id || 'admin',
                  timestamp: timestampIso,
                  type: 'receipt',
                  notes: `سداد في الفاتورة رقم ${selectedInvoice.invoiceNumber}`,
                  updatedAt: timestampIso,
                  voucherNumber: nextNum,
                  transactionCategory: 'دفعة أجهزة',
                  fundId: defaultFund.id,
                  fundName: defaultFund.name,
                  customerId: selectedInvoice.customerId || '',
                  isReversed: 0,
                  isReversal: 0,
                  reversalOf: '',
                  paymentType: 1,
                  liabilityCurrency: selectedInvoice.currency || 'USD',
                  liabilityAmount: Number(activePrintData.paidAmount),
                  receiptCurrency: selectedInvoice.currency || 'USD',
                  receiptAmount: Number(activePrintData.paidAmount),
                  bankDetails: ''
              });

              await ProviderFactory.getProvider().updateDoc('fin_funds', defaultFund.id, { balance: { type: 'increment', value: Number(activePrintData.paidAmount) } });


            } catch (sqliteErr) {
              console.error("Failed to write standard payment to SQLite/Firestore:", sqliteErr);
            }
          }
        }
      }

      await batch.commit();
      finalizedSessionIds.current.add(sessionId);
      console.log("finalizeExit: batch committed successfully");
      return true;
    } catch (error) {
      console.error("finalizeExit: error committing batch", error);
      throw error;
    } finally {
      isFinalizingRef.current = false;
      setIsFinalizing(false);
    }
  };

  const handlePrintAndFinalize = async () => {
    if (isFinalizingRef.current) return;
    try {
      const ok = await finalizeExit(items);
      if (ok) {
        handlePrintDirect();
        setActivePrintData(null);
        setSelectedInvoice(null);
      }
    } catch (err) {
      console.error("Error during print and finalize:", err);
    }
  };

  const handleExportAndFinalize = async () => {
    if (isFinalizingRef.current) return;
    try {
      const ok = await finalizeExit(items);
      if (ok) {
        await handleExportPDFAndWhatsApp();
        setActivePrintData(null);
        setSelectedInvoice(null);
      }
    } catch (err) {
      console.error("Error during export and finalize:", err);
    }
  };

  const handleSaveAndFinalize = async () => {
    if (isFinalizingRef.current) return;
    try {
      const ok = await finalizeExit(items);
      if (ok) {
        setActivePrintData(null);
        setSelectedInvoice(null);
      }
    } catch (err) {
      console.error("Error during save and finalize:", err);
    }
  };

  return (
    <div className="w-full max-w-full space-y-0 pb-0 m-0 p-0 text-right font-sans" dir="rtl">
      {activePrintData && !activePrintData.isPayOnly && (
        <PrintPreviewOverlay
          type="invoice"
          isSaving={isFinalizing}
          data={{
            invoice: {
              ...activePrintData.invoice,
              totalCost: activePrintData.selectedCost,
              amountPaid: Number(activePrintData.invoice.amountPaid || 0) + Number(activePrintData.paidAmount),
              discount: activePrintData.discountAmount,
              tax: activePrintData.taxAmount,
              printCount: activePrintData.invoice.printCount || 0
            },
            items: activePrintData.items,
            templateType: 'exit',
            isPartialExit: activePrintData.isPartialExit,
            currentItemsTotal: activePrintData.currentItemsTotal,
            previousRemaining: activePrintData.previousRemaining,
            previousPaid: activePrintData.previousPaid,
            paidForCurrent: activePrintData.paidForCurrent,
            paidForPrevious: activePrintData.paidForPrevious,
            paidAmount: activePrintData.paidAmount,
            discountAmount: activePrintData.discountAmount,
            remainingAmount: activePrintData.remainingAmount,
            totalInvoiceCost: activePrintData.totalInvoiceCost
          }}
          onClose={() => {
            if (!isFinalizing) {
              setActivePrintData(null);
            }
          }}
          shopConfig={shopConfig}
          user={user}
          onPrint={handlePrintAndFinalize}
          onWhatsApp={handleExportAndFinalize}
          onSave={handleSaveAndFinalize}
        />
      )}

      {activePrintData && activePrintData.isPayOnly && (
        <PrintPreviewOverlay
          type="voucher"
          isSaving={isFinalizing}
          data={{
            voucher: activePrintData.voucherData
          }}
          onClose={() => {
            if (!isFinalizing) {
              setActivePrintData(null);
            }
          }}
          shopConfig={shopConfig}
          user={user}
          onPrint={async () => {
            const ok = await finalizePrepaymentReceipt();
            if (ok) {
              handlePrintDirect();
              setActivePrintData(null);
            }
          }}
          onWhatsApp={async () => {
            const ok = await finalizePrepaymentReceipt();
            if (ok) {
              await handleExportPDFAndWhatsApp();
              setActivePrintData(null);
            }
          }}
          onSave={async () => {
            const ok = await finalizePrepaymentReceipt();
            if (ok) {
              setActivePrintData(null);
            }
          }}
        />
      )}
      {false && activePrintData && (
        <div className="fixed inset-0 z-[120] bg-black/95 flex flex-col" dir="rtl">
          {/* Top Navbar */}
          <div className="flex justify-between items-center bg-black/50 p-4 border-b border-white/10 shrink-0 flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setActivePrintData(null)}
                className="w-10 h-10 flex justify-center items-center bg-slate-200 border border-slate-300 rounded-xl text-slate-900 hover:bg-slate-300 transition-all shadow-md"
                title="العودة للتعديل"
              >
                <ArrowRight size={18} />
              </button>
              <h2 className="text-white font-bold hidden sm:block mr-2">فاتورة خروج أجهزه - #{activePrintData.invoice.invoiceNumber}</h2>
            </div>
            
            <div className="flex items-center gap-2">
              <ReportActions 
                onPrint={handlePrintAndFinalize}
                onWhatsApp={handleExportAndFinalize}
                isGenerating={isGeneratingPDF}
              />
            </div>
          </div>

          {/* Scalable Container for the A4 page */}
          <div 
            ref={containerRef}
            className="flex-1 w-full h-full relative overflow-hidden flex items-center justify-center p-6 bg-black"
          >
            <div 
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'center center',
                width: '794px',
                minHeight: '1123px',
                transition: 'transform 0.1s ease-out'
              }}
              className="bg-white shadow-2xl relative flex flex-col"
            >
              <div ref={printAreaRef} id="print-report-area" className="w-[794px] min-h-[1123px] flex flex-col relative print:w-auto print:min-h-0 print:h-auto bg-white p-8">
                <div className="absolute left-8 top-1.5 text-[8px] text-gray-400 font-normal select-none opacity-45 font-mono pointer-events-none flex items-center gap-1.5" dir="rtl">
                  <span>تاريخ ووقت الطباعة: {new Date().toLocaleDateString('ar-YE')} {new Date().toLocaleTimeString('ar-YE', { hour12: true, hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="border border-gray-400 px-1 rounded font-bold text-[9px] text-gray-500 bg-transparent inline-block font-sans ml-1">
                    {(activePrintData.invoice.printCount || 0) + 1}
                  </span>
                </div>

              {/* Header Layout */}
              <div className="flex justify-between items-start border-b-2 border-gray-900 pb-4 mb-4">
                {/* Right Corner: Shop Name */}
                <div className="text-right flex-1 pt-1">
                  <h2 className="text-xl font-black text-gray-900 leading-tight font-cairo whitespace-nowrap">{shopConfig?.shopName || 'عالم الصيانة والتجارة'}</h2>
                  <div className="text-sm font-black text-gray-900 leading-tight mt-1.5 font-cairo">قسم الصيانة</div>
                  <div className="mt-2 space-y-1">
                    {(shopConfig?.phone1 || shopConfig?.phone2) && (
                      <div className="text-[10px] font-bold text-gray-800 flex items-center justify-start gap-1.5 w-fit">
                        <span>تلفون :</span>
                        <span dir="ltr" className="font-mono">
                          {shopConfig?.phone1}
                          {shopConfig?.phone1 && shopConfig?.phone2 && ' - '}
                          {shopConfig?.phone2}
                        </span>
                        <div className="flex items-center gap-1 mr-1.5">
                          <Smartphone size={10} className="text-gray-700" />
                          {(shopConfig?.phone1Whatsapp || shopConfig?.phone2Whatsapp) && (
                            <MessageCircle size={10} className="text-green-600" />
                          )}
                        </div>
                      </div>
                    )}
                    {shopConfig?.landline && (
                      <div className="text-[10px] font-bold text-gray-800 flex items-center justify-start gap-1.5 w-fit">
                        <span>ثابت :</span>
                        <span dir="ltr" className="font-mono">{shopConfig.landline}</span>
                        <div className="flex items-center gap-1 mr-1.5">
                          <Phone size={10} className="text-gray-700" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Center: Title / Logo */}
                <div className="text-center flex-[1.2] flex flex-col items-center justify-center">
                  {shopConfig?.logoUrl ? (
                    <img src={shopConfig.logoUrl} alt="Logo" className="h-16 max-w-[150px] object-contain mb-1.5" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-12 border border-dashed border-gray-300 rounded-xl mb-1.5 flex items-center justify-center text-gray-400 text-[10px] font-bold">شعار المحل</div>
                  )}
                  <h1 className="text-lg font-black text-gray-900 border-2 border-gray-900 px-4 py-1.5 rounded-lg inline-block bg-gray-50/50">فاتورة صيانة أجهزة</h1>
                </div>

                {/* Left Corner: Invoice Info */}
                <div className="text-left flex-1 space-y-1 pt-1 bg-gray-50/50 p-3 rounded-lg border border-gray-200">
                  <div className="text-sm font-bold text-gray-700 flex justify-between gap-4">
                    <span>رقم التقرير:</span>
                    <span className="font-mono text-gray-900">{activePrintData.invoice.invoiceNumber}</span>
                  </div>
                  <div className="text-sm font-bold text-gray-700 flex justify-between gap-4">
                    <span>التاريخ:</span>
                    <span className="font-mono text-gray-900">{new Date().toISOString().slice(0,10).replace(/-/g, '/')}</span>
                  </div>
                  <div className="text-sm font-bold text-gray-700 flex justify-between gap-4">
                    <span>وقت الإصدار:</span>
                    <span className="font-mono text-gray-900">
                      {new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-gray-700 flex justify-between gap-4 border-t border-gray-200 pt-1 mt-1 font-cairo">
                    <span>رقم المستخدم:</span>
                    <span className="font-mono text-gray-900">{user?.userNumber || '100'}</span>
                  </div>
                </div>
              </div>

              {/* Customer Info Single Line */}
              {(() => {
                const custId = activePrintData.invoice.customerId;
                const name = activePrintData.invoice.customerName;
                let company = '';
                let phone = activePrintData.invoice.customerPhone || '';

                let matchedCust = customers.find(c => c.id === custId);
                if (!matchedCust && name) {
                  matchedCust = customers.find(c => c.name === name);
                }

                if (matchedCust) {
                  company = matchedCust.companyName || '';
                  if (!phone) phone = matchedCust.phone1 || '';
                }

                return (
                  <div className="bg-gray-100 p-3 rounded-lg mb-4 border border-gray-300 flex flex-row items-center justify-start gap-6 px-6 text-sm font-black text-gray-900 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="text-xs text-gray-600 ml-2 whitespace-nowrap">إسم العميل:</span>
                      <span className="text-gray-900 font-black">{name || 'عام'}</span>
                    </div>
                    {company && company !== '---' && (
                      <div className="border-r border-gray-300 pr-4 flex items-center">
                        <span className="text-xs text-gray-600 ml-2 whitespace-nowrap">الجهة:</span>
                        <span className="text-gray-900 font-black">{company}</span>
                      </div>
                    )}
                    {phone && phone !== '---' && (
                      <div className="border-r border-gray-300 pr-4 flex items-center">
                        <span className="text-xs text-gray-600 ml-2 whitespace-nowrap">الجوال:</span>
                        <span className="font-mono text-gray-900" dir="ltr">{phone}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Device Detailed Items Table */}
              <div className="border border-gray-400 overflow-hidden mb-4 rounded-md">
                <table className="w-full text-right border-collapse text-sm">
                  <thead className="bg-gray-100 text-gray-800 font-bold border-b-2 border-gray-400">
                    <tr>
                      <th className="px-3 py-3 text-center w-12 border-l border-gray-400 bg-gray-200/50">مسلسل</th>
                      <th className="px-3 py-3 border-l border-gray-400">النوع / الجهاز</th>
                      <th className="px-3 py-3 border-l border-gray-400">الحالة</th>
                      <th className="px-3 py-3 text-center border-l border-gray-400 w-28">تكلفة الصيانة</th>
                      <th className="px-3 py-3 text-center border-l border-gray-400 w-24">العدد</th>
                      <th className="px-3 py-3 text-center w-32 font-black bg-gray-200/50">اجمالي التكلفة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-300">
                    {(() => {
                      const getConditionRank = (item: any) => {
                        const subStatus = getItemSubStatus(item);
                        if (subStatus === 'ready') return 1;
                        if (subStatus === 'intact') return 2;
                        if (subStatus === 'unrepairable') return 3;
                        if (subStatus === 'refused') return 4;
                        return 5;
                      };
                      const typeRanks: Record<string, number> = {};
                      const nameRanks: Record<string, number> = {};
                      activePrintData.items.forEach(item => {
                        const t = item.deviceType || '';
                        const n = item.deviceName || '';
                        const key = `${t}|${n}`;
                        const r = getConditionRank(item);
                        if (!(t in typeRanks) || r < typeRanks[t]) typeRanks[t] = r;
                        if (!(key in nameRanks) || r < nameRanks[key]) nameRanks[key] = r;
                      });

                      return [...activePrintData.items].sort((a, b) => {
                        const tA = a.deviceType || '';
                        const tB = b.deviceType || '';
                        if (typeRanks[tA] !== typeRanks[tB]) return typeRanks[tA] - typeRanks[tB];
                        if (tA !== tB) return tA.localeCompare(tB, 'ar');
                        
                        const nA = a.deviceName || '';
                        const nB = b.deviceName || '';
                        const keyA = `${tA}|${nA}`;
                        const keyB = `${tB}|${nB}`;
                        if (nameRanks[keyA] !== nameRanks[keyB]) return nameRanks[keyA] - nameRanks[keyB];
                        if (nA !== nB) return nA.localeCompare(nB, 'ar');
                        
                        return getConditionRank(a) - getConditionRank(b);
                      }).map((item, idx) => {
                        const itemQty = Number(item.quantity || 1);
                        const totalItemCost = Number(item.cost || 0);
                        const unitItemCost = item.unitCost || (itemQty > 0 ? totalItemCost / itemQty : 0);
                        const subStatusArabic = getStatusArabic(getItemSubStatus(item));
                        const { outcome } = parseEngineerReport(item.engineerReport || '');
                        
                        return (
                          <tr key={`${item.id || 'item'}-${idx}`} className="even:bg-gray-50/50">
                            <td className="px-3 py-3 text-center font-mono font-bold border-l border-gray-400 bg-gray-50">{idx + 1}</td>
                            <td className="px-3 py-3 font-bold text-gray-900 border-l border-gray-400 leading-relaxed whitespace-nowrap overflow-hidden max-w-[200px] text-ellipsis">
                              {item.deviceType || '-'} {item.deviceName ? `- ${item.deviceName}` : ''}
                            </td>
                            <td className="px-3 py-3 text-gray-900 font-bold leading-relaxed border-l border-gray-400 whitespace-nowrap">
                              {subStatusArabic}{subStatusArabic === 'جاهز' && outcome ? ` - ${outcome}` : ''}
                            </td>
                            <td className="px-3 py-3 text-center font-mono text-gray-900 border-l border-gray-400">
                              {unitItemCost.toLocaleString('en-US')} <span className="text-[10px] font-sans mr-0.5">{selectedInvoice.currency || 'USD'}</span>
                            </td>
                            <td className="px-3 py-3 text-center font-mono text-gray-900 border-l border-gray-400">
                              {itemQty}
                            </td>
                            <td className="px-3 py-3 text-center font-mono font-black text-gray-900 bg-gray-50">
                              {totalItemCost.toLocaleString('en-US')} <span className="text-[10px] font-sans mr-0.5">{selectedInvoice.currency || 'USD'}</span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                    {/* Last rows for totals */}
                    <tr className="bg-gray-200/60 font-bold border-t-2 border-gray-400">
                      <td colSpan={4} className="px-3 py-4 text-left font-black border-l border-gray-400 text-base">إجمالى عدد الأجهزة ومبلغ الفاتورة</td>
                      <td className="px-3 py-4 text-center font-mono font-black border-l border-gray-400 text-lg">
                        {activePrintData.items.reduce((sum, item) => sum + Number(item.quantity || 1), 0)}
                      </td>
                      <td className="px-3 py-4 text-center font-mono font-black text-xl text-gray-900 border-l border-gray-400">
                        {activePrintData.selectedCost.toLocaleString('en-US')} <span className="text-sm font-sans mr-1">{activePrintData.invoice.currency || 'USD'}</span>
                      </td>
                    </tr>
                    {/* Combine discount, paid amount, and remaining amount in a single horizontal row */}
                    <tr className="bg-white font-bold border-t border-gray-400">
                      {activePrintData.discountAmount > 0 ? (
                        <>
                          {/* Discount Amount */}
                          <td colSpan={2} className="px-3 py-3 text-center border-l border-gray-400 bg-gray-50/20">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className="text-gray-500 font-extrabold text-xs">مبلغ الخصم:</span>
                              <span className="font-mono font-black text-amber-600 text-sm">
                                {activePrintData.discountAmount.toLocaleString('en-US')}
                              </span>
                              <span className="text-[10px] font-sans text-gray-400 font-bold">{activePrintData.invoice.currency || 'USD'}</span>
                            </div>
                          </td>

                          {/* Amount Paid */}
                          <td colSpan={2} className="px-3 py-3 text-center border-l border-gray-400 bg-gray-50/20">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className="text-gray-500 font-extrabold text-xs">المبلغ المدفوع:</span>
                              <span className="font-mono font-black text-emerald-700 text-sm">
                                {activePrintData.paidAmount.toLocaleString('en-US')}
                              </span>
                              <span className="text-[10px] font-sans text-gray-400 font-bold">{activePrintData.invoice.currency || 'USD'}</span>
                            </div>
                          </td>

                          {/* Remaining Amount */}
                          <td colSpan={2} className="px-3 py-3 text-center border-l border-gray-400 bg-red-100/30">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className="text-red-950 font-black text-sm">المبلغ المتبقي:</span>
                              <span className="font-mono font-black text-red-600 text-lg">
                                {activePrintData.remainingAmount.toLocaleString('en-US')}
                              </span>
                              <span className="text-xs font-sans text-red-800 font-black">{activePrintData.invoice.currency || 'USD'}</span>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Amount Paid */}
                          <td colSpan={3} className="px-3 py-3 text-center border-l border-gray-400 bg-gray-50/20">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className="text-gray-500 font-extrabold text-xs">المبلغ المدفوع:</span>
                              <span className="font-mono font-black text-emerald-700 text-sm">
                                {activePrintData.paidAmount.toLocaleString('en-US')}
                              </span>
                              <span className="text-[10px] font-sans text-gray-400 font-bold">{activePrintData.invoice.currency || 'USD'}</span>
                            </div>
                          </td>

                          {/* Remaining Amount */}
                          <td colSpan={3} className="px-3 py-3 text-center border-l border-gray-400 bg-red-100/30">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className="text-red-950 font-black text-sm">المبلغ المتبقي:</span>
                              <span className="font-mono font-black text-red-600 text-lg">
                                {activePrintData.remainingAmount.toLocaleString('en-US')}
                              </span>
                              <span className="text-xs font-sans text-red-800 font-black">{activePrintData.invoice.currency || 'USD'}</span>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Summary Devices Status */}
              {(() => {
                const counters = [
                  {
                    key: 'ready',
                    label: 'صيانة',
                    value: activePrintData.items.filter(i => getItemSubStatus(i) === 'ready').reduce((sum, i) => sum + Number(i.quantity || 1), 0),
                    textColor: 'text-gray-900',
                  },
                  {
                    key: 'unrepairable',
                    label: 'لايصلح',
                    value: activePrintData.items.filter(i => getItemSubStatus(i) === 'unrepairable').reduce((sum, i) => sum + Number(i.quantity || 1), 0),
                    textColor: 'text-rose-600',
                  },
                  {
                    key: 'intact',
                    label: 'سليم',
                    value: activePrintData.items.filter(i => getItemSubStatus(i) === 'intact').reduce((sum, i) => sum + Number(i.quantity || 1), 0),
                    textColor: 'text-emerald-600',
                  },
                  {
                    key: 'refused',
                    label: 'لم يوافق العميل',
                    value: activePrintData.items.filter(i => getItemSubStatus(i) === 'refused').reduce((sum, i) => sum + Number(i.quantity || 1), 0),
                    textColor: 'text-orange-600',
                  },
                  {
                    key: 'no_parts',
                    label: 'عدم توفر قطع',
                    value: activePrintData.items.filter(i => getItemSubStatus(i) === 'no_parts').reduce((sum, i) => sum + Number(i.quantity || 1), 0),
                    textColor: 'text-red-700',
                  }
                ];

                const activeCounters = counters.filter(c => c.value > 0);

                if (activeCounters.length === 0) return null;

                return (
                  <div className="flex items-center gap-4 mb-4 text-sm font-bold text-gray-900 mt-6 flex-wrap">
                    {activeCounters.map((counter, index) => (
                      <span key={counter.key} className="flex items-center gap-4">
                        {index > 0 && <span className="text-gray-400 font-normal">|</span>}
                        <div className="flex items-center gap-2">
                          <div className={`w-12 h-8 border-2 border-gray-400 bg-gray-50 rounded flex items-center justify-center font-mono font-black text-base ${counter.textColor}`}>
                            {counter.value}
                          </div>
                          <span>{counter.label}</span>
                        </div>
                      </span>
                    ))}
                  </div>
                );
              })()}

              <div className="mt-auto pt-8">
                <div className="border-t-2 border-gray-900 my-8"></div>

                {/* Footer Notes & Signatures */}
                <div className="flex justify-between items-start text-xs font-bold text-gray-900 leading-loose mb-6 px-4">
                   {/* Right Side */}
                   <div className="text-right space-y-1">
                      <p>استلمت الأجهزة الموضحة بحالة جيدة</p>
                      
                      <p className="pt-2">توقيع العميل / المقر بالموافقة</p>
                      <p className="pt-1 font-black">التوقيع: ........................................</p>
                   </div>

                   {/* Left Side */}
                   <div className="text-left space-y-1 flex flex-col items-end">
                      <p>نتمنى أن تنال خدمتنا إعجابكم</p>
                      
                      <p className="pt-2">اسم المهندس المختص: ........................</p>
                      <p className="pt-1 font-black">التوقيع / ........................................</p>
                   </div>
                </div>

                <div className="border-t-[3px] border-black mt-2 mb-1 border-solid"></div>
                
                {/* Footer Address and Facebook */}
                {(shopConfig?.address || shopConfig?.facebookUrl) && (
                  <div className="flex flex-row items-center justify-between text-[10px] font-bold text-black font-cairo py-1 mt-0">
                    {shopConfig?.address && (
                      <div className="flex items-center gap-1.5 justify-center flex-row-reverse text-center w-max">
                         <MapPin size={12} className="text-gray-600" />
                         <span>{shopConfig.address}</span>
                      </div>
                    )}

                    {shopConfig?.facebookUrl && (
                      <div className="flex items-center gap-1.5 justify-center flex-row-reverse text-center w-max">
                         <Facebook size={12} className="text-blue-600" />
                         <span dir="ltr">{shopConfig.facebookUrl}</span>
                      </div>
                    )}
                  </div>
                )}

                <BankAccountsFooter shopConfig={shopConfig} currentOutput={currentOutput || { output_datetime: new Date() }} />
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
      
      {showPayOnlyConfirmModal && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn" dir="rtl">
          <div className="bg-[#1f1f1f] border border-amber-500/40 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 text-right">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
                <AlertTriangle size={22} className="text-amber-400" />
              </div>
              <div>
                <h4 className="font-black text-sm text-white">تأكيد خيار (سداد فقط)</h4>
                <p className="text-[11px] text-gray-400 mt-0.5">تسجيل دفعة مالية لحساب الفاتورة</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 text-xs text-gray-200 leading-relaxed font-bold">
              سوف يتم انشاء سند قبض فقط دون تنفيذ خروج أجهزة
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowPayOnlyConfirmModal(false);
                  setIsPayOnly(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-all border border-white/10 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPayOnlyConfirmModal(false);
                  setIsPayOnly(true);
                }}
                className="px-5 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20 cursor-pointer"
              >
                موافق
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4 pointer-events-auto text-right" dir="rtl">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedInvoice(null)}></div>
          <div className="relative bg-[#1a1a1a] p-4 sm:p-5 w-full max-w-6xl rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/5">
              <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <Info size={18} className="text-orange-500" /> مراجعة الفاتورة
              </h3>
              <button onClick={() => setSelectedInvoice(null)} className="w-8 h-8 flex items-center justify-center bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl transition-all border border-red-500/20 group">
                 <X size={16} />
              </button>
            </div>

            {prepaymentSuccessMsg && (
              <div className="mb-3 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center justify-between animate-fadeIn">
                <span>{prepaymentSuccessMsg}</span>
                <button onClick={() => setPrepaymentSuccessMsg(null)} className="text-emerald-400 hover:text-white cursor-pointer mr-2">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="space-y-3 flex-1 flex flex-col justify-between overflow-hidden">
              {/* بيانات العميل في الأعلى */}
              <div className="space-y-1 bg-black/20 p-2.5 rounded-xl border border-white/5 relative">
                 <h4 className="text-xs font-bold text-gray-400 flex items-center gap-1.5 mb-1">
                   <UserIcon size={14} /> العميل
                 </h4>
                 <div className="grid grid-cols-2 gap-2 text-xs font-bold text-white">
                   <div>{selectedInvoice.customerName}</div>
                   <div dir="ltr" className="text-left font-mono text-orange-500">#{selectedInvoice.invoiceNumber}</div>
                 </div>
              </div>

              {/* جدول الأجهزة المعروض أفقيا */}
              <div className="space-y-1 bg-black/20 p-2.5 rounded-xl border border-white/5 relative flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between mb-1.5 flex-shrink-0">
                  <h4 className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
                    <HardDrive size={14} /> الأجهزة جاهزة للخروج ({invoiceItems.filter(i => !isDeliveredStatus(i.status)).length})
                    {invoiceItems.some(i => isDeliveredStatus(i.status)) && (
                      <span className="text-[10px] text-gray-500 font-normal">
                        ({invoiceItems.filter(i => isDeliveredStatus(i.status)).length} تم تسليمها مسبقاً)
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1 rounded-lg">
                    <span className="text-[11px] font-bold text-gray-400">المبلغ الكلي:</span>
                    <span className="font-mono font-black text-white text-xs">
                      {totalInvoiceAmount.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-gray-400 font-sans">{selectedInvoice.currency || 'USD'}</span>
                  </div>
                </div>

                <div className="overflow-auto w-full flex-1">
                  <table className="w-full text-right border-collapse text-xs">
                    <thead className="bg-[#111] text-gray-300 font-bold border-b border-white/10 whitespace-nowrap sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-center text-[10px] w-14">
                          <div className="flex items-center justify-center gap-1">
                            <span>م</span>
                            <span className="text-gray-600">/</span>
                            <input 
                              type="checkbox"
                              checked={
                                invoiceItems.filter(i => !isDeliveredStatus(i.status)).length > 0 && 
                                invoiceItems.filter(i => !isDeliveredStatus(i.status)).every(i => selectedItemIds.has(i.id!))
                              }
                              onChange={(e) => {
                                const activeItems = invoiceItems.filter(i => !isDeliveredStatus(i.status));
                                if (e.target.checked) {
                                  setSelectedItemIds(new Set(activeItems.map(i => i.id!)));
                                } else {
                                  setSelectedItemIds(new Set());
                                }
                              }}
                              className="rounded border-white/10 bg-black/40 text-orange-600 focus:ring-orange-500 focus:ring-offset-[#1a1a1a] w-3 h-3 cursor-pointer"
                            />
                          </div>
                        </th>
                        <th className="px-2 py-1.5 text-right text-[10px]">النوع/الجهاز</th>
                        <th className="px-2 py-1.5 text-center text-[10px] w-12">العدد</th>
                        <th className="px-2 py-1.5 text-center text-[10px] w-20">المبلغ</th>
                        <th className="px-2 py-1.5 text-center text-[10px] w-24">اجمالي المبلغ</th>
                        <th className="px-2 py-1.5 text-right text-[10px]">التقرير</th>
                        <th className="px-2 py-1.5 text-center text-[10px] w-24">نوع التقرير</th>
                        <th className="px-2 py-1.5 text-right text-[10px]">شكوى العميل</th>
                        <th className="px-2 py-1.5 text-right text-[10px]">تفاصيل الاستلام</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-gray-300">
                      {(() => {
                        const getConditionRank = (item: any) => {
                          if (isDeliveredStatus(item.status)) return 99;
                          const subStatus = getItemSubStatus(item);
                          if (subStatus === 'ready') return 1;
                          if (subStatus === 'intact') return 2;
                          if (subStatus === 'unrepairable') return 3;
                          if (subStatus === 'refused') return 4;
                          return 5;
                        };
                        const typeRanks: Record<string, number> = {};
                        const nameRanks: Record<string, number> = {};
                        invoiceItems.forEach(item => {
                          const t = item.deviceType || '';
                          const n = item.deviceName || '';
                          const key = `${t}|${n}`;
                          const r = getConditionRank(item);
                          if (!(t in typeRanks) || r < typeRanks[t]) typeRanks[t] = r;
                          if (!(key in nameRanks) || r < nameRanks[key]) nameRanks[key] = r;
                        });

                        return [...invoiceItems].sort((a, b) => {
                          const tA = a.deviceType || '';
                          const tB = b.deviceType || '';
                          if (typeRanks[tA] !== typeRanks[tB]) return typeRanks[tA] - typeRanks[tB];
                          if (tA !== tB) return tA.localeCompare(tB, 'ar');
                          
                          const nA = a.deviceName || '';
                          const nB = b.deviceName || '';
                          const keyA = `${tA}|${nA}`;
                          const keyB = `${tB}|${nB}`;
                          if (nameRanks[keyA] !== nameRanks[keyB]) return nameRanks[keyA] - nameRanks[keyB];
                          if (nA !== nB) return nA.localeCompare(nB, 'ar');
                          
                          return getConditionRank(a) - getConditionRank(b);
                        }).map((item, idx) => {
                          const isDelivered = isDeliveredStatus(item.status);
                          const isSelected = isDelivered || selectedItemIds.has(item.id!);
                          const subStatus = getItemSubStatus(item);
                          
                          const itemQty = Number(item.quantity || 1);
                          const totalItemCost = Number(item.cost || 0);
                          const unitItemCost = item.unitCost || (itemQty > 0 ? totalItemCost / itemQty : 0);
                          
                          const getReportTypeArabic = (itemData: typeof item, statusStr: string) => {
                            if (isDelivered) return 'تم التسليم';
                            if (statusStr === 'intact') return 'تقرير الفحص';
                            if (statusStr === 'unrepairable') {
                              return itemData.source === 'inspection' ? 'تقرير الفحص' : 'تقرير الصيانة';
                            }
                            if (statusStr === 'ready') return 'تقرير الصيانة';
                            if (statusStr === 'refused' || statusStr === 'cancelled') return 'تقرير رد العميل';
                            return 'تقرير الصيانة';
                          };

                          const reportTypeArabic = getReportTypeArabic(item, subStatus);
                          const subStatusArabic = isDelivered ? 'تم التسليم' : getStatusArabic(subStatus);
                          const parsedReport = parseEngineerReport(item.failureReason || item.engineerReport || '');
                          const reportText = isDelivered
                            ? 'تم تسليمه مسبقاً (مرحلة 60)'
                            : `${subStatusArabic}${subStatus === 'ready' && parsedReport.outcome ? ` - ${parsedReport.outcome}` : ''}`;

                          const reportTypeBadgeClass = isDelivered
                            ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                            : reportTypeArabic === 'تقرير الفحص' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                              reportTypeArabic === 'تقرير الصيانة' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' :
                              'bg-purple-500/10 text-purple-400 border border-purple-500/20';

                        return (
                          <tr 
                            key={`${item.id || 'item'}-${idx}`} 
                            onClick={() => !isDelivered && handleToggleItem(item.id!)}
                            className={`transition-colors whitespace-nowrap ${
                              isDelivered
                                ? 'opacity-40 bg-white/[0.02] cursor-not-allowed select-none'
                                : isSelected 
                                  ? 'bg-orange-500/5 hover:bg-white/5 cursor-pointer' 
                                  : 'hover:bg-white/5 cursor-pointer'
                            }`}
                          >
                            {/* 1. مسلسل / مربع اختيار */}
                            <td className="px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="font-mono text-gray-400 text-[10px]">{idx + 1}</span>
                                <input 
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={isDelivered}
                                  onChange={() => !isDelivered && handleToggleItem(item.id!)}
                                  className={`rounded border-white/10 w-3.5 h-3.5 ${
                                    isDelivered
                                      ? 'bg-gray-600/30 text-gray-500 cursor-not-allowed opacity-60'
                                      : 'bg-black/40 text-orange-600 focus:ring-orange-500 focus:ring-offset-[#1a1a1a] cursor-pointer'
                                  }`}
                                />
                              </div>
                            </td>

                            {/* 2. النوع/الجهاز */}
                            <td className="px-2 py-1 text-right text-white font-bold text-[11px] whitespace-nowrap">
                              {item.deviceType || '-'} {item.deviceName ? ` / ${item.deviceName}` : ''}
                              {isDelivered && (
                                <span className="text-[10px] text-gray-400 mr-1.5 font-normal">(تم تسليمه مسبقاً)</span>
                              )}
                            </td>

                            {/* 3. العدد */}
                            <td className="px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="font-mono text-white text-[11px] font-bold">{itemQty}</span>
                                {!isDelivered && itemQty > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenSplitModal(item);
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/15 text-orange-400 hover:bg-orange-500 hover:text-white border border-orange-500/30 transition-all flex items-center gap-0.5 whitespace-nowrap cursor-pointer shadow-sm active:scale-95"
                                    title="تسليم جزئي للكمية من هذا الجهاز"
                                  >
                                    <Scissors size={10} className="rotate-90" />
                                    <span>تسليم جزئي</span>
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* 4. المبلغ */}
                            <td className="px-2 py-1 text-center font-mono text-white text-[11px]">
                              {subStatus === 'ready' ? `${unitItemCost.toLocaleString('en-US')} ${selectedInvoice.currency || 'USD'}` : '-'}
                            </td>

                            {/* 5. اجمالي المبلغ */}
                            <td className="px-2 py-1 text-center font-mono text-orange-400 font-bold text-[11px]">
                              {subStatus === 'ready' ? `${totalItemCost.toLocaleString('en-US')} ${selectedInvoice.currency || 'USD'}` : '-'}
                            </td>

                            {/* 6. التقرير */}
                            <td className="px-2 py-1 text-right text-[11px] text-gray-300 max-w-[120px] truncate" title={reportText}>
                              {reportText}
                            </td>

                            {/* 7. نوع التقرير */}
                            <td className="px-2 py-1 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${reportTypeBadgeClass}`}>
                                {reportTypeArabic}
                              </span>
                            </td>

                            {/* 8. شكوى العميل */}
                            <td className="px-2 py-1 text-right text-[11px] text-gray-300 max-w-[120px] truncate" title={item.customerProblem || 'لا يوجد'}>
                              {item.customerProblem || 'لا يوجد'}
                            </td>

                            {/* 9. تفاصيل الاستلام */}
                            <td className="px-2 py-1 text-right text-[11px] text-gray-400 max-w-[120px] truncate" title={item.deviceNotes || 'لا يوجد'}>
                              {item.deviceNotes || 'لا يوجد'}
                            </td>
                          </tr>
                        );
                      });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Interactive calculations block adjacent to exit action */}
              <div className="pt-2 mt-2 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-3 flex-shrink-0">
                {/* Financial panel on the right (RTL) */}
                <div className="flex flex-col gap-2.5 w-full md:w-auto">
                  {/* Top row: 1. اجمالي جزئي ، 2. مسدد مسبقا ، 3. مستحق الدفع */}
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 justify-between md:justify-start">
                    {/* 1. Partial Total (اجمالي جزئي) */}
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest block mb-0.5">اجمالي جزئي</p>
                      <p className="text-sm font-black font-mono text-gray-200 text-right w-full">
                        {currentSelectedCost.toFixed(2)} <span className="text-xs text-gray-400 font-sans">{selectedInvoice.currency || 'USD'}</span>
                      </p>
                    </div>

                    {/* Vertical Separator */}
                    <div className="hidden sm:block w-px h-6 bg-white/10" />

                    {/* 2. Previous Payment (مسدد مسبقا) */}
                    <div className="text-right">
                      <p className="text-[10px] text-cyan-400 uppercase font-black tracking-widest block mb-0.5 flex items-center gap-1 justify-end">
                        {previousPaid > 0 && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                        مسدد مسبقا
                      </p>
                      <div className="flex items-baseline gap-1.5 justify-end">
                        <span className={`text-sm font-black font-mono text-right ${previousPaid > 0 ? 'text-cyan-300 font-bold' : 'text-gray-500'}`}>
                          {previousPaid.toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-400 font-sans">{selectedInvoice.currency || 'USD'}</span>
                      </div>
                      {previousDebt > 0 && (
                        <span className="text-[9px] text-amber-400 font-bold block" title="مبلغ متبقي بذمة العميل من خروج أجهزة سابقة">
                          (متبقي سابق: {previousDebt.toFixed(2)})
                        </span>
                      )}
                      {availableCredit > 0 && (
                        <span className="text-[9px] text-cyan-400 font-bold block" title="رصيد متبقي للعميل من دفعات سابقة">
                          (رصيد متاح: {availableCredit.toFixed(2)})
                        </span>
                      )}
                    </div>

                    {/* Vertical Separator */}
                    <div className="hidden sm:block w-px h-6 bg-white/10" />

                    {/* 3. Amount Due (مستحق الدفع) */}
                    <div className="text-right">
                      <p className="text-[10px] text-purple-400 uppercase font-black tracking-widest block mb-0.5">مستحق الدفع</p>
                      <p className="text-sm font-black font-mono text-purple-300 text-right w-full">
                        {totalDueAmount.toFixed(2)} <span className="text-xs text-purple-400 font-sans">{selectedInvoice.currency || 'USD'}</span>
                      </p>
                    </div>
                  </div>

                  {/* Divider line between rows */}
                  <div className="h-px bg-white/5 w-full" />

                  {/* Bottom row: مربع اختيار سداد بدون خروج ثم ثلاثة حقول: خصم ، واصل ، باقي */}
                  <div className="flex flex-wrap items-center gap-4 justify-between md:justify-start">
                    {/* Checkbox: سداد بدون خروج */}
                    <div className="text-right flex items-center">
                      <label 
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold font-cairo cursor-pointer transition-all select-none shadow-sm ${
                          isPayOnly 
                            ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300 ring-1 ring-emerald-500/50' 
                            : 'bg-white/5 border-white/15 text-gray-300 hover:bg-white/10 hover:border-white/25'
                        }`}
                        title="إنشاء سند قبض مالي فقط دون إخراج الأجهزة من المحل"
                      >
                        <input
                          type="checkbox"
                          checked={isPayOnly}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setShowPayOnlyConfirmModal(true);
                            } else {
                              setIsPayOnly(false);
                            }
                          }}
                          className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-white/20 bg-black/40 cursor-pointer accent-emerald-600"
                        />
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-xs">سداد بدون خروج</span>
                          {isPayOnly ? (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-md font-mono border border-emerald-500/30">سند قبض</span>
                          ) : (
                            <span className="text-[10px] text-gray-400">(سند قبض)</span>
                          )}
                        </div>
                      </label>
                    </div>

                    {/* Vertical Separator */}
                    <div className="hidden sm:block w-px h-6 bg-white/10" />

                    {/* 1. Discount (خصم) */}
                    <div className="text-right">
                      <p className="text-[10px] text-amber-500 uppercase font-black tracking-widest block mb-0.5">خصم</p>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          lang="en"
                          value={exitDiscountAmount || ''}
                          onFocus={e => e.target.select()}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            const parts = val.split('.');
                            if (parts.length > 2) return;
                            let num = parseFloat(val);
                            if (isNaN(num)) num = 0;
                            setExitDiscountAmount(num);
                          }}
                          className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs font-bold focus:outline-none transition-all pl-7 font-mono text-center text-amber-400 focus:border-amber-500"
                          placeholder="0"
                        />
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-500 font-bold font-mono">
                          {selectedInvoice.currency || 'USD'}
                        </span>
                      </div>
                    </div>

                    {/* Vertical Separator */}
                    <div className="hidden sm:block w-px h-6 bg-white/10" />

                    {/* 2. Amount received / paid (واصل) */}
                    <div className="text-right">
                      <p className="text-[10px] text-emerald-400 uppercase font-black tracking-widest block mb-1 flex items-center gap-1 justify-end">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        واصل
                      </p>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          lang="en"
                          value={exitPaidAmount || ''}
                          disabled={otherPayment?.isActive}
                          onFocus={e => e.target.select()}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            const parts = val.split('.');
                            if (parts.length > 2) return;
                            let num = parseFloat(val);
                            if (isNaN(num)) num = 0;
                            setExitPaidAmount(num);
                          }}
                          className={`w-28 h-9 bg-emerald-950/30 border rounded-lg px-3 py-1.5 text-sm font-black focus:outline-none transition-all pl-8 font-mono text-center shadow-md disabled:opacity-60 disabled:cursor-not-allowed ${
                            isOverAmount 
                              ? "border-rose-500 text-rose-400 focus:border-rose-500 bg-rose-500/10 focus:ring-1 focus:ring-rose-500 shadow-rose-500/10" 
                              : "border-emerald-500/45 text-emerald-400 focus:border-emerald-500 bg-emerald-950/20 focus:ring-1 focus:ring-emerald-500 shadow-emerald-500/10"
                          }`}
                          placeholder="0"
                        />
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-emerald-500/70 font-bold font-mono">
                          {selectedInvoice.currency || 'USD'}
                        </span>
                      </div>
                    </div>

                    {/* Vertical Separator */}
                    <div className="hidden sm:block w-px h-6 bg-white/10" />

                    {/* 3. Remaining Balance (باقي) */}
                    <div className="text-right">
                      <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest block mb-0.5">باقي</p>
                      <p className={`text-sm font-black font-mono ${remainingCostForSelection > 0 ? 'text-rose-500' : 'text-emerald-400'}`}>
                        {remainingCostForSelection.toFixed(2)} <span className="text-xs text-gray-500 font-sans">{selectedInvoice.currency || 'USD'}</span>
                      </p>
                    </div>

                    {/* Vertical Separator */}
                    <div className="hidden sm:block w-px h-6 bg-white/10" />

                    {/* 4. Other Payment Method Button */}
                    <div className="text-right flex items-end">
                      <button
                        onClick={() => {
                          if (otherPayment && otherPayment.isActive) {
                            setModalPaymentType(otherPayment.type);
                            setModalSelectedFundId(otherPayment.fundId);
                            setModalAmount(otherPayment.amount);
                            setModalNotes(otherPayment.notes || '');
                            setModalDepositorName(otherPayment.bankDetails?.depositorName || '');
                            setModalReferenceNumber(otherPayment.bankDetails?.referenceNumber || '');
                            setModalInvoiceRate(otherPayment.invoiceRate || '1');
                            setModalPaymentRate(otherPayment.paymentRate || '1');
                          } else {
                            setModalPaymentType('cash');
                            const cashFunds = funds.filter(f => f.type === 'cash');
                            if (cashFunds.length > 0) {
                              setModalSelectedFundId(cashFunds[0].id);
                            } else if (funds.length > 0) {
                              setModalSelectedFundId(funds[0].id);
                            }
                            setModalAmount(0);
                            setModalNotes('');
                            setModalDepositorName('');
                            setModalReferenceNumber('');
                            setModalInvoiceRate('1');
                            setModalPaymentRate('1');
                          }
                          setShowOtherPaymentModal(true);
                        }}
                        className={`h-9 px-3 rounded-lg border text-xs font-bold font-cairo flex items-center gap-1.5 transition-all cursor-pointer ${
                          otherPayment?.isActive
                            ? 'bg-purple-900/40 border-purple-500 text-purple-400 hover:bg-purple-900/60'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        <Wallet size={14} />
                        <span>{otherPayment?.isActive ? 'تعديل طريقة دفع أخرى' : 'طريقة دفع أخرى'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Other Payment Status Banner */}
                  {otherPayment && otherPayment.isActive && (
                    <div className="mt-2 p-2 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-between text-right w-full">
                      <div className="flex items-center gap-2">
                        <Wallet className="text-purple-400 animate-pulse animate-duration-1000" size={16} />
                        <span className="text-xs font-bold text-purple-300 font-cairo">
                          تم تفعيل طريقة دفع أخرى: {otherPayment.amount} {otherPayment.currency} (ما يعادل {exitPaidAmount} {selectedInvoice.currency || 'USD'}) عبر {otherPayment.fundName}
                        </span>
                      </div>
                      <button 
                        onClick={() => {
                          setOtherPayment(null);
                          setExitPaidAmount(0);
                        }}
                        className="text-rose-400 hover:text-rose-300 text-xs font-bold font-cairo cursor-pointer bg-transparent border-none outline-none"
                      >
                        إلغاء طريقة الدفع
                      </button>
                    </div>
                  )}
                </div>

                {/* Action Button & Metadata */}
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto justify-end">
                  <div className="text-right text-[10px] text-slate-500 leading-tight hidden lg:block">
                    <div>الواصل سابقاً: <span className="font-mono text-gray-300 font-bold">{Number(selectedInvoice.amountPaid || 0).toFixed(2)}</span> {selectedInvoice.currency}</div>
                    <div>المبلغ الكلي للفاتورة: <span className="font-mono text-gray-300 font-bold">{totalInvoiceAmount.toFixed(2)}</span> {selectedInvoice.currency}</div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 w-full md:w-auto mt-2 sm:mt-0">
                    {isOverAmount && (
                      <span className="text-[10px] text-rose-400 font-bold font-cairo text-right">
                        ⚠️ مبلغ الواصل أكبر من الإجمالي المستحق!
                      </span>
                    )}
                    <button 
                      onClick={handleShowPreview}
                      disabled={
                        isPayOnly
                          ? (exitPaidAmount <= 0 && (!otherPayment?.isActive || otherPayment.amount <= 0))
                          : (selectedItemIds.size === 0 || isOverAmount || (otherPayment?.isActive && (Number(exitPaidAmount) + Number(exitDiscountAmount)) === 0))
                      }
                      className={`w-full md:w-auto text-white font-black px-6 py-2 rounded-xl transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 text-xs font-cairo cursor-pointer ${
                        isPayOnly 
                          ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' 
                          : 'bg-orange-600 hover:bg-orange-700 shadow-orange-600/20'
                      }`}
                    >
                      <Save size={14} />
                      <span>{isPayOnly ? 'عرض السند للترحيل' : 'عرض الفاتورة للمراجعة'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Unified Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-b border-white/10 bg-black/20 gap-4" dir="rtl">
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onBack && (
            <button onClick={onBack} className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all">
              <ArrowRight size={18} />
            </button>
          )}
          <h1 className="text-lg font-black text-white m-0 p-0 flex items-center gap-2">
            {t('entryExit.deviceExit', 'Device Exit')}
          </h1>
        </div>
        <div className="flex flex-row items-center gap-2 w-full sm:w-auto justify-end">
          {/* Sort / Filter Button */}
          <div className="relative">
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="p-2 sm:px-3 bg-white/5 hover:bg-orange-600/20 text-gray-400 hover:text-orange-500 rounded-lg transition-all border border-white/10 flex items-center justify-center cursor-pointer"
              title="فرز وترتيب الفواتير"
            >
              <ArrowUpDown size={16} />
            </button>
            {showSortDropdown && (
              <div className="absolute z-50 right-0 mt-2 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl p-1.5 w-48">
                <button onClick={() => { setSortConfig({ key: 'invoiceNumber', direction: 'desc' }); setShowSortDropdown(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب رقم الفاتورة (الأحدث)</button>
                <button onClick={() => { setSortConfig({ key: 'invoiceNumber', direction: 'asc' }); setShowSortDropdown(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب رقم الفاتورة (الأقدم)</button>
                <button onClick={() => { setSortConfig({ key: 'customerName', direction: 'asc' }); setShowSortDropdown(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب العميل (أ - ي)</button>
                <button onClick={() => { setSortConfig({ key: 'customerName', direction: 'desc' }); setShowSortDropdown(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب العميل (ي - أ)</button>
                <button onClick={() => { setSortConfig({ key: 'date', direction: 'desc' }); setShowSortDropdown(false); }} className="w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white text-slate-300 rounded font-bold font-cairo transition-colors">حسب التاريخ (الأحدث)</button>
              </div>
            )}
          </div>
          
          {/* Customer Search Box */}
          <div className="flex-1 sm:w-80 font-bold">
            <CustomerAutocomplete
              customers={customers}
              onSelect={(c) => setSearch(c.name)}
              placeholder={t('common.search', 'بحث...')}
              initialValue={search}
            />
          </div>

          {/* Quick Column Settings Button (Icon-Only, aligned on opposite side of filter) */}
          <div className="relative">
            <button
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              className="p-2 sm:px-3 bg-white/5 hover:bg-orange-600/20 text-gray-400 hover:text-orange-500 rounded-lg transition-all border border-white/10 flex items-center justify-center cursor-pointer"
              title="تخصيص الأعمدة"
            >
              <SlidersHorizontal size={16} className={showColumnSettings ? 'text-orange-500' : ''} />
            </button>
            
            {showColumnSettings && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColumnSettings(false)} />
                <div className="absolute left-0 mt-2 w-56 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-xl p-4 z-50 text-right space-y-3" dir="rtl">
                  <div className="text-xs font-black text-orange-500 border-b border-white/5 pb-2 mb-2 flex items-center justify-between">
                    <span>إظهار/إخفاء الأعمدة</span>
                    <button 
                      onClick={() => setVisibleColumns({
                        invoiceNumber: true,
                        customerName: true,
                        totalDevices: true,
                        exitReadyCount: true,
                        unrepairableCount: true,
                        intactCount: true,
                        refusedCount: true,
                        readyCount: true,
                      })}
                      className="text-[10px] text-gray-400 hover:text-white underline cursor-pointer"
                    >
                      إعادة تعيين
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.invoiceNumber} 
                        onChange={e => setVisibleColumns(prev => ({...prev, invoiceNumber: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>رقم الفاتورة</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.customerName} 
                        onChange={e => setVisibleColumns(prev => ({...prev, customerName: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>العميل</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.totalDevices} 
                        onChange={e => setVisibleColumns(prev => ({...prev, totalDevices: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>أجهزة الفاتورة</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.exitReadyCount} 
                        onChange={e => setVisibleColumns(prev => ({...prev, exitReadyCount: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>المعنية بالإخراج</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.unrepairableCount} 
                        onChange={e => setVisibleColumns(prev => ({...prev, unrepairableCount: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>لا يصلح</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.intactCount} 
                        onChange={e => setVisibleColumns(prev => ({...prev, intactCount: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>سليم</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.refusedCount} 
                        onChange={e => setVisibleColumns(prev => ({...prev, refusedCount: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>لم يوافق</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-300 hover:text-white cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns.readyCount} 
                        onChange={e => setVisibleColumns(prev => ({...prev, readyCount: e.target.checked}))}
                        className="rounded border-white/10 text-orange-600 focus:ring-orange-500"
                      />
                      <span>جاهز</span>
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="w-full bg-[#1a1a1a] rounded-none border-b border-white/5 overflow-hidden m-0 p-0 shadow-2xl">
        <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-right border-collapse text-sm">
            <thead className="bg-black/40 text-gray-400 text-xs tracking-widest font-black uppercase border-b border-white/5">
              <tr className="text-[10px] sm:text-xs">
                {visibleColumns.invoiceNumber && <th className="px-2 sm:px-4 py-4 text-right">رقم الفاتورة</th>}
                {visibleColumns.customerName && <th className="px-2 sm:px-4 py-4 text-right w-40 sm:w-64">العميل</th>}
                {visibleColumns.totalDevices && <th className="px-1 sm:px-3 py-4 text-center">أجهزة الفاتورة</th>}
                {visibleColumns.exitReadyCount && <th className="px-1 sm:px-3 py-4 text-center text-orange-500 font-bold">المعنية بالإخراج</th>}
                {visibleColumns.unrepairableCount && <th className="px-1 sm:px-3 py-4 text-center text-red-500/80">لا يصلح</th>}
                {visibleColumns.intactCount && <th className="px-1 sm:px-3 py-4 text-center text-emerald-500/80">سليم</th>}
                {visibleColumns.refusedCount && <th className="px-1 sm:px-3 py-4 text-center text-red-400/80">لم يوافق</th>}
                {visibleColumns.readyCount && <th className="px-1 sm:px-3 py-4 text-center text-orange-500/80">جاهز</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300">
              {paginatedInvoices.map(invoice => {
                const invItems = items.filter(i => i.invoiceNumber === invoice.invoiceNumber && isShopMaintenanceItem(i, invoice));
                const totalDevices = invItems.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
                
                // Devices in the ready states (still inside DeviceExit waiting to be delivered)
                const exitReadyItems = invItems.filter(i => EXIT_READY_STATUSES.includes(i.status));
                const exitReadyCount = exitReadyItems.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
                
                let unrepairableCount = 0;
                let intactCount = 0;
                let refusedCount = 0;
                let readyCount = 0;

                exitReadyItems.forEach(item => {
                  const sub = getItemSubStatus(item);
                  const qty = Number(item.quantity) || 0;
                  if (sub === 'unrepairable') unrepairableCount += qty;
                  else if (sub === 'intact') intactCount += qty;
                  else if (sub === 'refused') refusedCount += qty;
                  else if (sub === 'ready') readyCount += qty;
                });

                return (
                  <tr key={invoice.id} className="hover:bg-white/5 transition-colors cursor-pointer group text-[11px] sm:text-xs md:text-sm" onClick={() => openInvoice(invoice)}>
                    {visibleColumns.invoiceNumber && <td className="px-2 sm:px-4 py-3 font-mono font-bold text-orange-500">{invoice.invoiceNumber}</td>}
                    {visibleColumns.customerName && <td className="px-2 sm:px-4 py-3 font-bold text-white max-w-[160px] sm:max-w-[280px] truncate" title={invoice.customerName}>{invoice.customerName}</td>}
                    {visibleColumns.totalDevices && <td className="px-1 sm:px-3 py-3 font-mono text-center font-bold text-gray-500">{totalDevices}</td>}
                    {visibleColumns.exitReadyCount && <td className="px-1 sm:px-3 py-3 font-mono text-center font-bold text-orange-400">{exitReadyCount}</td>}
                    {visibleColumns.unrepairableCount && <td className="px-1 sm:px-3 py-3 font-mono text-center text-red-500 font-bold">{unrepairableCount > 0 ? unrepairableCount : '-'}</td>}
                    {visibleColumns.intactCount && <td className="px-1 sm:px-3 py-3 font-mono text-center text-emerald-500 font-bold">{intactCount > 0 ? intactCount : '-'}</td>}
                    {visibleColumns.refusedCount && <td className="px-1 sm:px-3 py-3 font-mono text-center text-red-400 font-bold">{refusedCount > 0 ? refusedCount : '-'}</td>}
                    {visibleColumns.readyCount && <td className="px-1 sm:px-3 py-3 font-mono text-center text-orange-500 font-bold">{readyCount > 0 ? readyCount : '-'}</td>}
                  </tr>
                );
              })}
              {readyInvoices.length === 0 && (
                <tr>
                   <td colSpan={Object.values(visibleColumns).filter(Boolean).length} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center opacity-50 space-y-4">
                         <div className="p-4 bg-white/5 rounded-full border border-white/10">
                           <Info size={32} />
                         </div>
                         <p className="text-sm font-bold text-gray-400">لا توجد أجهزة جاهزة حالياً</p>
                      </div>
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {readyInvoices.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 bg-black/20 border-t border-white/5 gap-4" dir="rtl">
            <div className="text-xs text-gray-400 font-bold truncate">
              عرض <span className="text-white font-mono">{((safeCurrentPage - 1) * itemsPerPage) + 1}</span> إلى <span className="text-white font-mono">{Math.min(safeCurrentPage * itemsPerPage, readyInvoices.length)}</span> من أصل <span className="text-white font-mono">{readyInvoices.length}</span> فاتورة جاهزة للخروج
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              {/* Prev page button */}
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={safeCurrentPage === 1}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all border border-white/5 cursor-pointer"
                title="الصفحة السابقة"
              >
                <ChevronRight size={16} />
              </button>
              
              {/* Current page display */}
              <div className="px-3 py-1.5 rounded-xl bg-orange-600/20 border border-orange-500/30 text-orange-400 text-xs font-mono font-bold select-none flex items-center gap-1">
                <span>صفحة</span>
                <span className="text-white font-black">{safeCurrentPage}</span>
                <span className="text-gray-400">/</span>
                <span className="text-gray-300">{totalPages}</span>
              </div>

              {/* Next page button */}
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={safeCurrentPage === totalPages}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all border border-white/5 cursor-pointer"
                title="الصفحة التالية"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Other Payment Method Modal */}
      {showOtherPaymentModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" dir="rtl">
          <div className="bg-[#1c1c1c] w-full max-w-md rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col animate-fade-in">
            {/* Header */}
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/20">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl">
                  <Wallet size={18} />
                </div>
                <h3 className="text-sm font-black text-white font-cairo">
                  طريقة دفع أخرى - المبلغ المستحق {remainingCostForSelection.toFixed(2)} <span className="text-xs font-sans text-gray-400">{selectedInvoice.currency || 'USD'}</span>
                </h3>
              </div>
              <button 
                onClick={() => setShowOtherPaymentModal(false)}
                className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-all cursor-pointer bg-transparent border-none outline-none"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 flex-1 overflow-y-auto max-h-[70vh] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {/* 1. Payment Type Selection */}
              <div>
                <label className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-2 font-cairo text-right">نوع طريقة الدفع</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModalPaymentType('cash');
                      const cashFunds = funds.filter(f => f.type === 'cash');
                      if (cashFunds.length > 0) {
                        setModalSelectedFundId(cashFunds[0].id);
                      }
                      // Clear and reset values to prevent incorrect data transfer
                      setModalAmount(0);
                      setModalNotes('');
                      setModalDepositorName('');
                      setModalReferenceNumber('');
                      setModalInvoiceRate('1');
                      setModalPaymentRate('1');
                    }}
                    className={`py-2 px-4 rounded-xl border text-xs font-bold font-cairo transition-all cursor-pointer ${
                      modalPaymentType === 'cash'
                        ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/25'
                        : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    نقدي (صندوق مال)
                  </button>
                  <button
                    type="button"
                    disabled={funds.filter(f => f.type === 'bank').length === 0}
                    onClick={() => {
                      setModalPaymentType('bank');
                      const bankFunds = funds.filter(f => f.type === 'bank');
                      if (bankFunds.length > 0) {
                        setModalSelectedFundId(bankFunds[0].id);
                      }
                      // Clear and reset values to prevent incorrect data transfer
                      setModalAmount(0);
                      setModalNotes('');
                      setModalDepositorName('');
                      setModalReferenceNumber('');
                      setModalInvoiceRate('1');
                      setModalPaymentRate('1');
                    }}
                    className={`py-2 px-4 rounded-xl border text-xs font-bold font-cairo transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      modalPaymentType === 'bank'
                        ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/25'
                        : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    بنكي (حساب بنكي)
                  </button>
                </div>
              </div>

              {/* 2. Target Fund Dropdown */}
              <div>
                <label className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1.5 font-cairo text-right">الصندوق / الحساب المستهدف</label>
                <select
                  value={modalSelectedFundId}
                  onChange={(e) => {
                    setModalSelectedFundId(e.target.value);
                    // Clear and reset values to prevent incorrect data transfer
                    setModalAmount(0);
                    setModalNotes('');
                    setModalDepositorName('');
                    setModalReferenceNumber('');
                    setModalInvoiceRate('1');
                    setModalPaymentRate('1');
                  }}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-gray-200 focus:outline-none focus:border-purple-500 font-mono"
                >
                  {funds
                    .filter(f => f.type === modalPaymentType)
                    .map(f => (
                      <option key={f.id} value={f.id} className="bg-[#1c1c1c] font-bold text-right">
                        {f.name} ({f.currency})
                      </option>
                    ))}
                </select>
              </div>

              {/* 3. Amount Field */}
              <div>
                <label className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1.5 font-cairo text-right">المبلغ المدفوع بعملته الفعلية</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    lang="en"
                    value={modalAmount || ''}
                    onFocus={e => e.target.select()}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      const parts = val.split('.');
                      if (parts.length > 2) return;
                      let num = parseFloat(val);
                      if (isNaN(num)) num = 0;
                      setModalAmount(num);
                    }}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold font-mono focus:outline-none focus:border-purple-500 text-center text-purple-400"
                    placeholder="0.00"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500 font-mono">
                    {funds.find(f => f.id === modalSelectedFundId)?.currency || 'USD'}
                  </span>
                </div>
              </div>

              {/* Exchange Rate and Conversion */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] text-gray-400 font-bold mb-1 font-cairo text-center">
                    صرف الفاتورة ({invoiceCurrency})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    lang="en"
                    value={modalInvoiceRate}
                    disabled={isSameCurrency}
                    onFocus={e => e.target.select()}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      const parts = val.split('.');
                      if (parts.length > 2) return;
                      setModalInvoiceRate(val);
                    }}
                    className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-2 py-1 text-xs font-bold font-mono focus:outline-none focus:border-purple-500 text-center text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="1.00"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-gray-400 font-bold mb-1 font-cairo text-center">
                    صرف الدفع ({paymentCurrency})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    lang="en"
                    value={modalPaymentRate}
                    disabled={isSameCurrency}
                    onFocus={e => e.target.select()}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      const parts = val.split('.');
                      if (parts.length > 2) return;
                      setModalPaymentRate(val);
                    }}
                    className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-2 py-1 text-xs font-bold font-mono focus:outline-none focus:border-purple-500 text-center text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="1.00"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-purple-400 font-bold mb-1 font-cairo text-center">
                    المعادل بالفاتورة
                  </label>
                  <div className="w-full h-9 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-center text-center font-mono text-xs font-black text-purple-300" dir="ltr">
                    {convertedAmount.toFixed(2)}
                  </div>
                </div>
              </div>

              {modalPaymentType === 'bank' && (
                <>
                  <div>
                    <label className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1.5 font-cairo text-right">اسم المودع</label>
                    <input
                      type="text"
                      value={modalDepositorName}
                      onChange={(e) => setModalDepositorName(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-gray-200 focus:outline-none focus:border-purple-500 font-cairo text-right"
                      placeholder="اسم الشخص المودع"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1.5 font-cairo text-right">رقم المرجع / الإشعار</label>
                    <input
                      type="text"
                      value={modalReferenceNumber}
                      onChange={(e) => setModalReferenceNumber(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-gray-200 focus:outline-none focus:border-purple-500 font-cairo text-right"
                      placeholder="رقم مرجع الحوالة أو الإشعار"
                    />
                  </div>
                </>
              )}

              {/* 4. Notes Field */}
              <div>
                <label className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1.5 font-cairo text-right">ملاحظات دفع إضافية</label>
                <input
                  type="text"
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-gray-200 focus:outline-none focus:border-purple-500 font-cairo text-right"
                  placeholder="مثال: دفعة مقابل كذا دولار أو يورو..."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/5 bg-black/20 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowOtherPaymentModal(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 font-bold rounded-xl text-xs font-cairo transition-all cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetFund = funds.find(f => f.id === modalSelectedFundId);
                  if (targetFund) {
                    setOtherPayment({
                      fundId: targetFund.id,
                      fundName: targetFund.name,
                      amount: modalAmount,
                      currency: targetFund.currency,
                      notes: modalNotes.trim(),
                      type: modalPaymentType,
                      bankDetails: modalPaymentType === 'bank' ? {
                        depositorName: modalDepositorName.trim(),
                        referenceNumber: modalReferenceNumber.trim()
                      } : undefined,
                      isActive: true,
                      invoiceRate: modalInvoiceRate,
                      paymentRate: modalPaymentRate
                    });
                    setExitPaidAmount(convertedAmount);
                    setShowOtherPaymentModal(false);
                  }
                }}
                disabled={Number(modalAmount) === 0 || !modalSelectedFundId}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs font-cairo transition-all shadow-lg shadow-purple-600/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                تأكيد الدفع الخاص
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partial Quantity Split Modal (Front and Center at z-[160]) */}
      {targetSplitItem && selectedInvoice && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-3 sm:p-4 pointer-events-auto text-right font-sans" dir="rtl">
          {/* Dark Backdrop with blur - fully covering everything behind */}
          <div 
            className="absolute inset-0 bg-black/85 backdrop-blur-md" 
            onClick={() => {
              if (!isSplitting) setTargetSplitItem(null);
            }} 
          />
          
          <div className="relative z-10 bg-[#1a1a1a] border border-orange-500/30 rounded-2xl sm:rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.9)] w-full max-w-md overflow-hidden flex flex-col animate-fade-in text-white">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-black/40">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400">
                  <Scissors size={18} className="rotate-90" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-white">
                    تسليم جزئي للكمية (تجزئة الجهاز)
                  </h3>
                  <p className="text-[11px] text-gray-400 font-medium">
                    تحديد عدد قطع محدد لتسليمه الآن مع إبقاء الباقي بالفاتورة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSplitting) setTargetSplitItem(null);
                }}
                disabled={isSplitting}
                className="w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all cursor-pointer border border-white/5"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Device Information Card */}
              <div className="bg-black/40 border border-white/5 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-bold">الجهاز:</span>
                  <span className="text-xs font-black text-white">
                    {targetSplitItem.deviceType || '-'} {targetSplitItem.deviceName ? ` / ${targetSplitItem.deviceName}` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-xs text-gray-400 font-bold">العدد الإجمالي المسجل:</span>
                  <span className="text-xs font-mono font-black text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-lg border border-orange-500/20">
                    {Number(targetSplitItem.quantity) || 1} قطع
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-xs text-gray-400 font-bold">سعر/تكلفة القطعة الواحدة:</span>
                  <span className="text-xs font-mono font-bold text-gray-300">
                    {(Number(targetSplitItem.unitCost) || (Number(targetSplitItem.cost || 0) / (Number(targetSplitItem.quantity) || 1))).toLocaleString('en-US')} {selectedInvoice.currency || 'USD'}
                  </span>
                </div>
              </div>

              {/* The Strictly Controlled Numeric Input */}
              <div className="space-y-2 bg-gradient-to-b from-orange-500/5 to-transparent p-4 rounded-2xl border border-orange-500/20">
                <label className="block text-xs font-bold text-orange-300 text-right">
                  حدد الكمية المراد تسليمها وخروجها الآن:
                </label>
                
                <div className="relative flex items-center justify-center">
                  <input
                    ref={splitInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoFocus
                    dir="ltr"
                    value={splitInputText}
                    onFocus={(e) => e.target.select()}
                    onChange={handleSplitInputChange}
                    onBlur={handleSplitInputBlur}
                    onKeyDown={handleSplitInputKeyDown}
                    className="w-full text-center text-3xl font-black font-mono text-orange-400 bg-black/60 border-2 border-orange-500/60 rounded-2xl py-3 px-4 focus:ring-4 focus:ring-orange-500/20 focus:border-orange-400 outline-none shadow-inner transition-all tracking-wider"
                    placeholder={String(Number(targetSplitItem.quantity) || 1)}
                  />
                </div>

                <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                  العدد المسموح به من <span className="font-mono font-bold text-orange-400">1</span> إلى <span className="font-mono font-bold text-orange-400">{Number(targetSplitItem.quantity) || 1}</span>. (كتابة 0 أو رقم أعلى يعيد تلقائياً كامل الكمية).
                </p>
              </div>

              {/* Breakdown Summary */}
              <div className="grid grid-cols-2 gap-3">
                {/* Outgoing Split Card */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-right space-y-1">
                  <div className="text-[10px] font-bold text-emerald-400">الكمية الخارجة الآن:</div>
                  <div className="text-lg font-mono font-black text-emerald-300">
                    {splitQuantity} <span className="text-xs font-sans text-gray-400">قطع</span>
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400 font-bold">
                    {(splitQuantity * (Number(targetSplitItem.unitCost) || (Number(targetSplitItem.cost || 0) / (Number(targetSplitItem.quantity) || 1)))).toLocaleString('en-US')} {selectedInvoice.currency || 'USD'}
                  </div>
                </div>

                {/* Remaining Split Card */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-right space-y-1">
                  <div className="text-[10px] font-bold text-blue-400">الكمية المتبقية بالفاتورة:</div>
                  <div className="text-lg font-mono font-black text-blue-300">
                    {Math.max(0, (Number(targetSplitItem.quantity) || 1) - splitQuantity)} <span className="text-xs font-sans text-gray-400">قطع</span>
                  </div>
                  <div className="text-[11px] font-mono text-blue-400 font-bold">
                    {(Math.max(0, (Number(targetSplitItem.quantity) || 1) - splitQuantity) * (Number(targetSplitItem.unitCost) || (Number(targetSplitItem.cost || 0) / (Number(targetSplitItem.quantity) || 1)))).toLocaleString('en-US')} {selectedInvoice.currency || 'USD'}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 sm:p-5 border-t border-white/10 bg-black/40 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!isSplitting) setTargetSplitItem(null);
                }}
                disabled={isSplitting}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-bold transition-all cursor-pointer border border-white/5"
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={handleConfirmSplit}
                disabled={isSplitting || splitQuantity <= 0}
                className="flex-1 py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-black transition-all shadow-lg shadow-orange-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95"
              >
                <CheckCircle size={15} />
                <span>
                  {isSplitting ? 'جاري تجزئة الجهاز...' : `تأكيد التجزئة وخروج (${splitQuantity}) قطع`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
