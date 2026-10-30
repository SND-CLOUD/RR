import React, { useState, useEffect, useMemo } from 'react';
import { 
  FilePlus, 
  Search, 
  ArrowUpRight, 
  X, 
  Check, 
  ArrowRight, 
  Phone, 
  HardDrive, 
  AlertTriangle, 
  ClipboardCheck, 
  ChevronLeft, 
  ChevronRight,
  ArrowDownToLine,
  PlusCircle
} from 'lucide-react';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp } from '../../firebase';
import { db } from '../../firebase';
import { Invoice, InvoiceItem, User, Customer, isShopMaintenanceItem, isPurchaseInvoice, isSaleInvoice } from '../../types';
import { parseDate, resolveEntryDateString } from '../../lib/dateUtils';
import { useBackHandler } from '../../hooks/useBackHandler';
import DeviceEntry from './DeviceEntry';
import { motion, AnimatePresence } from 'motion/react';

interface DeviceIntakeHubProps {
  user: User;
  onBack: () => void;
  onNavigateToInspection?: (invoice: Invoice) => void;
}

export default function DeviceIntakeHub({ user, onBack }: DeviceIntakeHubProps) {
  const [subView, setSubView] = useState<'hub' | 'entry'>('hub');
  
  // Data states
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // UI states
  const [search, setSearch] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, 'action1' | 'action2'>>({});
  const [selectedInvoiceForCancel, setSelectedInvoiceForCancel] = useState<Invoice | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelNotes, setCancelNotes] = useState('');
  const [loadingCancel, setLoadingCancel] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Back handler for mobile & capacitor app: returns from entry subView to hub
  useBackHandler(subView === 'entry', () => {
    setSubView('hub');
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (s) => 
      setInvoices(s.docs.map(d => ({ ...d.data(), id: d.id } as Invoice)))
    );
    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (s) => 
      setItems(s.docs.map(d => ({ ...d.data(), id: d.id } as InvoiceItem)))
    );
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (s) => 
      setCustomers(s.docs.map(d => ({ ...d.data(), id: d.id } as Customer)))
    );
    return () => { 
      unsubInvoices(); 
      unsubItems(); 
      unsubCustomers(); 
    };
  }, []);

  // Initialize radio selection to 'action1' (فحص / دخول فحص) by default
  useEffect(() => {
    const newOptions = { ...selectedOptions };
    let changed = false;
    invoices.forEach(inv => {
      if (inv.id && !newOptions[inv.id]) {
        newOptions[inv.id] = 'action1';
        changed = true;
      }
    });
    if (changed) {
      setSelectedOptions(newOptions);
    }
  }, [invoices]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  // Lookup map for fast normalization
  const invoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    invoices.forEach(inv => {
      if (inv.id) map.set(String(inv.id), inv);
      if (inv.invoiceNumber) {
        const rawNo = String(inv.invoiceNumber);
        const cleanNo = rawNo.replace('#', '').trim();
        map.set(rawNo, inv);
        map.set(cleanNo, inv);
      }
    });
    return map;
  }, [invoices]);

  const getItemResolvedDate = (item: any): Date | null => {
    const cleanNo = String(item.invoiceNumber || '').replace('#', '').trim();
    const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                (cleanNo && invoiceMap.get(cleanNo)) ||
                null;

    const candidates = [
      item.createdAt,
      item.entryDate,
      item.date,
      inv?.createdAt,
      inv?.date,
      item.updatedAt,
      inv?.updatedAt
    ];

    for (const cand of candidates) {
      if (cand !== undefined && cand !== null && cand !== '') {
        const parsed = parseDate(cand);
        if (parsed && !isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    return null;
  };

  const now = new Date();
  const isToday = (date: Date | null): boolean => {
    if (!date) return false;
    return date.getFullYear() === now.getFullYear() &&
           date.getMonth() === now.getMonth() &&
           date.getDate() === now.getDate();
  };

  // 1. Total devices entered today (الأجهزة الداخلة اليوم)
  const todayEntryCount = useMemo(() => {
    return items.filter(item => {
      const cleanNo = String(item.invoiceNumber || '').replace('#', '').trim();
      const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                  (cleanNo && invoiceMap.get(cleanNo)) ||
                  null;
      if (!isShopMaintenanceItem(item, inv)) return false;
      if (inv && (isPurchaseInvoice(inv) || isSaleInvoice(inv))) return false;
      const d = getItemResolvedDate(item);
      return isToday(d);
    }).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  }, [items, invoiceMap]);

  // 2. New devices needing inspection (الأجهزة الجديدة التي تحتاج إلى فحص)
  const countNewDevices = useMemo(() => {
    return items.filter(item => {
      const cleanNo = String(item.invoiceNumber || '').replace('#', '').trim();
      const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                  (cleanNo && invoiceMap.get(cleanNo)) ||
                  null;
      if (inv && (isPurchaseInvoice(inv) || isSaleInvoice(inv))) return false;
      const st = String(item.status || '').toLowerCase().trim();
      return isShopMaintenanceItem(item, inv) && (st === '10' || st === 'new');
    }).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  }, [items, invoiceMap]);

  // Filtered invoices for the new devices table - thoroughly resilient matching
  const newInvoicesFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cleanQ = q.replace(/^#/, '');

    return invoices.filter(inv => {
      if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) return false;

      const invStatus = String(inv.status || '').toLowerCase().trim();
      const cleanInvNo = String(inv.invoiceNumber || '').replace('#', '').trim();

      // Check if invoice itself is status 10 / new
      const isNewByStatus = invStatus === '10' || invStatus === 'new';

      // Check if any matching item has status 10 / new
      const hasNewItem = items.some(item => {
        const cleanItemNo = String(item.invoiceNumber || '').replace('#', '').trim();
        const isMatch = (inv.id && item.invoiceId && String(item.invoiceId) === String(inv.id)) ||
                        (cleanItemNo && cleanInvNo && cleanItemNo === cleanInvNo);
        if (!isMatch) return false;
        if (!isShopMaintenanceItem(item, inv)) return false;
        const itemStatus = String(item.status || '').toLowerCase().trim();
        return (itemStatus === '10' || itemStatus === 'new') && Number(item.quantity || 1) > 0;
      });

      return isNewByStatus || hasNewItem;
    }).filter(inv => {
      if (!q) return true;
      const custName = (inv.customerName || '').toLowerCase();
      const invNum = String(inv.invoiceNumber || '').toLowerCase().replace('#', '');
      const custPhone = String(inv.customerPhone || '').toLowerCase();
      return custName.includes(q) || invNum.includes(cleanQ) || custPhone.includes(q);
    }).sort((a, b) => {
      const numA = Number(String(a.invoiceNumber || '0').replace('#', '')) || 0;
      const numB = Number(String(b.invoiceNumber || '0').replace('#', '')) || 0;
      return numB - numA;
    });
  }, [invoices, items, search]);

  const totalPages = Math.max(1, Math.ceil(newInvoicesFiltered.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const currentInvoices = newInvoicesFiltered.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);

  const getNewDevicesCountForInvoice = (invoice: Invoice) => {
    const cleanInvNo = String(invoice.invoiceNumber || '').replace('#', '').trim();
    const invItems = items.filter(item => {
      const cleanItemNo = String(item.invoiceNumber || '').replace('#', '').trim();
      return (invoice.id && item.invoiceId && String(item.invoiceId) === String(invoice.id)) ||
             (cleanItemNo && cleanInvNo && cleanItemNo === cleanInvNo);
    });

    const newItems = invItems.filter(item => {
      const st = String(item.status || '').toLowerCase().trim();
      return isShopMaintenanceItem(item, invoice) && (st === '10' || st === 'new');
    });

    if (newItems.length > 0) {
      return newItems.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
    }
    if (invItems.length > 0) {
      return invItems.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
    }
    return 1;
  };

  const getCustomerPhone = (customerId?: string, fallbackPhone?: string) => {
    if (fallbackPhone) return fallbackPhone;
    if (!customerId) return '---';
    const c = customers.find(item => item.id === customerId);
    return c ? (c.phone1 || c.phone2 || '---') : '---';
  };

  // Execution: either Transfer to Inspection (status 20) or Cancel (status 70)
  const handleExecuteAction = async (invoice: Invoice) => {
    const choice = selectedOptions[invoice.id!] || 'action1';

    if (choice === 'action2') {
      setSelectedInvoiceForCancel(invoice);
      setCancelNotes('');
      setShowCancelModal(true);
      return;
    }

    // Action 1: Send to Inspection (status 20) & Navigate directly to Inspection
    try {
      const batch = writeBatch(db);
      const invRef = doc(db, 'invoices', invoice.id!);
      batch.update(invRef, {
        status: '20',
        updatedAt: serverTimestamp()
      });

      const cleanInvNo = String(invoice.invoiceNumber || '').replace('#', '').trim();
      const invoiceItems = items.filter(i => {
        const cleanItemNo = String(i.invoiceNumber || '').replace('#', '').trim();
        const isMatch = (invoice.id && i.invoiceId && String(i.invoiceId) === String(invoice.id)) ||
                        (cleanItemNo && cleanInvNo && cleanItemNo === cleanInvNo);
        if (!isMatch) return false;
        const st = String(i.status || '').toLowerCase().trim();
        return st === '10' || st === 'new';
      });

      invoiceItems.forEach(item => {
        const resolvedEntryDate = resolveEntryDateString(item, invoice);
        batch.update(doc(db, 'invoice_items', item.id!), {
          status: '20',
          technician: item.technician || user?.name || user?.username || 'System',
          entryDate: resolvedEntryDate,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      showToast(`تم تحويل الفاتورة #${invoice.invoiceNumber} وأجهزتها بنجاح إلى قسم الفحص.`);
    } catch (err) {
      console.error('Error transitioning invoice to inspection:', err);
      alert('حدث خطأ أثناء محاولة تحويل الفاتورة إلى قسم الفحص.');
    }
  };

  const handleConfirmCancel = async () => {
    if (!selectedInvoiceForCancel) return;
    if (!cancelNotes.trim()) {
      alert('الرجاء كتابة سبب إلغاء العملية لتسجيل الإجراء.');
      return;
    }

    setLoadingCancel(true);
    try {
      const batch = writeBatch(db);
      
      // Update invoice as Cancelled '70' with reason
      batch.update(doc(db, 'invoices', selectedInvoiceForCancel.id!), {
        status: '70',
        cancelReason: cancelNotes,
        updatedAt: serverTimestamp()
      });

      // Update items to 70 / cancelled
      const cleanInvNo = String(selectedInvoiceForCancel.invoiceNumber || '').replace('#', '').trim();
      const invoiceItemsToCancel = items.filter(i => {
        const cleanItemNo = String(i.invoiceNumber || '').replace('#', '').trim();
        return (selectedInvoiceForCancel.id && i.invoiceId && String(i.invoiceId) === String(selectedInvoiceForCancel.id)) ||
               (cleanItemNo && cleanInvNo && cleanItemNo === cleanInvNo);
      });

      invoiceItemsToCancel.forEach(item => {
        const resolvedEntryDate = resolveEntryDateString(item, selectedInvoiceForCancel);
        batch.update(doc(db, 'invoice_items', item.id!), {
          status: '70',
          subStatus: 'cancelled',
          failureReason: cancelNotes,
          engineerReport: cancelNotes,
          entryDate: resolvedEntryDate,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      setShowCancelModal(false);
      setSelectedInvoiceForCancel(null);
      showToast(`تم إلغاء عملية الفاتورة #${selectedInvoiceForCancel.invoiceNumber} بنجاح وتحويلها لصفحة الخروج.`);
    } catch (err) {
      console.error('Error cancelling invoice:', err);
      alert('حدث خطأ أثناء محاولة إلغاء الفاتورة.');
    } finally {
      setLoadingCancel(false);
    }
  };

  // If subView is 'entry', render the full DeviceEntry component
  if (subView === 'entry') {
    return (
      <DeviceEntry 
        user={user} 
        onBack={() => setSubView('hub')} 
      />
    );
  }

  return (
    <div className="w-full min-h-0 flex-1 px-2 sm:px-4 py-2 sm:py-3 space-y-3 sm:space-y-4 max-w-7xl mx-auto overflow-y-visible" dir="rtl">
      {/* Toast Alert */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4"
          >
            <div className="bg-emerald-600 border border-emerald-500 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 justify-between">
              <div className="flex items-center gap-2">
                <Check size={18} className="shrink-0" />
                <span className="text-xs sm:text-sm font-bold">{toastMessage}</span>
              </div>
              <button 
                onClick={() => setToastMessage(null)} 
                className="w-6 h-6 flex items-center justify-center bg-black/20 hover:bg-black/40 text-white rounded-full transition-all"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. Header Card: إحصائية حركة دخول الأجهزة لليوم (Compact Height - Counters at opposite ends) */}
      <div className="w-full bg-gradient-to-r from-orange-600 via-amber-600 to-orange-700 text-white p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-md relative overflow-hidden">
        {/* Subtle decorative background glow */}
        <div className="absolute -left-10 -top-10 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
        <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-black/10 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 w-full">
          {/* Mobile View (< md): Centered title on top, and counters at opposite edges below */}
          <div className="flex flex-col gap-2 md:hidden">
            <div className="flex items-center justify-center gap-2">
              <div className="p-1 bg-white/15 rounded-lg shadow-inner shrink-0">
                <ArrowDownToLine size={16} className="text-white" />
              </div>
              <h1 className="text-xs sm:text-sm font-black font-cairo leading-tight">
                إحصائية حركة دخول الأجهزة لليوم
              </h1>
            </div>

            <div className="flex items-center justify-between w-full pt-0.5">
              {/* Counter 1: الطرف الأول (اليمين) - الأجهزة الداخلة */}
              <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-inner">
                <span className="text-lg font-black font-mono tracking-wider text-white">
                  {todayEntryCount}
                </span>
                <div className="flex flex-col text-right leading-tight">
                  <span className="text-[10px] font-bold font-cairo text-orange-100">
                    الأجهزة الداخلة
                  </span>
                  <span className="text-[8px] text-orange-200/70">
                    الوارد اليوم
                  </span>
                </div>
              </div>

              {/* Counter 2: الطرف الثاني (اليسار) - تحتاج فحص */}
              <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-inner relative">
                {countNewDevices > 0 && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping" />
                )}
                <span className="text-lg font-black font-mono tracking-wider text-yellow-300">
                  {countNewDevices}
                </span>
                <div className="flex flex-col text-right leading-tight">
                  <span className="text-[10px] font-bold font-cairo text-yellow-100">
                    تحتاج فحص
                  </span>
                  <span className="text-[8px] text-yellow-200/70">
                    أجهزة جديدة
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop & Tablet View (>= md): Single line with Counter 1 on far right, Title in center, Counter 2 on far left */}
          <div className="hidden md:flex items-center justify-between w-full">
            {/* الطرف الأول (اليمين): العداد الأول - الأجهزة الداخلة */}
            <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-4 py-1.5 flex items-center gap-3 shadow-inner">
              <span className="text-2xl font-black font-mono tracking-wider text-white">
                {todayEntryCount}
              </span>
              <div className="flex flex-col text-right leading-tight">
                <span className="text-xs font-bold font-cairo text-orange-100">
                  الأجهزة الداخلة
                </span>
                <span className="text-[10px] text-orange-200/70">
                  الوارد اليوم
                </span>
              </div>
            </div>

            {/* الوسط: عنوان البطاقة والأيقونة */}
            <div className="flex items-center gap-2.5 text-center">
              <div className="p-2 bg-white/15 rounded-xl shadow-inner shrink-0">
                <ArrowDownToLine size={20} className="text-white" />
              </div>
              <div className="text-right">
                <h1 className="text-base font-black font-cairo leading-tight">
                  إحصائية حركة دخول الأجهزة لليوم
                </h1>
                <p className="text-xs text-orange-100/80 mt-0.5">
                  متابعة الأجهزة الواردة والجديدة بانتظار الفحص
                </p>
              </div>
            </div>

            {/* الطرف الثاني (اليسار): العداد الثاني - تحتاج فحص */}
            <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-4 py-1.5 flex items-center gap-3 shadow-inner relative">
              {countNewDevices > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-400 rounded-full animate-ping" />
              )}
              <span className="text-2xl font-black font-mono tracking-wider text-yellow-300">
                {countNewDevices}
              </span>
              <div className="flex flex-col text-right leading-tight">
                <span className="text-xs font-bold font-cairo text-yellow-100">
                  تحتاج فحص
                </span>
                <span className="text-[10px] text-yellow-200/70">
                  أجهزة جديدة
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Compact Smart Search Box + Big Action Button */}
      <div className="bg-[#1a1a1a] border border-white/5 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 shadow-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        {/* Search input */}
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث ذكي باسم العميل، رقم الهاتف، أو رقم الفاتورة..."
            className="w-full bg-black/40 border border-white/10 rounded-xl pr-10 pl-8 py-2.5 text-xs sm:text-sm font-cairo text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white"
              title="مسح البحث"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Big Clear Button: إجراء دخول أجهزة */}
        <button
          onClick={() => setSubView('entry')}
          className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white px-5 sm:px-6 py-2.5 rounded-xl font-bold font-cairo text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-orange-600/20 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
        >
          <PlusCircle size={18} className="shrink-0" />
          <span>إجراء دخول أجهزة</span>
        </button>
      </div>

      {/* 3. Table: الأجهزة الجديدة التي تحتاج إلى فحص */}
      <div className="bg-[#1a1a1a] border border-white/5 rounded-xl sm:rounded-2xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={18} className="text-orange-500" />
            <h2 className="text-xs sm:text-sm font-black text-white font-cairo">
              جدول الأجهزة الجديدة التي تحتاج إلى فحص
            </h2>
          </div>
          <span className="text-[11px] bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2.5 py-0.5 rounded-lg font-bold font-mono">
            {newInvoicesFiltered.length} فاتورة
          </span>
        </div>

        {currentInvoices.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <HardDrive size={40} className="mx-auto mb-2 opacity-30 text-orange-400" />
            <p className="text-sm font-bold text-gray-300">لا توجد أجهزة جديدة بانتظار الفحص حالياً</p>
            <p className="text-[11px] text-gray-500 mt-1">
              {search ? 'لم نجد أي فاتورة مطابقة لمعيار البحث' : 'جميع الأجهزة تم تحويلها للفحص بنجاح'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto relative">
            <table className="w-full border-collapse text-right select-none">
              <thead className="bg-white/5 border-b border-white/10 text-gray-400 text-[11px] font-bold">
                <tr>
                  <th className="px-2.5 sm:px-3 py-2.5 text-center whitespace-nowrap w-16 sm:w-20">رقم الفاتورة</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">العميل / الهاتف</th>
                  <th className="px-2 sm:px-3 py-2.5 text-center whitespace-nowrap w-16 sm:w-20">عدد الأجهزة</th>
                  <th className="px-2 sm:px-3 py-2.5 text-center whitespace-nowrap w-28 sm:w-36">الخيارات</th>
                  <th className="px-2.5 sm:px-3 py-2.5 text-center whitespace-nowrap w-20 sm:w-24 sticky left-0 bg-[#1a1a1a] shadow-[-6px_0_12px_rgba(0,0,0,0.5)] z-10 border-l border-white/5">
                    الإجراء
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {currentInvoices.map((invoice, idx) => {
                  const currentChoice = selectedOptions[invoice.id!] || 'action1';
                  const deviceCount = getNewDevicesCountForInvoice(invoice);
                  const phone = getCustomerPhone(invoice.customerId, invoice.customerPhone);

                  return (
                    <tr key={invoice.id || idx} className="hover:bg-white/[0.02] transition-colors group">
                      {/* رقم الفاتورة */}
                      <td className="px-2.5 sm:px-3 py-2 font-mono font-bold text-white text-center whitespace-nowrap">
                        #{invoice.invoiceNumber}
                      </td>

                      {/* اسم العميل مع رقم الهاتف أسفله لتوفير المساحة ومنع التحريك الأفقي */}
                      <td className="px-3 py-2 text-right">
                        <div className="font-bold text-white text-xs truncate max-w-[130px] sm:max-w-none">
                          {invoice.customerName || 'عميل نقدي'}
                        </div>
                        {phone && (
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate" dir="ltr">
                            {phone}
                          </div>
                        )}
                      </td>

                      {/* عدد الأجهزة */}
                      <td className="px-2 sm:px-3 py-2 font-mono font-black text-orange-400 text-center whitespace-nowrap">
                        <span className="bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-md text-xs">
                          {deviceCount}
                        </span>
                      </td>

                      {/* الخيارات: زر إلغاء بعد عمود عدد الأجهزة مباشرة، ثم زر فحص الأقرب لزر التنفيذ */}
                      <td className="px-2 sm:px-3 py-2 whitespace-nowrap text-center">
                        <div className="grid grid-cols-2 gap-1 sm:gap-1.5 max-w-[130px] sm:max-w-[140px] mx-auto items-center">
                          {/* 1. خيار إلغاء: يأتي في اليمين (مباشرة بعد عمود عدد الأجهزة) */}
                          <label 
                            className={`flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg border cursor-pointer transition-all ${
                              currentChoice === 'action2' 
                                ? 'bg-rose-600/20 border-rose-500/50 text-rose-300 font-bold shadow-sm' 
                                : 'bg-black/20 border-white/5 text-gray-400 hover:border-white/20'
                            }`}
                            title="إلغاء العملية وسحب الأجهزة للمرحلة 70"
                          >
                            <input
                              type="radio"
                              name={`action-${invoice.id}`}
                              checked={currentChoice === 'action2'}
                              onChange={() => setSelectedOptions(prev => ({ ...prev, [invoice.id!]: 'action2' }))}
                              className="accent-rose-500 w-3 h-3 cursor-pointer"
                            />
                            <span className="text-[10px]">إلغاء</span>
                          </label>

                          {/* 2. خيار فحص: يأتي في اليسار (هو الأقرب لزر التنفيذ) */}
                          <label 
                            className={`flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg border cursor-pointer transition-all ${
                              currentChoice === 'action1' 
                                ? 'bg-purple-600/20 border-purple-500/50 text-purple-300 font-bold shadow-sm' 
                                : 'bg-black/20 border-white/5 text-gray-400 hover:border-white/20'
                            }`}
                            title="تحويل الفاتورة مباشرة لقسم الفحص"
                          >
                            <input
                              type="radio"
                              name={`action-${invoice.id}`}
                              checked={currentChoice === 'action1'}
                              onChange={() => setSelectedOptions(prev => ({ ...prev, [invoice.id!]: 'action1' }))}
                              className="accent-purple-500 w-3 h-3 cursor-pointer"
                            />
                            <span className="text-[10px]">فحص</span>
                          </label>
                        </div>
                      </td>

                      {/* زر الإجراء: ثابت على اليسار دائماً ومرئي بدون الحاجة لتحريك الشاشة يميناً ويساراً */}
                      <td className="px-2.5 sm:px-3 py-2 text-center whitespace-nowrap sticky left-0 bg-[#1a1a1a] group-hover:bg-[#1f1f1f] shadow-[-6px_0_12px_rgba(0,0,0,0.5)] z-10 border-l border-white/5">
                        <button
                          onClick={() => handleExecuteAction(invoice)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-all inline-flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-sm ${
                            currentChoice === 'action2'
                              ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-900/30'
                              : 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-900/30'
                          }`}
                        >
                          <span>تنفيذ</span>
                          <ArrowUpRight size={13} className="rtl:-scale-x-100" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-black/20 text-xs">
            <span className="text-gray-400 text-[11px]">
              الصفحة {safeCurrentPage} من {totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={safeCurrentPage === 1}
                className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                <ChevronRight size={15} />
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={safeCurrentPage === totalPages}
                className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                <ChevronLeft size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && selectedInvoiceForCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-5 w-full max-w-md shadow-2xl space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
              <div className="flex items-center gap-2 text-rose-500">
                <AlertTriangle size={18} />
                <h3 className="font-bold text-white text-sm">إلغاء عملية الفاتورة #{selectedInvoiceForCancel.invoiceNumber}</h3>
              </div>
              <button 
                onClick={() => setShowCancelModal(false)}
                className="p-1 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              عند تأكيد الإلغاء، ستنتقل الفاتورة وجميع أجهزتها إلى <span className="font-bold text-rose-400">المرحلة (70 - ملغية ومحولة للخروج)</span>، وتختفي من قائمة الفحص.
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">سبب إلغاء العملية والانسحاب *</label>
              <textarea
                value={cancelNotes}
                onChange={(e) => setCancelNotes(e.target.value)}
                placeholder="يرجى كتابة سبب الإلغاء هنا..."
                rows={3}
                className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:border-rose-500 focus:outline-none transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-gray-300 transition-all"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={loadingCancel || !cancelNotes.trim()}
                className="px-5 py-2 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-700 text-white transition-all shadow-md shadow-rose-900/30 disabled:opacity-50"
              >
                {loadingCancel ? 'جارِ الإلغاء...' : 'تأكيد الإلغاء'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
