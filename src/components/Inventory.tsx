import { useBackHandler } from '../hooks/useBackHandler';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Wrench,
  CheckCircle2,
  Package,
  ArrowUpDown,
  AlertCircle,
  AlertTriangle,
  Clock,
  ShieldAlert,
  Smartphone,
  Boxes,
  ArrowRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Printer,
  User as UserIcon,
  Phone,
  Calendar,
  Layers,
  RotateCcw,
  Eye,
  X,
  FileText,
  Cpu,
  Filter,
  Sparkles,
  CornerDownLeft
} from 'lucide-react';
import { collection, query, onSnapshot } from '../firebase';
import { db } from '../firebase';
import {
  Invoice,
  InvoiceItem,
  Customer,
  User,
  ShopConfig,
  isInShopMaintenanceDevice,
  getItemSubStatus
} from '../types';
import { parseDate, formatDate } from '../lib/dateUtils';
import { getCurrencySymbol } from '../lib/fundUtils';
import { motion, AnimatePresence } from 'motion/react';
import ShopPartsStockView from './ShopPartsStockView';
import PartsCatalogTable from './PartsCatalogTable';
import PrintPreviewOverlay from './PrintPreviewOverlay';
import { usePermissions } from '../hooks/usePermissions';

type InventorySortType =
  | 'invoice'
  | 'deviceType'
  | 'deviceName'
  | 'customerName'
  | 'status'
  | 'quantity'
  | 'technician'
  | 'daysInShop';

type InventoryMode = 'hub' | 'parts_stock' | 'catalog' | 'devices_stock';
type StageTab = 'all' | 'inspection' | 'approval' | 'maintenance' | 'ready' | 'returns' | 'delayed';
type GroupByMode = 'none' | 'stage' | 'technician' | 'customer';

interface EnrichedDeviceItem {
  item: InvoiceItem;
  invoice: Invoice | null;
  customer: Customer | null;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  entryDateObj: Date | null;
  entryDateLabel: string;
  daysInShop: number;
  isDelayed: boolean;
  isWarrantyReturn: boolean;
  stageGroup: 'inspection' | 'approval' | 'maintenance' | 'ready';
  qty: number;
  currency: string;
  serial: string;
}

const ARABIC_STATUS_CONFIG: Record<string, { label: string; badgeClass: string; textClass: string }> = {
  '10': { label: 'دخول جديد', badgeClass: 'bg-blue-500/10 border-blue-500/20', textClass: 'text-blue-400' },
  new: { label: 'دخول جديد', badgeClass: 'bg-blue-500/10 border-blue-500/20', textClass: 'text-blue-400' },
  '20': { label: 'قيد الفحص', badgeClass: 'bg-amber-500/10 border-amber-500/20', textClass: 'text-amber-400' },
  inspected: { label: 'تم الفحص', badgeClass: 'bg-amber-500/10 border-amber-500/20', textClass: 'text-amber-400' },
  testing: { label: 'قيد الفحص', badgeClass: 'bg-amber-500/10 border-amber-500/20', textClass: 'text-amber-400' },
  '30': { label: 'انتظار الموافقة', badgeClass: 'bg-cyan-500/10 border-cyan-500/20', textClass: 'text-cyan-400' },
  awaiting_approval: { label: 'انتظار موافقة العميل', badgeClass: 'bg-cyan-500/10 border-cyan-500/20', textClass: 'text-cyan-400' },
  approved: { label: 'تمت الموافقة', badgeClass: 'bg-teal-500/10 border-teal-500/20', textClass: 'text-teal-400' },
  '35': { label: 'انتظار قطع الغيار', badgeClass: 'bg-orange-500/10 border-orange-500/20', textClass: 'text-orange-400' },
  awaiting_parts: { label: 'انتظار قطع الغيار', badgeClass: 'bg-orange-500/10 border-orange-500/20', textClass: 'text-orange-400' },
  parts_available: { label: 'تم توفير القطع', badgeClass: 'bg-indigo-500/10 border-indigo-500/20', textClass: 'text-indigo-400' },
  parts_not_available: { label: 'لم تتوفر القطع', badgeClass: 'bg-rose-500/10 border-rose-500/20', textClass: 'text-rose-400' },
  '40': { label: 'قيد الصيانة', badgeClass: 'bg-indigo-500/10 border-indigo-500/20', textClass: 'text-indigo-400' },
  repairing: { label: 'قيد الصيانة', badgeClass: 'bg-indigo-500/10 border-indigo-500/20', textClass: 'text-indigo-400' },
  '50': { label: 'جاهز للتسليم', badgeClass: 'bg-emerald-500/10 border-emerald-500/20', textClass: 'text-emerald-400' },
  ready: { label: 'جاهز للتسليم', badgeClass: 'bg-emerald-500/10 border-emerald-500/20', textClass: 'text-emerald-400' },
  intact: { label: 'جاهز (سليم بدون صيانة)', badgeClass: 'bg-emerald-500/10 border-emerald-500/20', textClass: 'text-emerald-400' },
  unrepairable: { label: 'جاهز (لا يصلح)', badgeClass: 'bg-rose-500/10 border-rose-500/20', textClass: 'text-rose-400' },
  '55': { label: 'جاهز (لا يصلح)', badgeClass: 'bg-rose-500/10 border-rose-500/20', textClass: 'text-rose-400' },
  refused: { label: 'جاهز (مرفوض من العميل)', badgeClass: 'bg-red-500/10 border-red-500/20', textClass: 'text-red-400' },
  no_parts: { label: 'جاهز (عدم توفر قطع)', badgeClass: 'bg-rose-500/10 border-rose-500/20', textClass: 'text-rose-400' },
  '60': { label: 'تم التسليم', badgeClass: 'bg-gray-500/10 border-gray-500/20', textClass: 'text-gray-400' },
  delivered: { label: 'تم التسليم', badgeClass: 'bg-gray-500/10 border-gray-500/20', textClass: 'text-gray-400' },
  '70': { label: 'ملغى / مسحوب', badgeClass: 'bg-rose-500/10 border-rose-500/20', textClass: 'text-rose-400' },
  cancelled: { label: 'ملغى / مسحوب', badgeClass: 'bg-rose-500/10 border-rose-500/20', textClass: 'text-rose-400' }
};

const STATUS_HIERARCHY: Record<string, number> = {
  '10': 10, new: 10,
  '20': 20, inspected: 20, testing: 20,
  '30': 30, awaiting_approval: 30,
  approved: 34,
  '35': 36, awaiting_parts: 36,
  parts_available: 38,
  parts_not_available: 39,
  '40': 40, repairing: 40,
  '50': 50, ready: 50,
  intact: 51,
  unrepairable: 52, '55': 52, no_parts: 52,
  refused: 53,
  '60': 60, delivered: 60,
  '70': 70, cancelled: 70
};

const STAGE_META: Record<'inspection' | 'approval' | 'maintenance' | 'ready', { title: string; color: string; badgeBg: string; border: string }> = {
  inspection: {
    title: 'الاستلام والفحص (10–20)',
    color: 'text-amber-400',
    badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    border: 'border-amber-500/20'
  },
  approval: {
    title: 'انتظار الموافقة والقطع (30–35)',
    color: 'text-cyan-400',
    badgeBg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    border: 'border-cyan-500/20'
  },
  maintenance: {
    title: 'قيد الصيانة والتشغيل (40)',
    color: 'text-indigo-400',
    badgeBg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    border: 'border-indigo-500/20'
  },
  ready: {
    title: 'جاهز للتسليم والخروج (50)',
    color: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    border: 'border-emerald-500/20'
  }
};

function resolveStageGroup(item: InvoiceItem): 'inspection' | 'approval' | 'maintenance' | 'ready' {
  const st = String(item.status || '').toLowerCase().trim();
  const sub = getItemSubStatus(item);
  if (
    ['50', 'ready', 'intact', 'unrepairable', '55', 'refused', 'no_parts'].includes(st) ||
    ['ready', 'intact', 'unrepairable', 'refused', 'no_parts'].includes(sub)
  ) {
    return 'ready';
  }
  if (['40', 'repairing'].includes(st)) {
    return 'maintenance';
  }
  if (['30', 'awaiting_approval', 'approved', '35', 'awaiting_parts', 'parts_available', 'parts_not_available'].includes(st)) {
    return 'approval';
  }
  return 'inspection';
}

