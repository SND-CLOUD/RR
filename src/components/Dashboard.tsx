import React, { useEffect, useState, useRef, useMemo } from 'react';
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
  FileText,
  ShoppingCart,
  BookOpen,
  ArrowRightLeft,
  Landmark,
  CornerDownLeft,
  Percent
} from 'lucide-react';
import { collection, query, where, getDocs, onSnapshot, orderBy } from '../firebase';
import { db } from '../firebase';
import { VaultTransaction, InvoiceItem, User, isInShopMaintenanceDevice, isShopMaintenanceItem, isPurchaseInvoice, isSaleInvoice } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { useTranslation } from 'react-i18next';

export interface QuickJumpTarget {
  tab:
    | 'device-intake'
    | 'device-exit'
    | 'device-movement'
    | 'inspection'
    | 'approval'
    | 'maintenance'
    | 'invoices'
    | 'device-management'
    | 'other-services'
    | 'vault'
    | 'customers'
    | 'inventory'
    | 'reports'
    | 'search'
    | 'settings'
    | 'advanced-database-maintenance'
    | 'alerts';
  subView?: 'hub' | 'entry';
  vaultSegment?: 'dashboard' | 'receipt' | 'payment' | 'discounts' | 'transfer' | 'funds' | 'reports';
  vaultShowAddModal?: boolean;
  otherServicesTab?: 'hub' | 'software' | 'maintenance' | 'parts' | 'purchase' | 'catalog' | 'stock';
}

interface QuickJumpItem {
  id: string;
  label: string;
  category: string;
  keywords: string[];
  icon: React.ReactNode;
  iconBg: string;
  target: QuickJumpTarget;
  isAllowed: boolean;
}

