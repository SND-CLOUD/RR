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
  FileOutput
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

  const counterSlides = [
    {
      id: 'active',
      title: shopName || 'عالم الصيانة والتجارة',
      count: activeDevicesCount,
      label: 'الأجهزة النشطة في المحل',
      gradient: 'from-orange-500 to-orange-600',
      icon: <Smartphone size={36} className="text-orange-100" />,
      faintIcon: <SettingsIcon size={140} />,
      onClick: () => onNavigate('reports')
    },
    {
      id: 'inspection',
      title: 'إجراء الفحص الأولي',
      count: inspectionCount,
      label: 'أجهزة قيد أو بانتظار الفحص',
      gradient: 'from-amber-500 to-amber-600',
      icon: <ClipboardCheck size={36} className="text-amber-100" />,
      faintIcon: <ClipboardCheck size={140} />,
      onClick: () => onNavigate('inspection')
    },
    {
      id: 'approval',
      title: 'انتظار الموافقة والقطع',
      count: approvalPartsCount,
      label: 'أجهزة بانتظار الموافقة أو توفير القطع',
      gradient: 'from-cyan-600 to-teal-700',
      icon: <Clock size={36} className="text-cyan-100" />,
      faintIcon: <Clock size={140} />,
      onClick: () => onNavigate('approval')
    },
    {
      id: 'maintenance',
      title: 'إجراء قسم الصيانة',
      count: maintenanceCount,
      label: 'أجهزة قيد الصيانة والإصلاح',
      gradient: 'from-blue-600 to-indigo-600',
      icon: <Wrench size={36} className="text-indigo-100" />,
      faintIcon: <Wrench size={140} />,
      onClick: () => onNavigate('maintenance')
    },
    {
      id: 'exit',
      title: 'إجراء خروج الأجهزة',
      count: exitReadyCount,
      label: 'أجهزة جاهزة للتسليم والخروج',
      gradient: 'from-emerald-600 to-teal-700',
      icon: <CheckCircle2 size={36} className="text-emerald-100" />,
      faintIcon: <CheckCircle2 size={140} />,
      onClick: () => onNavigate('entry-exit', 'exit')
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
        {counterSlides.map((slide) => (
          <div 
            key={slide.id}
            className="w-full min-w-full flex-shrink-0 snap-center"
          >
            <button 
              type="button"
              onClick={() => handleCardClick(slide.onClick)}
              className={`w-full bg-gradient-to-br ${slide.gradient} text-white p-6 md:p-8 rounded-3xl shadow-lg relative overflow-hidden flex flex-col items-center text-center hover:scale-[1.01] transition-transform cursor-pointer select-none`}
            >
              {/* Background Faint Watermark Icon */}
              <div className="absolute opacity-10 -left-6 -top-6 pointer-events-none">
                {slide.faintIcon}
              </div>

              {/* Top Title */}
              <h2 className="text-base md:text-lg font-bold font-cairo text-orange-50 mb-2 z-10">
                {slide.title}
              </h2>

              {/* Main Counter Number & Icon */}
              <div className="flex items-center justify-center gap-3 my-1 z-10">
                <span className="text-5xl md:text-6xl font-black tracking-widest text-white drop-shadow-md">
                  {slide.count}
                </span>
                {slide.icon}
              </div>

              {/* Bottom Label */}
              <p className="text-sm md:text-base font-bold mt-2 z-10 text-orange-50">
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
          className="w-full bg-white dark:bg-[#1a1a1a] py-3.5 px-5 rounded-2xl border border-gray-200 dark:border-white/5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-all group shadow-sm text-gray-500 dark:text-gray-400"
        >
          <div className="flex items-center gap-3 flex-1 text-right"> 
            <span className="text-sm font-bold font-cairo">البحث السريع</span>
          </div>
          <Search size={20} className="text-gray-400" />
        </button>
      </div>

      {/* Action Grid - 3x2 layout */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-4xl mx-auto pt-2">
        <ActionCard 
          onClick={() => onNavigate('entry-exit')}
          icon={<FilePlus size={24} className="md:w-7 md:h-7" />} 
          label="دخول وخروج" 
          color="bg-orange-600 hover:bg-orange-700"
        />
        <ActionCard 
          onClick={() => onNavigate('device-movement')}
          icon={<SettingsIcon size={24} className="md:w-7 md:h-7" />} 
          label="قسم الصيانة" 
          color="bg-blue-600 hover:bg-blue-700"
        />
        <ActionCard 
          onClick={() => onNavigate('customers')}
          icon={<Users size={24} className="md:w-7 md:h-7" />} 
          label="العملاء" 
          color="bg-amber-500 hover:bg-amber-600"
        />
        <ActionCard 
          onClick={() => onNavigate('vault')}
          icon={<CircleDollarSign size={24} className="md:w-7 md:h-7" />} 
          label="الحسابات" 
          color="bg-emerald-600 hover:bg-emerald-700"
        />
        <ActionCard 
          onClick={() => setShowInventoryReportsModal(true)}
          icon={<Layers size={24} className="md:w-7 md:h-7" />} 
          label="المخزون والتقارير" 
          color="bg-purple-600 hover:bg-purple-700"
        />
        <ActionCard 
          onClick={() => {
            localStorage.setItem('otherServicesTab', 'hub');
            onNavigate('other-services');
          }}
          icon={<Wrench size={24} className="md:w-7 md:h-7" />} 
          label="خدمات أخرى" 
          color="bg-indigo-600 hover:bg-indigo-700"
        />
      </div>

      {/* Modals */}
      
      {/* Inventory & Reports Modal */}
      {showInventoryReportsModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
        >
          <div 
            ref={inventoryReportsModalRef}
            className="bg-[#1a1a1a] rounded-2xl p-6 w-full max-w-sm border border-white/10 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200 pointer-events-auto"
          >
            <button 
              onClick={() => setShowInventoryReportsModal(false)}
              className="absolute top-4 left-4 p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-colors"
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-black text-white mb-6 font-cairo text-center">المخزون والتقارير</h2>
            
            <div className="space-y-4">
              <button 
                onClick={() => {
                  setShowInventoryReportsModal(false);
                  onNavigate('inventory');
                }}
                className="w-full flex items-center justify-between bg-purple-600 hover:bg-purple-700 text-white p-4 rounded-xl transition-colors shadow-lg"
              >
                <span className="font-bold font-cairo text-lg">المخزون</span>
                <Package size={24} />
              </button>
              <button 
                onClick={() => {
                  setShowInventoryReportsModal(false);
                  onNavigate('reports');
                }}
                className="w-full flex items-center justify-between bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-xl transition-colors shadow-lg"
              >
                <span className="font-bold font-cairo text-lg">التقارير</span>
                <BarChart3 size={24} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionCard({ icon, label, color, onClick }: { icon: React.ReactNode, label: string, color: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`p-4 rounded-2xl flex flex-col items-center justify-center gap-3 transition-all duration-300 group text-center border border-white/5 shadow-sm hover:shadow-md active:scale-95 aspect-square text-white ${color}`}
    >
      <div className="group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div>
        <h3 className="font-bold text-xs md:text-sm leading-tight drop-shadow-sm">{label}</h3>
      </div>
    </button>
  );
}
