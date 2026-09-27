import React, { useState, useEffect } from 'react';
import { parseDate } from '../lib/dateUtils';
import { collection, getDocs, doc, getDoc } from '../firebase';
import { db } from '../firebase';
import { 
  Package, 
  CheckCircle2, 
  XCircle, 
  X,
  Clock, 
  TrendingUp,
  Filter,
  ArrowRight,
  PlusCircle,
  Wrench,
  Search,
  AlertTriangle,
  Sparkles,
  MinusCircle,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Coins,
  FileText,
  BarChart3,
  Calendar,
  Layers,
  ArrowLeft,
  LogOut,
  Printer
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { User, isInShopMaintenanceDevice, isShopMaintenanceItem, isPurchaseInvoice, isSaleInvoice } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { usePermissions } from '../hooks/usePermissions';
import ReportActions, { WhatsAppIcon } from './ReportActions';
import PrintPreviewOverlay from './PrintPreviewOverlay';
import DeviceStatisticalSummaryModal from './DeviceStatisticalSummaryModal';
import FinancialReportsTab from './FinancialReportsTab';

interface ReportStats {
  totalIncoming: number;
  inShopTotal: number;
  deliveredTotal: number;
  deliveredByExitDateTotal: number;
  
  // In-shop sub stats
  inShopNew: number;
  inShopInspection: number;
  inShopRepairing: number;
  inShopAwaitingApproval: number;
  inShopAwaitingParts: number;
  inShopReady: number;

  // Delivered sub stats (Batch-based)
  deliveredReadyCount: number;
  deliveredUnrepairableCount: number;
  deliveredIntactCount: number;
  deliveredRefusedCount: number;
  deliveredCancelledCount: number;

  // Delivered sub stats (Exit-date based)
  deliveredByExitReadyCount: number;
  deliveredByExitUnrepairableCount: number;
  deliveredByExitIntactCount: number;
  deliveredByExitRefusedCount: number;
  deliveredByExitCancelledCount: number;
  
  // Financial stats
  revenueCollected: number;
  revenueCollectedByExitDate: number;
  revenueAwaiting: number;
  averageTicket: number;
}

type TimeRange = 'today' | 'week' | 'month' | 'custom' | 'all';
type SubView = 'none' | 'in-shop' | 'delivered';

// Helper to deduce item sub-status for legacy and unified statuses
function getItemSubStatus(item: any): string {
  if (item.subStatus) return item.subStatus;
  
  // Backwards compatibility with legacy status strings
  if (item.status === 'ready') return 'ready';
  if (item.status === 'intact') return 'intact';
  if (item.status === 'unrepairable') return 'unrepairable';
  if (item.status === 'refused') return 'refused';
  
  // For unified status codes
  if (item.status === '50' || item.status === '60' || item.status === 'delivered') {
    const report = (item.engineerReport || '').toLowerCase();
    const reason = (item.failureReason || '').toLowerCase();
    const notes = (item.technicalNotes || '').toLowerCase();
    
    if (reason.includes('لم يوافق') || report.includes('لم يوافق') || notes.includes('لم يوافق')) return 'refused';
    if (reason.includes('لا يصلح') || report.includes('لا يصلح') || reason.includes('unrepairable') || report.includes('unrepairable')) return 'unrepairable';
    if (report.includes('سليم') || report.includes('intact')) return 'intact';
    if (reason.includes('الغاء') || report.includes('الغاء') || reason.includes('cancel') || report.includes('cancel')) return 'cancelled';
    return 'ready';
  }
  
  return item.status || 'new';
}

export default function Reports({ user, onBack }: { user: User; onBack?: () => void }) {
  const { t } = useTranslation();
  const { hasPermission, canPrint } = usePermissions(user, 'reports');
  const canViewFinancial = user?.role === 'admin' 
    ? (user.permissions?.reports_financial?.view !== false)
    : !!user?.permissions?.reports_financial?.view;
  const [shopConfig, setShopConfig] = useState<any>(null);

  useEffect(() => {
    getDoc(doc(db, 'company_details', 'main_details')).then(snap => {
      if (snap.exists()) setShopConfig(snap.data());
    });
  }, []);

  const handlePrint = () => {
    const originalStyle = document.createElement('style');
    originalStyle.innerHTML = `
      @media print {
        @page { size: auto; margin: 10mm; }
        body * { visibility: hidden !important; }
        #printable-report, #printable-report * { visibility: visible !important; }
        #printable-report {
          position: absolute;
          left: 0;
          top: 0;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          color: #000000 !important;
          background-color: #ffffff !important;
        }
        .no-print { display: none !important; }
      }
    `;
    document.head.appendChild(originalStyle);
    window.print();
    document.head.removeChild(originalStyle);
  };

  if (!hasPermission('view')) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500">
          <BarChart3 size={32} />
        </div>
        <h2 className="text-xl font-bold text-white">عذراً، ليس لديك صلاحية الوصول</h2>
        <p className="text-gray-400 max-w-md">يرجى التواصل مع المسؤول للحصول على الصلاحيات اللازمة لعرض التقارير.</p>
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
  const [stats, setStats] = useState<ReportStats>({
    totalIncoming: 0,
    inShopTotal: 0,
    deliveredTotal: 0,
    deliveredByExitDateTotal: 0,
    inShopNew: 0,
    inShopInspection: 0,
    inShopRepairing: 0,
    inShopAwaitingApproval: 0,
    inShopAwaitingParts: 0,
    inShopReady: 0,
    deliveredReadyCount: 0,
    deliveredUnrepairableCount: 0,
    deliveredIntactCount: 0,
    deliveredRefusedCount: 0,
    deliveredCancelledCount: 0,
    deliveredByExitReadyCount: 0,
    deliveredByExitUnrepairableCount: 0,
    deliveredByExitIntactCount: 0,
    deliveredByExitRefusedCount: 0,
    deliveredByExitCancelledCount: 0,
    revenueCollected: 0,
    revenueCollectedByExitDate: 0,
    revenueAwaiting: 0,
    averageTicket: 0
  });

  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Navigation & Sub-views states
  const [activeSubView, setActiveSubView] = useState<SubView>('none');
  const [inShopFilter, setInShopFilter] = useState<string>('all');
  const [deliveredFilter, setDeliveredFilter] = useState<string>('all');
  const [deliveryMode, setDeliveryMode] = useState<'batch' | 'exit_date'>('batch');
  const [viewMode, setViewMode] = useState<'devices' | 'invoices'>('devices');
  const [showFinancialModal, setShowFinancialModal] = useState(false);
  const [showComprehensiveModal, setShowComprehensiveModal] = useState(false);
  const [showDeviceSummaryModal, setShowDeviceSummaryModal] = useState(false);
  const [previewData, setPreviewData] = useState<{ type: 'invoice' | 'voucher' | 'statement' | 'table'; data: any } | null>(null);
  const [mainReportSection, setMainReportSection] = useState<'devices' | 'financial'>('devices');

  useBackHandler(mainReportSection === 'financial' && activeSubView === 'none', () => setMainReportSection('devices'));
  useBackHandler(activeSubView !== 'none', () => setActiveSubView('none'));

  // Raw and filtered items cache for the table
  const [rawItems, setRawItems] = useState<any[]>([]);
  const [filteredPeriodItems, setFilteredPeriodItems] = useState<any[]>([]);
  const [filteredDeliveredByExitItems, setFilteredDeliveredByExitItems] = useState<any[]>([]);
  const [itemInvoiceMap, setItemInvoiceMap] = useState<Map<string, any>>(new Map());
  const [customersMap, setCustomersMap] = useState<Map<string, any>>(new Map());

  // Pagination for Detailed Reports
  const [reportPage, setReportPage] = useState(1);
  const itemsPerPage = 10;

  // Reset page when any filter or view changes
  useEffect(() => {
    setReportPage(1);
  }, [timeRange, startDate, endDate, activeSubView, inShopFilter, deliveredFilter, deliveryMode, viewMode]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const customersSnap = await getDocs(collection(db, 'customers'));
        const custMap = new Map<string, any>();
        customersSnap.docs.forEach((d: any) => {
          custMap.set(d.id, { id: d.id, ...d.data() });
        });
        setCustomersMap(custMap);

        const itemsSnap = await getDocs(collection(db, 'invoice_items'));
        const rawItemDocs = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const invoicesSnap = await getDocs(collection(db, 'invoices'));
        const allInvoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const invoiceMap = new Map<string, any>();
        allInvoices.forEach((inv: any) => {
          if (inv.id) invoiceMap.set(String(inv.id), inv);
          if (inv.invoiceNumber) {
            const rawNo = String(inv.invoiceNumber);
            const cleanNo = rawNo.replace('#', '').trim();
            invoiceMap.set(rawNo, inv);
            invoiceMap.set(cleanNo, inv);
          }
        });
        setItemInvoiceMap(invoiceMap);

        // Strict Maintenance-Only filtering for all device reports and counters
        const allItems = rawItemDocs.filter((item: any) => {
          const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                      (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                      (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber))) ||
                      null;
          if (inv && (isPurchaseInvoice(inv) || isSaleInvoice(inv))) return false;
          return isShopMaintenanceItem(item, inv);
        });
        setRawItems(allItems);

        // Filter items based on selected time range
        const now = new Date();

        // Universal date extractor for any item
        const getItemResolvedDate = (item: any): Date | null => {
          const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                      (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                      (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber))) ||
                      null;

          const candidates = [
            item.createdAt,
            item.entryDate,
            item.date,
            inv?.createdAt,
            inv?.date,
            item.updatedAt,
            inv?.updatedAt,
            item.deliveryDate,
            item.deliveredAt,
            inv?.deliveredAt
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

        const periodItems = allItems.filter((item: any) => {
          if (timeRange === 'all') return true;

          const itemDate = getItemResolvedDate(item);
          if (!itemDate) return false;

          if (timeRange === 'today') {
            const d = new Date(itemDate);
            return d.getFullYear() === now.getFullYear() &&
                   d.getMonth() === now.getMonth() &&
                   d.getDate() === now.getDate();
          }
          if (timeRange === 'week') {
            const weekAgo = new Date();
            weekAgo.setDate(now.getDate() - 7);
            weekAgo.setHours(0, 0, 0, 0);
            return itemDate >= weekAgo;
          }
          if (timeRange === 'month') {
            const monthAgo = new Date();
            monthAgo.setMonth(now.getMonth() - 1);
            monthAgo.setHours(0, 0, 0, 0);
            return itemDate >= monthAgo;
          }
          if (timeRange === 'custom') {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            return itemDate >= start && itemDate <= end;
          }
          return true;
        });

        // Universal delivery date extractor for delivered items
        const getItemResolvedDeliveryDate = (item: any): Date | null => {
          const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                      (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                      (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber))) ||
                      null;

          const candidates = [
            item.deliveredAt,
            item.deliveryDate,
            inv?.deliveredAt,
            inv?.deliveryDate,
            item.updatedAt,
            inv?.updatedAt,
            item.createdAt,
            inv?.createdAt
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

        // Outgoing items filtered strictly by their Exit/Delivery Date
        const allDeliveredItems = allItems.filter((i: any) => i.status === '60' || i.status === 'delivered');
        const deliveredByExitItems = allDeliveredItems.filter((item: any) => {
          if (timeRange === 'all') return true;

          const exitDate = getItemResolvedDeliveryDate(item);
          if (!exitDate) return false;

          if (timeRange === 'today') {
            const d = new Date(exitDate);
            return d.getFullYear() === now.getFullYear() &&
                   d.getMonth() === now.getMonth() &&
                   d.getDate() === now.getDate();
          }
          if (timeRange === 'week') {
            const weekAgo = new Date();
            weekAgo.setDate(now.getDate() - 7);
            weekAgo.setHours(0, 0, 0, 0);
            return exitDate >= weekAgo;
          }
          if (timeRange === 'month') {
            const monthAgo = new Date();
            monthAgo.setMonth(now.getMonth() - 1);
            monthAgo.setHours(0, 0, 0, 0);
            return exitDate >= monthAgo;
          }
          if (timeRange === 'custom') {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            return exitDate >= start && exitDate <= end;
          }
          return true;
        });

        // Sort deliveredByExitItems so the newest delivery is first
        deliveredByExitItems.sort((a, b) => {
          const dateA = getItemResolvedDeliveryDate(a)?.getTime() || 0;
          const dateB = getItemResolvedDeliveryDate(b)?.getTime() || 0;
          if (dateB !== dateA) return dateB - dateA;
          const numA = Number(a.invoiceNumber) || 0;
          const numB = Number(b.invoiceNumber) || 0;
          return numB - numA;
        });

        setFilteredDeliveredByExitItems(deliveredByExitItems);

        // Sort periodItems so the newest is at the top (highest invoiceNumber / newest date)
        periodItems.sort((a, b) => {
          const numA = Number(a.invoiceNumber) || 0;
          const numB = Number(b.invoiceNumber) || 0;
          if (numB !== numA) return numB - numA;
          
          const dateA = getItemResolvedDate(a)?.getTime() || 0;
          const dateB = getItemResolvedDate(b)?.getTime() || 0;
          return dateB - dateA;
        });

        setFilteredPeriodItems(periodItems);

        // Sum helper
        const sumQuantity = (arr: any[]) => arr.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
        const sumCost = (arr: any[]) => arr.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);

        // Separate In-Shop and Delivered within selected period
        const inShopItems = periodItems.filter(i => isInShopMaintenanceDevice(i));
        const deliveredItems = periodItems.filter(i => i.status === '60' || i.status === 'delivered');

        // Detailed In-Shop Classifications
        const inShopNew = inShopItems.filter(i => i.status === '10' || i.status === 'new');
        const inShopInspection = inShopItems.filter(i => i.status === '20' || i.status === '21' || i.status === '22' || i.status === 'inspected' || i.status === 'testing');
        const inShopRepairing = inShopItems.filter(i => i.status === '40' || i.status === 'repairing');
        const inShopAwaitingApproval = inShopItems.filter(i => i.status === '30' || i.status === 'awaiting_approval');
        const inShopAwaitingParts = inShopItems.filter(i => i.status === '35' || i.status === 'awaiting_parts');
        const inShopReady = inShopItems.filter(i => i.status === '50' || ['ready', 'intact', 'unrepairable', 'refused'].includes(i.status));

        // Detailed Delivered Classifications (Perspective 1: Inflow batch devices that became delivered)
        const deliveredReady = deliveredItems.filter(i => getItemSubStatus(i) === 'ready');
        const deliveredUnrepairable = deliveredItems.filter(i => getItemSubStatus(i) === 'unrepairable');
        const deliveredIntact = deliveredItems.filter(i => getItemSubStatus(i) === 'intact');
        const deliveredRefused = deliveredItems.filter(i => getItemSubStatus(i) === 'refused');
        const deliveredCancelled = deliveredItems.filter(i => getItemSubStatus(i) === 'cancelled');

        // Detailed Delivered Classifications (Perspective 2: Devices exited during period by delivery date)
        const deliveredByExitReady = deliveredByExitItems.filter(i => getItemSubStatus(i) === 'ready');
        const deliveredByExitUnrepairable = deliveredByExitItems.filter(i => getItemSubStatus(i) === 'unrepairable');
        const deliveredByExitIntact = deliveredByExitItems.filter(i => getItemSubStatus(i) === 'intact');
        const deliveredByExitRefused = deliveredByExitItems.filter(i => getItemSubStatus(i) === 'refused');
        const deliveredByExitCancelled = deliveredByExitItems.filter(i => getItemSubStatus(i) === 'cancelled');

        // Financial analytics
        const revenueCollected = sumCost(deliveredItems);
        const revenueCollectedByExitDate = sumCost(deliveredByExitItems);
        const revenueAwaiting = sumCost(inShopItems);
        const avgTicket = periodItems.length > 0 ? (sumCost(periodItems) / sumQuantity(periodItems)) : 0;

        setStats({
          totalIncoming: sumQuantity(periodItems),
          inShopTotal: sumQuantity(inShopItems),
          deliveredTotal: sumQuantity(deliveredItems),
          deliveredByExitDateTotal: sumQuantity(deliveredByExitItems),
          
          inShopNew: sumQuantity(inShopNew),
          inShopInspection: sumQuantity(inShopInspection),
          inShopRepairing: sumQuantity(inShopRepairing),
          inShopAwaitingApproval: sumQuantity(inShopAwaitingApproval),
          inShopAwaitingParts: sumQuantity(inShopAwaitingParts),
          inShopReady: sumQuantity(inShopReady),

          deliveredReadyCount: sumQuantity(deliveredReady),
          deliveredUnrepairableCount: sumQuantity(deliveredUnrepairable),
          deliveredIntactCount: sumQuantity(deliveredIntact),
          deliveredRefusedCount: sumQuantity(deliveredRefused),
          deliveredCancelledCount: sumQuantity(deliveredCancelled),

          deliveredByExitReadyCount: sumQuantity(deliveredByExitReady),
          deliveredByExitUnrepairableCount: sumQuantity(deliveredByExitUnrepairable),
          deliveredByExitIntactCount: sumQuantity(deliveredByExitIntact),
          deliveredByExitRefusedCount: sumQuantity(deliveredByExitRefused),
          deliveredByExitCancelledCount: sumQuantity(deliveredByExitCancelled),

          revenueCollected,
          revenueCollectedByExitDate,
          revenueAwaiting,
          averageTicket: Math.round(avgTicket)
        });

      } catch (err) {
        console.error("Error fetching report metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [timeRange, startDate, endDate]);

  const timeRangeLabels = {
    all: 'الكل',
    today: 'اليوم',
    week: 'أسبوع',
    month: 'شهر',
    custom: 'فترة محددة'
  };

  // Extract counts for device type distribution categories
  const getCategoryDistribution = () => {
    const counts: Record<string, number> = {};
    filteredPeriodItems.forEach((item) => {
      const type = item.deviceType || 'أخرى';
      counts[type] = (counts[type] || 0) + (Number(item.quantity) || 1);
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  };

  const getCustomerDetails = (item: any) => {
    let custId = item.customerId;
    if (!custId && item.invoiceNumber) {
      const inv = itemInvoiceMap.get(String(item.invoiceNumber));
      if (inv) {
        custId = inv.customerId;
      }
    }
    if (custId) {
      const cust = customersMap.get(custId);
      if (cust) {
        return {
          name: cust.name || item.customerName || 'مستلم عام',
          company: cust.companyName || '---',
          phone: cust.phone1 || '---'
        };
      }
    }
    return {
      name: item.customerName || 'مستلم عام',
      company: '---',
      phone: '---'
    };
  };

  // Filtrations for the lower table depending on clicked sub stats
  const getSubViewTableItems = () => {
    const inShopItems = filteredPeriodItems.filter(i => isInShopMaintenanceDevice(i));
    const deliveredItems = deliveryMode === 'exit_date' 
      ? filteredDeliveredByExitItems 
      : filteredPeriodItems.filter(i => i.status === '60' || i.status === 'delivered');

    if (activeSubView === 'in-shop') {
      if (inShopFilter === 'all') return inShopItems;
      if (inShopFilter === 'new') return inShopItems.filter(i => i.status === '10' || i.status === 'new');
      if (inShopFilter === 'inspection') return inShopItems.filter(i => i.status === '20' || i.status === '21' || i.status === '22' || i.status === 'inspected' || i.status === 'testing');
      if (inShopFilter === 'repairing') return inShopItems.filter(i => i.status === '40' || i.status === 'repairing');
      if (inShopFilter === 'awaiting_approval') return inShopItems.filter(i => i.status === '30' || i.status === 'awaiting_approval');
      if (inShopFilter === 'awaiting_parts') return inShopItems.filter(i => i.status === '35' || i.status === 'awaiting_parts');
      if (inShopFilter === 'ready') return inShopItems.filter(i => i.status === '50' || ['ready', 'intact', 'unrepairable', 'refused'].includes(i.status));
    }

    if (activeSubView === 'delivered') {
      if (deliveredFilter === 'all') return deliveredItems;
      if (deliveredFilter === 'ready') return deliveredItems.filter(i => getItemSubStatus(i) === 'ready');
      if (deliveredFilter === 'unrepairable') return deliveredItems.filter(i => getItemSubStatus(i) === 'unrepairable');
      if (deliveredFilter === 'intact') return deliveredItems.filter(i => getItemSubStatus(i) === 'intact');
      if (deliveredFilter === 'refused') return deliveredItems.filter(i => getItemSubStatus(i) === 'refused');
      if (deliveredFilter === 'cancelled') return deliveredItems.filter(i => getItemSubStatus(i) === 'cancelled');
    }

    return [];
  };

  const tableItems = getSubViewTableItems();
  const tableItemsTotalQuantity = tableItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0);

  const formatDate = (val: any) => {
    const d = parseDate(val);
    if (!d) return '---';
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getGroupedInvoices = (items: any[]) => {
    const map = new Map<string, {
      invoiceNumber: string;
      customer: any;
      items: any[];
      totalCost: number;
      totalQuantity: number;
      currency: string;
      createdAt: any;
    }>();

    items.forEach(item => {
      const invNum = String(item.invoiceNumber || 'بدون رقم');
      const existing = map.get(invNum);
      const itemCost = Number(item.cost) || 0;
      const invData = itemInvoiceMap.get(invNum);
      const currency = invData?.currency || 'USD';

      const itemQty = Number(item.quantity) || 1;
      if (existing) {
        existing.items.push(item);
        existing.totalCost += itemCost;
        existing.totalQuantity += itemQty;
      } else {
        map.set(invNum, {
          invoiceNumber: invNum,
          customer: getCustomerDetails(item),
          items: [item],
          totalCost: itemCost,
          totalQuantity: itemQty,
          currency: currency,
          createdAt: item.createdAt || invData?.createdAt
        });
      }
    });

    const result = Array.from(map.values());
    result.forEach(group => {
      const invData = itemInvoiceMap.get(group.invoiceNumber);
      if (invData) {
        const discount = Number(invData.discount !== undefined ? invData.discount : (invData.discountAmount || 0));
        const tax = Number(invData.tax !== undefined ? invData.tax : (invData.taxAmount || 0));
        group.totalCost = Math.max(0, group.totalCost - discount + tax);
        (group as any).discount = discount;
        (group as any).tax = tax;
      }
    });

    return result;
  };

  const groupedInvoices = getGroupedInvoices(tableItems);

  const totalPages = viewMode === 'invoices'
    ? Math.max(1, Math.ceil(groupedInvoices.length / itemsPerPage))
    : Math.max(1, Math.ceil(tableItems.length / itemsPerPage));

  const safeCurrentPage = Math.min(reportPage, totalPages);
  const paginatedItems = tableItems.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);
  const paginatedInvoices = groupedInvoices.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);

  const handleWhatsAppExport = () => {
    let title = activeSubView === 'in-shop' 
      ? 'تقرير الأجهزة داخل المحل' 
      : activeSubView === 'delivered' 
      ? 'تقرير الأجهزة الخارجة' 
      : 'تقرير تقارير الصيانة والشؤون الفنية';

    let filterText = 'جميع البيانات';
    if (activeSubView === 'in-shop') {
      filterText = inShopFilter === 'all' ? 'جميع الأجهزة' :
        inShopFilter === 'new' ? 'أجهزة جديدة' :
        inShopFilter === 'inspection' ? 'قيد الفحص' :
        inShopFilter === 'repairing' ? 'قيد الصيانة' :
        inShopFilter === 'awaiting_approval' ? 'في انتظار الموافقة والقطع' :
        inShopFilter === 'ready' ? 'جاهز للتسليم' : 'أخرى';
    } else if (activeSubView === 'delivered') {
      filterText = deliveredFilter === 'all' ? 'جميع المخرجات' :
        deliveredFilter === 'ready' ? 'تسليم وهو جاهز' :
        deliveredFilter === 'unrepairable' ? 'غير قابل للصيانة' :
        deliveredFilter === 'intact' ? 'تسليم سليم' :
        deliveredFilter === 'refused' ? 'مرفوض' : 'أخرى';
    }

    const count = viewMode === 'invoices' ? groupedInvoices.length : tableItemsTotalQuantity;
    const itemType = viewMode === 'invoices' ? 'فاتورة' : 'جهاز';
    
    let totalAmount = 0;
    if (viewMode === 'invoices') {
      totalAmount = groupedInvoices.reduce((acc, inv) => acc + inv.totalCost, 0);
    } else {
      totalAmount = tableItems.reduce((acc, it) => acc + (Number(it.cost) || 0), 0);
    }

    let msg = `📋 *${title}*\n`;
    msg += `📅 الفترة: ${timeRangeLabels[timeRange] || 'الحالية'}\n`;
    msg += `🔍 التصفية: ${filterText}\n`;
    msg += `📊 طريقة العرض: ${viewMode === 'invoices' ? 'فواتير' : 'أجهزة'}\n`;
    msg += `🔢 الإجمالي: ${count} ${itemType}\n`;
    msg += `💰 المبلغ الكلي: ${totalAmount.toLocaleString('en-US')}\n`;
    msg += `-----------------------------------\n`;

    if (viewMode === 'invoices') {
      const list = groupedInvoices.slice(0, 20);
      list.forEach((inv, i) => {
        msg += `${i + 1}. فاتورة #${inv.invoiceNumber} | ${inv.customer.name} | ${inv.totalQuantity} أجهزة | ${inv.totalCost.toLocaleString('en-US')} ${inv.currency}\n`;
      });
      if (groupedInvoices.length > 20) {
        msg += `...وغيرها (${groupedInvoices.length - 20} فاتورة أخرى)\n`;
      }
    } else {
      const list = tableItems.slice(0, 20);
      list.forEach((it, i) => {
        const cust = getCustomerDetails(it);
        msg += `${i + 1}. فاتورة #${it.invoiceNumber} | ${it.deviceType || 'جهاز'} ${it.deviceName || ''} | ${cust.name} | ${Number(it.cost) || 0}\n`;
      });
      if (tableItems.length > 20) {
        msg += `...وغيرها (${tableItems.length - 20} جهاز آخر)\n`;
      }
    }

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const ViewModeSelector = () => (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 bg-black/40 p-1.5 rounded-2xl border border-white/10 my-1">
        <span className="text-[11px] font-black text-gray-400 px-2">طريقة العرض:</span>
        <button 
          type="button"
          onClick={() => setViewMode('devices')} 
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
            viewMode === 'devices' 
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20' 
              : 'text-gray-400 hover:text-white bg-white/5'
          }`}
        >
          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
            viewMode === 'devices' ? 'border-white bg-white' : 'border-gray-400'
          }`}>
            {viewMode === 'devices' && <div className="w-2 h-2 rounded-full bg-orange-600" />}
          </div>
          <Package size={14} />
          <span>أجهزة</span>
        </button>

        <button 
          type="button"
          onClick={() => setViewMode('invoices')} 
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-all ${
            viewMode === 'invoices' 
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20' 
              : 'text-gray-400 hover:text-white bg-white/5'
          }`}
        >
          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
            viewMode === 'invoices' ? 'border-white bg-white' : 'border-gray-400'
          }`}>
            {viewMode === 'invoices' && <div className="w-2 h-2 rounded-full bg-orange-600" />}
          </div>
          <FileText size={14} />
          <span>فواتير</span>
        </button>
      </div>

      <div className="flex items-center gap-2 my-1">
        <button 
          type="button"
          onClick={handlePrint}
          className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-md shadow-blue-600/20 active:scale-95 cursor-pointer"
          title="طباعة التقرير الحالي"
        >
          <Printer size={15} />
          <span>طباعة</span>
        </button>

        <button 
          type="button"
          onClick={handleWhatsAppExport}
          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20 active:scale-95 cursor-pointer"
          title="تصدير ومشاركة التقرير عبر الواتساب"
        >
          <WhatsAppIcon className="w-4 h-4" />
          <span>تصدير واتساب</span>
        </button>
      </div>
    </div>
  );

  const getRevenueCollectedFormatted = () => {
    const deliveredItems = filteredPeriodItems.filter(i => i.status === '60' || i.status === 'delivered');
    const totals: { [cur: string]: number } = {};
    deliveredItems.forEach((it) => {
      const cur = itemInvoiceMap.get(String(it.invoiceNumber))?.currency || 'USD';
      totals[cur] = (totals[cur] || 0) + (Number(it.cost) || 0);
    });
    const entries = Object.entries(totals);
    if (entries.length === 0) return '0 USD';
    return entries.map(([cur, val]) => `${val.toLocaleString('en-US')} ${cur}`).join(' / ');
  };

  const getRevenueAwaitingFormatted = () => {
    const inShopItems = filteredPeriodItems.filter(i => isInShopMaintenanceDevice(i));
    const totals: { [cur: string]: number } = {};
    inShopItems.forEach((it) => {
      const cur = itemInvoiceMap.get(String(it.invoiceNumber))?.currency || 'USD';
      totals[cur] = (totals[cur] || 0) + (Number(it.cost) || 0);
    });
    const entries = Object.entries(totals);
    if (entries.length === 0) return '0 USD';
    return entries.map(([cur, val]) => `${val.toLocaleString('en-US')} ${cur}`).join(' / ');
  };

  const getAverageTicketFormatted = () => {
    if (filteredPeriodItems.length === 0) return '0 USD';
    const totals: { [cur: string]: number } = {};
    const counts: { [cur: string]: number } = {};
    filteredPeriodItems.forEach((it) => {
      const cur = itemInvoiceMap.get(String(it.invoiceNumber))?.currency || 'USD';
      totals[cur] = (totals[cur] || 0) + (Number(it.cost) || 0);
      counts[cur] = (counts[cur] || 0) + 1;
    });
    const entries = Object.entries(totals);
    return entries.map(([cur, val]) => {
      const avg = val / (counts[cur] || 1);
      return `${Math.round(avg).toLocaleString('en-US')} ${cur}`;
    }).join(' / ');
  };

  const getStatusArabicLabel = (status: string, sub?: string) => {
    const itemSub = sub || '';
    if (status === '60' || status === 'delivered') {
      if (itemSub === 'ready') return 'تم التسليم (جاهز)';
      if (itemSub === 'unrepairable') return 'تم التسليم (لا يصلح)';
      if (itemSub === 'intact') return 'تم التسليم (سليم)';
      if (itemSub === 'refused') return 'تم التسليم (لم يوافق العميل)';
      if (itemSub === 'cancelled') return 'تم التسليم (ملغى)';
      return 'تم التسليم';
    }
    if (status === '10' || status === 'new') return 'أجهزة جديدة';
    if (status === '20' || status === 'inspected' || status === 'testing') return 'قيد الفحص';
    if (status === '21') return 'فحص مرحلي 1';
    if (status === '22') return 'فحص مرحلي 2';
    if (status === '30' || status === 'awaiting_approval') return 'انتظار الموافقة والقطع';
    if (status === '35' || status === 'awaiting_parts') return 'انتظار قطع الغيار';
    if (status === '40' || status === 'repairing') return 'قيد الصيانة';
    if (status === '50' || ['ready', 'intact', 'unrepairable', 'refused'].includes(status)) return 'جاهز للتسليم';
    return status;
  };

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case 'today': return 'اليوم';
      case 'week': return 'آخر 7 أيام';
      case 'month': return 'الشهر الحالي';
      case 'custom': return `من ${startDate} إلى ${endDate}`;
      default: return 'كافة الفترات';
    }
  };

  const getCustomerName = (item: any, inv: any) => {
    if (item.customerName) return item.customerName;
    if (inv?.customerName) return inv.customerName;
    const custId = item.customerId || inv?.customerId;
    if (custId && customersMap.has(custId)) {
      return customersMap.get(custId)?.name || 'عميل نقدي';
    }
    return 'عميل نقدي';
  };

  // 1. تقرير الأجهزة المنجزة والجاهزة للتسليم
  const handlePrintDailyCompletedReport = () => {
    const targetItems = filteredPeriodItems.filter(item => 
      ['50', '60'].includes(item.status) || item.status === 'ready' || item.status === 'delivered'
    );

    const rows = targetItems.map((item, idx) => {
      const inv = itemInvoiceMap.get(String(item.invoiceNumber).replace('#', '').trim()) || itemInvoiceMap.get(String(item.invoiceNumber));
      const cust = getCustomerName(item, inv);
      const dev = `${item.deviceType || 'جهاز'} ${item.deviceName ? `- ${item.deviceName}` : ''}`;
      const tech = item.technician || 'عام';
      const dateStr = parseDate(item.updatedAt || item.deliveryDate || item.entryDate)?.toLocaleDateString('ar-YE') || '---';
      const cost = Number(item.cost || 0);
      const curr = inv?.currency || 'USD';
      const statusStr = item.status === '60' || item.status === 'delivered' ? 'تم التسليم' : 'جاهز للتسليم';

      return [
        String(item.invoiceNumber || idx + 1).replace('#', ''),
        cust,
        dev,
        tech,
        dateStr,
        `${cost.toLocaleString('en-US')} ${curr}`,
        statusStr
      ];
    });

    const totalCost = targetItems.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير الأجهزة المنجزة والجاهزة للتسليم',
          subtitle: `الفترة: ${getTimeRangeLabel()} | إجمالي الأجهزة: ${targetItems.length}`,
          headers: ['رقم الفاتورة', 'اسم العميل', 'نوع الجهاز والموديل', 'المهندس الفني', 'تاريخ الإنجاز', 'التكلفة', 'الحالة الفنية'],
          rows: rows,
          footerNotes: `إجمالي عدد الأجهزة المنجزة: ${targetItems.length} جهاز | إجمالي القيمة الفنية: ${totalCost.toLocaleString('en-US')}`
        }
      }
    });
  };

  // 2. تقرير الأجهزة المتأخرة بالورشة
  const handlePrintDelayedDevicesReport = () => {
    const inShopStatuses = ['10', '20', '21', '22', '30', '35', '40', 'new', 'testing', 'awaiting_approval', 'awaiting_parts', 'repairing'];
    const nowTime = new Date().getTime();

    const delayedItems = rawItems.filter(item => {
      if (!inShopStatuses.includes(item.status)) return false;
      const d = parseDate(item.createdAt || item.entryDate);
      if (!d) return false;
      const diffDays = Math.floor((nowTime - d.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 3;
    });

    const rows = delayedItems.map((item, idx) => {
      const inv = itemInvoiceMap.get(String(item.invoiceNumber).replace('#', '').trim()) || itemInvoiceMap.get(String(item.invoiceNumber));
      const cust = getCustomerName(item, inv);
      const dev = `${item.deviceType || 'جهاز'} ${item.deviceName ? `- ${item.deviceName}` : ''}`;
      const d = parseDate(item.createdAt || item.entryDate);
      const dateStr = d ? d.toLocaleDateString('ar-YE') : '---';
      const diffDays = d ? Math.floor((nowTime - d.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const tech = item.technician || 'غير مسند';
      const statusStr = getStatusArabicLabel(item.status, getItemSubStatus(item));

      return [
        String(item.invoiceNumber || idx + 1).replace('#', ''),
        cust,
        dev,
        dateStr,
        `${diffDays} يوم`,
        tech,
        statusStr
      ];
    });

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير حصر الأجهزة المتأخرة في الورشة',
          subtitle: `الأجهزة التي تجاوزت مدة إقامتها في الورشة أكثر من 3 أيام | العدد: ${delayedItems.length}`,
          headers: ['رقم الفاتورة', 'اسم العميل', 'نوع الجهاز', 'تاريخ الدخول', 'مدة التأخير', 'المهندس المسؤول', 'الحالة الحالية'],
          rows: rows,
          footerNotes: `يرجى متابعة إنجاز وفحص الأجهزة المذكورة أعلاه مع المهندسين المختصين لضمان سرعة التسليم.`
        }
      }
    });
  };

  // 3. تقرير كفاءة وإنتاجية المهندسين
  const handlePrintTechnicianProductivityReport = () => {
    const techMap = new Map<string, { total: number; completed: number; inProgress: number; failed: number; revenue: number }>();

    filteredPeriodItems.forEach(item => {
      const tech = item.technician || 'غير محدد';
      if (!techMap.has(tech)) {
        techMap.set(tech, { total: 0, completed: 0, inProgress: 0, failed: 0, revenue: 0 });
      }
      const data = techMap.get(tech)!;
      data.total += 1;
      const cost = Number(item.cost || 0);

      if (['50', '60'].includes(item.status) || item.status === 'ready' || item.status === 'delivered') {
        data.completed += 1;
        data.revenue += cost;
      } else if (['55', '45', '70'].includes(item.status) || item.status === 'unrepairable' || item.status === 'refused') {
        data.failed += 1;
      } else {
        data.inProgress += 1;
      }
    });

    const rows: any[] = [];
    techMap.forEach((val, tech) => {
      const rate = val.total > 0 ? Math.round((val.completed / val.total) * 100) : 0;
      rows.push([
        tech,
        `${val.total} جهاز`,
        `${val.completed} جهاز`,
        `${val.inProgress} جهاز`,
        `${val.failed} جهاز`,
        `${val.revenue.toLocaleString('en-US')}`,
        `${rate}%`
      ]);
    });

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير كفاءة وإنتاجية الفنيين والمهندسين',
          subtitle: `الفترة: ${getTimeRangeLabel()} | إجمالي الطاقم الفني النشط: ${techMap.size}`,
          headers: ['اسم المهندس / الفني', 'إجمالي المسند', 'تم الإنجاز بنجاح', 'قيد العمل والفحص', 'مرفوض / لا يصلح', 'قيمة الصيانة المنجزة', 'نسبة الإنجاز %'],
          rows: rows,
          footerNotes: `تم استخراج هذا التقرير تلقائياً استناداً إلى عمليات الصيانة المسجلة باسم كل فني.`
        }
      }
    });
  };

  // 4. تقرير مسير خروج وتسليم الأجهزة
  const handlePrintDetailedExitReport = () => {
    const exitItems = filteredPeriodItems.filter(item => 
      ['60', 'delivered'].includes(item.status) || item.deliveryDate
    );

    const rows = exitItems.map((item, idx) => {
      const inv = itemInvoiceMap.get(String(item.invoiceNumber).replace('#', '').trim()) || itemInvoiceMap.get(String(item.invoiceNumber));
      const cust = getCustomerName(item, inv);
      const dev = `${item.deviceType || 'جهاز'} ${item.deviceName ? `- ${item.deviceName}` : ''}`;
      const d = parseDate(item.deliveryDate || item.updatedAt);
      const dateStr = d ? d.toLocaleDateString('ar-YE') : '---';
      const statusLabel = getStatusArabicLabel(item.status, getItemSubStatus(item));
      const cost = Number(item.cost || 0);
      const curr = inv?.currency || 'USD';
      const recipient = item.recipientName || cust;

      return [
        String(item.invoiceNumber || idx + 1).replace('#', ''),
        cust,
        dev,
        dateStr,
        statusLabel,
        `${cost.toLocaleString('en-US')} ${curr}`,
        recipient
      ];
    });

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير مسير خروج وتسليم الأجهزة للعملاء',
          subtitle: `الفترة: ${getTimeRangeLabel()} | إجمالي الأجهزة الخارجة: ${exitItems.length}`,
          headers: ['رقم الفاتورة', 'اسم العميل', 'نوع الجهاز', 'تاريخ الاستلام والتسليم', 'الحالة الفنية عند الخروج', 'المبلغ المحصل', 'المستلم'],
          rows: rows,
          footerNotes: `إجمالي الأجهزة الخارجة المسلمة: ${exitItems.length} جهاز.`
        }
      }
    });
  };

  // 5. تقرير حركة استلام ودخول الأجهزة
  const handlePrintDetailedEntryReport = () => {
    const rows = filteredPeriodItems.map((item, idx) => {
      const inv = itemInvoiceMap.get(String(item.invoiceNumber).replace('#', '').trim()) || itemInvoiceMap.get(String(item.invoiceNumber));
      const cust = getCustomerName(item, inv);
      const dev = `${item.deviceType || 'جهاز'} ${item.deviceName ? `- ${item.deviceName}` : ''}`;
      const d = parseDate(item.createdAt || item.entryDate);
      const dateStr = d ? d.toLocaleDateString('ar-YE') : '---';
      const fault = item.faultType || item.customerProblem || 'غير محدد';
      const statusLabel = getStatusArabicLabel(item.status, getItemSubStatus(item));

      return [
        String(item.invoiceNumber || idx + 1).replace('#', ''),
        cust,
        dev,
        dateStr,
        fault,
        statusLabel
      ];
    });

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير حركة استلام ودخول الأجهزة للورشة',
          subtitle: `الفترة: ${getTimeRangeLabel()} | إجمالي الأجهزة المستلمة: ${filteredPeriodItems.length}`,
          headers: ['رقم الفاتورة', 'اسم العميل', 'نوع الجهاز والموديل', 'تاريخ الدخول', 'العطل المشتكى منه', 'الحالة الحالية'],
          rows: rows,
          footerNotes: `إجمالي الأجهزة المستلمة خلال الفترة: ${filteredPeriodItems.length} جهاز.`
        }
      }
    });
  };

  // 6. تقرير الأجهزة المرفوضة وغير القابلة للإصلاح
  const handlePrintUnrepairableRefusedReport = () => {
    const unrepairableItems = filteredPeriodItems.filter(item => 
      ['55', '45', '70'].includes(item.status) || 
      item.subStatus === 'unrepairable' || 
      item.subStatus === 'refused' ||
      item.subStatus === 'cancelled'
    );

    const rows = unrepairableItems.map((item, idx) => {
      const inv = itemInvoiceMap.get(String(item.invoiceNumber).replace('#', '').trim()) || itemInvoiceMap.get(String(item.invoiceNumber));
      const cust = getCustomerName(item, inv);
      const dev = `${item.deviceType || 'جهاز'} ${item.deviceName ? `- ${item.deviceName}` : ''}`;
      const d = parseDate(item.updatedAt || item.createdAt);
      const dateStr = d ? d.toLocaleDateString('ar-YE') : '---';
      const reason = item.failureReason || item.engineerReport || item.technicalNotes || 'تعذر الإصلاح لعدم توفر القطع أو عدم الجدوى';
      const statusLabel = item.status === '70' || item.subStatus === 'refused' ? 'رفض العميل' : 'لا يمكن إصلاحه';

      return [
        String(item.invoiceNumber || idx + 1).replace('#', ''),
        cust,
        dev,
        dateStr,
        reason,
        statusLabel
      ];
    });

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير الأجهزة المرفوضة وغير القابلة للإصلاح',
          subtitle: `الفترة: ${getTimeRangeLabel()} | العدد الإجمالي: ${unrepairableItems.length}`,
          headers: ['رقم الفاتورة', 'اسم العميل', 'نوع الجهاز والموديل', 'تاريخ القرار الفني', 'السبب / التقرير الفني', 'النتيجة النهائية'],
          rows: rows,
          footerNotes: `إجمالي الأجهزة المرفوضة وغير القابلة للإصلاح: ${unrepairableItems.length} جهاز.`
        }
      }
    });
  };

  // 7. تقرير الملخص العام ومؤشرات النظام
  const handlePrintGeneralSummaryReport = () => {
    const rows = [
      ['إجمالي الأجهزة الواردة في الفترة', `${stats.totalIncoming} جهاز`, 'إجمالي مدخلات النظام'],
      ['الأجهزة المتواجدة حالياً في المحل', `${stats.inShopTotal} جهاز`, 'قيد الفحص والإجراء الفني'],
      ['الأجهزة المنتهية والخارجة', `${stats.deliveredTotal} جهاز`, 'تمت دورة الصيانة وخرجت'],
      ['الأجهزة الجاهزة للتسليم داخل الورشة', `${stats.inShopReady} جهاز`, 'بانتظار استلام العميل'],
      ['الأجهزة قيد الصيانة والإصلاح', `${stats.inShopRepairing} جهاز`, 'يجري العمل عليها'],
      ['الأجهزة بانتظار موافقة العميل', `${stats.inShopAwaitingApproval} جهاز`, 'تم الفحص والتسعير'],
      ['الأجهزة بانتظار قطع الغيار', `${stats.inShopAwaitingParts} جهاز`, 'معلقة لطلب القطع'],
      ['الأجهزة التي تعذر إصلاحها', `${stats.deliveredUnrepairableCount} جهاز`, 'لا تصلح أو لا تتوفر قطع'],
      ['الأجهزة المرفوضة من العميل', `${stats.deliveredRefusedCount} جهاز`, 'عدم موافقة على التكلفة'],
      ['الإيرادات المحصلة من الأجهزة الصادرة', getRevenueCollectedFormatted(), 'صافي المقبوض الفعلي'],
      ['القيمة المقدرة للأجهزة قيد العمل', getRevenueAwaitingFormatted(), 'تكاليف الصيانة التقديرية بالداخل'],
      ['متوسط الفاتورة الصادرة', getAverageTicketFormatted(), 'معدل الدخل لكل عملية صيانة']
    ];

    setPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'تقرير الملخص الإحصائي والمؤشرات الشاملة للنظام',
          subtitle: `الفترة المحددة: ${getTimeRangeLabel()}`,
          headers: ['المؤشر / البيان التشغيلي', 'القيمة المحققة', 'ملاحظات وتفاصيل'],
          rows: rows,
          footerNotes: `تم استخراج هذا الملخص الآلي بدقة من واقع قاعدة بيانات المركز.`
        }
      }
    });
  };

  return (
    <div className="space-y-4 pb-12 text-right rtl pt-4" dir="rtl">

      {/* Printable Area Wrapper */}
      <div id="printable-report" className="hidden print:block bg-white text-black p-8 text-right font-cairo" dir="rtl">
        {/* Report Header */}
        <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-6">
          <div className="text-right">
            <h1 className="text-xl font-black">{shopConfig?.shopName || 'عالم الصيانة'}</h1>
            <p className="text-sm font-bold">تقرير {activeSubView === 'none' ? 'عام' : (activeSubView === 'in-shop' ? 'الأجهزة في المحل' : 'الأجهزة الصادرة')}</p>
            <p className="text-xs font-bold mt-1">الفترة: {timeRangeLabels[timeRange]} {timeRange === 'custom' ? `(${startDate} - ${endDate})` : ''}</p>
          </div>
          <div className="text-left text-xs font-bold space-y-1">
            <p>رقم المستخدم: {user?.userNumber || '100'}</p>
          </div>
        </div>

        {/* Content will be mirrors of the UI but styled for print */}
        {activeSubView === 'none' ? (
          <div className="space-y-6">
             <div className="grid grid-cols-3 gap-4 border border-black p-4 rounded-lg">
                <div className="text-center">
                  <p className="text-xs font-bold">الأجهزة الداخلة</p>
                  <p className="text-2xl font-black">{stats.totalIncoming}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold">الأجهزة في المحل</p>
                  <p className="text-2xl font-black">{stats.inShopTotal}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold">الأجهزة الخارجة</p>
                  <p className="text-2xl font-black">{stats.deliveredTotal}</p>
                </div>
             </div>
             {canViewFinancial && (
               <div className="border border-black p-4 rounded-lg">
                 <h3 className="text-sm font-black mb-3 border-b border-black pb-1">الأداء المالي</h3>
                 <div className="grid grid-cols-2 gap-4 text-sm">
                   <p>الإيراد المحصل: <span className="font-mono font-bold">{getRevenueCollectedFormatted()}</span></p>
                   <p>الإيراد المعلق: <span className="font-mono font-bold">{getRevenueAwaitingFormatted()}</span></p>
                 </div>
               </div>
             )}
          </div>
        ) : viewMode === 'invoices' ? (
          <div className="overflow-x-auto w-full max-w-full my-2">
            <h3 className="text-sm font-black mb-4">قائمة الفواتير ({groupedInvoices.length})</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-black">
                  <th className="p-2 border border-black text-right">م</th>
                  <th className="p-2 border border-black text-right">رقم الفاتورة</th>
                  <th className="p-2 border border-black text-right">العميل</th>
                  <th className="p-2 border border-black text-right">التاريخ</th>
                  <th className="p-2 border border-black text-right">الأجهزة بالفاتورة</th>
                  <th className="p-2 border border-black text-left">إجمالي الفاتورة</th>
                </tr>
              </thead>
              <tbody>
                {groupedInvoices.map((inv, idx) => (
                  <tr key={inv.invoiceNumber} className="border-b border-black">
                    <td className="p-2 border border-black text-center">{idx + 1}</td>
                    <td className="p-2 border border-black font-mono">#{inv.invoiceNumber}</td>
                    <td className="p-2 border border-black">
                      <div className="font-bold">{inv.customer.name}</div>
                      {inv.customer.phone !== '---' && (
                        <div className="text-[10px] text-gray-700 font-mono">الجوال: {inv.customer.phone}</div>
                      )}
                    </td>
                    <td className="p-2 border border-black">{formatDate(inv.createdAt)}</td>
                    <td className="p-2 border border-black">
                      <div className="font-bold mb-1">عدد الأجهزة (قطع): {inv.totalQuantity}</div>
                      <div className="text-[10px] space-y-0.5">
                        {inv.items.map((it, i) => (
                          <div key={i}>• {it.deviceType || ''} {it.deviceName || ''} ({getStatusArabicLabel(it.status, getItemSubStatus(it))})</div>
                        ))}
                      </div>
                    </td>
                    <td className="p-2 border border-black text-left font-mono font-bold">{inv.totalCost.toLocaleString('en-US')} {inv.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto w-full max-w-full touch-pan-x my-2">
            <h3 className="text-sm font-black mb-4">قائمة السجلات ({tableItemsTotalQuantity})</h3>
            <table className="w-full min-w-[650px] text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-black">
                  <th className="p-2 border border-black text-right">م</th>
                  <th className="p-2 border border-black text-right">رقم الفاتورة</th>
                  <th className="p-2 border border-black text-right">العميل</th>
                  <th className="p-2 border border-black text-right">الجهاز</th>
                  <th className="p-2 border border-black text-right">الحالة</th>
                  <th className="p-2 border border-black text-left">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item, idx) => {
                  const custDetails = getCustomerDetails(item);
                  return (
                    <tr key={item.id} className="border-b border-black">
                      <td className="p-2 border border-black text-center">{idx + 1}</td>
                      <td className="p-2 border border-black font-mono">{item.invoiceNumber}</td>
                      <td className="p-2 border border-black">
                        <div className="font-bold">{custDetails.name}</div>
                        {custDetails.company !== '---' && (
                          <div className="text-[10px] text-gray-600">الجهة: {custDetails.company}</div>
                        )}
                        {custDetails.phone !== '---' && (
                          <div className="text-[10px] text-gray-700 font-mono">الجوال: {custDetails.phone}</div>
                        )}
                      </td>
                      <td className="p-2 border border-black">{item.deviceType} - {item.deviceName} {(Number(item.quantity) || 1) > 1 && <span className="text-orange-600 font-bold">({Number(item.quantity) || 1} قطع)</span>}</td>
                      <td className="p-2 border border-black">{getStatusArabicLabel(item.status, getItemSubStatus(item))}</td>
                      <td className="p-2 border border-black text-left font-mono">{item.cost}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Report Footer */}
        <div className="mt-12 pt-4 border-t-2 border-black flex justify-between items-end text-[10px] font-bold">
          <div>
            <p>تم استخراج هذا التقرير بواسطة: {user?.name || user?.username}</p>
            <p>{shopConfig?.address}</p>
          </div>
          <div className="text-left">
            <p>صفحة 1 من 1</p>
            <p>{shopConfig?.shopName}</p>
          </div>
        </div>
      </div>

      {/* Primary Section Switcher: Maintenance Reports vs Financial & Vault Reports */}
      <div className="flex items-center gap-2 bg-[#121212] p-1.5 rounded-2xl border border-white/5 w-fit">
        <button
          type="button"
          onClick={() => setMainReportSection('devices')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
            mainReportSection === 'devices'
              ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Wrench size={16} />
          <span>تقارير الأجهزة والورشة والصيانة</span>
        </button>

        {canViewFinancial && (
          <button
            type="button"
            onClick={() => setMainReportSection('financial')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
              mainReportSection === 'financial'
                ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Coins size={16} />
            <span>تقارير الحسابات والمالية والصناديق</span>
          </button>
        )}
      </div>

      {mainReportSection === 'financial' ? (
        <FinancialReportsTab
          user={user}
          shopConfig={shopConfig}
          onPrintPreview={(pData) => setPreviewData(pData)}
          canPrint={canPrint}
        />
      ) : (
        <>
          {/* Top Controls & Time Period Selector */}
          <div className="bg-white/[0.02] p-4 rounded-3xl border border-white/5 space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-600/15 text-orange-500 rounded-2xl">
              <Filter size={18} />
            </div>
            <div>
              <h2 className="text-base font-black text-white">التقارير دقيقة بدقيقة</h2>
              <p className="text-xs text-slate-400 font-bold">راقب أداء الورشة وحالة الأجهزة المالية والفنية فوراً</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <button 
              type="button"
              onClick={handlePrint}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95 cursor-pointer w-full sm:w-auto"
              title="طباعة التقرير الحالي"
            >
              <Printer size={18} />
              <span>طباعة التقرير</span>
            </button>

            <div className="flex bg-black/40 p-1 rounded-2xl border border-white/5 w-full md:w-auto overflow-x-auto items-center">
              {(['all', 'today', 'week', 'month', 'custom'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => {
                    setTimeRange(range);
                    // Reset filters
                    setInShopFilter('all');
                    setDeliveredFilter('all');
                  }}
                  className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap flex-1 md:flex-none ${
                    timeRange === range 
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' 
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {timeRangeLabels[range]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {timeRange === 'custom' && (
          <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-white/5 animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <label className="text-xs font-black text-gray-400">من تاريخ</label>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-black/60 border border-white/10 text-white text-xs px-4 py-2.5 rounded-xl focus:border-orange-500 outline-none font-bold"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs font-black text-gray-400">إلى تاريخ</label>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-black/60 border border-white/10 text-white text-xs px-4 py-2.5 rounded-xl focus:border-orange-500 outline-none font-bold"
              />
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-60 flex flex-col items-center justify-center bg-white/[0.01] rounded-3xl border border-white/5 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
          <p className="text-sm font-bold text-gray-400">جاري قراءة البيانات وإعداد المؤشرات والرسوم...</p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {activeSubView === 'none' && (
            <motion.div 
              key="main-dash"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              {/* Device Counter Buttons (As specified by user - clickable buttons) */}
              <div className="space-y-3">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <BarChart3 size={18} className="text-orange-500" />
                  أعداد ومؤشرات الأجهزة الصادرة والواردة
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. Incoming Devices Counter Dashboard */}
                  <div className="bg-[#141414] p-6 rounded-[2rem] border border-white/5 relative overflow-hidden flex flex-col gap-2 transition-all">
                    <div className="absolute top-5 left-5 p-3.5 bg-blue-500/10 text-blue-500 rounded-2xl shadow-inner">
                      <TrendingUp size={24} />
                    </div>
                    <span className="text-gray-400 text-xs font-black tracking-wider">الأجهزة الداخلة</span>
                    <span className="text-5xl font-extrabold font-mono text-white mt-1">{stats.totalIncoming}</span>
                    <p className="text-xs text-gray-500 mt-2 font-bold leading-relaxed">
                      إجمالي الأجهزة التي تم استقبالها في الصيانة ضمن النطاق الزمني المحدد.
                    </p>
                  </div>

                  {/* 2. Devices in Shop (Button) */}
                  <motion.button 
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      setActiveSubView('in-shop');
                      setInShopFilter('all');
                    }}
                    className="bg-[#141414] p-6 rounded-[2rem] border border-white/5 relative overflow-hidden flex flex-col items-start gap-2 text-right transition-all hover:bg-white/[0.02] hover:border-orange-500/30 cursor-pointer group"
                  >
                    <div className="absolute top-5 left-5 p-3.5 bg-orange-500/10 text-orange-500 rounded-2xl group-hover:bg-orange-500 group-hover:text-white transition-all shadow-inner">
                      <Package size={24} />
                    </div>
                    <span className="text-gray-400 text-xs font-black tracking-wider">أجهزة موجودة في المحل</span>
                    <span className="text-5xl font-extrabold font-mono text-white mt-1 group-hover:text-orange-500 transition-colors">{stats.inShopTotal}</span>
                    <p className="text-xs text-gray-500 mt-2 font-bold leading-relaxed">
                      الأجهزة المتواجدة حالياً لورشتنا لتنفيذ أعمال الفحص والإبرام الفني والصيانة.
                    </p>
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs font-black text-orange-500 w-full group-hover:text-orange-400">
                      <span>اضغط لاستعراض تقارير حالات المحل</span>
                      <ChevronLeft size={16} className="transition-transform group-hover:-translate-x-1" />
                    </div>
                  </motion.button>

                  {/* 3. Delivered/Outgoing Devices (Button) */}
                  <motion.button 
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      setActiveSubView('delivered');
                      setDeliveredFilter('all');
                    }}
                    className="bg-[#141414] p-6 rounded-[2rem] border border-white/5 relative overflow-hidden flex flex-col items-start gap-2 text-right transition-all hover:bg-white/[0.02] hover:border-emerald-500/30 cursor-pointer group"
                  >
                    <div className="absolute top-5 left-5 p-3.5 bg-emerald-500/10 text-emerald-500 rounded-2xl group-hover:bg-emerald-500 group-hover:text-white transition-all shadow-inner">
                      <CheckCircle2 size={24} />
                    </div>
                    <span className="text-gray-400 text-xs font-black tracking-wider">أجهزة خارجة</span>
                    <span className="text-5xl font-extrabold font-mono text-white mt-1 group-hover:text-emerald-500 transition-colors">{stats.deliveredTotal}</span>
                    <p className="text-xs text-gray-500 mt-2 font-bold leading-relaxed">
                      الأجهزة التي أكملت دورتها وخرجت للعميل (جاهزة، لا تصلح، سليم، ملغاة، إلخ).
                    </p>
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs font-black text-emerald-500 w-full group-hover:text-emerald-400">
                      <span>اضغط لاستعراض تقارير الأجهزة الخارجة</span>
                      <ChevronLeft size={16} className="transition-transform group-hover:-translate-x-1" />
                    </div>
                  </motion.button>
                </div>
              </div>

              {/* Financial Performance Box Button (صندوق الأداء المالي المحقق والدورة النقدية) */}
              {canViewFinancial && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowFinancialModal(true)}
                    className="w-full flex items-center justify-between p-4 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 hover:border-amber-500/40 rounded-2xl transition-all font-cairo cursor-pointer group text-right shadow-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-[0_0_12px_rgba(245,158,11,0.3)] group-hover:scale-105 transition-transform">
                        <Coins size={20} />
                      </div>
                      <div className="text-right">
                        <span className="block text-sm font-bold text-white">صندوق الأداء المالي المحقق والدورة النقدية</span>
                        <span className="block text-[10px] text-gray-400 mt-0.5">تحليل الإيرادات المحصلة، القيمة المقدرة للصيانة الجارية، ومتوسط الفاتورة</span>
                      </div>
                    </div>
                    <ChevronLeft size={18} className="text-amber-500 group-hover:-translate-x-1 transition-transform" />
                  </button>
                </div>
              )}

              {/* Financial Performance Modal Popup */}
              {showFinancialModal && canViewFinancial && (
                <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" dir="rtl">
                  <div className="bg-[#161616] border border-amber-500/25 rounded-[2.5rem] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden font-cairo">
                    
                    {/* Header */}
                    <div className="p-6 md:p-7 border-b border-white/5 bg-[#1a1a1a] flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-amber-500/15 text-amber-500 rounded-2xl shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                          <Coins size={24} />
                        </div>
                        <div className="text-right">
                          <h3 className="text-base md:text-lg font-black text-white font-cairo">صندوق الأداء المالي المحقق والدورة النقدية</h3>
                          <p className="text-xs text-gray-400 font-medium font-cairo">المؤشرات المالية، الإيرادات المحصلة، والقيمة التقديرية للأجهزة</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowFinancialModal(false)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-colors cursor-pointer"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 md:p-8 overflow-y-auto flex-1 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        
                        {/* Collected Revenue */}
                        <div className="bg-[#111111] p-5 rounded-2xl border border-white/5 flex flex-col justify-between gap-4 relative overflow-hidden">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400 text-xs font-black">المحصل من الأجهزة الصادرة</span>
                            <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl">
                              <Coins size={20} />
                            </div>
                          </div>
                          <div>
                            <span className="text-xl font-black font-mono text-white">{getRevenueCollectedFormatted()}</span>
                            <p className="text-[10px] text-gray-500 mt-1">المبالغ الفعلية المقبوضة من عمليات الصيانة المسلمة</p>
                          </div>
                        </div>

                        {/* Estimated Revenue */}
                        <div className="bg-[#111111] p-5 rounded-2xl border border-white/5 flex flex-col justify-between gap-4 relative overflow-hidden">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400 text-xs font-black">القيمة المقدرة بالداخل</span>
                            <div className="p-2.5 bg-indigo-500/10 text-indigo-500 rounded-xl">
                              <Wrench size={20} />
                            </div>
                          </div>
                          <div>
                            <span className="text-xl font-black font-mono text-white">{getRevenueAwaitingFormatted()}</span>
                            <p className="text-[10px] text-gray-500 mt-1">إجمالي تكاليف الأجهزة التي لا تزال قيد الفحص والصيانة</p>
                          </div>
                        </div>

                        {/* Average Ticket */}
                        <div className="bg-[#111111] p-5 rounded-2xl border border-white/5 flex flex-col justify-between gap-4 relative overflow-hidden">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400 text-xs font-black">متوسط الفاتورة</span>
                            <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl">
                              <TrendingUp size={20} />
                            </div>
                          </div>
                          <div>
                            <span className="text-xl font-black font-mono text-white">{getAverageTicketFormatted()}</span>
                            <p className="text-[10px] text-gray-500 mt-1">معدل الدخل لكل عملية صيانة منجزة</p>
                          </div>
                        </div>

                      </div>

                      {/* Summary Notes / Details */}
                      <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-right text-xs text-gray-400 space-y-2">
                        <div className="flex items-center gap-2 text-white font-bold">
                          <Sparkles size={16} className="text-amber-500" />
                          <span>ملاحظة حول الحسابات المالية:</span>
                        </div>
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                          يتم احتساب هذه المؤشرات آلياً بناءً على حركة الفواتير وسندات القبض المسجلة في النظام للأجهزة المستهدفة ضمن نطاق الفلترة المختار.
                        </p>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* Comprehensive System Reports Box Button (صندوق تقارير النظام والمهام الشاملة) */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowComprehensiveModal(true)}
                  className="w-full flex items-center justify-between p-4 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/25 hover:border-purple-500/40 rounded-2xl transition-all font-cairo cursor-pointer group text-right shadow-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-purple-500 text-white rounded-xl shadow-[0_0_12px_rgba(168,85,247,0.3)] group-hover:scale-105 transition-transform">
                      <FileText size={20} />
                    </div>
                    <div className="text-right">
                      <span className="block text-sm font-bold text-white">صندوق تقارير النظام والمهام الشاملة</span>
                      <span className="block text-[10px] text-gray-400 mt-0.5">طباعة تقارير الإنجاز اليومي، الأجهزة المتأخرة، كفاءة المهندسين، ومسيرات الحركة</span>
                    </div>
                  </div>
                  <ChevronLeft size={18} className="text-purple-500 group-hover:-translate-x-1 transition-transform" />
                </button>
              </div>

              {/* Comprehensive System Reports Modal Popup */}
              {showComprehensiveModal && (
                <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" dir="rtl">
                  <div className="bg-[#161616] border border-purple-500/25 rounded-[2.5rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden font-cairo">
                    
                    {/* Header */}
                    <div className="p-6 md:p-7 border-b border-white/5 bg-[#1a1a1a] flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-purple-500/15 text-purple-400 rounded-2xl shadow-[0_0_15px_rgba(168,85,247,0.2)]">
                          <FileText size={24} />
                        </div>
                        <div className="text-right">
                          <h3 className="text-base md:text-lg font-black text-white font-cairo">تقارير النظام والمهام الشاملة</h3>
                          <p className="text-xs text-gray-400 font-medium font-cairo">كشوفات تفصيلية جاهزة للطباعة والتصدير والمشاركة عبر واتساب</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowComprehensiveModal(false)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-colors cursor-pointer"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 md:p-8 overflow-y-auto flex-1 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        
                        {/* 1. Daily Completed Devices */}
                        <div 
                          onClick={handlePrintDailyCompletedReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl group-hover:scale-110 transition-transform">
                                <CheckCircle2 size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">تقرير الأجهزة المنجزة والجاهزة</h4>
                                <span className="text-[10px] text-gray-400">الفترة: {getTimeRangeLabel()}</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-emerald-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            كشف تفصيلي بالأجهزة التي تم الانتهاء من صيانتها مع اسم المهندس الفني وتكلفة الصيانة.
                          </p>
                        </div>

                        {/* 2. Delayed Devices Report */}
                        <div 
                          onClick={handlePrintDelayedDevicesReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-amber-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl group-hover:scale-110 transition-transform">
                                <Clock size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">تقرير الأجهزة المتأخرة بالورشة</h4>
                                <span className="text-[10px] text-amber-500/80">أكثر من 3 أيام بالورشة</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-amber-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            حصر دقيق للأجهزة المعلقة في الورشة والتي مضى على استلامها فترة تفوق 3 أيام لمتابعة الإنجاز.
                          </p>
                        </div>

                        {/* 3. Technician Productivity Report */}
                        <div 
                          onClick={handlePrintTechnicianProductivityReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl group-hover:scale-110 transition-transform">
                                <Wrench size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">تقرير كفاءة وإنتاجية المهندسين</h4>
                                <span className="text-[10px] text-gray-400">إحصائيات إنجاز الطاقم الفني</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-blue-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            جدول إحصائي يبين عدد الأجهزة المسندة، المنجزة بنجاح، ونسبة النجاح % لكل مهندس.
                          </p>
                        </div>

                        {/* 4. Detailed Exit Report */}
                        <div 
                          onClick={handlePrintDetailedExitReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-purple-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl group-hover:scale-110 transition-transform">
                                <LogOut size={20} className="rotate-180" />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-purple-400 transition-colors">مسير خروج وتسليم الأجهزة</h4>
                                <span className="text-[10px] text-gray-400">مسير العمليات المسلمة</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-purple-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            مسير شامل لعمليات خروج الأجهزة للعملاء مع المبالغ المحصلة والمستلم.
                          </p>
                        </div>

                        {/* 5. Detailed Entry Report */}
                        <div 
                          onClick={handlePrintDetailedEntryReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl group-hover:scale-110 transition-transform">
                                <Package size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">مسير استلام ودخول الأجهزة</h4>
                                <span className="text-[10px] text-gray-400">حصر الأجهزة الواردة</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-cyan-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            كشف بجميع الأجهزة المستلمة ومشاكل العملاء وأرقام الفواتير خلال الفترة المحددة.
                          </p>
                        </div>

                        {/* 6. Unrepairable / Refused Report */}
                        <div 
                          onClick={handlePrintUnrepairableRefusedReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-rose-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl group-hover:scale-110 transition-transform">
                                <XCircle size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-rose-400 transition-colors">الأجهزة المرفوضة ولا يمكن إصلاحها</h4>
                                <span className="text-[10px] text-gray-400">تقرير عدم الصيانة</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-rose-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            بيان بالأجهزة التي تعذر إصلاحها أو رفض العميل تكلفتها مع أسباب عدم الصيانة.
                          </p>
                        </div>

                        {/* 7. General System KPI Summary */}
                        <div 
                          onClick={handlePrintGeneralSummaryReport}
                          className="bg-[#111111] hover:bg-[#181818] p-5 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl group-hover:scale-110 transition-transform">
                                <BarChart3 size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">تقرير الملخص الإحصائي والمؤشرات الشاملة</h4>
                                <span className="text-[10px] text-gray-400">تقرير تنفيذي شامل للأنشطة والعمليات</span>
                              </div>
                            </div>
                            <Printer size={16} className="text-gray-500 group-hover:text-indigo-400 transition-colors" />
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            تقرير تنفيذي يجمع كافة مؤشرات الأداء التشغيلية والمالية ومعدلات الإنجاز بنسق جدول موحد.
                          </p>
                        </div>

                        {/* 8. Filtered Statistical Report by Device Type or Device Name (التقرير الإحصائي المخصص حسب النوع أو الجهاز) */}
                        <div 
                          onClick={() => {
                            setShowComprehensiveModal(false);
                            setShowDeviceSummaryModal(true);
                          }}
                          className="bg-indigo-950/20 hover:bg-indigo-900/30 p-5 rounded-2xl border border-indigo-500/30 hover:border-indigo-400 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-indigo-500 text-white rounded-xl group-hover:scale-110 transition-transform shadow-[0_0_12px_rgba(99,102,241,0.4)]">
                                <Layers size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-indigo-300 group-hover:text-white transition-colors">تقرير الملخص الإحصائي حسب النوع أو الجهاز</h4>
                                <span className="text-[10px] text-indigo-400/80">دوائر اختيار + رول الأجهزة والأنواع</span>
                              </div>
                            </div>
                            <Sparkles size={16} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                          </div>
                          <p className="text-xs text-gray-300 leading-relaxed">
                            تقرير تفاعلي مخصص يتيح اختيار نوع أو جهاز محدد واستعراض جدول مؤشراته الشاملة مع إمكانية طباعته ومشاركته.
                          </p>
                        </div>

                        {/* 9. Financial & Vault Accounts Report */}
                        {canViewFinancial && (
                          <div 
                            onClick={() => {
                              setShowComprehensiveModal(false);
                              setMainReportSection('financial');
                            }}
                            className="bg-amber-950/20 hover:bg-amber-900/30 p-5 rounded-2xl border border-amber-500/30 hover:border-amber-400 transition-all cursor-pointer group flex flex-col justify-between gap-3 shadow-md md:col-span-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-amber-500 text-white rounded-xl group-hover:scale-110 transition-transform shadow-[0_0_12px_rgba(245,158,11,0.4)]">
                                  <Coins size={20} />
                                </div>
                                <div>
                                  <h4 className="text-sm font-bold text-amber-300 group-hover:text-white transition-colors">تقارير الحسابات والمالية والصناديق الشاملة</h4>
                                  <span className="text-[10px] text-amber-400/80">أرصدة الصناديق، القيود، وتدقيق الفواتير وطباعة كشوفات الحسابات</span>
                                </div>
                              </div>
                              <Sparkles size={16} className="text-amber-400 group-hover:scale-110 transition-transform" />
                            </div>
                            <p className="text-xs text-gray-300 leading-relaxed">
                              استعراض أرصدة جميع الصناديق، كشف حركات السندات والقيود، مطابقة الفواتير المرتبطة، وتصدير كشف Excel أو طباعة A4 رسمية.
                            </p>
                          </div>
                        )}

                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* Lower Level: Categories & Configured Reports */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Categories Device Type Distribution (توزيع الأجهزة حسب الصنف) */}
                <div className="lg:col-span-2 bg-[#141414] p-6 rounded-[2rem] border border-white/5 space-y-4">
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <Layers size={18} className="text-purple-500" />
                    توزيع الأجهزة حسب الصنف والنوع
                  </h3>
                  
                  {getCategoryDistribution().length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-xs text-gray-500 font-bold">
                      لا توجد أجهزة مضافة في هذه الفترة لحساب التوزيع.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {getCategoryDistribution().slice(0, 5).map((cat, idx) => {
                        const colors = ['bg-blue-500', 'bg-orange-500', 'bg-emerald-500', 'bg-pink-500', 'bg-purple-500'];
                        const percentage = stats.totalIncoming > 0 ? Math.round((cat.count / stats.totalIncoming) * 100) : 0;
                        return (
                          <div key={cat.name} className="space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                              <span className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${colors[idx % colors.length]}`}></span>
                                {cat.name}
                              </span>
                              <span className="font-mono text-white">{cat.count} جهاز ({percentage}%)</span>
                            </div>
                            <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden">
                              <div className={`${colors[idx % colors.length]} h-full rounded-full`} style={{ width: `${percentage}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Sub View: In-Shop detailed reports (تقارير الأجهزة داخل المحل) */}
          {activeSubView === 'in-shop' && (
            <motion.div 
              key="in-shop-dash"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Back & Sub-Page Header Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/5">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <Package size={22} className="text-orange-500" />
                    تقارير أجهزة داخل المحل
                  </h3>
                  <p className="text-xs text-gray-400 font-bold mt-1">توزيع كلي وفلترة دقيقة لجميع الأجهزة النشطة بالصيانة ({stats.inShopTotal} جهاز)</p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={handlePrint}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-md active:scale-95 cursor-pointer"
                    title="طباعة التقرير"
                  >
                    <Printer size={16} />
                    <span>طباعة</span>
                  </button>
                  <button 
                    onClick={() => setActiveSubView('none')}
                    className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="الرجوع للتقرير العام"
                  >
                    <ArrowRight size={18} className="text-orange-500" />
                    <span>رجوع</span>
                  </button>
                </div>
              </div>

              {/* Six Counters as specified representing each sub-status */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
                {/* 1. New Entry Counter Button */}
                <button 
                  onClick={() => setInShopFilter(inShopFilter === 'new' ? 'all' : 'new')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    inShopFilter === 'new' 
                      ? 'border-blue-500 bg-blue-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl self-start">
                    <PlusCircle size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">أجهزة جديدة</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">{stats.inShopNew}</p>
                  </div>
                </button>

                {/* 2. Over inspection Button */}
                <button 
                  onClick={() => setInShopFilter(inShopFilter === 'inspection' ? 'all' : 'inspection')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    inShopFilter === 'inspection' 
                      ? 'border-amber-500 bg-amber-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-amber-500/10 text-amber-500 rounded-xl self-start">
                    <Search size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">قيد الفحص</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">{stats.inShopInspection}</p>
                  </div>
                </button>

                {/* 3. Under Repair Button */}
                <button 
                  onClick={() => setInShopFilter(inShopFilter === 'repairing' ? 'all' : 'repairing')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    inShopFilter === 'repairing' 
                      ? 'border-indigo-500 bg-indigo-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-indigo-500/10 text-indigo-500 rounded-xl self-start">
                    <Wrench size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">قيد الصيانة</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">{stats.inShopRepairing}</p>
                  </div>
                </button>

                {/* 4. Awaiting Approval Button */}
                <button 
                  onClick={() => setInShopFilter(inShopFilter === 'awaiting_approval' ? 'all' : 'awaiting_approval')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    inShopFilter === 'awaiting_approval' 
                      ? 'border-cyan-500 bg-cyan-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-cyan-500/10 text-cyan-500 rounded-xl self-start">
                    <Clock size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">انتظار موافقة</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">{stats.inShopAwaitingApproval}</p>
                  </div>
                </button>

                {/* 5. Awaiting Parts Button */}
                <button 
                  onClick={() => setInShopFilter(inShopFilter === 'awaiting_parts' ? 'all' : 'awaiting_parts')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    inShopFilter === 'awaiting_parts' 
                      ? 'border-violet-500 bg-violet-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl self-start ${
                    inShopFilter === 'awaiting_parts'
                      ? 'bg-violet-500/25 text-violet-400'
                      : 'bg-violet-500/10 text-violet-500'
                  }`}>
                    <Cpu size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">انتظار قطع الغيار</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">{stats.inShopAwaitingParts}</p>
                  </div>
                </button>

                {/* 6. Ready Device Button */}
                <button 
                  onClick={() => setInShopFilter(inShopFilter === 'ready' ? 'all' : 'ready')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    inShopFilter === 'ready' 
                      ? 'border-emerald-500 bg-emerald-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl self-start">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">جاهز للتسليم</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">{stats.inShopReady}</p>
                  </div>
                </button>
              </div>

              {/* Dynamic device or invoice list matching filtered button selection */}
              <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                  <div>
                    <h4 className="font-black text-sm text-white flex items-center gap-2">
                      <BarChart3 size={16} className="text-orange-500" />
                      جدول {viewMode === 'invoices' ? 'الفواتير' : 'الأجهزة المتوفرة'} (تصفية: {
                        inShopFilter === 'all' ? 'جميع أجهزة المحل' :
                        inShopFilter === 'new' ? 'أجهزة جديدة' :
                        inShopFilter === 'inspection' ? 'قيد الفحص حالياً' :
                        inShopFilter === 'repairing' ? 'قيد الصيانة النشطة' :
                        inShopFilter === 'awaiting_approval' ? 'في انتظار الموافقة والقطع' :
                        inShopFilter === 'ready' ? 'أجهزة جاهزة للتسليم' : 'أخرى'
                      })
                    </h4>
                    <span className="text-xs text-gray-500 font-bold mt-1 block">
                      إجمالي السجلات: {viewMode === 'invoices' ? groupedInvoices.length : tableItemsTotalQuantity} {viewMode === 'invoices' ? 'فاتورة' : 'جهاز'}
                    </span>
                  </div>

                  <ViewModeSelector />
                </div>

                {tableItems.length === 0 ? (
                  <div className="py-12 text-center text-xs text-gray-500 font-black">
                     لا توجد بيانات مطابقة للفلترة الفعالة لهذا النطاق الزمني.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-end text-[10px] text-gray-400 gap-1 font-bold sm:hidden">
                      <span>← إسحب الجدول لليمين أو اليسار لعرض باقي التفاصيل →</span>
                    </div>
                    <div className="overflow-x-auto w-full touch-pan-x rounded-xl pb-2 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                      {viewMode === 'invoices' ? (
                        <table className="w-full min-w-[750px] text-right text-xs">
                          <thead>
                            <tr className="border-b border-white/5 text-gray-400 pb-3">
                              <th className="pb-3 pt-1 font-black px-2">رقم الفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">اسم العميل</th>
                              <th className="pb-3 pt-1 font-black px-2">تاريخ الفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">الأجهزة بالفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">حالات الأجهزة</th>
                              <th className="pb-3 pt-1 font-black text-left px-2">إجمالي الفاتورة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedInvoices.map((inv, idx) => (
                              <tr key={inv.invoiceNumber} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                                <td className="py-4 font-mono text-[#fa5f1c] font-bold px-2">
                                  {((safeCurrentPage - 1) * itemsPerPage) + idx + 1} - #{inv.invoiceNumber}
                                </td>
                                <td className="py-4 text-white font-bold px-2">
                                  <div>{inv.customer.name}</div>
                                  {inv.customer.company !== '---' && (
                                    <div className="text-[10px] text-gray-400 font-medium">الجهة: {inv.customer.company}</div>
                                  )}
                                  {inv.customer.phone !== '---' && (
                                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">الجوال: {inv.customer.phone}</div>
                                  )}
                                </td>
                                <td className="py-4 text-gray-300 font-medium px-2">
                                  {formatDate(inv.createdAt)}
                                </td>
                                <td className="py-4 font-bold text-white px-2">
                                  <div className="flex items-center gap-1.5 text-xs text-orange-400 font-black mb-1">
                                    <Package size={14} />
                                    <span>({inv.totalQuantity}) جهاز</span>
                                  </div>
                                  <div className="text-[11px] text-gray-300 max-w-xs space-y-1">
                                    {inv.items.map((it: any, i: number) => (
                                      <div key={i} className="truncate text-gray-400 font-medium">
                                        • {it.deviceType || 'جهاز'} - {it.deviceName || 'بدون اسم'}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-4 text-xs px-2">
                                  <div className="flex flex-wrap gap-1 max-w-xs">
                                    {inv.items.map((it: any, i: number) => (
                                      <span key={i} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[10px] text-gray-300 font-bold">
                                        {getStatusArabicLabel(it.status, getItemSubStatus(it))}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-4 font-mono font-bold text-white text-left px-2">
                                  {inv.totalCost.toLocaleString('en-US')} <span className="text-[10px] text-gray-500 font-black">{inv.currency}</span>
                                </td>
                              </tr>
                            ))}
                            {totalPages > 1 && (
                              <tr>
                                <td colSpan={6} className="py-4">
                                  <div className="flex items-center justify-between" dir="rtl">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setReportPage(prev => Math.max(1, prev - 1))}
                                        disabled={safeCurrentPage === 1}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft className="rotate-180" size={18} />
                                      </button>
                                      <div className="flex items-center gap-1">
                                        {[...Array(totalPages)].map((_, i) => (
                                          <button
                                            key={i}
                                            onClick={() => setReportPage(i + 1)}
                                            className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                                              safeCurrentPage === i + 1
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                            }`}
                                          >
                                            {i + 1}
                                          </button>
                                        ))}
                                      </div>
                                      <button
                                        onClick={() => setReportPage(prev => Math.min(totalPages, prev + 1))}
                                        disabled={safeCurrentPage === totalPages}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft size={18} />
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-bold font-cairo">
                                      عرض {((safeCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, groupedInvoices.length)} من أصل {groupedInvoices.length} فاتورة
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full min-w-[700px] text-right text-xs">
                          <thead>
                            <tr className="border-b border-white/5 text-gray-400 pb-3">
                              <th className="pb-3 pt-1 font-black px-2">رقم الفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">اسم العميل</th>
                              <th className="pb-3 pt-1 font-black">نوع وصنف الجهاز</th>
                              <th className="pb-3 pt-1 font-black">المشكلة والتوصيف</th>
                              <th className="pb-3 pt-1 font-black text-left px-2">تكلفة التقدير</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedItems.map((item, idx) => {
                              const custDetails = getCustomerDetails(item);
                              return (
                                <tr key={item.id} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                                  <td className="py-4 font-mono text-[#fa5f1c] font-bold px-2">{((safeCurrentPage - 1) * itemsPerPage) + idx + 1} - {item.invoiceNumber}</td>
                                  <td className="py-4 text-white font-bold px-2">
                                    <div>{custDetails.name}</div>
                                    {custDetails.company !== '---' && (
                                      <div className="text-[10px] text-gray-400 font-medium">الجهة: {custDetails.company}</div>
                                    )}
                                    {custDetails.phone !== '---' && (
                                      <div className="text-[10px] text-gray-500 font-mono mt-0.5">الجوال: {custDetails.phone}</div>
                                    )}
                                  </td>
                                  <td className="py-4 font-black">
                                    <span className="text-xs text-white">
    {item.deviceType || 'موبايل'}
    {(Number(item.quantity) || 1) > 1 && <span className="mr-1 text-[10px] text-orange-500 font-bold bg-orange-500/10 px-1 rounded">{(Number(item.quantity) || 1)} قطع</span>}
  </span>
                                    <span className="text-[10px] text-gray-400 block mt-0.5">{item.deviceName || 'غير محدد'}</span>
                                  </td>
                                  <td className="py-4 text-gray-400">
                                    <span className="block max-w-xs truncate text-[11px]">{item.customerProblem || 'لم تسرد مواصفات'}</span>
                                    {item.engineerReport && <span className="block text-[10px] text-orange-400 font-bold mt-1 max-w-xs truncate">التقرير: {item.engineerReport}</span>}
                                    {(item.status === '35' || item.status === 'awaiting_parts') && item.failureReason && (
                                      <span className="block text-[10px] text-violet-400 font-bold mt-1 max-w-xs truncate">ملاحظة القطع: {item.failureReason}</span>
                                    )}
                                  </td>
                                  <td className="py-4 font-mono font-bold text-white text-left px-2">{(Number(item.cost) || 0).toLocaleString('en-US')} <span className="text-[10px] text-gray-500 font-black">{itemInvoiceMap.get(String(item.invoiceNumber))?.currency || 'USD'}</span></td>
                                </tr>
                              );
                            })}
                            {totalPages > 1 && (
                              <tr>
                                <td colSpan={5} className="py-4">
                                  <div className="flex items-center justify-between" dir="rtl">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setReportPage(prev => Math.max(1, prev - 1))}
                                        disabled={safeCurrentPage === 1}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft className="rotate-180" size={18} />
                                      </button>
                                      <div className="flex items-center gap-1">
                                        {[...Array(totalPages)].map((_, i) => (
                                          <button
                                            key={i}
                                            onClick={() => setReportPage(i + 1)}
                                            className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                                              safeCurrentPage === i + 1
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                            }`}
                                          >
                                            {i + 1}
                                          </button>
                                        ))}
                                      </div>
                                      <button
                                        onClick={() => setReportPage(prev => Math.min(totalPages, prev + 1))}
                                        disabled={safeCurrentPage === totalPages}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft size={18} />
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-bold font-cairo">
                                      عرض {((safeCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, tableItems.length)} من أصل {tableItems.length} سجل
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}


          {/* Sub View: Outgoing detailed reports (تقارير الأجهزة الخارجة) */}
          {activeSubView === 'delivered' && (
            <motion.div 
              key="delivered-dash"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Back & Sub-Page Header Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/5">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <CheckCircle2 size={22} className="text-emerald-500" />
                    تقارير أجهزة خارجة
                  </h3>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    تتبع الأجهزة والعمليات التي خرجت وغادرت المحل بالكامل ({deliveryMode === 'exit_date' ? stats.deliveredByExitDateTotal : stats.deliveredTotal} جهاز)
                  </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  {/* Perspective Toggle: By Delivery Date vs By Batch/Entry Date */}
                  <div className="bg-[#141414] border border-white/10 p-1 rounded-2xl flex items-center gap-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setDeliveryMode('exit_date')}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                        deliveryMode === 'exit_date'
                          ? 'bg-emerald-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                      title="عرض الأجهزة حسب تاريخ خروجها وتسليمها الفعلي للعميل في هذه الفترة"
                    >
                      <Clock size={14} />
                      <span>حسب تاريخ الخروج</span>
                      <span className="text-[10px] opacity-80 font-mono">({stats.deliveredByExitDateTotal})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryMode('batch')}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                        deliveryMode === 'batch'
                          ? 'bg-emerald-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                      title="عرض الأجهزة المسلمة من ضمن الدفعة الداخلة في نفس الفترة"
                    >
                      <Layers size={14} />
                      <span>من دفعة الدخول</span>
                      <span className="text-[10px] opacity-80 font-mono">({stats.deliveredTotal})</span>
                    </button>
                  </div>

                  <button 
                    type="button"
                    onClick={handlePrint}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-md active:scale-95 cursor-pointer"
                    title="طباعة التقرير"
                  >
                    <Printer size={16} />
                    <span>طباعة</span>
                  </button>
                  <button 
                    onClick={() => setActiveSubView('none')}
                    className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="الرجوع للتقرير العام"
                  >
                    <ArrowRight size={18} className="text-orange-500" />
                    <span>رجوع</span>
                  </button>
                </div>
              </div>

              {/* Five Counters representing delivered states */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                {/* 1. Delivered Repaired */}
                <button 
                  onClick={() => setDeliveredFilter(deliveredFilter === 'ready' ? 'all' : 'ready')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    deliveredFilter === 'ready' 
                      ? 'border-emerald-500 bg-emerald-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl self-start">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">تم التسليم جاهز</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">
                      {deliveryMode === 'exit_date' ? stats.deliveredByExitReadyCount : stats.deliveredReadyCount}
                    </p>
                  </div>
                </button>

                {/* 2. Delivered Unrepairable */}
                <button 
                  onClick={() => setDeliveredFilter(deliveredFilter === 'unrepairable' ? 'all' : 'unrepairable')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    deliveredFilter === 'unrepairable' 
                      ? 'border-red-500 bg-red-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-red-500/10 text-red-500 rounded-xl self-start">
                    <XCircle size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">تم التسليم لا يصلح</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">
                      {deliveryMode === 'exit_date' ? stats.deliveredByExitUnrepairableCount : stats.deliveredUnrepairableCount}
                    </p>
                  </div>
                </button>

                {/* 3. Delivered Intact */}
                <button 
                  onClick={() => setDeliveredFilter(deliveredFilter === 'intact' ? 'all' : 'intact')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    deliveredFilter === 'intact' 
                      ? 'border-teal-500 bg-teal-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-teal-500/10 text-teal-400 rounded-xl self-start">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">تم التسليم سليم</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">
                      {deliveryMode === 'exit_date' ? stats.deliveredByExitIntactCount : stats.deliveredIntactCount}
                    </p>
                  </div>
                </button>

                {/* 4. Delivered Refused */}
                <button 
                  onClick={() => setDeliveredFilter(deliveredFilter === 'refused' ? 'all' : 'refused')}
                  className={`p-4 rounded-[2rem] border transition-all text-right flex flex-col justify-between h-32 ${
                    deliveredFilter === 'refused' 
                      ? 'border-amber-500 bg-amber-500/10' 
                      : 'border-white/5 bg-[#141414] hover:border-white/15'
                  }`}
                >
                  <div className="p-2.5 bg-amber-500/10 text-amber-500 rounded-xl self-start">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-400 text-xs font-black">تم التسليم لم يوافق العميل</h4>
                    <p className="text-2xl font-black font-mono text-white mt-0.5">
                      {deliveryMode === 'exit_date' ? stats.deliveredByExitRefusedCount : stats.deliveredRefusedCount}
                    </p>
                  </div>
                </button>

                {/* 5. Delivered Process Cancelled */}
                <div className="p-4 rounded-[2rem] border border-white/5 bg-[#141414]/50 text-right flex flex-col justify-between h-32 relative opacity-60">
                  <div className="p-2.5 bg-white/5 text-gray-500 rounded-xl self-start">
                    <MinusCircle size={18} />
                  </div>
                  <div>
                    <h4 className="text-gray-500 text-xs font-black">تم التسليم تم إلغاء العملية</h4>
                    <p className="text-2xl font-black font-mono text-gray-500 mt-0.5">
                      {deliveryMode === 'exit_date' ? stats.deliveredByExitCancelledCount : stats.deliveredCancelledCount}
                    </p>
                  </div>
                  <span className="absolute top-3 left-3 text-[8px] font-bold text-gray-600 bg-white/5 px-1.5 py-0.5 rounded-sm">مدرج قريباً</span>
                </div>
              </div>

              {/* Dynamic device or invoice list matching filtered button selection */}
              <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                  <div>
                    <h4 className="font-black text-sm text-white flex items-center gap-2">
                      <BarChart3 size={16} className="text-emerald-500" />
                      سجل {viewMode === 'invoices' ? 'الفواتير الخارجة' : 'المستلم والمبيعات المخرجة'} ({
                        deliveryMode === 'exit_date' ? 'حسب تاريخ الخروج الفعلي' : 'من دفعة الدخول'
                      } - تصفية: {
                        deliveredFilter === 'all' ? 'جميع الأجهزة الخارجة' :
                        deliveredFilter === 'ready' ? 'تم التسليم وهو جاهز' :
                        deliveredFilter === 'unrepairable' ? 'تم التسليم وغير قابل للصيانة' :
                        deliveredFilter === 'intact' ? 'تم التسليم وهو سليم' :
                        deliveredFilter === 'refused' ? 'تم التسليم لرفض السعر' :
                        deliveredFilter === 'cancelled' ? 'ملغى كلياً' : 'أخرى'
                      })
                    </h4>
                    <span className="text-xs text-gray-500 font-bold mt-1 block">
                      إجمالي المخرجات: {viewMode === 'invoices' ? groupedInvoices.length : tableItemsTotalQuantity} {viewMode === 'invoices' ? 'فاتورة' : 'جهاز'}
                    </span>
                  </div>

                  <ViewModeSelector />
                </div>

                {tableItems.length === 0 ? (
                  <div className="py-12 text-center text-xs text-gray-500 font-black">
                     لا توجد تسليمات في هذا النطاق الزمني مطابقة للفلترة الفعالة.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-end text-[10px] text-gray-400 gap-1 font-bold sm:hidden">
                      <span>← إسحب الجدول لليمين أو اليسار لعرض باقي التفاصيل →</span>
                    </div>
                    <div className="overflow-x-auto w-full touch-pan-x rounded-xl pb-2 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                      {viewMode === 'invoices' ? (
                        <table className="w-full min-w-[750px] text-right text-xs">
                          <thead>
                            <tr className="border-b border-white/5 text-gray-400 pb-3">
                              <th className="pb-3 pt-1 font-black px-2">رقم الفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">مستلم الصيانة</th>
                              <th className="pb-3 pt-1 font-black px-2">تاريخ الفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">الأجهزة بالفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">حالات الأجهزة</th>
                              <th className="pb-3 pt-1 font-black text-left px-2">إجمالي الفاتورة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedInvoices.map((inv, idx) => (
                              <tr key={inv.invoiceNumber} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                                <td className="py-4 font-mono text-emerald-500 font-bold px-2">
                                  {((safeCurrentPage - 1) * itemsPerPage) + idx + 1} - #{inv.invoiceNumber}
                                </td>
                                <td className="py-4 text-white font-bold px-2">
                                  <div>{inv.customer.name}</div>
                                  {inv.customer.company !== '---' && (
                                    <div className="text-[10px] text-gray-400 font-medium">الجهة: {inv.customer.company}</div>
                                  )}
                                  {inv.customer.phone !== '---' && (
                                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">الجوال: {inv.customer.phone}</div>
                                  )}
                                </td>
                                <td className="py-4 text-gray-300 font-medium px-2">
                                  {formatDate(inv.createdAt)}
                                </td>
                                <td className="py-4 font-bold text-white px-2">
                                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-black mb-1">
                                    <Package size={14} />
                                    <span>({inv.totalQuantity}) جهاز</span>
                                  </div>
                                  <div className="text-[11px] text-gray-300 max-w-xs space-y-1">
                                    {inv.items.map((it: any, i: number) => (
                                      <div key={i} className="truncate text-gray-400 font-medium">
                                        • {it.deviceType || 'جهاز'} - {it.deviceName || 'بدون اسم'}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-4 text-xs px-2">
                                  <div className="flex flex-wrap gap-1 max-w-xs">
                                    {inv.items.map((it: any, i: number) => (
                                      <span key={i} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[10px] text-gray-300 font-bold">
                                        {getStatusArabicLabel(it.status, getItemSubStatus(it))}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-4 font-mono font-bold text-emerald-400 text-left px-2">
                                  {inv.totalCost.toLocaleString('en-US')} <span className="text-[10px] text-emerald-600 font-black">{inv.currency}</span>
                                </td>
                              </tr>
                            ))}
                            {totalPages > 1 && (
                              <tr>
                                <td colSpan={6} className="py-4">
                                  <div className="flex items-center justify-between" dir="rtl">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setReportPage(prev => Math.max(1, prev - 1))}
                                        disabled={safeCurrentPage === 1}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft className="rotate-180" size={18} />
                                      </button>
                                      <div className="flex items-center gap-1">
                                        {[...Array(totalPages)].map((_, i) => (
                                          <button
                                            key={i}
                                            onClick={() => setReportPage(i + 1)}
                                            className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                                              safeCurrentPage === i + 1
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                            }`}
                                          >
                                            {i + 1}
                                          </button>
                                        ))}
                                      </div>
                                      <button
                                        onClick={() => setReportPage(prev => Math.min(totalPages, prev + 1))}
                                        disabled={safeCurrentPage === totalPages}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft size={18} />
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-bold font-cairo">
                                      عرض {((safeCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, groupedInvoices.length)} من أصل {groupedInvoices.length} فاتورة
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full min-w-[700px] text-right text-xs">
                          <thead>
                            <tr className="border-b border-white/5 text-gray-400 pb-3">
                              <th className="pb-3 pt-1 font-black px-2">رقم الفاتورة</th>
                              <th className="pb-3 pt-1 font-black px-2">مستلم الصيانة</th>
                              <th className="pb-3 pt-1 font-black">تفاصيل الجهاز والصالحية</th>
                              <th className="pb-3 pt-1 font-black">تقارير الإقفال والمخرجات</th>
                              <th className="pb-3 pt-1 font-black text-left px-2">إجمالي المسدد</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedItems.map((item, idx) => {
                              const custDetails = getCustomerDetails(item);
                              return (
                                <tr key={item.id} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                                  <td className="py-4 font-mono text-emerald-500 font-bold px-2">{((safeCurrentPage - 1) * itemsPerPage) + idx + 1} - {item.invoiceNumber}</td>
                                  <td className="py-4 text-white font-bold px-2">
                                    <div>{custDetails.name}</div>
                                    {custDetails.company !== '---' && (
                                      <div className="text-[10px] text-gray-400 font-medium">الجهة: {custDetails.company}</div>
                                    )}
                                    {custDetails.phone !== '---' && (
                                      <div className="text-[10px] text-gray-500 font-mono mt-0.5">الجوال: {custDetails.phone}</div>
                                    )}
                                    {item.recipientName && item.recipientName !== custDetails.name && (
                                      <div className="text-[9px] text-[#fa5f1c] mt-0.5">المستلم: {item.recipientName}</div>
                                    )}
                                  </td>
                                  <td className="py-4 font-black">
                                    <span className="text-xs text-white">
    {item.deviceType || 'موبايل'}
    {(Number(item.quantity) || 1) > 1 && <span className="mr-1 text-[10px] text-orange-500 font-bold bg-orange-500/10 px-1 rounded">{(Number(item.quantity) || 1)} قطع</span>}
  </span>
                                    <span className="text-[10px] text-gray-400 block mt-0.5">{item.deviceName || 'غير محدد'}</span>
                                  </td>
                                  <td className="py-4 text-gray-400">
                                    <span className="text-[9px] px-2 py-0.5 rounded-md inline-block bg-white/5 font-extrabold text-gray-400 mb-1">
                                      {getStatusArabicLabel(item.status, getItemSubStatus(item))}
                                    </span>
                                    <span className="block text-[10px] italic">{item.engineerReport || item.failureReason || 'لم يدون المهندس المذكرة الفنية'}</span>
                                  </td>
                                  <td className="py-4 font-mono font-bold text-emerald-400 text-left px-2">{(Number(item.cost) || 0).toLocaleString('en-US')} <span className="text-[10px] text-emerald-600 font-black">{itemInvoiceMap.get(String(item.invoiceNumber))?.currency || 'USD'}</span></td>
                                </tr>
                              );
                            })}
                            {totalPages > 1 && (
                              <tr>
                                <td colSpan={5} className="py-4">
                                  <div className="flex items-center justify-between" dir="rtl">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setReportPage(prev => Math.max(1, prev - 1))}
                                        disabled={safeCurrentPage === 1}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft className="rotate-180" size={18} />
                                      </button>
                                      <div className="flex items-center gap-1">
                                        {[...Array(totalPages)].map((_, i) => (
                                          <button
                                            key={i}
                                            onClick={() => setReportPage(i + 1)}
                                            className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                                              safeCurrentPage === i + 1
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                            }`}
                                          >
                                            {i + 1}
                                          </button>
                                        ))}
                                      </div>
                                      <button
                                        onClick={() => setReportPage(prev => Math.min(totalPages, prev + 1))}
                                        disabled={safeCurrentPage === totalPages}
                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                      >
                                        <ChevronLeft size={18} />
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-bold font-cairo">
                                      عرض {((safeCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, tableItems.length)} من أصل {tableItems.length} تسليم
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      </>
      )}

      {/* Filtered Statistical Summary Modal by Device Type or Device Name */}
      <DeviceStatisticalSummaryModal
        isOpen={showDeviceSummaryModal}
        onClose={() => setShowDeviceSummaryModal(false)}
        rawItems={rawItems}
        itemInvoiceMap={itemInvoiceMap}
        customersMap={customersMap}
        shopConfig={shopConfig}
        user={user}
        canViewFinancial={canViewFinancial}
        onPrintPreview={(pData) => setPreviewData(pData)}
        defaultTimeRange={timeRange}
        defaultStartDate={startDate}
        defaultEndDate={endDate}
      />

      {/* Print Preview Overlay for System Comprehensive Reports */}
      {previewData && (
        <PrintPreviewOverlay
          type={previewData.type}
          data={previewData.data}
          onClose={() => setPreviewData(null)}
          shopConfig={shopConfig}
          user={user}
        />
      )}
    </div>
  );
}
