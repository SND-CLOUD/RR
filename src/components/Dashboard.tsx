import React, { useEffect, useState, useRef } from 'react';
import { parseTxDate } from '../lib/dateUtils';
import { 
  FilePlus, 
  Package, 
  CheckCircle, 
  BarChart3, 
  Users, 
  Settings as SettingsIcon, 
  Database, 
  Search,
  ArrowUpRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  CircleDollarSign,
  X,
  Calendar,
  User as UserIcon,
  Tag,
  Cpu,
  MoreVertical,
  Smartphone,
  Layers,
  Wrench,
  Bell,
  ClipboardCheck,
  FileOutput,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText
} from 'lucide-react';
import { collection, query, where, getDocs, onSnapshot, orderBy } from '../firebase';
import { db } from '../firebase';
import { VaultTransaction, InvoiceItem, isInShopMaintenanceDevice, isShopMaintenanceItem, isPurchaseInvoice, isSaleInvoice } from '../types';
import { useTranslation } from 'react-i18next';

export default function Dashboard({ 
  onNavigate, 
  shopName, 
  fiscalYear,
  activeAlertsCount = 0,
  onShowAlerts = () => {},
  resetTrigger = 0
}: { 
  onNavigate: (tab: any, subView?: any) => void, 
  shopName?: string, 
  fiscalYear?: string,
  activeAlertsCount?: number,
  onShowAlerts?: () => void,
  resetTrigger?: number
}) {
  const { t } = useTranslation();
  const [vaultTotals, setVaultTotals] = useState<Record<string, number>>({
    RY: 0,
    SAR: 0,
    USD: 0
  });
  const [activeDevicesCount, setActiveDevicesCount] = useState(0);
  const [totalDevicesCount, setTotalDevicesCount] = useState(0);
  const [inspectionCount, setInspectionCount] = useState(0);
  const [approvalPartsCount, setApprovalPartsCount] = useState(0);
  const [maintenanceCount, setMaintenanceCount] = useState(0);
  const [exitReadyCount, setExitReadyCount] = useState(0);

  // Carousel state for interactive horizontal swipe
  const carouselRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number, y: number } | null>(null);
  const isSwipingRef = useRef(false);

  // Function to reset carousel back to the main counter (slide 0)
  const resetToMainCounter = () => {
    const doScroll = () => {
      if (!carouselRef.current) return;
      const container = carouselRef.current;
      const firstChild = container.children[0] as HTMLElement;
      if (firstChild) {
        firstChild.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest'
        });
      }
      try {
        container.scrollTo({ left: 0, behavior: 'smooth' });
      } catch (_) {}
    };

    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 80);
    setTimeout(doScroll, 220);
  };

  // Reset to main counter when resetTrigger changes
  useEffect(() => {
    resetToMainCounter();
  }, [resetTrigger]);

  // Listen to global reset events
  useEffect(() => {
    const handleResetEvent = () => {
      resetToMainCounter();
    };
    window.addEventListener('reset-dashboard-counter', handleResetEvent);
    return () => {
      window.removeEventListener('reset-dashboard-counter', handleResetEvent);
    };
  }, []);

  const [showHistory, setShowHistory] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<VaultTransaction[]>([]);
  
  // New Modals State
  const [showInventoryReportsModal, setShowInventoryReportsModal] = useState(false);
  const inventoryReportsModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (inventoryReportsModalRef.current && !inventoryReportsModalRef.current.contains(event.target as Node)) {
        setShowInventoryReportsModal(false);
      }
    }
    if (showInventoryReportsModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showInventoryReportsModal]);

  useEffect(() => {
    // Listen to all vault transactions
    const qVault = query(collection(db, 'vault_transactions'));
    const unsubscribeVault = onSnapshot(qVault, (s) => {
      const totals: Record<string, number> = { RY: 0, SAR: 0, USD: 0 };
      const txs = s.docs.map(d => ({ id: d.id, ...d.data() } as VaultTransaction));
      
      txs.forEach(tx => {
        if (totals[tx.currency] !== undefined) {
          totals[tx.currency] += Number(tx.amount);
        }
      });
      
      setVaultTotals(totals);
      setTransactions(txs.sort((a, b) => {
        const timeA = parseTxDate(a)?.getTime() || 0;
        const timeB = parseTxDate(b)?.getTime() || 0;
        return timeB - timeA;
      }));
    });

    // Listen to active & total devices (In-shop hardware maintenance only)
    let rawItems: InvoiceItem[] = [];
    let invoiceMap = new Map<string, any>();

    const updateCounts = () => {
      let activeCount = 0;
      let totalCount = 0;
      let inspection = 0;
      let approvalAndParts = 0;
      let maintenance = 0;
      let exitReady = 0;

      rawItems.forEach(data => {
        const inv = (data.invoiceId && invoiceMap.get(String(data.invoiceId))) ||
                    (data.invoiceNumber && invoiceMap.get(String(data.invoiceNumber).replace('#', '').trim())) ||
                    (data.invoiceNumber && invoiceMap.get(String(data.invoiceNumber))) ||
                    null;
        if (inv && (isPurchaseInvoice(inv) || isSaleInvoice(inv))) return;
        if (!isShopMaintenanceItem(data, inv)) return;

        const qty = Number(data.quantity) || 1;
        totalCount += qty;
        if (isInShopMaintenanceDevice(data, inv)) {
          activeCount += qty;

          const st = String(data.status || '').toLowerCase().trim();

          // 1. Inspection: 10, new, 20, 25, 21, 22, testing, inspected
          if (['10', 'new', '20', '25', '21', '22', 'testing', 'inspected'].includes(st)) {
            inspection += qty;
          }
          // 2. Awaiting Approval & Parts: 30, awaiting_approval, 35, awaiting_parts
          else if (['30', 'awaiting_approval', '35', 'awaiting_parts'].includes(st)) {
            approvalAndParts += qty;
          }
          // 3. Maintenance: 40, repairing
          else if (['40', 'repairing'].includes(st)) {
            maintenance += qty;
          }
          // 4. Exit / Ready: ready, unrepairable, intact, refused, 50, 70, cancelled
          else if (['ready', 'unrepairable', 'intact', 'refused', '50', '70', 'cancelled'].includes(st)) {
            exitReady += qty;
          }
        }
      });

      setActiveDevicesCount(activeCount);
      setTotalDevicesCount(totalCount);
      setInspectionCount(inspection);
      setApprovalPartsCount(approvalAndParts);
      setMaintenanceCount(maintenance);
      setExitReadyCount(exitReady);
    };

    const unsubscribeDevices = onSnapshot(collection(db, 'invoice_items'), (snapshot) => {
      rawItems = snapshot.docs.map(doc => doc.data() as InvoiceItem);
      updateCounts();
    });

    const unsubscribeInvoices = onSnapshot(collection(db, 'invoices'), (snapshot) => {
      invoiceMap.clear();
      snapshot.docs.forEach(doc => {
        const inv = { id: doc.id, ...doc.data() } as any;
        if (inv.id) invoiceMap.set(String(inv.id), inv);
        if (inv.invoiceNumber) {
          const rawNo = String(inv.invoiceNumber);
          const cleanNo = rawNo.replace('#', '').trim();
          invoiceMap.set(rawNo, inv);
          invoiceMap.set(cleanNo, inv);
        }
      });
      updateCounts();
    });

    return () => {
      unsubscribeVault();
      unsubscribeDevices();
      unsubscribeInvoices();
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    isSwipingRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartRef.current) return;
    const diffX = Math.abs(e.clientX - pointerStartRef.current.x);
    if (diffX > 8) {
      isSwipingRef.current = true;
    }
  };

  const handlePointerUp = () => {
    // Reset after microtask to prevent click triggering if swiped
    setTimeout(() => {
      pointerStartRef.current = null;
      isSwipingRef.current = false;
    }, 80);
  };

  const handleCardClick = (action: () => void) => {
    if (isSwipingRef.current) return;
    action();
  };

  const unifiedSlideTheme = {
    isSolidHero: true,
    cardClass: 'bg-gradient-to-br from-[#e66000] to-[#c2410c] text-white border-orange-500/20 theme-preserve-white',
    titleClass: 'text-white/90',
    countClass: 'text-white',
    labelClass: 'text-white/90',
    iconBg: 'bg-white/15 text-white'
  };

  const counterSlides = [
    {
      id: 'active',
      title: shopName || 'عالم الصيانة والتجارة',
      count: activeDevicesCount,
      label: 'الأجهزة النشطة في المحل',
      ...unifiedSlideTheme,
      icon: <Smartphone size={32} className="text-white" />,
      onClick: () => onNavigate('reports')
    },
    {
      id: 'inspection',
      title: 'إجراء الفحص الأولي',
      count: inspectionCount,
      label: 'أجهزة قيد أو بانتظار الفحص',
      ...unifiedSlideTheme,
      icon: <ClipboardCheck size={32} className="text-white" />,
      onClick: () => onNavigate('inspection')
    },
    {
      id: 'approval',
      title: 'انتظار الموافقة والقطع',
      count: approvalPartsCount,
      label: 'أجهزة بانتظار الموافقة أو توفير القطع',
      ...unifiedSlideTheme,
      icon: <Clock size={32} className="text-white" />,
      onClick: () => onNavigate('approval')
    },
    {
      id: 'maintenance',
      title: 'إجراء قسم الصيانة',
      count: maintenanceCount,
      label: 'أجهزة قيد الصيانة والإصلاح',
      ...unifiedSlideTheme,
      icon: <Wrench size={32} className="text-white" />,
      onClick: () => onNavigate('maintenance')
    },
    {
      id: 'exit',
      title: 'إجراء خروج الأجهزة',
      count: exitReadyCount,
      label: 'أجهزة جاهزة للتسليم والخروج',
      ...unifiedSlideTheme,
      icon: <CheckCircle2 size={32} className="text-white" />,
      onClick: () => onNavigate('device-exit')
    }
  ];

  return (
    <div className="space-y-4 pb-10">
      {/* Top Main Active Devices Multi-Counter Carousel */}
      <div 
        ref={carouselRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth rounded-3xl"
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch' 
        }}
        dir="rtl"
      >
        {counterSlides.map((slide, sIdx) => (
          <div 
            key={`dash-slide-${slide.id}-${sIdx}`}
            className="w-full min-w-full flex-shrink-0 snap-center"
          >
            <button 
              type="button"
              onClick={() => handleCardClick(slide.onClick)}
              className={`w-full ${slide.cardClass} p-6 md:p-8 rounded-3xl shadow-md border relative overflow-hidden flex flex-col items-center text-center hover:opacity-95 transition-all cursor-pointer select-none`}
            >
              {/* Top Title */}
              <h2 className={`text-base md:text-lg font-bold font-cairo mb-2 z-10 ${slide.titleClass}`}>
                {slide.title}
              </h2>

              {/* Main Counter Number & Icon */}
              <div className="flex items-center justify-center gap-3 my-1 z-10">
                <span className={`text-5xl md:text-6xl font-black tracking-widest tabular-nums ${slide.countClass}`}>
                  {slide.count}
                </span>
                <div className={`p-2.5 rounded-2xl ${slide.iconBg}`}>
                  {slide.icon}
                </div>
              </div>

              {/* Bottom Label */}
              <p className={`text-sm md:text-base font-bold mt-2 z-10 ${slide.labelClass}`}>
                {slide.label}
              </p>
            </button>
          </div>
        ))}
      </div>

      {/* Quick Search */}
      <div className="w-full pt-1">
        <button 
          onClick={() => onNavigate('search')}
          className="w-full bg-white dark:bg-[#161616] py-3.5 px-5 rounded-2xl border border-slate-200/90 dark:border-white/8 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1d1d1d] hover:border-orange-500/40 transition-all group shadow-sm text-slate-600 dark:text-gray-400 cursor-pointer"
        >
          <div className="flex items-center gap-3 flex-1 text-right"> 
            <span className="text-sm font-bold font-cairo">البحث السريع</span>
          </div>
          <Search size={20} className="text-slate-400 dark:text-gray-500 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors" />
        </button>
      </div>

      {/* Action Grid - 3x2 layout */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-4xl mx-auto pt-2">
        {/* Row 1 */}
        {/* 1. دخول أجهزة (Primary Brand Accent) */}
        <ActionCard 
          onClick={() => onNavigate('device-intake')}
          icon={<ArrowDownToLine size={24} className="md:w-7 md:h-7" />} 
          label="دخول أجهزة" 
          iconClass="bg-orange-600 text-white shadow-sm shadow-orange-600/20 theme-preserve-white"
          cardAccentClass="border-orange-500/30 dark:border-orange-500/25"
        />
        {/* 2. قسم الصيانة */}
        <ActionCard 
          onClick={() => onNavigate('device-movement')}
          icon={<SettingsIcon size={24} className="md:w-7 md:h-7" />} 
          label="قسم الصيانة" 
          iconClass="bg-orange-500/10 text-orange-600 dark:text-orange-400"
        />
        {/* 3. خروج أجهزة */}
        <ActionCard 
          onClick={() => onNavigate('device-exit')}
          icon={<ArrowUpFromLine size={24} className="md:w-7 md:h-7" />} 
          label="خروج أجهزة" 
          iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />

        {/* Row 2 */}
        {/* 1. الحسابات */}
        <ActionCard 
          onClick={() => onNavigate('vault')}
          icon={<CircleDollarSign size={24} className="md:w-7 md:h-7" />} 
          label="الحسابات" 
          iconClass="bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-200"
        />
        {/* 2. العملاء */}
        <ActionCard 
          onClick={() => onNavigate('customers')}
          icon={<Users size={24} className="md:w-7 md:h-7" />} 
          label="العملاء" 
          iconClass="bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-200"
        />
        {/* 3. أخرى */}
        <ActionCard 
          onClick={() => setShowInventoryReportsModal(true)}
          icon={<Layers size={24} className="md:w-7 md:h-7" />} 
          label="أخرى" 
          iconClass="bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-200"
        />
      </div>

      {/* Modals */}
      
      {/* Other Options Modal: خدمات أخرى + التقارير + المخزون + الفواتير */}
      {showInventoryReportsModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 dark:bg-black/75"
        >
          <div 
            ref={inventoryReportsModalRef}
            className="bg-white dark:bg-[#161616] rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-white/10 shadow-2xl relative"
          >
            <button 
              onClick={() => setShowInventoryReportsModal(false)}
              className="absolute top-4 left-4 p-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full text-slate-600 dark:text-gray-300 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-5 font-cairo text-center">خيارات وخدمات أخرى</h2>
            
            <div className="space-y-2.5">
              {/* Option 1: خدمات أخرى */}
              <button 
                onClick={() => {
                  setShowInventoryReportsModal(false);
                  localStorage.setItem('otherServicesTab', 'hub');
                  onNavigate('other-services');
                }}
                className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-800 dark:text-slate-100 p-3.5 rounded-2xl border border-slate-200/80 dark:border-white/8 hover:border-orange-500/30 transition-all active:scale-98 cursor-pointer"
              >
                <span className="font-bold font-cairo text-sm">خدمات أخرى</span>
                <div className="p-2 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
                  <Wrench size={18} />
                </div>
              </button>

              {/* Option 2: التقارير */}
              <button 
                onClick={() => {
                  setShowInventoryReportsModal(false);
                  onNavigate('reports');
                }}
                className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-800 dark:text-slate-100 p-3.5 rounded-2xl border border-slate-200/80 dark:border-white/8 hover:border-orange-500/30 transition-all active:scale-98 cursor-pointer"
              >
                <span className="font-bold font-cairo text-sm">التقارير</span>
                <div className="p-2 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
                  <BarChart3 size={18} />
                </div>
              </button>

              {/* Option 3: المخزون */}
              <button 
                onClick={() => {
                  setShowInventoryReportsModal(false);
                  onNavigate('inventory');
                }}
                className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-800 dark:text-slate-100 p-3.5 rounded-2xl border border-slate-200/80 dark:border-white/8 hover:border-orange-500/30 transition-all active:scale-98 cursor-pointer"
              >
                <span className="font-bold font-cairo text-sm">المخزون</span>
                <div className="p-2 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
                  <Package size={18} />
                </div>
              </button>

              {/* Option 4: الفواتير */}
              <button 
                onClick={() => {
                  setShowInventoryReportsModal(false);
                  onNavigate('invoices');
                }}
                className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-800 dark:text-slate-100 p-3.5 rounded-2xl border border-slate-200/80 dark:border-white/8 hover:border-orange-500/30 transition-all active:scale-98 cursor-pointer"
              >
                <span className="font-bold font-cairo text-sm">الفواتير</span>
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <FileText size={18} />
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionCard({ icon, label, iconClass, cardAccentClass = '', onClick }: { icon: React.ReactNode, label: string, iconClass: string, cardAccentClass?: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`p-3.5 md:p-4 rounded-2xl flex flex-col items-center justify-center gap-3 transition-all duration-200 group text-center bg-white dark:bg-[#161616] hover:bg-slate-50 dark:hover:bg-[#1d1d1d] border ${cardAccentClass || 'border-slate-200/90 dark:border-white/8'} hover:border-orange-500/40 shadow-sm active:scale-95 aspect-square text-slate-800 dark:text-slate-100 cursor-pointer`}
    >
      <div className={`w-12 h-12 md:w-13 md:h-13 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 ${iconClass}`}>
        {icon}
      </div>
      <div>
        <h3 className="font-bold text-xs md:text-sm leading-tight font-cairo">{label}</h3>
      </div>
    </button>
  );
}
