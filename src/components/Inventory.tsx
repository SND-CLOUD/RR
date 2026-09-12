import { useBackHandler } from '../hooks/useBackHandler';
import { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Wrench, 
  CheckCircle2, 
  Package, 
  ArrowUpDown,
  AlertCircle,
  AlertTriangle,
  Clock,
  Plus,
  ShieldAlert,
  Smartphone,
  Boxes,
  ArrowRight,
  ChevronLeft,
  BookOpen
} from 'lucide-react';
import { collection, query, onSnapshot } from '../firebase';
import { db } from '../firebase';
import { InvoiceItem, User, isInShopMaintenanceDevice } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import MaintenanceActionForm from './MaintenanceActionForm';
import ShopPartsStockView from './ShopPartsStockView';
import PartsCatalogTable from './PartsCatalogTable';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../hooks/usePermissions';

type InventorySortType = 'invoice' | 'deviceType' | 'deviceName' | 'status' | 'quantity' | 'technician';
type InventoryMode = 'hub' | 'parts_stock' | 'catalog' | 'devices_stock';

const STATUS_CONFIG = {
  // New unified status codes
  '10': { label: 'New Entry', color: 'bg-blue-500/10 text-blue-500', icon: <Clock size={14} /> },
  '20': { label: 'Under Inspection', color: 'bg-amber-500/10 text-amber-500', icon: <Search size={14} /> },
  '30': { label: 'Awaiting Customer/Parts', color: 'bg-cyan-500/10 text-cyan-500', icon: <Clock size={14} /> },
  '40': { label: 'Under Repair', color: 'bg-indigo-500/10 text-indigo-500', icon: <Wrench size={14} /> },
  '50': { label: 'Ready', color: 'bg-emerald-500/10 text-emerald-500', icon: <CheckCircle2 size={14} /> },
  '60': { label: 'Delivered', color: 'bg-gray-500/10 text-gray-400', icon: <Package size={14} /> },
  '70': { label: 'Cancelled', color: 'bg-rose-500/10 text-rose-500', icon: <AlertTriangle size={14} /> },
  // Legacy status mapping (for backwards compatibility)
  new: { label: 'New', color: 'bg-blue-500/10 text-blue-500', icon: <Clock size={14} /> },
  inspected: { label: 'Inspected', color: 'bg-amber-500/10 text-amber-500', icon: <Search size={14} /> },
  testing: { label: 'In Testing', color: 'bg-amber-500/10 text-amber-500', icon: <Search size={14} /> },
  repairing: { label: 'Repairing', color: 'bg-indigo-500/10 text-indigo-500', icon: <Wrench size={14} /> },
  ready: { label: 'Ready', color: 'bg-emerald-500/10 text-emerald-500', icon: <CheckCircle2 size={14} /> },
  intact: { label: 'Intact', color: 'bg-emerald-500/10 text-emerald-500', icon: <CheckCircle2 size={14} /> },
  unrepairable: { label: 'Unrepairable', color: 'bg-red-500/10 text-red-500', icon: <AlertTriangle size={14} /> },
  refused: { label: 'Refused', color: 'bg-red-400/10 text-red-400', icon: <AlertTriangle size={14} /> },
  delivered: { label: 'Delivered', color: 'bg-gray-500/10 text-gray-400', icon: <Package size={14} /> },
};

const STATUS_HIERARCHY: Record<string, number> = {
  '10': 10, 'new': 10,
  '20': 20, 'inspected': 20, 'testing': 20,
  '30': 30,
  '40': 40, 'repairing': 40,
  '50': 50, 'ready': 50, 'intact': 50,
  '60': 60, 'delivered': 60,
  '70': 70, 'cancelled': 70, 'unrepairable': 70, 'refused': 70
};