export default function Dashboard({ 
  onNavigate,
  onQuickNavigate,
  user,
  shopName, 
  fiscalYear,
  activeAlertsCount = 0,
  onShowAlerts = () => {},
  resetTrigger = 0
}: { 
  onNavigate: (tab: any, subView?: any) => void,
  onQuickNavigate?: (target: QuickJumpTarget) => void,
  user?: User | null,
  shopName?: string, 
  fiscalYear?: string,
  activeAlertsCount?: number,
  onShowAlerts?: () => void,
  resetTrigger?: number
}) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions(user || null);
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

  // "خذني إلى" Quick Navigation Input State
  const [quickJumpQuery, setQuickJumpQuery] = useState('');
  const [isQuickJumpOpen, setIsQuickJumpOpen] = useState(false);
  const [highlightedQuickJumpIdx, setHighlightedQuickJumpIdx] = useState(0);
  const quickJumpContainerRef = useRef<HTMLDivElement>(null);
  const quickJumpInputRef = useRef<HTMLInputElement>(null);
  const quickJumpListRef = useRef<HTMLDivElement>(null);

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
    function handleQuickJumpOutside(event: MouseEvent | TouchEvent) {
      if (quickJumpContainerRef.current && !quickJumpContainerRef.current.contains(event.target as Node)) {
        setIsQuickJumpOpen(false);
      }
    }
    if (isQuickJumpOpen) {
      document.addEventListener('mousedown', handleQuickJumpOutside);
      document.addEventListener('touchstart', handleQuickJumpOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleQuickJumpOutside);
      document.removeEventListener('touchstart', handleQuickJumpOutside);
    };
  }, [isQuickJumpOpen]);

  const quickJumpScreens = useMemo<QuickJumpItem[]>(() => {
    const canViewInventory = !user || hasPermission('inventory', 'view');
    const canViewInvoices = !user || hasPermission('invoices', 'view');
    const canViewVault = !user || hasPermission('vault', 'view');
    const canAddVault = !user || hasPermission('vault', 'add');
    const canVaultAdvanced = !user || user.isPrimary || user.role === 'admin' || hasPermission('vault', 'advancedView');
    const canViewCustomers = !user || hasPermission('customers', 'view');
    const canViewReports = !user || hasPermission('reports', 'view');
    const canViewSettings = !user || hasPermission('settings', 'view');
    const canViewDeviceMgmt = !user || user.isPrimary || user.role === 'admin' || hasPermission('settings_device_management', 'view');
    const canViewAdvMaint = !user || user.isPrimary || user.role === 'admin' || hasPermission('settings_advanced_maintenance', 'view');

    return [
      // إجراءات الصيانة وفواتير الصيانة
      {
        id: 'qj-device-intake-entry',
        label: 'استلام جهاز جديد (فاتورة دخول صيانة)',
        category: 'فواتير وإجراءات الصيانة',
        keywords: ['دخول', 'استلام', 'جهاز', 'فاتورة', 'صيانة', 'intake', 'entry'],
        icon: <FilePlus size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'device-intake', subView: 'entry' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-device-intake-hub',
        label: 'دخول أجهزة',
        category: 'إجراءات الصيانة',
        keywords: ['دخول', 'أجهزة', 'استلام', 'intake'],
        icon: <ArrowDownToLine size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'device-intake', subView: 'hub' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-device-movement',
        label: 'قسم الصيانة (مركز الإجراءات)',
        category: 'إجراءات الصيانة',
        keywords: ['قسم', 'الصيانة', 'حركة', 'movement'],
        icon: <SettingsIcon size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'device-movement' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-inspection',
        label: 'فحص الأجهزة',
        category: 'إجراءات الصيانة',
        keywords: ['فحص', 'الأجهزة', 'أولي', 'inspection'],
        icon: <ClipboardCheck size={16} />,
        iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        target: { tab: 'inspection' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-approval',
        label: 'انتظار الموافقة والقطع',
        category: 'إجراءات الصيانة',
        keywords: ['موافقة', 'الموافقة', 'القطع', 'approval'],
        icon: <Clock size={16} />,
        iconBg: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
        target: { tab: 'approval' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-maintenance',
        label: 'صيانة الأجهزة (تنفيذ الصيانة)',
        category: 'إجراءات الصيانة',
        keywords: ['صيانة', 'اصلاح', 'تنفيذ', 'maintenance'],
        icon: <Wrench size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'maintenance' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-device-exit',
        label: 'خروج أجهزة (تسليم الأجهزة)',
        category: 'إجراءات الصيانة',
        keywords: ['خروج', 'تسليم', 'أجهزة', 'exit'],
        icon: <ArrowUpFromLine size={16} />,
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        target: { tab: 'device-exit' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-invoices',
        label: 'إدارة الفواتير (صيانة ومبيعات)',
        category: 'الفواتير',
        keywords: ['فواتير', 'فاتورة', 'صيانة', 'تعديل', 'invoices'],
        icon: <FileText size={16} />,
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        target: { tab: 'invoices' },
        isAllowed: canViewInvoices
      },
      {
        id: 'qj-device-management',
        label: 'إدارة الأجهزة',
        category: 'الأجهزة',
        keywords: ['أجهزة', 'حالات', 'إدارة', 'devices'],
        icon: <Smartphone size={16} />,
        iconBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
        target: { tab: 'device-management' },
        isAllowed: canViewDeviceMgmt
      },

      // الفواتير الأخرى والخدمات الإضافية والمشتريات
      {
        id: 'qj-other-services-hub',
        label: 'خدمات أخرى (القائمة الرئيسية)',
        category: 'فواتير أخرى',
        keywords: ['خدمات', 'أخرى', 'فواتير', 'other'],
        icon: <Layers size={16} />,
        iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
        target: { tab: 'other-services', otherServicesTab: 'hub' },
        isAllowed: canViewInvoices || canViewInventory
      },
      {
        id: 'qj-other-software',
        label: 'فاتورة خدمات برمجية (سوفت وير)',
        category: 'فواتير أخرى',
        keywords: ['برمجية', 'سوفت', 'وير', 'فاتورة', 'software'],
        icon: <Cpu size={16} />,
        iconBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
        target: { tab: 'other-services', otherServicesTab: 'software' },
        isAllowed: canViewInvoices || canViewInventory
      },
      {
        id: 'qj-other-maintenance',
        label: 'فاتورة صيانة خارجية',
        category: 'فواتير أخرى',
        keywords: ['صيانة', 'خارجية', 'فاتورة', 'maintenance'],
        icon: <Wrench size={16} />,
        iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        target: { tab: 'other-services', otherServicesTab: 'maintenance' },
        isAllowed: canViewInvoices || canViewInventory
      },
      {
        id: 'qj-other-parts',
        label: 'فاتورة بيع قطع غيار وملحقات',
        category: 'فواتير أخرى',
        keywords: ['بيع', 'قطع', 'غيار', 'ملحقات', 'فاتورة', 'parts'],
        icon: <Tag size={16} />,
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        target: { tab: 'other-services', otherServicesTab: 'parts' },
        isAllowed: canViewInvoices || canViewInventory
      },
      {
        id: 'qj-other-purchase',
        label: 'فاتورة شراء قطع وملحقات',
        category: 'فواتير أخرى والمشتريات',
        keywords: ['شراء', 'مشتريات', 'قطع', 'ملحقات', 'فاتورة', 'purchase'],
        icon: <ShoppingCart size={16} />,
        iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
        target: { tab: 'other-services', otherServicesTab: 'purchase' },
        isAllowed: canViewInvoices || canViewInventory
      },
      {
        id: 'qj-other-catalog',
        label: 'دليل القطع والملحقات',
        category: 'فواتير أخرى والمخزون',
        keywords: ['دليل', 'أصناف', 'قطع', 'ملحقات', 'catalog'],
        icon: <BookOpen size={16} />,
        iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
        target: { tab: 'other-services', otherServicesTab: 'catalog' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-other-stock',
        label: 'مخزون ودفوعات المحل',
        category: 'فواتير أخرى والمخزون',
        keywords: ['مخزون', 'دفوعات', 'المحل', 'stock'],
        icon: <Package size={16} />,
        iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
        target: { tab: 'other-services', otherServicesTab: 'stock' },
        isAllowed: canViewInventory
      },

      // السندات والحسابات
      {
        id: 'qj-vault-dashboard',
        label: 'الحسابات (الشاشة الرئيسية)',
        category: 'الحسابات والسندات',
        keywords: ['حسابات', 'خزينة', 'الصندوق', 'vault'],
        icon: <CircleDollarSign size={16} />,
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        target: { tab: 'vault', vaultSegment: 'dashboard' },
        isAllowed: canViewVault
      },
      {
        id: 'qj-vault-receipt-new',
        label: 'إنشاء سند قبض جديد',
        category: 'السندات',
        keywords: ['سند', 'قبض', 'تحصيل', 'استلام', 'مبلغ', 'receipt'],
        icon: <ArrowDownToLine size={16} />,
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        target: { tab: 'vault', vaultSegment: 'receipt', vaultShowAddModal: true },
        isAllowed: canViewVault && canAddVault
      },
      {
        id: 'qj-vault-receipt-list',
        label: 'سندات القبض',
        category: 'السندات',
        keywords: ['سندات', 'سند', 'قبض', 'receipt'],
        icon: <ArrowDownToLine size={16} />,
        iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        target: { tab: 'vault', vaultSegment: 'receipt', vaultShowAddModal: false },
        isAllowed: canViewVault
      },
      {
        id: 'qj-vault-payment-new',
        label: 'إنشاء سند صرف جديد',
        category: 'السندات',
        keywords: ['سند', 'صرف', 'دفع', 'مصروف', 'payment'],
        icon: <ArrowUpFromLine size={16} />,
        iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        target: { tab: 'vault', vaultSegment: 'payment', vaultShowAddModal: true },
        isAllowed: canViewVault && canAddVault
      },
      {
        id: 'qj-vault-payment-list',
        label: 'سندات الصرف',
        category: 'السندات',
        keywords: ['سندات', 'سند', 'صرف', 'payment'],
        icon: <ArrowUpFromLine size={16} />,
        iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        target: { tab: 'vault', vaultSegment: 'payment', vaultShowAddModal: false },
        isAllowed: canViewVault
      },
      {
        id: 'qj-vault-discounts',
        label: 'الخصومات والتنازلات',
        category: 'الحسابات والسندات',
        keywords: ['خصم', 'خصومات', 'تنازل', 'تنازلات', 'discounts'],
        icon: <Percent size={16} />,
        iconBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        target: { tab: 'vault', vaultSegment: 'discounts' },
        isAllowed: canViewVault
      },
      {
        id: 'qj-vault-transfer',
        label: 'تحويل بين الصناديق',
        category: 'الحسابات المتقدمة',
        keywords: ['تحويل', 'صناديق', 'نقل', 'transfer'],
        icon: <ArrowRightLeft size={16} />,
        iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
        target: { tab: 'vault', vaultSegment: 'transfer' },
        isAllowed: canViewVault && canVaultAdvanced
      },
      {
        id: 'qj-vault-funds',
        label: 'الصناديق والبنوك',
        category: 'الحسابات المتقدمة',
        keywords: ['صناديق', 'بنوك', 'أرصدة', 'funds'],
        icon: <Landmark size={16} />,
        iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
        target: { tab: 'vault', vaultSegment: 'funds' },
        isAllowed: canViewVault && canVaultAdvanced
      },
      {
        id: 'qj-vault-reports',
        label: 'تقارير الحسابات',
        category: 'الحسابات المتقدمة',
        keywords: ['تقارير', 'أرباح', 'إيرادات', 'مصروفات', 'مستحقات', 'reports'],
        icon: <BarChart3 size={16} />,
        iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
        target: { tab: 'vault', vaultSegment: 'reports' },
        isAllowed: canViewVault && canVaultAdvanced
      },
      {
        id: 'qj-alerts',
        label: 'اشعارات التنبيه والضمان والمستحقات',
        category: 'التنبيهات والمستحقات',
        keywords: ['اشعارات', 'تنبيه', 'ضمان', 'مستحقات', 'مديونية', 'alerts'],
        icon: <Bell size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'alerts' },
        isAllowed: true
      },

      // الشاشات العامة والإدارية
      {
        id: 'qj-customers',
        label: 'العملاء',
        category: 'العملاء',
        keywords: ['عميل', 'عملاء', 'زبائن', 'customers'],
        icon: <Users size={16} />,
        iconBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
        target: { tab: 'customers' },
        isAllowed: canViewCustomers
      },
      {
        id: 'qj-inventory',
        label: 'المخزون وتقارير القطع',
        category: 'المخزون',
        keywords: ['مخزون', 'قطع', 'جرد', 'inventory'],
        icon: <Package size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'inventory' },
        isAllowed: canViewInventory
      },
      {
        id: 'qj-reports',
        label: 'التقارير الشاملة',
        category: 'التقارير',
        keywords: ['تقرير', 'تقارير', 'إحصائيات', 'reports'],
        icon: <BarChart3 size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'reports' },
        isAllowed: canViewReports
      },
      {
        id: 'qj-search',
        label: 'البحث السريع',
        category: 'البحث',
        keywords: ['بحث', 'سريع', 'فاتورة', 'سند', 'search'],
        icon: <Search size={16} />,
        iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        target: { tab: 'search' },
        isAllowed: true
      },
      {
        id: 'qj-settings',
        label: 'الإعدادات',
        category: 'الإدارة',
        keywords: ['إعدادات', 'اعدادات', 'مستخدمين', 'نسخ', 'نظام', 'settings'],
        icon: <SettingsIcon size={16} />,
        iconBg: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
        target: { tab: 'settings' },
        isAllowed: canViewSettings
      },
      {
        id: 'qj-adv-maintenance',
        label: 'الصيانة المتقدمة لقاعدة البيانات',
        category: 'الإدارة المتقدمة',
        keywords: ['قاعدة', 'بيانات', 'صيانة', 'متقدمة', 'database'],
        icon: <Database size={16} />,
        iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
        target: { tab: 'advanced-database-maintenance' },
        isAllowed: canViewAdvMaint
      }
    ].filter(item => item.isAllowed);
  }, [user, hasPermission]);

  // Case-sensitive flexible matching: matches any character anywhere in any word
  const filteredQuickJumpScreens = useMemo(() => {
    if (quickJumpQuery.length === 0) return [];
    const matches = quickJumpScreens.filter(item =>
      item.label.includes(quickJumpQuery) ||
      item.category.includes(quickJumpQuery) ||
      item.keywords.some(kw => kw.includes(quickJumpQuery))
    );
    return matches.sort((a, b) => {
      const aStarts = a.label.startsWith(quickJumpQuery) ? 0 : 1;
      const bStarts = b.label.startsWith(quickJumpQuery) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      const aInLabel = a.label.includes(quickJumpQuery) ? 0 : 1;
      const bInLabel = b.label.includes(quickJumpQuery) ? 0 : 1;
      return aInLabel - bInLabel;
    });
  }, [quickJumpQuery, quickJumpScreens]);

  useEffect(() => {
    setHighlightedQuickJumpIdx(0);
  }, [quickJumpQuery]);

  useEffect(() => {
    if (!isQuickJumpOpen || !quickJumpListRef.current) return;
    const activeEl = quickJumpListRef.current.children[highlightedQuickJumpIdx] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedQuickJumpIdx, isQuickJumpOpen]);

  const handleSelectQuickJump = (item: QuickJumpItem) => {
    setQuickJumpQuery('');
    setIsQuickJumpOpen(false);
    setHighlightedQuickJumpIdx(0);
    if (item.target.tab === 'alerts') {
      onShowAlerts();
      return;
    }
    if (onQuickNavigate) {
      onQuickNavigate(item.target);
      return;
    }
    if (item.target.otherServicesTab) {
      localStorage.setItem('otherServicesTab', item.target.otherServicesTab);
    }
    onNavigate(item.target.tab, item.target.subView);
  };

  const handleQuickJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsQuickJumpOpen(false);
      return;
    }
    if (!isQuickJumpOpen || filteredQuickJumpScreens.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedQuickJumpIdx(prev => (prev + 1) % filteredQuickJumpScreens.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedQuickJumpIdx(prev => (prev - 1 + filteredQuickJumpScreens.length) % filteredQuickJumpScreens.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filteredQuickJumpScreens[highlightedQuickJumpIdx] || filteredQuickJumpScreens[0];
      if (chosen) handleSelectQuickJump(chosen);
    }
  };

  const renderHighlightedLabel = (label: string, queryStr: string) => {
    if (!queryStr) return label;
    const idx = label.indexOf(queryStr);
    if (idx === -1) return label;
    return (
      <>
        {label.slice(0, idx)}
        <span className="text-orange-600 dark:text-orange-400 underline decoration-orange-500/40 underline-offset-2">
          {label.slice(idx, idx + queryStr.length)}
        </span>
        {label.slice(idx + queryStr.length)}
      </>
    );
  };

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
    <div className="space-y-4 pb-10 w-full max-w-full" dir="rtl">
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

      {/* Take Me To (خذني إلى) + Compact Quick Search Icon Button */}
      <div className="w-full max-w-full pt-1 relative box-border" ref={quickJumpContainerRef}>
        {/* Upward-opening scrollable dropdown (opens as soon as first character is typed) */}
        {isQuickJumpOpen && quickJumpQuery.length > 0 && (
          <div
            ref={quickJumpListRef}
            role="listbox"
            aria-label="قائمة الانتقال إلى الشاشات"
            dir="rtl"
            className="absolute bottom-full left-0 right-0 mb-2 z-50 max-h-[176px] sm:max-h-[220px] overflow-y-auto overscroll-contain bg-white dark:bg-[#161616] rounded-3xl border border-slate-200/95 dark:border-white/10 shadow-2xl p-2 space-y-1"
          >
            {filteredQuickJumpScreens.length > 0 ? (
              filteredQuickJumpScreens.map((item, idx) => {
                const isActive = idx === highlightedQuickJumpIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setHighlightedQuickJumpIdx(idx)}
                    onClick={() => handleSelectQuickJump(item)}
                    className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-2xl text-right transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-orange-500/12 dark:bg-orange-500/15 border border-orange-500/30 text-slate-900 dark:text-white'
                        : 'border border-transparent hover:bg-slate-50 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${item.iconBg}`}>
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-bold font-cairo truncate">
                          {renderHighlightedLabel(item.label, quickJumpQuery)}
                        </div>
                        <div className="text-[10px] font-cairo text-slate-400 dark:text-gray-500 truncate">
                          {item.category}
                        </div>
                      </div>
                    </div>
                    <CornerDownLeft size={14} className={`shrink-0 ${isActive ? 'text-orange-500' : 'text-slate-300 dark:text-gray-600'}`} />
                  </button>
                );
              })
            ) : (
              <div className="py-4 px-3 text-center text-xs font-bold font-cairo text-slate-400 dark:text-gray-500">
                لا توجد شاشة مطابقة لـ «{quickJumpQuery}»
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2.5 w-full min-w-0 box-border" dir="rtl">
          {/* New Field: خذني إلى */}
          <div className="flex-1 min-w-0 relative h-12 bg-white dark:bg-[#161616] rounded-3xl overflow-hidden border border-slate-200/90 dark:border-white/8 focus-within:border-orange-500/50 transition-all shadow-sm flex items-center box-border">
            {quickJumpQuery.length === 0 && (
              <span
                aria-hidden="true"
                className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold font-cairo text-slate-400 dark:text-gray-500 opacity-75 pointer-events-none select-none z-20"
              >
                خذني إلى
              </span>
            )}
            <input
              ref={quickJumpInputRef}
              type="text"
              size={1}
              dir="rtl"
              aria-label="خذني إلى"
              value={quickJumpQuery}
              onFocus={() => {
                if (quickJumpQuery.length > 0) {
                  setIsQuickJumpOpen(true);
                }
              }}
              onChange={(e) => {
                const val = e.target.value;
                setQuickJumpQuery(val);
                setIsQuickJumpOpen(val.length > 0);
              }}
              onKeyDown={handleQuickJumpKeyDown}
              className="quick-jump-input w-full min-w-0 h-full bg-transparent border-0 rounded-3xl pr-5 pl-9 text-sm font-bold font-cairo text-slate-800 dark:text-slate-100 focus:outline-none relative z-10"
            />
            {quickJumpQuery.length > 0 && (
              <button
                type="button"
                aria-label="مسح النص"
                onClick={() => {
                  setQuickJumpQuery('');
                  setIsQuickJumpOpen(false);
                  quickJumpInputRef.current?.focus();
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors z-30 cursor-pointer"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Original Quick Search preserved at far-left end of the row as a compact lens square */}
          <button
            type="button"
            onClick={() => onNavigate('search')}
            aria-label="مربع البحث السريع"
            title="البحث السريع"
            className="w-12 h-12 shrink-0 bg-white dark:bg-[#161616] rounded-3xl border border-slate-200/90 dark:border-white/8 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-[#1d1d1d] hover:border-orange-500/40 transition-all group shadow-sm text-slate-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 cursor-pointer box-border"
          >
            <Search size={20} className="transition-colors" />
          </button>
        </div>
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