function getArabicStatusMeta(item: InvoiceItem) {
  const st = String(item.status || '').toLowerCase().trim();
  const sub = getItemSubStatus(item);
  const specificKey = ['intact', 'unrepairable', 'refused', 'no_parts', 'awaiting_parts', 'awaiting_approval', 'parts_available', 'parts_not_available'].includes(sub)
    ? sub
    : st;

  return (
    ARABIC_STATUS_CONFIG[specificKey] ||
    ARABIC_STATUS_CONFIG[st] ||
    ARABIC_STATUS_CONFIG['10']
  );
}

function normalizeSmartText(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchCorpus(entry: EnrichedDeviceItem): string {
  const partsNames = Array.isArray(entry.item.partsUsed)
    ? entry.item.partsUsed.map(p => p.partName || '').join(' ')
    : '';
  const statusLabel = getArabicStatusMeta(entry.item).label;
  const rawParts = [
    entry.invoiceNumber,
    `#${entry.invoiceNumber}`,
    entry.customerName,
    entry.customerPhone,
    entry.item.deviceType || '',
    entry.item.deviceName || '',
    entry.serial,
    entry.item.technician || 'غير مسند',
    entry.item.createdBy || '',
    entry.item.faultType || '',
    entry.item.customerProblem || '',
    entry.item.engineerReport || '',
    entry.item.failureReason || '',
    entry.item.deviceNotes || '',
    entry.item.technicalNotes || '',
    partsNames,
    statusLabel,
    entry.isWarrantyReturn ? 'مرتجع ضمان' : '',
    entry.isDelayed ? 'متأخر متاخره متأخرة' : ''
  ];
  return normalizeSmartText(rawParts.join(' '));
}

export default function Inventory({
  user,
  onBack,
  initialMode = 'hub',
  shopConfig = null
}: {
  user: User;
  onBack?: () => void;
  initialMode?: InventoryMode;
  shopConfig?: ShopConfig | null;
}) {
  const { hasPermission } = usePermissions(user);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partsCount, setPartsCount] = useState<number>(0);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [inventoryMode, setInventoryMode] = useState<InventoryMode>(initialMode);
  useEffect(() => {
    setInventoryMode(initialMode);
  }, [initialMode]);

  // Search, Tabs, Quick Filters, Grouping, Sort
  const [search, setSearch] = useState('');
  const [isSmartSearchOpen, setIsSmartSearchOpen] = useState(false);
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(0);
  const smartSearchRef = useRef<HTMLDivElement>(null);
  const smartSearchInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<StageTab>('all');
  const [selectedTechnician, setSelectedTechnician] = useState<string>('all');
  const [selectedDeviceType, setSelectedDeviceType] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<GroupByMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [filterType, setFilterType] = useState<InventorySortType>('invoice');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Quick details & Print preview modals
  const [selectedDetailEntry, setSelectedDetailEntry] = useState<EnrichedDeviceItem | null>(null);
  const [printPreviewData, setPrintPreviewData] = useState<any>(null);

  // Pagination (used when groupBy === 'none')
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const canView = hasPermission('inventory', 'view');
  const canPrint = user?.role === 'admin' || user?.isPrimary || hasPermission('inventory', 'print');

  useBackHandler(Boolean(printPreviewData), () => {
    setPrintPreviewData(null);
  });

  useBackHandler(Boolean(selectedDetailEntry) && !printPreviewData, () => {
    setSelectedDetailEntry(null);
  });

  useBackHandler((showFilterDropdown || isSmartSearchOpen) && !selectedDetailEntry && !printPreviewData, () => {
    setShowFilterDropdown(false);
    setIsSmartSearchOpen(false);
  });

  useBackHandler(inventoryMode !== 'hub' && !selectedDetailEntry && !showFilterDropdown && !isSmartSearchOpen && !printPreviewData, () => {
    setInventoryMode('hub');
  });

  // Close sort & smart search dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
      if (smartSearchRef.current && !smartSearchRef.current.contains(e.target as Node)) {
        setIsSmartSearchOpen(false);
      }
    };
    if (showFilterDropdown || isSmartSearchOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterDropdown, isSmartSearchOpen]);

  useEffect(() => {
    const unsubItems = onSnapshot(
      query(collection(db, 'invoice_items')),
      (snapshot) => {
        setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceItem)));
        setLoading(false);
      },
      (error) => {
        console.error('Firestore invoice_items error:', error);
        setLoading(false);
      }
    );

    const unsubInvoices = onSnapshot(
      query(collection(db, 'invoices')),
      (snapshot) => {
        setInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)));
      },
      (error) => console.error('Firestore invoices error:', error)
    );

    const unsubCustomers = onSnapshot(
      query(collection(db, 'customers')),
      (snapshot) => {
        setCustomers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
      },
      (error) => console.error('Firestore customers error:', error)
    );

    const unsubParts = onSnapshot(
      collection(db, 'shop_parts_inventory'),
      (snap) => setPartsCount(snap.docs.length),
      (err) => console.error('Parts count error:', err)
    );

    const unsubCatalog = onSnapshot(
      collection(db, 'parts_catalog'),
      (snap) => setCatalogCount(snap.docs.length),
      (err) => console.error('Catalog count error:', err)
    );

    return () => {
      unsubItems();
      unsubInvoices();
      unsubCustomers();
      unsubParts();
      unsubCatalog();
    };
  }, []);

  // Build fast lookup maps
  const invoiceMap = useMemo(() => {
    const map = new Map<string, Invoice>();
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

  const customerMap = useMemo(() => {
    const byId = new Map<string, Customer>();
    const byName = new Map<string, Customer>();
    customers.forEach(c => {
      if (c.id) byId.set(String(c.id), c);
      if (c.name) byName.set(c.name.trim().toLowerCase(), c);
    });
    return { byId, byName };
  }, [customers]);

  // Enrich active in-shop customer devices
  const enrichedActiveDevices = useMemo<EnrichedDeviceItem[]>(() => {
    const nowMs = Date.now();
    const list: EnrichedDeviceItem[] = [];

    items.forEach(item => {
      const cleanNo = String(item.invoiceNumber || '').replace('#', '').trim();
      const inv =
        (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
        (cleanNo && invoiceMap.get(cleanNo)) ||
        null;

      if (!isInShopMaintenanceDevice(item, inv)) return;

      const custId = inv?.customerId || item.customerId;
      const rawCustName = (inv?.customerName || item.customerName || '').trim();
      const cust =
        (custId && customerMap.byId.get(String(custId))) ||
        (rawCustName && customerMap.byName.get(rawCustName.toLowerCase())) ||
        null;

      const customerName = rawCustName || cust?.name || 'عميل غير محدد';
      const customerPhone = cust?.phone1 || cust?.phone2 || (inv as any)?.customerPhone || '';
      const invoiceNumber = String(inv?.invoiceNumber || item.invoiceNumber || '---').replace(/^#/, '').trim();

      const entryDateObj =
        parseDate(item.entryDate) ||
        parseDate(inv?.entryDate) ||
        parseDate(inv?.date) ||
        parseDate(inv?.createdAt) ||
        parseDate(item.createdAt) ||
        parseDate(item.date) ||
        parseDate(item.updatedAt) ||
        null;

      const daysInShop = entryDateObj
        ? Math.max(0, Math.floor((nowMs - entryDateObj.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const isDelayed = daysInShop >= 7;
      const isWarrantyReturn = Boolean(
        item.isWarrantyReturn ||
          item.isReturnPending ||
          (item.returnLinkStatus && item.returnLinkStatus !== 'none' && item.returnLinkStatus !== 'rejected_new')
      );

      const stageGroup = resolveStageGroup(item);
      const qty = Math.max(1, Number(item.quantity) || 1);
      const currency = inv?.currency || 'YER';
      const serial = String((item as any).serialNumber || (item as any).serial || '').trim();

      list.push({
        item,
        invoice: inv,
        customer: cust,
        invoiceNumber,
        customerName,
        customerPhone,
        entryDateObj,
        entryDateLabel: entryDateObj ? formatDate(entryDateObj) : '---',
        daysInShop,
        isDelayed,
        isWarrantyReturn,
        stageGroup,
        qty,
        currency,
        serial
      });
    });

    return list;
  }, [items, invoiceMap, customerMap]);

  // Summary metrics across all active devices in shop
  const summaryStats = useMemo(() => {
    let totalQty = 0;
    let inspectionQty = 0;
    let approvalQty = 0;
    let maintenanceQty = 0;
    let readyQty = 0;
    let delayedQty = 0;
    let returnsQty = 0;

    enrichedActiveDevices.forEach(entry => {
      totalQty += entry.qty;
      if (entry.stageGroup === 'inspection') inspectionQty += entry.qty;
      else if (entry.stageGroup === 'approval') approvalQty += entry.qty;
      else if (entry.stageGroup === 'maintenance') maintenanceQty += entry.qty;
      else if (entry.stageGroup === 'ready') readyQty += entry.qty;

      if (entry.isDelayed) delayedQty += entry.qty;
      if (entry.isWarrantyReturn) returnsQty += entry.qty;
    });

    return {
      totalRows: enrichedActiveDevices.length,
      totalQty,
      inspectionQty,
      approvalQty,
      maintenanceQty,
      readyQty,
      delayedQty,
      returnsQty
    };
  }, [enrichedActiveDevices]);

  // Unique dropdown options for Technician & DeviceType
  const technicianOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedActiveDevices.forEach(e => {
      const tName = (e.item.technician || '').trim();
      if (tName) set.add(tName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [enrichedActiveDevices]);

  const deviceTypeOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedActiveDevices.forEach(e => {
      const dt = (e.item.deviceType || '').trim();
      if (dt) set.add(dt);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [enrichedActiveDevices]);

  // Filtered & sorted list (Smart multi-token normalized search)
  const processedEntries = useMemo(() => {
    const normQuery = normalizeSmartText(search);
    const tokens = normQuery ? normQuery.split(' ').filter(Boolean) : [];

    const filtered = enrichedActiveDevices.filter(entry => {
      // Tab filter
      if (activeTab === 'inspection' && entry.stageGroup !== 'inspection') return false;
      if (activeTab === 'approval' && entry.stageGroup !== 'approval') return false;
      if (activeTab === 'maintenance' && entry.stageGroup !== 'maintenance') return false;
      if (activeTab === 'ready' && entry.stageGroup !== 'ready') return false;
      if (activeTab === 'returns' && !entry.isWarrantyReturn) return false;
      if (activeTab === 'delayed' && !entry.isDelayed) return false;

      // Technician filter
      if (selectedTechnician === '__unassigned__') {
        if ((entry.item.technician || '').trim() !== '') return false;
      } else if (selectedTechnician !== 'all') {
        if ((entry.item.technician || '').trim() !== selectedTechnician) return false;
      }

      // Device type filter
      if (selectedDeviceType !== 'all') {
        if ((entry.item.deviceType || '').trim() !== selectedDeviceType) return false;
      }

      // Smart multi-token query filter (each token must match anywhere in device/customer/invoice/parts/status corpus)
      if (tokens.length > 0) {
        const corpus = buildSearchCorpus(entry);
        const matchesAllTokens = tokens.every(tok => {
          const cleanTok = tok.replace(/^#/, '');
          return corpus.includes(tok) || (cleanTok !== '' && corpus.includes(cleanTok));
        });
        if (!matchesAllTokens) return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      if (filterType === 'invoice') {
        const numA = Number(a.invoiceNumber) || 0;
        const numB = Number(b.invoiceNumber) || 0;
        return sortDir === 'asc' ? numA - numB : numB - numA;
      }
      if (filterType === 'deviceType') {
        const vA = a.item.deviceType || '';
        const vB = b.item.deviceType || '';
        return sortDir === 'asc' ? vA.localeCompare(vB, 'ar') : vB.localeCompare(vA, 'ar');
      }
      if (filterType === 'deviceName') {
        const vA = a.item.deviceName || '';
        const vB = b.item.deviceName || '';
        return sortDir === 'asc' ? vA.localeCompare(vB, 'ar') : vB.localeCompare(vA, 'ar');
      }
      if (filterType === 'customerName') {
        return sortDir === 'asc'
          ? a.customerName.localeCompare(b.customerName, 'ar')
          : b.customerName.localeCompare(a.customerName, 'ar');
      }
      if (filterType === 'status') {
        const oA = STATUS_HIERARCHY[String(getItemSubStatus(a.item))] ?? STATUS_HIERARCHY[String(a.item.status)] ?? 99;
        const oB = STATUS_HIERARCHY[String(getItemSubStatus(b.item))] ?? STATUS_HIERARCHY[String(b.item.status)] ?? 99;
        return sortDir === 'asc' ? oA - oB : oB - oA;
      }
      if (filterType === 'quantity') {
        return sortDir === 'asc' ? a.qty - b.qty : b.qty - a.qty;
      }
      if (filterType === 'technician') {
        const tA = a.item.technician || '';
        const tB = b.item.technician || '';
        return sortDir === 'asc' ? tA.localeCompare(tB, 'ar') : tB.localeCompare(tA, 'ar');
      }
      if (filterType === 'daysInShop') {
        return sortDir === 'asc' ? a.daysInShop - b.daysInShop : b.daysInShop - a.daysInShop;
      }
      return 0;
    });

    return filtered;
  }, [enrichedActiveDevices, activeTab, selectedTechnician, selectedDeviceType, search, filterType, sortDir]);

  // Smart Suggestions for instant autocomplete dropdown
  type SmartSuggestion =
    | { id: string; kind: 'technician'; label: string; meta: string; value: string }
    | { id: string; kind: 'deviceType'; label: string; meta: string; value: string }
    | { id: string; kind: 'customer'; label: string; meta: string; value: string }
    | { id: string; kind: 'invoice'; label: string; meta: string; value: string }
    | { id: string; kind: 'device'; label: string; meta: string; entry: EnrichedDeviceItem };

  const smartSuggestions = useMemo<SmartSuggestion[]>(() => {
    const normQuery = normalizeSmartText(search);
    if (!normQuery) return [];
    const tokens = normQuery.split(' ').filter(Boolean);
    const cleanQuery = normQuery.replace(/^#/, '');
    const results: SmartSuggestion[] = [];

    // 1. Matching Engineers
    const techCounts = new Map<string, number>();
    enrichedActiveDevices.forEach(e => {
      const t = (e.item.technician || '').trim();
      if (t) techCounts.set(t, (techCounts.get(t) || 0) + e.qty);
    });
    let addedTech = 0;
    techCounts.forEach((qty, techName) => {
      if (addedTech >= 2) return;
      if (normalizeSmartText(techName).includes(normQuery)) {
        results.push({
          id: `sg-tech-${techName}`,
          kind: 'technician',
          label: `تصفية حسب المهندس: ${techName}`,
          meta: `${qty} جهاز`,
          value: techName
        });
        addedTech++;
      }
    });

    // 2. Matching Device Types
    const typeCounts = new Map<string, number>();
    enrichedActiveDevices.forEach(e => {
      const dt = (e.item.deviceType || '').trim();
      if (dt) typeCounts.set(dt, (typeCounts.get(dt) || 0) + e.qty);
    });
    let addedType = 0;
    typeCounts.forEach((qty, dtName) => {
      if (addedType >= 2) return;
      if (normalizeSmartText(dtName).includes(normQuery)) {
        results.push({
          id: `sg-type-${dtName}`,
          kind: 'deviceType',
          label: `تصفية حسب النوع: ${dtName}`,
          meta: `${qty} جهاز`,
          value: dtName
        });
        addedType++;
      }
    });

    // 3. Matching Customers
    const custCounts = new Map<string, { name: string; phone: string; qty: number }>();
    enrichedActiveDevices.forEach(e => {
      const key = e.customerName.trim();
      if (!key || key === 'عميل غير محدد') return;
      const prev = custCounts.get(key);
      if (prev) prev.qty += e.qty;
      else custCounts.set(key, { name: key, phone: e.customerPhone, qty: e.qty });
    });
    let addedCust = 0;
    custCounts.forEach(c => {
      if (addedCust >= 2) return;
      const hay = normalizeSmartText(`${c.name} ${c.phone}`);
      if (tokens.every(tok => hay.includes(tok))) {
        results.push({
          id: `sg-cust-${c.name}`,
          kind: 'customer',
          label: `عميل: ${c.name}`,
          meta: c.phone ? `${c.phone} • ${c.qty} جهاز` : `${c.qty} جهاز`,
          value: c.name
        });
        addedCust++;
      }
    });

    // 4. Matching Invoices
    const invMap = new Map<string, { num: string; customerName: string; qty: number }>();
    enrichedActiveDevices.forEach(e => {
      if (!e.invoiceNumber || e.invoiceNumber === '---') return;
      const prev = invMap.get(e.invoiceNumber);
      if (prev) prev.qty += e.qty;
      else invMap.set(e.invoiceNumber, { num: e.invoiceNumber, customerName: e.customerName, qty: e.qty });
    });
    let addedInv = 0;
    invMap.forEach(invInfo => {
      if (addedInv >= 2) return;
      if (cleanQuery && normalizeSmartText(invInfo.num).includes(cleanQuery)) {
        results.push({
          id: `sg-inv-${invInfo.num}`,
          kind: 'invoice',
          label: `فاتورة #${invInfo.num}`,
          meta: `${invInfo.customerName} • ${invInfo.qty} جهاز`,
          value: invInfo.num
        });
        addedInv++;
      }
    });

    // 5. Direct Device Matches (Top 5)
    const directMatches = enrichedActiveDevices
      .filter(entry => {
        const corpus = buildSearchCorpus(entry);
        return tokens.every(tok => {
          const cleanTok = tok.replace(/^#/, '');
          return corpus.includes(tok) || (cleanTok !== '' && corpus.includes(cleanTok));
        });
      })
      .slice(0, 5);

    directMatches.forEach((entry, i) => {
      const statusLabel = getArabicStatusMeta(entry.item).label;
      results.push({
        id: `sg-dev-${entry.item.id || i}`,
        kind: 'device',
        label: `${entry.item.deviceType || 'جهاز'}${entry.item.deviceName ? ` — ${entry.item.deviceName}` : ''}`,
        meta: `#${entry.invoiceNumber} • ${entry.customerName} • ${statusLabel}`,
        entry
      });
    });

    return results;
  }, [enrichedActiveDevices, search]);

  useEffect(() => {
    setHighlightedSuggestionIdx(0);
  }, [search]);

  const handleSelectSmartSuggestion = (sg: SmartSuggestion) => {
    if (sg.kind === 'technician') {
      setSelectedTechnician(sg.value);
      setSearch('');
      setCurrentPage(1);
    } else if (sg.kind === 'deviceType') {
      setSelectedDeviceType(sg.value);
      setSearch('');
      setCurrentPage(1);
    } else if (sg.kind === 'customer' || sg.kind === 'invoice') {
      setSearch(sg.value);
      setCurrentPage(1);
    } else if (sg.kind === 'device') {
      setSelectedDetailEntry(sg.entry);
    }
    setIsSmartSearchOpen(false);
  };

  // Grouped entries when groupBy !== 'none'
  const groupedEntries = useMemo(() => {
    if (groupBy === 'none') return [];

    const map = new Map<string, { key: string; label: string; badgeClass?: string; entries: EnrichedDeviceItem[]; totalQty: number }>();

    if (groupBy === 'stage') {
      (['inspection', 'approval', 'maintenance', 'ready'] as const).forEach(stageKey => {
        map.set(stageKey, {
          key: stageKey,
          label: STAGE_META[stageKey].title,
          badgeClass: STAGE_META[stageKey].badgeBg,
          entries: [],
          totalQty: 0
        });
      });
    }

    processedEntries.forEach(entry => {
      let key = '';
      let label = '';
      let badgeClass = 'bg-white/10 text-gray-200 border-white/10';

      if (groupBy === 'stage') {
        key = entry.stageGroup;
        label = STAGE_META[entry.stageGroup].title;
        badgeClass = STAGE_META[entry.stageGroup].badgeBg;
      } else if (groupBy === 'technician') {
        const tech = (entry.item.technician || '').trim();
        key = tech || '__unassigned__';
        label = tech ? `المهندس: ${tech}` : 'غير مسند لمهندس بعد';
        badgeClass = tech ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20';
      } else {
        key = `${entry.customerName}__${entry.invoiceNumber}`;
        label = `${entry.customerName} — فاتورة #${entry.invoiceNumber}`;
        badgeClass = 'bg-blue-500/10 text-blue-300 border-blue-500/20';
      }

      if (!map.has(key)) {
        map.set(key, { key, label, badgeClass, entries: [], totalQty: 0 });
      }
      const grp = map.get(key)!;
      grp.entries.push(entry);
      grp.totalQty += entry.qty;
    });

    return Array.from(map.values()).filter(g => g.entries.length > 0);
  }, [processedEntries, groupBy]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-gray-500 gap-4" dir="rtl">
        <ShieldAlert size={48} className="text-orange-500/50" />
        <h2 className="text-xl font-bold font-cairo">ليس لديك صلاحية لعرض هذا القسم</h2>
        <p className="text-sm">يرجى التواصل مع مسؤول النظام للمزيد من المعلومات</p>
      </div>
    );
  }

  const setFilterAndSort = (type: InventorySortType, dir: 'asc' | 'desc') => {
    setFilterType(type);
    setSortDir(dir);
    setShowFilterDropdown(false);
    setCurrentPage(1);
  };

  const handleHeaderClick = (type: InventorySortType) => {
    if (filterType === type) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setFilterType(type);
      setSortDir(type === 'invoice' || type === 'quantity' || type === 'daysInShop' ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  };

  const renderSortArrow = (type: InventorySortType) => {
    if (filterType !== type) return null;
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const totalPages = Math.max(1, Math.ceil(processedEntries.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const currentEntries = processedEntries.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);
  const filteredTotalQty = processedEntries.reduce((s, e) => s + e.qty, 0);

  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getTabLabel = (tab: StageTab) => {
    switch (tab) {
      case 'all': return 'جميع الأجهزة في المحل';
      case 'inspection': return 'الاستلام والفحص';
      case 'approval': return 'انتظار الموافقة والقطع';
      case 'maintenance': return 'قيد الصيانة';
      case 'ready': return 'جاهز للتسليم';
      case 'returns': return 'مرتجعات الضمان';
      case 'delayed': return 'الأجهزة المتأخرة (+7 أيام)';
    }
  };

  const handlePrintInventoryReport = () => {
    const headers = [
      'رقم الفاتورة',
      'العميل',
      'نوع واسم الجهاز',
      'المهندس',
      'تاريخ الدخول / المدة',
      'الكمية',
      'الحالة التشغيلية'
    ];

    const rows = processedEntries.map((entry) => {
      const statusMeta = getArabicStatusMeta(entry.item);
      const deviceFull = `${entry.item.deviceType || 'غير محدد'}${entry.item.deviceName ? ` - ${entry.item.deviceName}` : ''}`;
      const warrantySuffix = entry.isWarrantyReturn ? ' (مرتجع ضمان)' : '';
      const stayLabel = entry.entryDateLabel !== '---'
        ? `${entry.entryDateLabel} (${entry.daysInShop === 0 ? 'اليوم' : `${entry.daysInShop} يوم`})`
        : '---';

      return [
        `#${entry.invoiceNumber}`,
        entry.customerPhone ? `${entry.customerName} (${entry.customerPhone})` : entry.customerName,
        `${deviceFull}${warrantySuffix}`,
        entry.item.technician || 'غير مسند',
        stayLabel,
        String(entry.qty),
        statusMeta.label
      ];
    });

    const filterParts: string[] = [getTabLabel(activeTab)];
    if (selectedTechnician !== 'all') {
      filterParts.push(selectedTechnician === '__unassigned__' ? 'غير مسند لمهندس' : `المهندس: ${selectedTechnician}`);
    }
    if (selectedDeviceType !== 'all') {
      filterParts.push(`النوع: ${selectedDeviceType}`);
    }

    setPrintPreviewData({
      type: 'table',
      data: {
        table: {
          title: 'كشف جرد أجهزة العملاء في المحل',
          subtitle: `التصفية: ${filterParts.join(' | ')} | إجمالي السجلات: ${processedEntries.length} | إجمالي الأجهزة: ${filteredTotalQty}`,
          headers,
          rows,
          footerNotes: `تاريخ استخراج الجرد: ${formatDate(new Date())} — يشمل الأجهزة المتواجدة فعلياً بالمحل ولم تُسلّم بعد.`
        }
      }
    });
  };

  const renderDaysBadge = (entry: EnrichedDeviceItem) => {
    if (!entry.entryDateObj) {
      return <span className="text-[10px] text-gray-500">---</span>;
    }
    const label = entry.daysInShop === 0 ? 'اليوم' : entry.daysInShop === 1 ? 'يوم واحد' : `${entry.daysInShop} يوم`;
    const colorClass =
      entry.daysInShop >= 14
        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
        : entry.daysInShop >= 7
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-white/5 text-gray-300 border-white/10';

    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-gray-400 font-mono">{entry.entryDateLabel}</span>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${colorClass}`}>
          {label}
        </span>
      </div>
    );
  };

  const renderTableBlock = (entriesToRender: EnrichedDeviceItem[]) => (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block w-full overflow-x-auto overflow-y-auto max-h-[60vh] scrollbar-thin overscroll-contain border-b border-white/5">
        <table className="w-full min-w-[880px] text-right border-collapse select-none">
          <thead className="sticky top-0 z-10 bg-[#161616] shadow-sm">
            <tr className="bg-white/5 border-b border-white/10 text-gray-400 text-[10px]">
              <th
                onClick={() => handleHeaderClick('invoice')}
                className="px-3 py-2.5 font-bold whitespace-nowrap text-center cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                رقم الفاتورة{renderSortArrow('invoice')}
              </th>
              <th
                onClick={() => handleHeaderClick('customerName')}
                className="px-3 py-2.5 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                العميل{renderSortArrow('customerName')}
              </th>
              <th
                onClick={() => handleHeaderClick('deviceType')}
                className="px-3 py-2.5 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                نوع الجهاز{renderSortArrow('deviceType')}
              </th>
              <th
                onClick={() => handleHeaderClick('deviceName')}
                className="px-3 py-2.5 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                اسم الجهاز / الموديل{renderSortArrow('deviceName')}
              </th>
              <th
                onClick={() => handleHeaderClick('technician')}
                className="px-3 py-2.5 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                المهندس{renderSortArrow('technician')}
              </th>
              <th
                onClick={() => handleHeaderClick('daysInShop')}
                className="px-3 py-2.5 font-bold whitespace-nowrap text-center cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                الدخول والمدة{renderSortArrow('daysInShop')}
              </th>
              <th
                onClick={() => handleHeaderClick('quantity')}
                className="px-3 py-2.5 font-bold text-center whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                الكمية{renderSortArrow('quantity')}
              </th>
              <th
                onClick={() => handleHeaderClick('status')}
                className="px-3 py-2.5 font-bold text-center whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all"
              >
                الحالة{renderSortArrow('status')}
              </th>
              <th className="px-2 py-2.5 font-bold text-center whitespace-nowrap">التفاصيل</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-slate-300 text-xs">
            {entriesToRender.map((entry, idx) => (
              <tr
                key={entry.item.id ? `dev-row-${entry.item.id}-${idx}` : `dev-row-${idx}`}
                onClick={() => setSelectedDetailEntry(entry)}
                className="hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <td className="px-3 py-2.5 text-center">
                  <span className="font-mono font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-lg text-[11px]">
                    #{entry.invoiceNumber}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col max-w-[170px]">
                    <span className="font-bold text-white truncate">{entry.customerName}</span>
                    {entry.customerPhone && (
                      <span className="text-[10px] text-gray-400 font-mono truncate">{entry.customerPhone}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap max-w-[160px]">
                    <span className="font-bold text-white truncate">{entry.item.deviceType || 'غير محدد'}</span>
                    {entry.isWarrantyReturn && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 whitespace-nowrap">
                        مرتجع ضمان
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-bold text-orange-300 truncate block max-w-[170px]">
                    {entry.item.deviceName || '---'}
                  </span>
                  {entry.serial && (
                    <span className="text-[10px] font-mono text-gray-500 block truncate max-w-[170px]">
                      SN: {entry.serial}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`font-bold truncate block max-w-[120px] ${entry.item.technician ? 'text-blue-300' : 'text-gray-500'}`}>
                    {entry.item.technician || 'غير مسند'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center">{renderDaysBadge(entry)}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className="font-mono font-black text-white bg-white/5 px-2.5 py-0.5 rounded-lg border border-white/10">
                    {entry.qty}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <StatusBadge item={entry.item} />
                  </div>
                </td>
                <td className="px-2 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDetailEntry(entry);
                    }}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-orange-600/20 text-gray-400 hover:text-orange-400 border border-white/10 transition-colors cursor-pointer"
                    title="عرض تفاصيل الجهاز"
                  >
                    <Eye size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y divide-white/5">
        {entriesToRender.map((entry, idx) => (
          <div
            key={entry.item.id ? `dev-card-${entry.item.id}-${idx}` : `dev-card-${idx}`}
            onClick={() => setSelectedDetailEntry(entry)}
            className="p-3.5 space-y-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-lg text-[10px]">
                    #{entry.invoiceNumber}
                  </span>
                  {entry.isWarrantyReturn && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                      مرتجع ضمان
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded-md border border-white/10">
                    الكمية: {entry.qty}
                  </span>
                </div>
                <div className="font-black text-sm text-white truncate">
                  {entry.item.deviceType || 'غير محدد'}
                  {entry.item.deviceName ? ` — ${entry.item.deviceName}` : ''}
                </div>
              </div>
              <StatusBadge item={entry.item} />
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
              <div className="flex items-center gap-1.5 min-w-0">
                <UserIcon size={12} className="text-gray-500 shrink-0" />
                <span className="text-gray-200 font-bold truncate">{entry.customerName}</span>
                {entry.customerPhone && (
                  <span className="font-mono text-[10px] text-gray-500 shrink-0">({entry.customerPhone})</span>
                )}
              </div>
              <div className="shrink-0">
                {entry.entryDateObj && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      entry.daysInShop >= 14
                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        : entry.daysInShop >= 7
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-white/5 text-gray-300 border-white/10'
                    }`}
                  >
                    {entry.daysInShop === 0 ? 'اليوم' : `${entry.daysInShop} يوم`}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1">
              <span>
                المهندس: <strong className="text-blue-300">{entry.item.technician || 'غير مسند'}</strong>
              </span>
              <span className="text-orange-400 font-bold flex items-center gap-1">
                <Eye size={12} /> التفاصيل
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  // 1. HUB VIEW
  if (inventoryMode === 'hub') {
    return (
      <div className="space-y-6 pb-8 text-right font-cairo max-w-2xl mx-auto pt-4 px-2 sm:px-0" dir="rtl">
        <div className="text-center space-y-2 py-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-600/10 text-orange-500 border border-orange-500/20 mb-1">
            <Boxes size={22} />
          </div>
          <h1 className="text-lg sm:text-xl font-black text-white">أقسام وإدارة المخزون</h1>
          <p className="text-xs text-gray-400 font-medium max-w-md mx-auto">
            اختر القسم المطلوب لإدارة مخزون ودليل القطع والملحقات أو جرد أجهزة صيانة العملاء
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <button
            type="button"
            onClick={() => setInventoryMode('parts_stock')}
            className="w-full flex items-center justify-between p-6 bg-white/5 hover:bg-white/[0.08] border border-white/5 hover:border-emerald-500/30 rounded-2xl transition-all group text-right shadow-lg cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/10 text-emerald-500 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all shrink-0">
                <Package size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white text-base group-hover:text-emerald-400 transition-colors">
                    مخزون القطع والملحقات في النظام
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
                    {partsCount} صنف
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  إدارة وتدقيق قطع الغيار الجديدة، الشاشات، البطاريات، الملحقات، ودفعات التشليح
                </p>
              </div>
            </div>
            <ChevronLeft size={20} className="text-gray-500 group-hover:text-white group-hover:translate-x-[-4px] transition-all shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setInventoryMode('catalog')}
            className="w-full flex items-center justify-between p-6 bg-white/5 hover:bg-white/[0.08] border border-white/5 hover:border-blue-500/30 rounded-2xl transition-all group text-right shadow-lg cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-500 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                <BookOpen size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white text-base group-hover:text-blue-400 transition-colors">
                    دليل القطع والملحقات
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md">
                    {catalogCount} صنف
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  إدارة وتسجيل أصناف وأنواع القطع والأسعار الافتراضية للبيع والتكلفة
                </p>
              </div>
            </div>
            <ChevronLeft size={20} className="text-gray-500 group-hover:text-white group-hover:translate-x-[-4px] transition-all shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setInventoryMode('devices_stock')}
            className="w-full flex items-center justify-between p-6 bg-white/5 hover:bg-white/[0.08] border border-white/5 hover:border-orange-500/30 rounded-2xl transition-all group text-right shadow-lg cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange-600/10 text-orange-500 flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-all shrink-0">
                <Smartphone size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white text-base group-hover:text-orange-400 transition-colors">
                    مخزون أجهزة العملاء في المحل
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-md">
                    {summaryStats.totalQty} جهاز
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  كشف وجرد أجهزة الصيانة المتواجدة بالمحل، متابعة المهندسين، الحالات والفرز
                </p>
              </div>
            </div>
            <ChevronLeft size={20} className="text-gray-500 group-hover:text-white group-hover:translate-x-[-4px] transition-all shrink-0" />
          </button>
        </div>
      </div>
    );
  }

  // 2. PARTS CATALOG VIEW
  if (inventoryMode === 'catalog') {
    return (
      <div className="space-y-4 pb-24 md:pb-6 text-right pt-2" dir="rtl">
        <div className="flex items-center justify-between gap-3 bg-[#1a1a1a] p-3 rounded-2xl border border-white/5 shadow-md">
          <button
            type="button"
            onClick={() => setInventoryMode('hub')}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold font-cairo transition-all border border-white/10 cursor-pointer"
          >
            <ArrowRight size={16} />
            <span>العودة لأقسام المخزون</span>
          </button>
        </div>
        <PartsCatalogTable />
      </div>
    );
  }

  // 3. PARTS STOCK VIEW
  if (inventoryMode === 'parts_stock') {
    return (
      <div className="space-y-4 pb-24 md:pb-6 text-right pt-2" dir="rtl">
        <div className="flex items-center justify-between gap-3 bg-[#1a1a1a] p-3 rounded-2xl border border-white/5 shadow-md">
          <button
            type="button"
            onClick={() => setInventoryMode('hub')}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold font-cairo transition-all border border-white/10 cursor-pointer"
          >
            <ArrowRight size={16} />
            <span>العودة لأقسام المخزون</span>
          </button>
        </div>
        <ShopPartsStockView />
      </div>
    );
  }

  // 4. IN-SHOP CLIENT DEVICES STOCK VIEW (Organized Inventory View)
  const stageTabs: { id: StageTab; label: string; count: number; activeColor: string }[] = [
    { id: 'all', label: 'الكل', count: summaryStats.totalQty, activeColor: 'bg-orange-600 text-white border-orange-500' },
    { id: 'inspection', label: 'فحص واستلام', count: summaryStats.inspectionQty, activeColor: 'bg-amber-600 text-white border-amber-500' },
    { id: 'approval', label: 'موافقة وقطع', count: summaryStats.approvalQty, activeColor: 'bg-cyan-600 text-white border-cyan-500' },
    { id: 'maintenance', label: 'قيد الصيانة', count: summaryStats.maintenanceQty, activeColor: 'bg-indigo-600 text-white border-indigo-500' },
    { id: 'ready', label: 'جاهز للتسليم', count: summaryStats.readyQty, activeColor: 'bg-emerald-600 text-white border-emerald-500' },
    { id: 'returns', label: 'مرتجعات ضمان', count: summaryStats.returnsQty, activeColor: 'bg-purple-600 text-white border-purple-500' },
    { id: 'delayed', label: 'متأخرة (+7 أيام)', count: summaryStats.delayedQty, activeColor: 'bg-rose-600 text-white border-rose-500' }
  ];

  return (
    <div className="space-y-4 pb-24 md:pb-6 text-right pt-2 font-cairo" dir="rtl">
      {/* Top Bar: Back + Title + Print Inventory Sheet */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1a1a1a] p-3 rounded-2xl border border-white/5 shadow-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setInventoryMode('hub')}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold transition-all border border-white/10 cursor-pointer"
          >
            <ArrowRight size={16} />
            <span>العودة لأقسام المخزون</span>
          </button>
          <div className="hidden sm:flex items-center gap-2">
            <Smartphone size={18} className="text-orange-400" />
            <h2 className="text-sm font-black text-white">مخزون أجهزة العملاء في المحل</h2>
          </div>
        </div>

        {canPrint && (
          <button
            type="button"
            disabled={processedEntries.length === 0}
            onClick={handlePrintInventoryReport}
            className="flex items-center gap-2 px-3.5 py-2 bg-orange-600/15 hover:bg-orange-600 text-orange-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-black transition-all border border-orange-500/30 cursor-pointer"
          >
            <Printer size={15} />
            <span>طباعة كشف الجرد ({filteredTotalQty})</span>
          </button>
        )}
      </div>

      {/* 1. Summary Strip Card */}
      <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl p-3 sm:p-4 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <Boxes size={18} />
            </div>
            <div>
              <span className="text-xs text-gray-400 block font-bold">إجمالي الأجهزة المتواجدة حالياً بالمحل</span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-black font-mono text-white">{summaryStats.totalQty}</span>
                <span className="text-[11px] text-gray-400 font-bold">جهاز ({summaryStats.totalRows} بند)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {summaryStats.returnsQty > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab(activeTab === 'returns' ? 'all' : 'returns');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                  activeTab === 'returns'
                    ? 'bg-purple-600 text-white border-purple-500'
                    : 'bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/20'
                }`}
              >
                <RotateCcw size={13} />
                <span>مرتجعات ضمان: {summaryStats.returnsQty}</span>
              </button>
            )}
            {summaryStats.delayedQty > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab(activeTab === 'delayed' ? 'all' : 'delayed');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                  activeTab === 'delayed'
                    ? 'bg-rose-600 text-white border-rose-500'
                    : 'bg-rose-500/10 text-rose-300 border-rose-500/20 hover:bg-rose-500/20'
                }`}
              >
                <AlertTriangle size={13} />
                <span>متأخرة (+7 أيام): {summaryStats.delayedQty}</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Operational Stage Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'inspection' ? 'all' : 'inspection');
              setCurrentPage(1);
            }}
            className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
              activeTab === 'inspection'
                ? 'bg-amber-500/15 border-amber-500/40'
                : 'bg-black/30 border-white/5 hover:border-amber-500/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-300">الفحص والاستلام</span>
              <Search size={14} className="text-amber-400" />
            </div>
            <div className="text-lg font-black font-mono text-amber-400 mt-1">{summaryStats.inspectionQty}</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'approval' ? 'all' : 'approval');
              setCurrentPage(1);
            }}
            className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
              activeTab === 'approval'
                ? 'bg-cyan-500/15 border-cyan-500/40'
                : 'bg-black/30 border-white/5 hover:border-cyan-500/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-300">الموافقة والقطع</span>
              <Clock size={14} className="text-cyan-400" />
            </div>
            <div className="text-lg font-black font-mono text-cyan-400 mt-1">{summaryStats.approvalQty}</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'maintenance' ? 'all' : 'maintenance');
              setCurrentPage(1);
            }}
            className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
              activeTab === 'maintenance'
                ? 'bg-indigo-500/15 border-indigo-500/40'
                : 'bg-black/30 border-white/5 hover:border-indigo-500/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-300">قيد الصيانة</span>
              <Wrench size={14} className="text-indigo-400" />
            </div>
            <div className="text-lg font-black font-mono text-indigo-400 mt-1">{summaryStats.maintenanceQty}</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'ready' ? 'all' : 'ready');
              setCurrentPage(1);
            }}
            className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
              activeTab === 'ready'
                ? 'bg-emerald-500/15 border-emerald-500/40'
                : 'bg-black/30 border-white/5 hover:border-emerald-500/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-300">جاهز للتسليم</span>
              <CheckCircle2 size={14} className="text-emerald-400" />
            </div>
            <div className="text-lg font-black font-mono text-emerald-400 mt-1">{summaryStats.readyQty}</div>
          </button>
        </div>
      </div>

      {/* 2. Quick Tabs + Search + Dropdown Filters + Grouping + Sort */}
      <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl p-3 space-y-3 shadow-lg relative">
        {/* Stage Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          {stageTabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? tab.activeColor
                    : 'bg-black/30 text-gray-300 border-white/10 hover:bg-white/5'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`font-mono text-[10px] px-1.5 py-0.2 rounded-md ${isActive ? 'bg-black/25 text-white' : 'bg-white/5 text-gray-400'}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Secondary Controls Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-end">
          {/* Smart Search Box */}
          <div className="lg:col-span-5 space-y-1 relative" ref={smartSearchRef}>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold text-orange-400 flex items-center gap-1">
                <Sparkles size={11} />
                <span>بحث ذكي (عميل، فاتورة، جهاز، مهندس، عطل، قطعة، سيريال، حالة):</span>
              </label>
              {search.trim() !== '' && (
                <span className="text-[10px] font-mono font-bold text-gray-400">
                  {processedEntries.length} نتيجة
                </span>
              )}
            </div>
            <div className="relative">
              <input
                ref={smartSearchInputRef}
                type="text"
                placeholder="مثال: أحمد ميكروتيك، 105، جاهز، أو اسم قطعة..."
                value={search}
                onFocus={() => {
                  if (search.trim().length > 0) setIsSmartSearchOpen(true);
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearch(val);
                  setIsSmartSearchOpen(val.trim().length > 0);
                  setCurrentPage(1);
                }}
                onKeyDown={(e) => {
                  if (!isSmartSearchOpen || smartSuggestions.length === 0) {
                    if (e.key === 'Escape') setIsSmartSearchOpen(false);
                    return;
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedSuggestionIdx(prev => (prev + 1) % smartSuggestions.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedSuggestionIdx(prev => (prev - 1 + smartSuggestions.length) % smartSuggestions.length);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const picked = smartSuggestions[highlightedSuggestionIdx];
                    if (picked) handleSelectSmartSuggestion(picked);
                  } else if (e.key === 'Escape') {
                    setIsSmartSearchOpen(false);
                  }
                }}
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-10 py-2.5 focus:border-orange-500 outline-none transition-all text-xs font-bold text-white text-right"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-orange-400" size={16} />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setIsSmartSearchOpen(false);
                    setCurrentPage(1);
                    smartSearchInputRef.current?.focus();
                  }}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white cursor-pointer"
                  title="مسح البحث"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Instant Smart Suggestions Dropdown */}
            {isSmartSearchOpen && search.trim().length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1.5 bg-[#161616] border border-white/10 rounded-2xl shadow-2xl p-1.5 max-h-72 overflow-y-auto space-y-1">
                {smartSuggestions.length > 0 ? (
                  smartSuggestions.map((sg, idx) => {
                    const isHighlighted = idx === highlightedSuggestionIdx;
                    const kindBadge =
                      sg.kind === 'technician'
                        ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                        : sg.kind === 'deviceType'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : sg.kind === 'customer'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : sg.kind === 'invoice'
                        ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
                        : 'bg-purple-500/15 text-purple-300 border-purple-500/30';
                    const kindText =
                      sg.kind === 'technician'
                        ? 'مهندس'
                        : sg.kind === 'deviceType'
                        ? 'نوع'
                        : sg.kind === 'customer'
                        ? 'عميل'
                        : sg.kind === 'invoice'
                        ? 'فاتورة'
                        : 'جهاز';

                    return (
                      <button
                        key={sg.id}
                        type="button"
                        onMouseEnter={() => setHighlightedSuggestionIdx(idx)}
                        onClick={() => handleSelectSmartSuggestion(sg)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-right transition-all cursor-pointer ${
                          isHighlighted ? 'bg-orange-600/20 border border-orange-500/40' : 'hover:bg-white/5 border border-transparent'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border shrink-0 ${kindBadge}`}>
                              {kindText}
                            </span>
                            <span className="text-xs font-bold text-white truncate">{sg.label}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">{sg.meta}</div>
                        </div>
                        <CornerDownLeft size={13} className={isHighlighted ? 'text-orange-400 shrink-0' : 'text-gray-600 shrink-0'} />
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-center text-[11px] text-gray-500 font-bold">
                    لا توجد اقتراحات مطابقة لـ «{search}»
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Engineer Quick Filter */}
          <div className="lg:col-span-2 space-y-1">
            <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
              <Filter size={11} /> المهندس:
            </label>
            <select
              value={selectedTechnician}
              onChange={(e) => {
                setSelectedTechnician(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-orange-500 cursor-pointer"
            >
              <option value="all" className="bg-[#1a1a1a]">كل المهندسين</option>
              <option value="__unassigned__" className="bg-[#1a1a1a]">غير مسند لمهندس</option>
              {technicianOptions.map(tech => (
                <option key={tech} value={tech} className="bg-[#1a1a1a]">{tech}</option>
              ))}
            </select>
          </div>

          {/* Device Type Quick Filter */}
          <div className="lg:col-span-2 space-y-1">
            <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
              <Smartphone size={11} /> نوع الجهاز:
            </label>
            <select
              value={selectedDeviceType}
              onChange={(e) => {
                setSelectedDeviceType(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-orange-500 cursor-pointer"
            >
              <option value="all" className="bg-[#1a1a1a]">كل الأنواع</option>
              {deviceTypeOptions.map(dt => (
                <option key={dt} value={dt} className="bg-[#1a1a1a]">{dt}</option>
              ))}
            </select>
          </div>

          {/* Grouping Mode Selector + Sort Dropdown */}
          <div className="lg:col-span-3 flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
                <Layers size={11} /> تجميع العرض:
              </label>
              <select
                value={groupBy}
                onChange={(e) => {
                  setGroupBy(e.target.value as GroupByMode);
                  setCollapsedGroups({});
                  setCurrentPage(1);
                }}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-orange-500 cursor-pointer"
              >
                <option value="none" className="bg-[#1a1a1a]">بدون تجميع (قائمة)</option>
                <option value="stage" className="bg-[#1a1a1a]">تجميع حسب المرحلة</option>
                <option value="technician" className="bg-[#1a1a1a]">تجميع حسب المهندس</option>
                <option value="customer" className="bg-[#1a1a1a]">تجميع حسب العميل والفاتورة</option>
              </select>
            </div>

            <div className="relative" ref={filterDropdownRef}>
              <button
                type="button"
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                className={`p-2.5 rounded-xl transition-all border flex items-center justify-center cursor-pointer shadow-lg ${
                  showFilterDropdown || filterType !== 'invoice'
                    ? 'bg-orange-600 text-white border-orange-500 shadow-orange-600/20'
                    : 'bg-white/5 hover:bg-orange-600/20 text-gray-400 hover:text-orange-500 border-white/10 hover:border-orange-500/30'
                }`}
                title="خيارات الترتيب والفرز"
              >
                <ArrowUpDown size={18} />
              </button>

              {showFilterDropdown && (
                <div className="absolute z-50 left-0 mt-2 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl p-1.5 w-56">
                  <div className="px-3 py-1 text-[10px] font-bold text-gray-400 border-b border-white/5 mb-1">
                    خيارات الترتيب
                  </div>
                  <button onClick={() => setFilterAndSort('invoice', 'desc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'invoice' && sortDir === 'desc' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    رقم الفاتورة (الأحدث أولاً)
                  </button>
                  <button onClick={() => setFilterAndSort('invoice', 'asc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'invoice' && sortDir === 'asc' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    رقم الفاتورة (الأقدم أولاً)
                  </button>
                  <button onClick={() => setFilterAndSort('daysInShop', 'desc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'daysInShop' && sortDir === 'desc' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    الأكثر بقاءً في المحل أولاً
                  </button>
                  <button onClick={() => setFilterAndSort('status', 'asc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'status' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    حسب الحالة (المسار التشغيلي)
                  </button>
                  <button onClick={() => setFilterAndSort('customerName', 'asc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'customerName' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    اسم العميل (أبجدي)
                  </button>
                  <button onClick={() => setFilterAndSort('deviceType', 'asc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'deviceType' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    نوع الجهاز (أبجدي)
                  </button>
                  <button onClick={() => setFilterAndSort('technician', 'asc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'technician' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    اسم المهندس (أبجدي)
                  </button>
                  <button onClick={() => setFilterAndSort('quantity', 'desc')} className={`w-full text-right px-3 py-1.5 text-[11px] hover:bg-orange-600 hover:text-white rounded font-bold transition-colors ${filterType === 'quantity' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}>
                    حسب الكمية الأعلى
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Active filter reset indicator */}
        {(activeTab !== 'all' || selectedTechnician !== 'all' || selectedDeviceType !== 'all' || search.trim() !== '') && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-gray-400 border-t border-white/5">
            <span>
              النتائج المطابقة: <strong className="text-white font-mono">{processedEntries.length}</strong> بند (بإجمالي <strong className="text-orange-400 font-mono">{filteredTotalQty}</strong> جهاز)
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveTab('all');
                setSelectedTechnician('all');
                setSelectedDeviceType('all');
                setSearch('');
                setCurrentPage(1);
              }}
              className="text-orange-400 hover:text-orange-300 font-bold cursor-pointer"
            >
              إعادة ضبط الفلاتر
            </button>
          </div>
        )}
      </div>

      {/* 3. Main Content: Grouped or Flat Table */}
      {processedEntries.length === 0 && !loading ? (
        <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl px-6 py-16 text-center text-gray-500 shadow-xl">
          <div className="flex flex-col items-center gap-3">
            <AlertCircle size={40} className="text-gray-600" />
            <p className="font-bold text-sm text-gray-400">لا توجد أجهزة مطابقة لمعايير البحث أو التصفية الحالية.</p>
          </div>
        </div>
      ) : groupBy !== 'none' ? (
        <div className="space-y-3">
          {groupedEntries.map(group => {
            const isCollapsed = Boolean(collapsedGroups[group.key]);
            return (
              <div key={group.key} className="bg-[#1a1a1a] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(group.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] border-b border-white/5 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`text-xs font-black px-3 py-1 rounded-xl border ${group.badgeClass}`}>
                      {group.label}
                    </span>
                    <span className="text-[11px] font-bold text-gray-400">
                      ({group.entries.length} بند — {group.totalQty} جهاز)
                    </span>
                  </div>
                  {isCollapsed ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronUp size={18} className="text-gray-400" />}
                </button>
                {!isCollapsed && renderTableBlock(group.entries)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
          {renderTableBlock(currentEntries)}

          {/* Pagination */}
          {processedEntries.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-white/5 bg-black/30">
              <div className="flex items-center gap-2">
                <span className="text-xs text-orange-400 font-bold">التنقل بين الصفحات:</span>
                <span className="text-xs text-gray-400 font-bold">
                  عرض {(safeCurrentPage - 1) * itemsPerPage + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, processedEntries.length)} من أصل {processedEntries.length} بند ({filteredTotalQty} جهاز)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 rounded-lg transition-all cursor-pointer text-white"
                >
                  السابق
                </button>
                <div className="flex items-center gap-1 mx-2">
                  <span className="text-sm font-bold text-orange-400 font-mono">{safeCurrentPage}</span>
                  <span className="text-xs text-gray-500">من</span>
                  <span className="text-sm font-bold text-white font-mono">{totalPages}</span>
                </div>
                <button
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 rounded-lg transition-all cursor-pointer text-white"
                >
                  التالي
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Quick Device Details Modal (Read-only tracking & audit) */}
      <AnimatePresence>
        {selectedDetailEntry && (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
            dir="rtl"
            onClick={() => setSelectedDetailEntry(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-[#161616] border border-white/10 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between gap-3 p-4 sm:p-5 bg-white/[0.03] border-b border-white/10">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 rounded-2xl bg-orange-500/10 text-orange-400 border border-orange-500/20 shrink-0">
                    <Smartphone size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-black text-white truncate">
                        {selectedDetailEntry.item.deviceType || 'جهاز غير محدد'}
                        {selectedDetailEntry.item.deviceName ? ` — ${selectedDetailEntry.item.deviceName}` : ''}
                      </h3>
                      <span className="font-mono font-black text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-lg">
                        #{selectedDetailEntry.invoiceNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <StatusBadge item={selectedDetailEntry.item} />
                      {selectedDetailEntry.isWarrantyReturn && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
                          مرتجع ضمان {selectedDetailEntry.item.linkedOldInvoiceNumber ? `(من فاتورة #${selectedDetailEntry.item.linkedOldInvoiceNumber})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetailEntry(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
                {/* Customer & Dates Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-black/30 border border-white/5 rounded-2xl p-3.5 space-y-2">
                    <div className="text-[11px] font-black text-gray-400 flex items-center gap-1.5">
                      <UserIcon size={13} className="text-orange-400" /> بيانات العميل
                    </div>
                    <div className="font-black text-sm text-white">{selectedDetailEntry.customerName}</div>
                    {selectedDetailEntry.customerPhone ? (
                      <a
                        href={`tel:${selectedDetailEntry.customerPhone}`}
                        className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-mono font-bold text-xs"
                      >
                        <Phone size={12} /> {selectedDetailEntry.customerPhone}
                      </a>
                    ) : (
                      <span className="text-gray-500 block">لا يوجد رقم هاتف</span>
                    )}
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-2xl p-3.5 space-y-2">
                    <div className="text-[11px] font-black text-gray-400 flex items-center gap-1.5">
                      <Calendar size={13} className="text-blue-400" /> المتابعة والمدة بالمحل
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-gray-500 block">تاريخ الدخول</span>
                        <span className="font-mono font-bold text-white">{selectedDetailEntry.entryDateLabel}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">المدة في المحل</span>
                        <span className={`font-bold ${selectedDetailEntry.isDelayed ? 'text-amber-400' : 'text-white'}`}>
                          {selectedDetailEntry.daysInShop === 0 ? 'اليوم' : `${selectedDetailEntry.daysInShop} يوم`}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">المهندس المسؤول</span>
                        <span className="font-bold text-blue-300">{selectedDetailEntry.item.technician || 'غير مسند'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">المستلم / الكمية</span>
                        <span className="font-bold text-gray-200">
                          {selectedDetailEntry.item.createdBy || '---'} ({selectedDetailEntry.qty})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fault & Technical Reports */}
                <div className="bg-black/30 border border-white/5 rounded-2xl p-3.5 space-y-3">
                  <div className="text-[11px] font-black text-gray-400 flex items-center gap-1.5">
                    <FileText size={13} className="text-purple-400" /> الشكوى والتقارير الفنية
                  </div>
                  {selectedDetailEntry.serial && (
                    <div className="text-[11px] text-gray-300">
                      <span className="text-gray-500 font-bold">السيريال (SN): </span>
                      <span className="font-mono text-white font-bold">{selectedDetailEntry.serial}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-[10px] text-gray-500 block">وصف العطل / شكوى العميل:</span>
                    <p className="text-gray-200 font-bold mt-0.5">
                      {selectedDetailEntry.item.customerProblem || selectedDetailEntry.item.faultType || 'غير مسجل'}
                    </p>
                  </div>
                  {selectedDetailEntry.item.engineerReport && (
                    <div>
                      <span className="text-[10px] text-gray-500 block">التقرير الفني للمهندس:</span>
                      <p className="text-blue-200 font-bold mt-0.5">{selectedDetailEntry.item.engineerReport}</p>
                    </div>
                  )}
                  {selectedDetailEntry.item.failureReason && (
                    <div>
                      <span className="text-[10px] text-rose-400 block">سبب التعذر / الرفض / الإلغاء:</span>
                      <p className="text-rose-200 font-bold mt-0.5">{selectedDetailEntry.item.failureReason}</p>
                    </div>
                  )}
                  {(selectedDetailEntry.item.deviceNotes || selectedDetailEntry.item.technicalNotes) && (
                    <div>
                      <span className="text-[10px] text-gray-500 block">ملاحظات إضافية:</span>
                      <p className="text-gray-300 mt-0.5">
                        {selectedDetailEntry.item.technicalNotes || selectedDetailEntry.item.deviceNotes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Parts Used & Cost Summary */}
                <div className="bg-black/30 border border-white/5 rounded-2xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-gray-400 flex items-center gap-1.5">
                      <Cpu size={13} className="text-emerald-400" /> قطع الغيار والتكلفة
                    </span>
                    <span className="font-mono font-black text-sm text-emerald-400">
                      {(Number(selectedDetailEntry.item.cost) || 0).toLocaleString('en-US')} {getCurrencySymbol(selectedDetailEntry.currency)}
                    </span>
                  </div>

                  {Array.isArray(selectedDetailEntry.item.partsUsed) && selectedDetailEntry.item.partsUsed.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      {selectedDetailEntry.item.partsUsed.map((part, pIdx) => (
                        <div
                          key={`${part.partId || part.partName}-${pIdx}`}
                          className="flex items-center justify-between px-2.5 py-1.5 bg-white/5 rounded-xl border border-white/5 text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{part.partName}</span>
                            {part.isScrap && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                                تشليح
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-gray-300">
                            {part.quantity} × {(Number(part.unitSalePrice) || 0).toLocaleString('en-US')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-500">لا توجد قطع غيار مسجلة لهذا الجهاز.</p>
                  )}
                </div>
              </div>

              <div className="p-3.5 bg-white/[0.02] border-t border-white/10 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedDetailEntry(null)}
                  className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-black transition-colors cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Print Preview Overlay for Inventory Report */}
      {printPreviewData && (
        <PrintPreviewOverlay
          type={printPreviewData.type}
          data={printPreviewData.data}
          onClose={() => setPrintPreviewData(null)}
          shopConfig={shopConfig}
          user={user}
        />
      )}
    </div>
  );
}

function StatusBadge({ item }: { item: InvoiceItem }) {
  const meta = getArabicStatusMeta(item);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${meta.badgeClass} ${meta.textClass}`}>
      {meta.label}
    </span>
  );
}