export default function Inventory({ user, onBack }: { user: User, onBack?: () => void }) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions(user);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [partsCount, setPartsCount] = useState<number>(0);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Main screen section mode (hub = two buttons, parts_stock, devices_stock)
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>('hub');
  
  // Sorting & Filtering controls (matching Customers.tsx mechanism)
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [filterType, setFilterType] = useState<InventorySortType>('invoice');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const canAdd = hasPermission('inventory', 'add');
  const canEdit = hasPermission('inventory', 'edit');
  const canView = hasPermission('inventory', 'view');

  // Modal state
  const [isActionFormOpen, setIsActionFormOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useBackHandler(isActionFormOpen, () => {
    setIsActionFormOpen(false);
    setSelectedItemId(null);
  });

  useBackHandler(showFilterDropdown, () => {
    setShowFilterDropdown(false);
  });

  useBackHandler(inventoryMode !== 'hub' && !isActionFormOpen && !showFilterDropdown, () => {
    setInventoryMode('hub');
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
    };
    if (showFilterDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterDropdown]);

  // Pagination controls
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    // Fetch maintenance items
    const q = query(collection(db, 'invoice_items'));
    const unsubscribeItems = onSnapshot(q, (snapshot) => {
      setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceItem)));
      setLoading(false);
    }, (error) => {
      console.error("Firestore error:", error);
      setLoading(false);
    });

    // Fetch parts count for hub badge
    const unsubParts = onSnapshot(collection(db, 'shop_parts_inventory'), (snap) => {
      setPartsCount(snap.docs.length);
    }, (err) => {
      console.error("Parts count error:", err);
    });

    // Fetch parts catalog count for hub badge
    const unsubCatalog = onSnapshot(collection(db, 'parts_catalog'), (snap) => {
      setCatalogCount(snap.docs.length);
    }, (err) => {
      console.error("Catalog count error:", err);
    });

    return () => {
      unsubscribeItems();
      unsubParts();
      unsubCatalog();
    };
  }, []);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-gray-500 gap-4" dir="rtl">
        <ShieldAlert size={48} className="text-orange-500/50" />
        <h2 className="text-xl font-bold font-cairo">ليس لديك صلاحية لعرض هذا القسم</h2>
        <p className="text-sm">يرجى التواصل مع مسؤول النظام للمزيد من المعلومات</p>
      </div>
    );
  }

  const activeItems = items.filter(item => isInShopMaintenanceDevice(item));

  // Sort and filter processing
  const getProcessedItems = () => {
    let list = activeItems.filter(item => {
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      return (
        (item.deviceType?.toLowerCase() || '').includes(term) || 
        (item.deviceName?.toLowerCase() || '').includes(term) ||
        (item.invoiceNumber || '').includes(term) ||
        (item.createdBy?.toLowerCase() || '').includes(term) ||
        (item.technician?.toLowerCase() || '').includes(term)
      );
    });

    list.sort((a, b) => {
      if (filterType === 'invoice') {
        const numA = Number(a.invoiceNumber || 0);
        const numB = Number(b.invoiceNumber || 0);
        return sortDir === 'asc' ? numA - numB : numB - numA;
      } else if (filterType === 'deviceType') {
        const typeA = a.deviceType || '';
        const typeB = b.deviceType || '';
        return sortDir === 'asc'
          ? typeA.localeCompare(typeB, 'ar')
          : typeB.localeCompare(typeA, 'ar');
      } else if (filterType === 'deviceName') {
        const nameA = a.deviceName || '';
        const nameB = b.deviceName || '';
        return sortDir === 'asc'
          ? nameA.localeCompare(nameB, 'ar')
          : nameB.localeCompare(nameA, 'ar');
      } else if (filterType === 'status') {
        const orderA = STATUS_HIERARCHY[String(a.status)] || 99;
        const orderB = STATUS_HIERARCHY[String(b.status)] || 99;
        return sortDir === 'asc' ? orderA - orderB : orderB - orderA;
      } else if (filterType === 'quantity') {
        const qtyA = Number(a.quantity || 1);
        const qtyB = Number(b.quantity || 1);
        return sortDir === 'asc' ? qtyA - qtyB : qtyB - qtyA;
      } else if (filterType === 'technician') {
        const techA = a.technician || '';
        const techB = b.technician || '';
        return sortDir === 'asc'
          ? techA.localeCompare(techB, 'ar')
          : techB.localeCompare(techA, 'ar');
      }
      return 0;
    });

    return list;
  };

  const processedItems = getProcessedItems();

  const setFilterAndSort = (type: InventorySortType, dir: 'asc' | 'desc') => {
    setFilterType(type);
    setSortDir(dir);
    setShowFilterDropdown(false);
    setCurrentPage(1);
  };

  const handleHeaderClick = (type: InventorySortType) => {
    if (filterType === type) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setFilterType(type);
      if (type === 'invoice' || type === 'quantity') {
        setSortDir('desc');
      } else {
        setSortDir('asc');
      }
    }
    setCurrentPage(1);
  };

  const renderSortArrow = (type: InventorySortType) => {
    if (filterType !== type) return null;
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const totalPages = Math.max(1, Math.ceil(processedItems.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const currentItems = processedItems.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);

  // 1. HUB VIEW: Two sleek options matching categories-engineers main page
  if (inventoryMode === 'hub') {
    return (
      <div className="space-y-6 pb-8 text-right font-cairo max-w-2xl mx-auto pt-4 px-2 sm:px-0" dir="rtl">
        {/* Header Intro */}
        <div className="text-center space-y-2 py-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-600/10 text-orange-500 border border-orange-500/20 mb-1">
            <Boxes size={22} />
          </div>
          <h1 className="text-lg sm:text-xl font-black text-white">أقسام وإدارة المخزون</h1>
          <p className="text-xs text-gray-400 font-medium max-w-md mx-auto">
            اختر القسم المطلوب لإدارة مخزون ودليل القطع والملحقات أو جرد أجهزة صيانة العملاء
          </p>
        </div>

        {/* The Main Buttons */}
        <div className="grid grid-cols-1 gap-4">
          {/* 1. Parts & Accessories Stock Option */}
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

          {/* 2. Parts & Accessories Catalog Option */}
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

          {/* 3. Client Devices In Shop Option */}
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
                    {activeItems.length} جهاز
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

  // 2. PARTS & ACCESSORIES CATALOG VIEW
  if (inventoryMode === 'catalog') {
    return (
      <div className="space-y-4 pb-24 md:pb-6 text-right pt-2" dir="rtl">
        {/* Navigation Top Bar */}
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

        {/* Render the Parts Catalog Module */}
        <PartsCatalogTable />
      </div>
    );
  }

  // 2. PARTS & ACCESSORIES STOCK VIEW
  if (inventoryMode === 'parts_stock') {
    return (
      <div className="space-y-4 pb-24 md:pb-6 text-right pt-2" dir="rtl">
        {/* Navigation Top Bar */}
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

        {/* Render the Parts and Accessories Stock Module */}
        <ShopPartsStockView />
      </div>
    );
  }

  // 3. IN-SHOP CLIENT DEVICES STOCK VIEW (Previous/Old Inventory view)
  return (
    <div className="space-y-4 pb-24 md:pb-6 text-right pt-2" dir="rtl">
      {/* Navigation Top Bar */}
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

      {isActionFormOpen && (
        <MaintenanceActionForm 
          user={user}
          onClose={() => setIsActionFormOpen(false)} 
          availableItems={activeItems}
          preSelectedItemId={selectedItemId}
        />
      )}

      <div className="bg-[#1a1a1a] border-y border-white/5 mx-0 my-0 relative">
        <div className="flex items-center gap-3 py-3 px-2 sm:px-3">
          <div className="flex-1 space-y-1 relative">
            <label className="text-[10px] font-bold text-gray-500 block">البحث برقم الفاتورة أو نوع الجهاز أو اسم الجهاز أو المهندس:</label>
            <div className="relative">
              <input 
                type="text" 
                placeholder="ابحث برقم الفاتورة، نوع الجهاز، اسم الجهاز، المهندس..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-black/40 border border-white/10 rounded-2xl pl-4 pr-11 py-3 focus:border-orange-500 outline-none transition-all text-sm font-bold text-white text-right"
              />
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            </div>
          </div>

          {/* Filter Dropdown placed where the + button was */}
          <div className="relative mt-5" ref={filterDropdownRef}>
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className={`p-3 rounded-xl transition-all border flex items-center justify-center cursor-pointer shadow-lg ${
                showFilterDropdown || filterType !== 'invoice'
                  ? 'bg-orange-600 text-white border-orange-500 shadow-orange-600/20'
                  : 'bg-white/5 hover:bg-orange-600/20 text-gray-400 hover:text-orange-500 border-white/10 hover:border-orange-500/30'
              }`}
              title="خيارات الترتيب والفرز"
            >
              <ArrowUpDown size={20} />
            </button>

            {showFilterDropdown && (
              <div className="absolute z-50 left-0 mt-2 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl p-1.5 w-52">
                <div className="px-3 py-1 text-[9px] font-bold text-gray-400 border-b border-white/5 mb-1">
                  خيارات الترتيب
                </div>
                <button 
                  onClick={() => setFilterAndSort('invoice', 'desc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'invoice' && sortDir === 'desc' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  رقم الفاتورة (الأحدث أولاً)
                </button>
                <button 
                  onClick={() => setFilterAndSort('invoice', 'asc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'invoice' && sortDir === 'asc' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  رقم الفاتورة (الأقدم أولاً)
                </button>
                <button 
                  onClick={() => setFilterAndSort('deviceType', 'asc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'deviceType' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  نوع الجهاز (أبجدي)
                </button>
                <button 
                  onClick={() => setFilterAndSort('deviceName', 'asc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'deviceName' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  إسم الجهاز (أبجدي)
                </button>
                <button 
                  onClick={() => setFilterAndSort('status', 'asc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'status' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  حسب الحالة (المسار التشغيلي)
                </button>
                <button 
                  onClick={() => setFilterAndSort('quantity', 'desc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'quantity' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  حسب الكمية الأعلى
                </button>
                <button 
                  onClick={() => setFilterAndSort('technician', 'asc')} 
                  className={`w-full text-right px-3 py-1.5 text-[10px] hover:bg-orange-600 hover:text-white rounded font-bold font-cairo transition-colors ${filterType === 'technician' ? 'bg-orange-600/20 text-orange-400' : 'text-slate-300'}`}
                >
                  إسم المهندس (أبجدي)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-[#1a1a1a] border-y border-white/5 mx-0 shadow-2xl">
        {/* The Horizontally & Vertically Scrollable Table Container */}
        <div className="w-full overflow-x-auto overflow-y-auto max-h-[55vh] sm:max-h-[60vh] scrollbar-thin overscroll-contain touch-pan-x touch-pan-y border-b border-white/5">
          <table className="w-full min-w-[680px] sm:min-w-[760px] text-right border-collapse select-none">
            <thead className="sticky top-0 z-10 bg-[#161616] shadow-sm">
              <tr className="bg-white/5 border-b border-white/10 text-gray-400 text-[9px] sm:text-[10px]">
                <th 
                  onClick={() => handleHeaderClick('deviceType')}
                  className="px-2.5 py-2 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all select-none"
                >
                  {t('inventory.deviceType', 'نوع الجهاز')}{renderSortArrow('deviceType')}
                </th>
                <th 
                  onClick={() => handleHeaderClick('deviceName')}
                  className="px-2.5 py-2 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all select-none"
                >
                  اسم الجهاز{renderSortArrow('deviceName')}
                </th>
                <th 
                  onClick={() => handleHeaderClick('invoice')}
                  className="px-2 py-2 font-bold whitespace-nowrap text-center cursor-pointer hover:bg-white/10 hover:text-white transition-all select-none"
                >
                  {t('inventory.invoiceNumber', 'رقم الفاتورة')}{renderSortArrow('invoice')}
                </th>
                <th className="px-2 py-2 font-bold hidden sm:table-cell whitespace-nowrap">
                  {t('inventory.manager', 'المستلم')}
                </th>
                <th 
                  onClick={() => handleHeaderClick('technician')}
                  className="px-2 py-2 font-bold whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all select-none"
                >
                  {t('inventory.engineer', 'المهندس')}{renderSortArrow('technician')}
                </th>
                <th 
                  onClick={() => handleHeaderClick('quantity')}
                  className="px-2 py-2 font-bold text-center whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all select-none"
                >
                  {t('inventory.quantity', 'الكمية')}{renderSortArrow('quantity')}
                </th>
                <th 
                  onClick={() => handleHeaderClick('status')}
                  className="px-2 py-2 font-bold text-center whitespace-nowrap cursor-pointer hover:bg-white/10 hover:text-white transition-all select-none"
                >
                  {t('inventory.status', 'الحالة')}{renderSortArrow('status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300 text-[10px] sm:text-xs">
              <AnimatePresence>
                {currentItems.map((item) => (
                  <motion.tr 
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    key={item.id} 
                    className="hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-2.5 py-2">
                      <span className="font-bold text-[10px] sm:text-xs text-white truncate block max-w-[140px] sm:max-w-[180px]">
                        {item.deviceType || 'مجهول'}
                      </span>
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="font-bold text-[10px] sm:text-xs text-orange-400 truncate block max-w-[150px] sm:max-w-[200px]">
                        {item.deviceName || '---'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="font-mono text-gray-400 font-bold text-[9px] sm:text-[10px]">
                        {item.invoiceNumber || '---'}
                      </span>
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell text-gray-400 truncate max-w-[120px]">
                      {item.createdBy || '---'}
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-orange-400 font-bold truncate block max-w-[120px]">
                        {item.technician || '---'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="font-mono text-white font-bold">{item.quantity || 1}</span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex justify-center">
                        <StatusBadge status={item.status} />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {processedItems.length === 0 && !loading && (
          <div className="px-6 py-20 text-center text-gray-500">
            <div className="flex flex-col items-center gap-3">
              <AlertCircle size={40} className="text-gray-600" />
              <p>{t('inventory.noDevices', 'لا توجد أجهزة مطابقة حالياً.')}</p>
            </div>
          </div>
        )}
        
        {/* Pagination Controls - التنقل بين الصفحات */}
        {processedItems.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-white/5 bg-black/30">
            <div className="flex items-center gap-2">
              <span className="text-xs text-orange-400 font-bold font-cairo">
                التنقل بين الصفحات:
              </span>
              <span className="text-xs text-gray-400 font-bold font-cairo">
                عرض {((safeCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, processedItems.length)} من أصل {processedItems.length} جهاز
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-3 py-1.5 text-xs font-bold font-cairo bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 rounded-lg transition-all cursor-pointer text-white"
              >
                السابق
              </button>
              <div className="flex items-center gap-1 mx-2">
                <span className="text-sm font-bold text-orange-400 font-mono">{safeCurrentPage}</span>
                <span className="text-xs text-gray-500 font-cairo">من</span>
                <span className="text-sm font-bold text-white font-mono">{totalPages}</span>
              </div>
              <button
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-3 py-1.5 text-xs font-bold font-cairo bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 rounded-lg transition-all cursor-pointer text-white"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.new;
  const { t } = useTranslation();
  
  const textColor = config.color.split(' ').find(c => c.startsWith('text-')) || 'text-gray-400';

  return (
    <span className={`text-[10px] sm:text-xs font-bold ${textColor}`}>
      {t(`inventory.status_${status}`, config.label)}
    </span>
  );
}


