import React, { useState, useMemo, useEffect } from 'react';
import { 
  BarChart3, 
  Layers, 
  Laptop, 
  Search, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  X, 
  ChevronDown, 
  Wrench, 
  Sparkles, 
  TrendingUp, 
  Coins, 
  Package, 
  FileText, 
  Download, 
  SlidersHorizontal,
  Check,
  Eye
} from 'lucide-react';
import { motion } from 'motion/react';
import { parseDate } from '../lib/dateUtils';

interface DeviceStatisticalSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawItems: any[];
  itemInvoiceMap: Map<string, any>;
  customersMap: Map<string, any>;
  shopConfig: any;
  user?: any;
  canViewFinancial?: boolean;
  onPrintPreview: (previewData: any) => void;
  defaultTimeRange?: string;
  defaultStartDate?: string;
  defaultEndDate?: string;
}

export default function DeviceStatisticalSummaryModal({
  isOpen,
  onClose,
  rawItems,
  itemInvoiceMap,
  customersMap,
  shopConfig,
  canViewFinancial = true,
  onPrintPreview,
  defaultTimeRange = 'all',
  defaultStartDate = '',
  defaultEndDate = ''
}: DeviceStatisticalSummaryModalProps) {
  // Default currency is USD ($) as requested
  const currencySymbol = shopConfig?.currency || '$';

  // 1. Radio Selection Mode: 'type' (حسب نوع الجهاز) vs 'device' (حسب اسم/موديل الجهاز)
  const [selectionMode, setSelectionMode] = useState<'type' | 'device'>('type');

  // 2. Selected Value from the Roll ('all' or specific type/device name)
  const [selectedValue, setSelectedValue] = useState<string>('all');

  // Search filter inside roll selector dropdown
  const [rollSearchQuery, setRollSearchQuery] = useState<string>('');
  const [isRollDropdownOpen, setIsRollDropdownOpen] = useState<boolean>(false);

  // 3. Additional Filters (المحددات الإضافية)
  const [timeRange, setTimeRange] = useState<string>(defaultTimeRange);
  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [endDate, setEndDate] = useState<string>(defaultEndDate);
  const [locationFilter, setLocationFilter] = useState<'all' | 'in-shop' | 'delivered'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [technicianFilter, setTechnicianFilter] = useState<string>('all');

  // 4. View Mode inside modal: 'summary' (جدول المؤشرات الإحصائية) vs 'records' (كشف الأجهزة الفردية)
  const [activeTab, setActiveTab] = useState<'summary' | 'records'>('summary');
  const [recordsSearch, setRecordsSearch] = useState<string>('');
  const [recordsPage, setRecordsPage] = useState<number>(1);
  const recordsPerPage = 10;

  // Reset fields on modal open / reopen
  useEffect(() => {
    if (isOpen) {
      setSelectionMode('type');
      setSelectedValue('all');
      setRollSearchQuery('');
      setIsRollDropdownOpen(false);
      setTimeRange(defaultTimeRange || 'all');
      setStartDate(defaultStartDate || '');
      setEndDate(defaultEndDate || '');
      setLocationFilter('all');
      setStatusFilter('all');
      setTechnicianFilter('all');
      setActiveTab('summary');
      setRecordsSearch('');
      setRecordsPage(1);
    }
  }, [isOpen, defaultTimeRange, defaultStartDate, defaultEndDate]);

  // Universal date resolver for items
  const getItemResolvedDate = (item: any): Date | null => {
    const inv = (item.invoiceId && itemInvoiceMap.get(String(item.invoiceId))) ||
                (item.invoiceNumber && itemInvoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                (item.invoiceNumber && itemInvoiceMap.get(String(item.invoiceNumber))) ||
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

  // Helper to determine if an item is currently in shop
  const isInShopDevice = (item: any): boolean => {
    const statusVal = String(item.status || '').trim();
    if (['60', 'delivered'].includes(statusVal)) return false;
    return true;
  };

  // Helper to get subStatus label
  const getItemSubStatus = (item: any): string => {
    if (item.subStatus) return String(item.subStatus).trim().toLowerCase();
    const statusVal = String(item.status || '').trim();
    if (['55', '45', '70'].includes(statusVal)) return 'unrepairable';
    if (['50', '60'].includes(statusVal)) return 'ready';
    return 'in_progress';
  };

  // Helper to get customer details
  const getCustomerDetails = (item: any) => {
    let custId = item.customerId;
    if (!custId && item.invoiceId) {
      const inv = itemInvoiceMap.get(String(item.invoiceId));
      if (inv) custId = inv.customerId;
    }
    if (!custId && item.invoiceNumber) {
      const cleanNo = String(item.invoiceNumber).replace('#', '').trim();
      const inv = itemInvoiceMap.get(cleanNo) || itemInvoiceMap.get(String(item.invoiceNumber));
      if (inv) custId = inv.customerId;
    }

    if (custId && customersMap.has(custId)) {
      const c = customersMap.get(custId);
      return {
        name: c.name || 'عميل غير مسجل',
        phone: c.phone1 || c.phone || '---',
        company: c.companyName || '---'
      };
    }

    return {
      name: item.customerName || 'عميل غير مسجل',
      phone: item.customerPhone || '---',
      company: '---'
    };
  };

  // Extract all unique Types and all unique Device Names with their counts across the raw items
  const { uniqueTypesList, uniqueDevicesList, uniqueTechniciansList } = useMemo(() => {
    const typeCountMap = new Map<string, number>();
    const deviceCountMap = new Map<string, number>();
    const techSet = new Set<string>();

    rawItems.forEach(it => {
      const qty = Number(it.quantity) || 1;
      const t = String(it.deviceType || 'غير محدد').trim();
      const d = String(it.deviceName || 'بدون موديل').trim();
      const tech = String(it.technician || '').trim();

      if (t) typeCountMap.set(t, (typeCountMap.get(t) || 0) + qty);
      if (d) deviceCountMap.set(d, (deviceCountMap.get(d) || 0) + qty);
      if (tech && tech !== '-' && tech !== '---') techSet.add(tech);
    });

    const types = Array.from(typeCountMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const devices = Array.from(deviceCountMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const technicians = Array.from(techSet).sort((a, b) => a.localeCompare(b, 'ar'));

    return {
      uniqueTypesList: types,
      uniqueDevicesList: devices,
      uniqueTechniciansList: technicians
    };
  }, [rawItems]);

  // Filter the roll dropdown items according to search query
  const filteredRollItems = useMemo(() => {
    const sourceList = selectionMode === 'type' ? uniqueTypesList : uniqueDevicesList;
    if (!rollSearchQuery.trim()) return sourceList;
    const q = rollSearchQuery.toLowerCase().trim();
    return sourceList.filter(item => item.name.toLowerCase().includes(q));
  }, [selectionMode, uniqueTypesList, uniqueDevicesList, rollSearchQuery]);

  // When selection mode changes, reset roll selection to 'all' or first item
  const handleSelectionModeChange = (mode: 'type' | 'device') => {
    setSelectionMode(mode);
    setSelectedValue('all');
    setRollSearchQuery('');
    setIsRollDropdownOpen(false);
    setRecordsPage(1);
  };

  // Filter items matching the chosen Type/Device and all additional criteria
  const { filteredItems, stats } = useMemo(() => {
    const now = new Date();

    const filtered = rawItems.filter(item => {
      // 1. Filter by Type or Device Name
      if (selectedValue !== 'all') {
        if (selectionMode === 'type') {
          const itemType = String(item.deviceType || 'غير محدد').trim();
          if (itemType !== selectedValue) return false;
        } else {
          const itemName = String(item.deviceName || 'بدون موديل').trim();
          if (itemName !== selectedValue) return false;
        }
      }

      // 2. Filter by Time Range
      if (timeRange !== 'all') {
        const itemDate = getItemResolvedDate(item);
        if (!itemDate) return false;

        if (timeRange === 'today') {
          const d = new Date(itemDate);
          if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) {
            return false;
          }
        } else if (timeRange === 'week') {
          const weekAgo = new Date();
          weekAgo.setDate(now.getDate() - 7);
          weekAgo.setHours(0, 0, 0, 0);
          if (itemDate < weekAgo) return false;
        } else if (timeRange === 'month') {
          const monthAgo = new Date();
          monthAgo.setDate(now.getDate() - 30);
          monthAgo.setHours(0, 0, 0, 0);
          if (itemDate < monthAgo) return false;
        } else if (timeRange === 'year') {
          const yearAgo = new Date();
          yearAgo.setFullYear(now.getFullYear() - 1);
          yearAgo.setHours(0, 0, 0, 0);
          if (itemDate < yearAgo) return false;
        } else if (timeRange === 'custom') {
          if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            if (itemDate < start) return false;
          }
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            if (itemDate > end) return false;
          }
        }
      }

      // 3. Filter by Location (In-shop vs Delivered)
      const inShop = isInShopDevice(item);
      if (locationFilter === 'in-shop' && !inShop) return false;
      if (locationFilter === 'delivered' && inShop) return false;

      // 4. Filter by Status
      if (statusFilter !== 'all') {
        const statusVal = String(item.status || '').trim();
        const sub = getItemSubStatus(item);
        if (statusFilter === 'ready' && !['50', '60'].includes(statusVal) && sub !== 'ready') return false;
        if (statusFilter === 'repairing' && !['40', 'repairing'].includes(statusVal)) return false;
        if (statusFilter === 'awaiting_approval' && !['30', 'awaiting_approval'].includes(statusVal)) return false;
        if (statusFilter === 'awaiting_parts' && !['35', 'awaiting_parts'].includes(statusVal)) return false;
        if (statusFilter === 'unrepairable' && !['55', '45', '70'].includes(statusVal) && sub !== 'unrepairable' && sub !== 'refused') return false;
      }

      // 5. Filter by Technician
      if (technicianFilter !== 'all') {
        const tech = String(item.technician || '').trim();
        if (tech !== technicianFilter) return false;
      }

      return true;
    });

    // Sort descending by resolved date / invoice number
    filtered.sort((a, b) => {
      const numA = Number(String(a.invoiceNumber || '0').replace('#', '')) || 0;
      const numB = Number(String(b.invoiceNumber || '0').replace('#', '')) || 0;
      if (numB !== numA) return numB - numA;
      const dateA = getItemResolvedDate(a)?.getTime() || 0;
      const dateB = getItemResolvedDate(b)?.getTime() || 0;
      return dateB - dateA;
    });

    // Calculate statistical metrics
    const sumQty = (arr: any[]) => arr.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
    const sumCost = (arr: any[]) => arr.reduce((sum, it) => sum + (Number(it.cost) || 0), 0);

    const inShopItems = filtered.filter(i => isInShopDevice(i));
    const deliveredItems = filtered.filter(i => !isInShopDevice(i));

    const inShopNew = inShopItems.filter(i => ['10', 'new'].includes(String(i.status)));
    const inShopInspection = inShopItems.filter(i => ['20', '21', '22', 'inspected', 'testing'].includes(String(i.status)));
    const inShopRepairing = inShopItems.filter(i => ['40', 'repairing'].includes(String(i.status)));
    const inShopAwaitingApproval = inShopItems.filter(i => ['30', 'awaiting_approval'].includes(String(i.status)));
    const inShopAwaitingParts = inShopItems.filter(i => ['35', 'awaiting_parts'].includes(String(i.status)));
    const inShopReady = inShopItems.filter(i => ['50', 'ready'].includes(String(i.status)));

    const deliveredReady = deliveredItems.filter(i => getItemSubStatus(i) === 'ready' || ['60', 'delivered'].includes(String(i.status)));
    const deliveredUnrepairable = deliveredItems.filter(i => getItemSubStatus(i) === 'unrepairable' || ['55', '45'].includes(String(i.status)));
    const deliveredRefused = deliveredItems.filter(i => getItemSubStatus(i) === 'refused' || ['70'].includes(String(i.status)));

    const totalQty = sumQty(filtered);
    const inShopQty = sumQty(inShopItems);
    const deliveredQty = sumQty(deliveredItems);

    const revenueCollected = sumCost(deliveredItems);
    const revenueAwaiting = sumCost(inShopItems);
    const totalCostValue = sumCost(filtered);
    const avgCost = totalQty > 0 ? Math.round(totalCostValue / totalQty) : 0;

    // Actual success calculation based on completed repaired devices out of total processed/incoming
    const completedRepairs = sumQty(deliveredReady) + sumQty(inShopReady);
    const actualRate = totalQty > 0 ? (completedRepairs / totalQty) * 100 : 0;
    const successRateFormatted = actualRate % 1 === 0 ? actualRate.toFixed(0) : actualRate.toFixed(1);

    // Calculate turnaround days for completed devices
    let totalDays = 0;
    let daysCount = 0;
    deliveredItems.forEach(it => {
      const entry = parseDate(it.entryDate || it.createdAt);
      const exit = parseDate(it.exitDate || it.deliveredAt || it.updatedAt);
      if (entry && exit && exit >= entry) {
        const diffMs = exit.getTime() - entry.getTime();
        const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
        totalDays += days;
        daysCount++;
      }
    });
    const avgTurnaroundDays = daysCount > 0 ? (totalDays / daysCount).toFixed(1) : '---';

    // Top Faults / Issues
    const faultCounts = new Map<string, number>();
    filtered.forEach(it => {
      const f = String(it.faultDescription || it.issueDescription || it.technicalNotes || '').trim();
      if (f && f !== '-' && f !== '---') {
        faultCounts.set(f, (faultCounts.get(f) || 0) + 1);
      }
    });
    const topFaults = Array.from(faultCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return {
      filteredItems: filtered,
      stats: {
        totalIncoming: totalQty,
        inShopTotal: inShopQty,
        deliveredTotal: deliveredQty,
        inShopNew: sumQty(inShopNew),
        inShopInspection: sumQty(inShopInspection),
        inShopRepairing: sumQty(inShopRepairing),
        inShopAwaitingApproval: sumQty(inShopAwaitingApproval),
        inShopAwaitingParts: sumQty(inShopAwaitingParts),
        inShopReady: sumQty(inShopReady),
        deliveredReadyCount: sumQty(deliveredReady),
        deliveredUnrepairableCount: sumQty(deliveredUnrepairable),
        deliveredRefusedCount: sumQty(deliveredRefused),
        completedRepairs,
        revenueCollected,
        revenueAwaiting,
        avgCost,
        successRate: successRateFormatted,
        avgTurnaroundDays,
        topFaults
      }
    };
  }, [rawItems, selectionMode, selectedValue, timeRange, startDate, endDate, locationFilter, statusFilter, technicianFilter]);

  // Paginated records for the records tab
  const paginatedRecords = useMemo(() => {
    let list = filteredItems;
    if (recordsSearch.trim()) {
      const q = recordsSearch.toLowerCase().trim();
      list = list.filter(it => {
        const cust = getCustomerDetails(it);
        return (
          String(it.invoiceNumber || '').toLowerCase().includes(q) ||
          String(it.deviceName || '').toLowerCase().includes(q) ||
          String(it.deviceType || '').toLowerCase().includes(q) ||
          cust.name.toLowerCase().includes(q) ||
          cust.phone.includes(q) ||
          String(it.technician || '').toLowerCase().includes(q)
        );
      });
    }

    const startIdx = (recordsPage - 1) * recordsPerPage;
    return {
      totalRecords: list.length,
      totalPages: Math.ceil(list.length / recordsPerPage) || 1,
      items: list.slice(startIdx, startIdx + recordsPerPage)
    };
  }, [filteredItems, recordsSearch, recordsPage]);

  // Label for current time range
  const getTimeRangeLabel = () => {
    if (timeRange === 'all') return 'كافة الفترات المسجلة';
    if (timeRange === 'today') return 'اليوم';
    if (timeRange === 'week') return 'آخر 7 أيام';
    if (timeRange === 'month') return 'آخر 30 يوماً';
    if (timeRange === 'year') return 'هذا العام';
    if (timeRange === 'custom') return `من ${startDate || 'البداية'} إلى ${endDate || 'اليوم'}`;
    return 'الفترة المحددة';
  };

  // Label for current selection
  const getSelectionTitleLabel = () => {
    if (selectedValue === 'all') {
      return selectionMode === 'type' ? 'جميع أنواع وتصنيفات الأجهزة' : 'جميع أسماء وموديلات الأجهزة';
    }
    return `${selectionMode === 'type' ? 'نوع الجهاز:' : 'موديل الجهاز:'} ${selectedValue}`;
  };

  // 1. Single Action: Preview Report (يفتح المعاينة الشاملة التي تحتوي على خيارات الطباعة والتصدير)
  const handlePreviewReport = () => {
    const selectedTitle = getSelectionTitleLabel();

    if (activeTab === 'records') {
      const rows = filteredItems.map((item) => {
        const cust = getCustomerDetails(item);
        const dateResolved = getItemResolvedDate(item);
        const formattedDate = dateResolved ? dateResolved.toLocaleDateString('ar-YE') : '---';
        const statusLabel = isInShopDevice(item) ? 'بالمحل (صيانة)' : 'مسلم للعميل';
        const costFormatted = `${Number(item.cost || 0).toLocaleString('en-US')} ${currencySymbol}`;

        return [
          `#${item.invoiceNumber || '---'}`,
          cust.name,
          `${item.deviceType || ''} - ${item.deviceName || ''}`,
          formattedDate,
          statusLabel,
          costFormatted,
          item.technician || '---'
        ];
      });

      onPrintPreview({
        type: 'table',
        data: {
          table: {
            title: `كشف وسجلات الأجهزة التفصيلي - ${selectedTitle}`,
            subtitle: `الفترة: ${getTimeRangeLabel()} | العدد الإجمالي: ${filteredItems.length} جهاز | الإجمالي المالي: ${(stats.revenueCollected + stats.revenueAwaiting).toLocaleString('en-US')} ${currencySymbol}`,
            headers: ['رقم الفاتورة', 'اسم العميل', 'نوع وموديل الجهاز', 'التاريخ', 'الحالة الفنية', 'التكلفة', 'المهندس'],
            rows: rows,
            footerNotes: `إجمالي عدد الأجهزة المسجلة ضمن هذا الكشف: ${filteredItems.length} جهاز.`
          }
        }
      });
      return;
    }

    // Default Summary Matrix Preview
    const rows = [
      ['إجمالي الأجهزة الواردة من هذا المحدد', `${stats.totalIncoming} جهاز`, 'إجمالي المدخلات المسجلة لهذا التصنيف'],
      ['الأجهزة المتواجدة حالياً في المحل', `${stats.inShopTotal} جهاز`, 'قيد الفحص والإجراء الفني داخل الورشة'],
      ['الأجهزة المنتهية والخارجة للعملاء', `${stats.deliveredTotal} جهاز`, 'تمت دورة الصيانة وتم تسليمها للعميل'],
      ['الأجهزة الجاهزة للتسليم داخل الورشة', `${stats.inShopReady} جهاز`, 'منجزة بالكامل وبانتظار استلام العميل'],
      ['الأجهزة قيد الصيانة والإصلاح الفعلي', `${stats.inShopRepairing} جهاز`, 'يجري العمل عليها على طاولة الصيانة'],
      ['الأجهزة بانتظار موافقة العميل', `${stats.inShopAwaitingApproval} جهاز`, 'تم فحصها وتحديد تكلفتها وبانتظار الإذن'],
      ['الأجهزة بانتظار قطع الغيار', `${stats.inShopAwaitingParts} جهاز`, 'معلقة لطلب واستيراد القطع اللازمة'],
      ['الأجهزة التي تعذر إصلاحها', `${stats.deliveredUnrepairableCount} جهاز`, 'لا تصلح أو لا تتوفر قطع بديلة'],
      ['الأجهزة المرفوضة من العميل', `${stats.deliveredRefusedCount} جهاز`, 'عدم موافقة العميل على تكلفة الصيانة'],
      ['معدل النجاح والإصلاح الفعلي', `${stats.successRate}%`, `تم إصلاح ${stats.completedRepairs} جهاز من إجمالي ${stats.totalIncoming}`],
      ['الإيرادات المحصلة من الأجهزة الصادرة', `${stats.revenueCollected.toLocaleString('en-US')} ${currencySymbol}`, 'صافي المقبوض الفعلي من هذا المحدد'],
      ['القيمة المقدرة للأجهزة قيد العمل', `${stats.revenueAwaiting.toLocaleString('en-US')} ${currencySymbol}`, 'تكاليف الصيانة التقديرية للأجهزة بالداخل'],
      ['متوسط تكلفة الفاتورة / الصيانة', `${stats.avgCost.toLocaleString('en-US')} ${currencySymbol}`, 'معدل الدخل لكل عملية صيانة لهذا المحدد'],
      ['متوسط فترة بقاء الجهاز في الصيانة', `${stats.avgTurnaroundDays} يوم`, 'معدل الوقت من تاريخ الدخول حتى التسليم']
    ];

    onPrintPreview({
      type: 'table',
      data: {
        table: {
          title: `تقرير الملخص الإحصائي والمؤشرات - ${selectedTitle}`,
          subtitle: `الفترة المحددة: ${getTimeRangeLabel()} | إجمالي الأجهزة: ${stats.totalIncoming} جهاز | نسبة النجاح الفعلية: ${stats.successRate}%`,
          headers: ['المؤشر / البيان التشغيلي والمالي', 'القيمة المحققة', 'ملاحظات وتفاصيل'],
          rows: rows,
          footerNotes: `تم استخراج هذا التقرير الإحصائي التخصصي آلياً بناءً على محددات الفلترة الخاصة بـ (${selectedTitle}). العملة: ${currencySymbol}.`
        }
      }
    });
  };

  // 2. Single Action: Download Report (تنزيل التقرير كملف بيانات إكسل / CSV)
  const handleDownloadReport = () => {
    const selectedTitle = getSelectionTitleLabel();
    const clean = (str: any) => `"${String(str || '').replace(/"/g, '""')}"`;

    if (activeTab === 'summary') {
      const csvRows = [
        ['المؤشر الإحصائي والتشغيلي', 'القيمة المحققة', 'ملاحظات'].map(clean).join(','),
        [clean('المحدد المستهدف'), clean(selectedTitle), clean(getTimeRangeLabel())].join(','),
        [clean('إجمالي الوارد'), clean(`${stats.totalIncoming} جهاز`), clean('مدخلات الفترة')].join(','),
        [clean('المتواجد في المحل حالياً'), clean(`${stats.inShopTotal} جهاز`), clean('قيد الإجراء')].join(','),
        [clean('المنتهي والمسلم للعميل'), clean(`${stats.deliveredTotal} جهاز`), clean('خارج ومسلم')].join(','),
        [clean('الجاهز للتسليم بالورشة'), clean(`${stats.inShopReady} جهاز`), clean('بانتظار العميل')].join(','),
        [clean('قيد الصيانة والإصلاح'), clean(`${stats.inShopRepairing} جهاز`), clean('على الطاولة')].join(','),
        [clean('بانتظار الموافقة'), clean(`${stats.inShopAwaitingApproval} جهاز`), clean('معلق للإذن')].join(','),
        [clean('بانتظار قطع الغيار'), clean(`${stats.inShopAwaitingParts} جهاز`), clean('طلب قطع')].join(','),
        [clean('تعذر الإصلاح'), clean(`${stats.deliveredUnrepairableCount} جهاز`), clean('لا يصلح')].join(','),
        [clean('مرفوض من العميل'), clean(`${stats.deliveredRefusedCount} جهاز`), clean('رفض التكلفة')].join(','),
        [clean('نسبة النجاح الفعلية'), clean(`${stats.successRate}%`), clean(`${stats.completedRepairs} من ${stats.totalIncoming} مصلحة بنجاح`)].join(','),
        [clean('الإيراد المحصل الفعلي'), clean(`${stats.revenueCollected} ${currencySymbol}`), clean('مقبوض')].join(','),
        [clean('القيمة التقديرية بالداخل'), clean(`${stats.revenueAwaiting} ${currencySymbol}`), clean('قيد العمل')].join(','),
        [clean('متوسط تكلفة الصيانة'), clean(`${stats.avgCost} ${currencySymbol}`), clean('لكل فاتورة')].join(','),
        [clean('متوسط فترة الإنجاز'), clean(`${stats.avgTurnaroundDays} يوم`), clean('زمن الدورة')].join(',')
      ];

      const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `ملخص_احصائي_${selectionMode}_${selectedValue}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Records Tab Download
    const headers = ['م', 'رقم الفاتورة', 'اسم العميل', 'الهاتف', 'نوع الجهاز', 'اسم الجهاز', 'الحالة', 'التكلفة', 'المهندس الفني'];
    const csvRows = [headers.join(',')];

    filteredItems.forEach((item, idx) => {
      const cust = getCustomerDetails(item);
      const statusLabel = isInShopDevice(item) ? 'بالمحل' : 'مسلم';

      csvRows.push([
        idx + 1,
        clean(item.invoiceNumber),
        clean(cust.name),
        clean(cust.phone),
        clean(item.deviceType),
        clean(item.deviceName),
        clean(statusLabel),
        `${Number(item.cost) || 0} ${currencySymbol}`,
        clean(item.technician)
      ].join(','));
    });

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `كشف_اجهزة_${selectionMode}_${selectedValue}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-fade-in" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="bg-white dark:bg-[#141414] text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden font-cairo text-right"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-white/10 bg-gray-50/90 dark:bg-[#1a1a1a] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 rounded-2xl shadow-sm">
              <BarChart3 size={22} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-gray-900 dark:text-white">
                تقرير الملخص الإحصائي حسب النوع أو الجهاز
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-medium mt-0.5">
                مؤشرات تشغيلية وفنية وإحصائية مفصلة (العملة الأساسية: {currencySymbol})
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
            title="إغلاق النافذة"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body: Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">

          {/* Section 1: Radio Buttons (دوائر الاختيار) & Roll Selection (رول الاختيار) */}
          <div className="bg-gray-50/70 dark:bg-[#191919] p-4 sm:p-5 rounded-2xl border border-gray-200 dark:border-white/5 space-y-4 shadow-sm">
            
            {/* 1.1 Radio Buttons in Header */}
            <div>
              <label className="text-xs font-black text-gray-700 dark:text-gray-300 block mb-2.5">
                تحديد نمط التقرير والمؤشرات (دوائر الاختيار):
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                {/* Radio Option 1: By Device Type */}
                <div 
                  onClick={() => handleSelectionModeChange('type')}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                    selectionMode === 'type' 
                      ? 'bg-indigo-50/90 dark:bg-indigo-500/15 border-indigo-500 text-indigo-950 dark:text-white shadow-sm ring-1 ring-indigo-500/30' 
                      : 'bg-white dark:bg-black/30 border-gray-200 dark:border-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectionMode === 'type' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-400 dark:border-gray-500 bg-transparent'
                    }`}>
                      {selectionMode === 'type' && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <Layers size={18} className={selectionMode === 'type' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'} />
                      <span className="text-xs sm:text-sm font-black">حسب نوع الجهاز (الصنف / Category)</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-gray-200/70 dark:bg-white/5 px-2 py-0.5 rounded-md text-gray-700 dark:text-gray-300">
                    {uniqueTypesList.length} أنواع
                  </span>
                </div>

                {/* Radio Option 2: By Device Name / Model */}
                <div 
                  onClick={() => handleSelectionModeChange('device')}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                    selectionMode === 'device' 
                      ? 'bg-indigo-50/90 dark:bg-indigo-500/15 border-indigo-500 text-indigo-950 dark:text-white shadow-sm ring-1 ring-indigo-500/30' 
                      : 'bg-white dark:bg-black/30 border-gray-200 dark:border-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectionMode === 'device' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-400 dark:border-gray-500 bg-transparent'
                    }`}>
                      {selectionMode === 'device' && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <Laptop size={18} className={selectionMode === 'device' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'} />
                      <span className="text-xs sm:text-sm font-black">حسب اسم / موديل الجهاز (Device Name)</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-gray-200/70 dark:bg-white/5 px-2 py-0.5 rounded-md text-gray-700 dark:text-gray-300">
                    {uniqueDevicesList.length} موديلات
                  </span>
                </div>

              </div>
            </div>

            {/* 1.2 Selection Roll (رول الاختيار يحمل جميع الأنواع أو الأجهزة) */}
            <div className="relative">
              <label className="text-xs font-black text-gray-700 dark:text-gray-300 block mb-2">
                {selectionMode === 'type' ? 'اختر نوع الجهاز المستهدف (رول الأنواع):' : 'اختر موديل الجهاز المستهدف (رول الأجهزة):'}
              </label>

              {/* Selector Box */}
              <div 
                onClick={() => setIsRollDropdownOpen(!isRollDropdownOpen)}
                className="w-full flex items-center justify-between p-3.5 bg-white dark:bg-black/50 border border-gray-300 dark:border-white/10 hover:border-indigo-500 rounded-xl cursor-pointer transition-all text-right shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  {selectionMode === 'type' ? <Layers size={18} className="text-indigo-600 dark:text-indigo-400" /> : <Laptop size={18} className="text-indigo-600 dark:text-indigo-400" />}
                  <span className="text-sm font-black text-gray-900 dark:text-white">
                    {selectedValue === 'all' 
                      ? (selectionMode === 'type' ? '⚡ كافة أنواع الأجهزة (شامل الكل)' : '⚡ كافة موديلات الأجهزة (شامل الكل)')
                      : selectedValue
                    }
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-500/20">
                    {stats.totalIncoming} جهاز مطابق
                  </span>
                  <ChevronDown size={18} className={`text-gray-500 dark:text-gray-400 transition-transform ${isRollDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Roll Dropdown Menu */}
              {isRollDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl p-3 space-y-2 max-h-72 flex flex-col font-cairo">
                  {/* Search inside roll */}
                  <div className="relative">
                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text"
                      placeholder={`بحث سريع داخل ${selectionMode === 'type' ? 'الأنواع' : 'الأجهزة'}...`}
                      value={rollSearchQuery}
                      onChange={(e) => setRollSearchQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl pr-9 pl-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Options List */}
                  <div className="overflow-y-auto flex-1 space-y-1 pr-1 custom-scrollbar">
                    {/* Option All */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedValue('all');
                        setIsRollDropdownOpen(false);
                        setRecordsPage(1);
                      }}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        selectedValue === 'all' 
                          ? 'bg-indigo-600 text-white shadow-sm' 
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {selectedValue === 'all' && <Check size={14} />}
                        ⚡ {selectionMode === 'type' ? 'كافة أنواع الأجهزة (الكل)' : 'كافة موديلات الأجهزة (الكل)'}
                      </span>
                      <span className="font-mono text-[10px] opacity-80">{rawItems.length} جهاز</span>
                    </button>

                    {/* Individual Items */}
                    {filteredRollItems.map((item, idx) => {
                      const isSelected = selectedValue === item.name;
                      return (
                        <button
                          key={`roll-${item.name}-${idx}`}
                          type="button"
                          onClick={() => {
                            setSelectedValue(item.name);
                            setIsRollDropdownOpen(false);
                            setRecordsPage(1);
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isSelected 
                              ? 'bg-indigo-600 text-white font-black shadow-sm' 
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            {isSelected && <Check size={14} />}
                            {item.name}
                          </span>
                          <span className="font-mono text-[10px] bg-gray-200/80 dark:bg-white/10 px-2 py-0.5 rounded-md text-gray-700 dark:text-gray-300">
                            {item.count} جهاز
                          </span>
                        </button>
                      );
                    })}

                    {filteredRollItems.length === 0 && (
                      <div className="p-4 text-center text-xs text-gray-500 font-bold">
                        لم يتم العثور على نتائج مطابقة للبحث.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Section 2: Additional Criteria & Determinants (المحددات والفلاتر الإضافية) */}
          <div className="bg-gray-50/70 dark:bg-[#191919] p-4 sm:p-5 rounded-2xl border border-gray-200 dark:border-white/5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black text-gray-800 dark:text-gray-200">
              <SlidersHorizontal size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>محددات وفلاتر الفحص الإضافية:</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              
              {/* 2.1 Time Range Filter */}
              <div>
                <label className="text-[11px] font-bold text-gray-600 dark:text-gray-400 block mb-1.5">النطاق الزمني</label>
                <select 
                  value={timeRange} 
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="w-full bg-white dark:bg-black/60 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500 font-bold shadow-sm"
                >
                  <option value="all">كافة الفترات</option>
                  <option value="today">اليوم</option>
                  <option value="week">آخر 7 أيام</option>
                  <option value="month">آخر 30 يوماً</option>
                  <option value="year">هذا العام</option>
                  <option value="custom">نطاق مخصص (تحديد تواريخ)</option>
                </select>
              </div>

              {/* 2.2 Location / Shop Presence Filter */}
              <div>
                <label className="text-[11px] font-bold text-gray-600 dark:text-gray-400 block mb-1.5">موقع ومسار الجهاز</label>
                <select 
                  value={locationFilter} 
                  onChange={(e) => setLocationFilter(e.target.value as any)}
                  className="w-full bg-white dark:bg-black/60 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500 font-bold shadow-sm"
                >
                  <option value="all">كافة الأجهزة (داخل وخارج)</option>
                  <option value="in-shop">متواجدة بالورشة حالياً فقط</option>
                  <option value="delivered">صادرة ومسلمة للعملاء فقط</option>
                </select>
              </div>

              {/* 2.3 Status Filter */}
              <div>
                <label className="text-[11px] font-bold text-gray-600 dark:text-gray-400 block mb-1.5">الحالة الفنية</label>
                <select 
                  value={statusFilter} 
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-white dark:bg-black/60 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500 font-bold shadow-sm"
                >
                  <option value="all">جميع الحالات الفنية</option>
                  <option value="ready">جاهز للتسليم / تم الإصلاح</option>
                  <option value="repairing">قيد الصيانة والإصلاح</option>
                  <option value="awaiting_approval">بانتظار موافقة العميل</option>
                  <option value="awaiting_parts">بانتظار قطع الغيار</option>
                  <option value="unrepairable">تعذر الإصلاح / مرفوض</option>
                </select>
              </div>

              {/* 2.4 Technician Filter */}
              <div>
                <label className="text-[11px] font-bold text-gray-600 dark:text-gray-400 block mb-1.5">المهندس الفني</label>
                <select 
                  value={technicianFilter} 
                  onChange={(e) => setTechnicianFilter(e.target.value)}
                  className="w-full bg-white dark:bg-black/60 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500 font-bold shadow-sm"
                >
                  <option value="all">كافة المهندسين والفنيين</option>
                  {uniqueTechniciansList.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

            </div>

            {/* Custom Date Inputs if custom range selected */}
            {timeRange === 'custom' && (
              <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-gray-200 dark:border-white/5 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400 font-bold">من تاريخ:</span>
                  <input 
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-white dark:bg-black/60 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-xs px-3 py-2 rounded-xl outline-none focus:border-indigo-500 font-bold font-mono shadow-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400 font-bold">إلى تاريخ:</span>
                  <input 
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-white dark:bg-black/60 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-xs px-3 py-2 rounded-xl outline-none focus:border-indigo-500 font-bold font-mono shadow-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Metric Summary Cards (بطاقات المؤشرات السريعة) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            
            {/* Card 1: Total Incoming */}
            <div className="bg-white dark:bg-[#191919] p-3.5 rounded-2xl border border-gray-200 dark:border-white/5 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">إجمالي الوارد</span>
              <div className="my-1">
                <span className="text-2xl font-black font-mono text-gray-900 dark:text-white">{stats.totalIncoming}</span>
                <span className="text-[10px] text-gray-500 mr-1 font-bold">جهاز</span>
              </div>
              <span className="text-[9px] text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded w-fit">مدخلات الفترة</span>
            </div>

            {/* Card 2: In-Shop Active */}
            <div className="bg-white dark:bg-[#191919] p-3.5 rounded-2xl border border-gray-200 dark:border-white/5 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">بالورشة حالياً</span>
              <div className="my-1">
                <span className="text-2xl font-black font-mono text-orange-600 dark:text-orange-400">{stats.inShopTotal}</span>
                <span className="text-[10px] text-gray-500 mr-1 font-bold">جهاز</span>
              </div>
              <span className="text-[9px] text-orange-600 dark:text-orange-400 font-bold bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded w-fit">قيد الإجراء</span>
            </div>

            {/* Card 3: Delivered Total */}
            <div className="bg-white dark:bg-[#191919] p-3.5 rounded-2xl border border-gray-200 dark:border-white/5 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">المنتهي والمسلم</span>
              <div className="my-1">
                <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">{stats.deliveredTotal}</span>
                <span className="text-[10px] text-gray-500 mr-1 font-bold">جهاز</span>
              </div>
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded w-fit">اكتملت دورته</span>
            </div>

            {/* Card 4: Success Rate (النسبة الفعلية) */}
            <div className="bg-white dark:bg-[#191919] p-3.5 rounded-2xl border border-gray-200 dark:border-white/5 flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">نسبة النجاح الفعلية</span>
              <div className="my-1">
                <span className="text-2xl font-black font-mono text-purple-600 dark:text-purple-400">{stats.successRate}%</span>
              </div>
              <span className="text-[9px] text-purple-600 dark:text-purple-400 font-bold bg-purple-50 dark:bg-purple-500/10 px-1.5 py-0.5 rounded w-fit">
                {stats.completedRepairs} من {stats.totalIncoming} مصلح
              </span>
            </div>

            {/* Card 5: Collected Revenue (بالدولار $) */}
            {canViewFinancial && (
              <div className="bg-white dark:bg-[#191919] p-3.5 rounded-2xl border border-gray-200 dark:border-white/5 flex flex-col justify-between shadow-sm">
                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">الإيراد المحصل</span>
                <div className="my-1">
                  <span className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
                    {stats.revenueCollected.toLocaleString('en-US')}
                  </span>
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 mr-1 font-bold">{currencySymbol}</span>
                </div>
                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded w-fit">صافي مقبوض</span>
              </div>
            )}

            {/* Card 6: Average Ticket (بالدولار $) */}
            {canViewFinancial && (
              <div className="bg-white dark:bg-[#191919] p-3.5 rounded-2xl border border-gray-200 dark:border-white/5 flex flex-col justify-between shadow-sm">
                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">متوسط الصيانة</span>
                <div className="my-1">
                  <span className="text-lg font-black font-mono text-indigo-600 dark:text-indigo-400">
                    {stats.avgCost.toLocaleString('en-US')}
                  </span>
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 mr-1 font-bold">{currencySymbol}</span>
                </div>
                <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded w-fit">لكل عملية</span>
              </div>
            )}

          </div>

          {/* Section 4: Main Tabs (جدول المؤشرات الإحصائية vs كشف السجلات المفصل) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('summary')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === 'summary' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
                  }`}
                >
                  <BarChart3 size={15} />
                  <span>جدول المؤشرات الإحصائية الشاملة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('records')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === 'records' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
                  }`}
                >
                  <FileText size={15} />
                  <span>كشف وسجلات الأجهزة بالتفصيل ({filteredItems.length})</span>
                </button>
              </div>

              {/* Action Buttons: Only Preview & Download as requested */}
              <div className="flex items-center gap-2">
                {/* 1. Preview Button */}
                <button
                  type="button"
                  onClick={handlePreviewReport}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                >
                  <Eye size={15} />
                  <span>معاينة التقرير</span>
                </button>

                {/* 2. Download Button */}
                <button
                  type="button"
                  onClick={handleDownloadReport}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                >
                  <Download size={15} />
                  <span>تنزيل التقرير</span>
                </button>
              </div>
            </div>

            {/* Tab 1: Comprehensive Statistical Summary Table (مطابق لتقرير الملخص الإحصائي والمؤشرات الشاملة) */}
            {activeTab === 'summary' && (
              <div className="bg-white dark:bg-[#191919] rounded-2xl border border-gray-200 dark:border-white/5 overflow-hidden shadow-sm">
                <div className="p-3.5 bg-gray-50 dark:bg-[#202020] border-b border-gray-200 dark:border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-black text-gray-900 dark:text-white">
                      مصفوفة المؤشرات التشغيلية والمالية: {getSelectionTitleLabel()}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">الفترة: {getTimeRangeLabel()}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-gray-100/80 dark:bg-black/40 border-b border-gray-200 dark:border-white/5 text-gray-700 dark:text-gray-400 font-bold">
                        <th className="p-3 text-right">المؤشر / البيان التشغيلي والمالي</th>
                        <th className="p-3 text-center w-40">القيمة المحققة</th>
                        <th className="p-3 text-right">ملاحظات وتفاصيل الدلالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-white/5 font-cairo">
                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                          <Package size={15} className="text-blue-500" />
                          <span>إجمالي الأجهزة الواردة في الفترة</span>
                        </td>
                        <td className="p-3 text-center font-mono font-black text-gray-900 dark:text-white bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.totalIncoming} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">إجمالي المدخلات المسجلة لهذا المحدد</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                          <Clock size={15} className="text-orange-500" />
                          <span>الأجهزة المتواجدة حالياً في المحل</span>
                        </td>
                        <td className="p-3 text-center font-mono font-black text-orange-600 dark:text-orange-400 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.inShopTotal} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">قيد الفحص والإجراء الفني داخل الورشة</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                          <CheckCircle2 size={15} className="text-emerald-500" />
                          <span>الأجهزة المنتهية والخارجة للعملاء</span>
                        </td>
                        <td className="p-3 text-center font-mono font-black text-emerald-600 dark:text-emerald-400 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.deliveredTotal} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">تمت دورة الصيانة وتم تسليمها للعميل</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-700 dark:text-gray-300 pr-8">
                          • الأجهزة الجاهزة للتسليم داخل الورشة
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.inShopReady} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">منجزة بالكامل وبانتظار استلام العميل</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-700 dark:text-gray-300 pr-8">
                          • الأجهزة قيد الصيانة والإصلاح الفعلي
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-indigo-700 dark:text-indigo-300 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.inShopRepairing} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">يجري العمل عليها على طاولة الصيانة</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-700 dark:text-gray-300 pr-8">
                          • الأجهزة بانتظار موافقة العميل
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-amber-700 dark:text-amber-300 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.inShopAwaitingApproval} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">تم فحصها وتحديد تكلفتها وبانتظار الإذن</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-700 dark:text-gray-300 pr-8">
                          • الأجهزة بانتظار قطع الغيار
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-amber-600 dark:text-amber-400 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.inShopAwaitingParts} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">معلقة لطلب واستيراد القطع اللازمة</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                          <XCircle size={15} />
                          <span>الأجهزة التي تعذر إصلاحها</span>
                        </td>
                        <td className="p-3 text-center font-mono font-black text-rose-600 dark:text-rose-400 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.deliveredUnrepairableCount} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">لا تصلح أو لا تتوفر قطع بديلة</td>
                      </tr>

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-rose-700 dark:text-rose-300 pr-8">
                          • الأجهزة المرفوضة من العميل
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-rose-700 dark:text-rose-300 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.deliveredRefusedCount} جهاز
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">عدم موافقة العميل على تكلفة الصيانة</td>
                      </tr>

                      <tr className="hover:bg-purple-50/70 dark:hover:bg-white/[0.02] transition-colors bg-purple-50/40 dark:bg-purple-500/5">
                        <td className="p-3 font-black text-purple-900 dark:text-purple-300 flex items-center gap-2">
                          <TrendingUp size={15} />
                          <span>معدل النجاح والإصلاح الفعلي لهذا المحدد</span>
                        </td>
                        <td className="p-3 text-center font-mono font-black text-purple-900 dark:text-purple-300 bg-purple-100/40 dark:bg-white/[0.01]">
                          {stats.successRate}%
                        </td>
                        <td className="p-3 text-purple-800 dark:text-purple-200/70 text-[11px]">
                          نسبة الأجهزة المصلحة فعلياً ({stats.completedRepairs} من {stats.totalIncoming} جهاز)
                        </td>
                      </tr>

                      {canViewFinancial && (
                        <>
                          <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="p-3 font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                              <Coins size={15} />
                              <span>الإيرادات المحصلة من الأجهزة الصادرة</span>
                            </td>
                            <td className="p-3 text-center font-mono font-black text-emerald-700 dark:text-emerald-400 bg-gray-50/50 dark:bg-white/[0.01]">
                              {stats.revenueCollected.toLocaleString('en-US')} {currencySymbol}
                            </td>
                            <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">صافي المقبوض الفعلي من هذا المحدد</td>
                          </tr>

                          <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="p-3 font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
                              <Wrench size={15} />
                              <span>القيمة المقدرة للأجهزة قيد العمل</span>
                            </td>
                            <td className="p-3 text-center font-mono font-black text-indigo-700 dark:text-indigo-400 bg-gray-50/50 dark:bg-white/[0.01]">
                              {stats.revenueAwaiting.toLocaleString('en-US')} {currencySymbol}
                            </td>
                            <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">تكاليف الصيانة التقديرية للأجهزة بالداخل</td>
                          </tr>

                          <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="p-3 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                              <TrendingUp size={15} />
                              <span>متوسط تكلفة الفاتورة / الصيانة</span>
                            </td>
                            <td className="p-3 text-center font-mono font-black text-gray-900 dark:text-white bg-gray-50/50 dark:bg-white/[0.01]">
                              {stats.avgCost.toLocaleString('en-US')} {currencySymbol}
                            </td>
                            <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">معدل الدخل لكل عملية صيانة لهذا المحدد</td>
                          </tr>
                        </>
                      )}

                      <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="p-3 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                          <Clock size={15} className="text-sky-500" />
                          <span>متوسط فترة بقاء الجهاز في الصيانة</span>
                        </td>
                        <td className="p-3 text-center font-mono font-black text-sky-600 dark:text-sky-400 bg-gray-50/50 dark:bg-white/[0.01]">
                          {stats.avgTurnaroundDays} يوم
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400 text-[11px]">معدل الوقت من تاريخ الدخول حتى التسليم الفعلي</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Additional Insight: Top Faults for this device/type */}
                {stats.topFaults.length > 0 && (
                  <div className="p-4 bg-gray-50/80 dark:bg-black/40 border-t border-gray-200 dark:border-white/5 space-y-2">
                    <span className="text-[11px] font-black text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                      <Wrench size={14} />
                      أبرز الأعطال والمشاكل الفنية الأكثر تكراراً المسجلة لهذا المحدد:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {stats.topFaults.map(([fault, count], idx) => (
                        <div key={idx} className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 px-3 py-1 rounded-xl text-xs flex items-center gap-2 shadow-xs">
                          <span className="text-gray-800 dark:text-gray-300 font-bold">{fault}</span>
                          <span className="text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">
                            {count} مرات
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Detailed Individual Device Records (كشف الأجهزة الفردية) */}
            {activeTab === 'records' && (
              <div className="bg-white dark:bg-[#191919] rounded-2xl border border-gray-200 dark:border-white/5 overflow-hidden space-y-3 p-3 sm:p-4 shadow-sm">
                
                {/* Search Bar inside records */}
                <div className="flex items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text"
                      placeholder="بحث برقم الفاتورة، العميل، الهاتف، أو الموديل..."
                      value={recordsSearch}
                      onChange={(e) => {
                        setRecordsSearch(e.target.value);
                        setRecordsPage(1);
                      }}
                      className="w-full bg-gray-50 dark:bg-black/60 border border-gray-300 dark:border-white/10 rounded-xl pr-9 pl-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-indigo-500 shadow-sm"
                    />
                  </div>
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
                    إجمالي النتائج: <strong className="text-gray-900 dark:text-white">{paginatedRecords.totalRecords}</strong> جهاز
                  </span>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-gray-100/80 dark:bg-black/40 border-b border-gray-200 dark:border-white/5 text-gray-700 dark:text-gray-400 font-bold">
                        <th className="p-2.5 text-center w-10">م</th>
                        <th className="p-2.5">رقم الفاتورة</th>
                        <th className="p-2.5">العميل</th>
                        <th className="p-2.5">نوع وموديل الجهاز</th>
                        <th className="p-2.5">تاريخ الدخول</th>
                        <th className="p-2.5">الحالة الفنية</th>
                        <th className="p-2.5">التكلفة</th>
                        <th className="p-2.5">المهندس</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-white/5 font-cairo">
                      {paginatedRecords.items.map((item, idx) => {
                        const cust = getCustomerDetails(item);
                        const dateResolved = getItemResolvedDate(item);
                        const formattedDate = dateResolved ? dateResolved.toLocaleDateString('ar-YE') : '---';
                        const inShop = isInShopDevice(item);
                        const rowNumber = (recordsPage - 1) * recordsPerPage + idx + 1;

                        return (
                          <tr key={item.id || idx} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="p-2.5 text-center font-mono text-gray-400">{rowNumber}</td>
                            <td className="p-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-300">
                              #{item.invoiceNumber || '---'}
                            </td>
                            <td className="p-2.5">
                              <div className="font-bold text-gray-900 dark:text-white">{cust.name}</div>
                              {cust.phone !== '---' && <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">{cust.phone}</div>}
                            </td>
                            <td className="p-2.5">
                              <div className="font-bold text-gray-800 dark:text-gray-200">{item.deviceType || 'عام'}</div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400">{item.deviceName || 'بدون موديل'}</div>
                            </td>
                            <td className="p-2.5 font-mono text-gray-700 dark:text-gray-300">{formattedDate}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                inShop 
                                  ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20' 
                                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                              }`}>
                                {inShop ? 'بالورشة (صيانة)' : 'مسلم للعميل'}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono font-bold text-gray-900 dark:text-white">
                              {Number(item.cost || 0).toLocaleString('en-US')} {currencySymbol}
                            </td>
                            <td className="p-2.5 text-gray-600 dark:text-gray-400 text-[11px]">{item.technician || '---'}</td>
                          </tr>
                        );
                      })}

                      {paginatedRecords.items.length === 0 && (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-gray-500 text-xs font-bold">
                            لا توجد أجهزة مطابقة للمحددات المختارة.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {paginatedRecords.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-white/5 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">
                      صفحة {recordsPage} من {paginatedRecords.totalPages}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setRecordsPage(p => Math.max(1, p - 1))}
                        disabled={recordsPage === 1}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed font-bold cursor-pointer text-gray-800 dark:text-gray-200"
                      >
                        السابق
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecordsPage(p => Math.min(paginatedRecords.totalPages, p + 1))}
                        disabled={recordsPage === paginatedRecords.totalPages}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed font-bold cursor-pointer text-gray-800 dark:text-gray-200"
                      >
                        التالي
                      </button>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-gray-200 dark:border-white/10 bg-gray-50/90 dark:bg-[#1a1a1a] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-gray-600 dark:text-gray-400 font-bold">
            المحدد المختار: <strong className="text-gray-900 dark:text-white">{getSelectionTitleLabel()}</strong> ({stats.totalIncoming} جهاز)
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* 1. Single Action: Preview */}
            <button
              type="button"
              onClick={handlePreviewReport}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95"
            >
              <Eye size={16} />
              <span>معاينة التقرير</span>
            </button>

            {/* 2. Single Action: Download */}
            <button
              type="button"
              onClick={handleDownloadReport}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95"
            >
              <Download size={16} />
              <span>تنزيل التقرير</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-white/5 dark:hover:bg-white/10 text-gray-800 dark:text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>

      </motion.div>
    </div>
  );
}
