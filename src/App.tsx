/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  FilePlus, 
  Package, 
  CheckCircle, 
  BarChart3, 
  Users, 
  Settings as SettingsIcon, 
  ClipboardCheck,
  Router,
  Bell,
  LogOut,
  Cpu,
  CircleDollarSign,
  Wrench,
  ShieldCheck,
  ArrowRightLeft,
  Clock,
  MoreVertical,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  MessageCircle,
  X,
  RefreshCw,
  Eye,
  ArrowUpDown,
  Search,
  AlertCircle
} from 'lucide-react';
import { collection, query, where, getDocs, addDoc, doc, getDoc, setDoc, updateDoc, onSnapshot, writeBatch, deleteDoc, serverTimestamp } from './firebase';
import { db } from './firebase';
import { User, ShopConfig, isPurchaseInvoice } from './types';
import { getItemBillableCost, isItemRefusedOrFailed } from './lib/billableService';
import { openWhatsApp, sendUniversalReminder } from './lib/shareHelper';
import { ProviderFactory } from './data/ProviderFactory';
import { localDb } from './lib/local-db';
import { parseDate, formatDateTime, parseTxDate } from './lib/dateUtils';
import PrintPreviewOverlay from './components/PrintPreviewOverlay';

// Components
import Dashboard from './components/Dashboard';
import EntryExit from './components/entry-exit';
import DeviceMovement from './components/movement';
import Inspection from './components/movement/Inspection';
import Maintenance from './components/movement/Maintenance';
import ApprovalAndParts from './components/movement/ApprovalAndParts';
import Inventory from './components/Inventory';
import Reports from './components/Reports';
import Customers from './components/Customers';
import Settings from './components/Settings';
import SearchInvoice from './components/SearchInvoice';
import DeviceManagement from './components/DeviceManagement';
import OtherServiceInvoice from './components/OtherServiceInvoice';
import Login from './components/Login';
import SetupWizard from './components/SetupWizard';
import DataAuditModal from './components/DataAuditModal';

import Vault from './components/Vault';
import SecurityGuard from './components/SecurityGuard';

import AdvancedDatabaseMaintenance from './components/AdvancedDatabaseMaintenance';

import { useTranslation } from 'react-i18next';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { App as CapacitorApp } from '@capacitor/app';

import { useSmartInputs } from './hooks/useSmartInputs';

export default function App() {
  useSmartInputs();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [shopConfig, setShopConfig] = useState<ShopConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'entry-exit' | 'device-movement' | 'inspection' | 'maintenance' | 'inventory' | 'reports' | 'customers' | 'settings' | 'search' | 'vault' | 'device-management' | 'approval' | 'other-services' | 'advanced-database-maintenance'>('dashboard');
  const [dashboardResetTrigger, setDashboardResetTrigger] = useState(0);

  const goToDashboard = () => {
    setActiveTab('dashboard');
    setVaultInitialProps(null);
    setEntryExitView('hub');
    setMovementView('hub');
    setDashboardResetTrigger(prev => prev + 1);
    window.dispatchEvent(new CustomEvent('reset-dashboard-counter'));
  };
  const [movementView, setMovementView] = useState<'hub' | 'inspection' | 'maintenance' | 'approval'>('hub');
  const [entryExitView, setEntryExitView] = useState<'hub' | 'entry' | 'exit'>('hub');

  // Alerts and Notifications State
  const [invoicesList, setInvoicesList] = useState<any[]>([]);
  const [itemsList, setItemsList] = useState<any[]>([]);
  const [customersList, setCustomersList] = useState<any[]>([]);
  const [transactionsList, setTransactionsList] = useState<any[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<any[]>([]);
  const [showAllAlertsModal, setShowAllAlertsModal] = useState(false);
  const [showAlertsBell, setShowAlertsBell] = useState<boolean>(true);
  const [showDataAuditModal, setShowDataAuditModal] = useState(false);
  const [alertsTab, setAlertsTab] = useState<'outstanding' | 'warranty'>('outstanding');
  
  // Sort and preview states for alerts
  const [alertsSortType, setAlertsSortType] = useState<'alpha' | 'date' | 'debt'>('debt');
  const [alertsSortDir, setAlertsSortDir] = useState<'asc' | 'desc'>('desc');
  const [showAlertsSortDropdown, setShowAlertsSortDropdown] = useState(false);
  const [alertsSearchQuery, setAlertsSearchQuery] = useState('');
  const [previewData, setPreviewData] = useState<{ type: 'invoice' | 'voucher' | 'statement' | 'table'; data: any } | null>(null);
  
  // State for navigating to Vault with preloaded customer and receipt voucher
  const [vaultInitialProps, setVaultInitialProps] = useState<{
    segment?: 'dashboard' | 'receipt' | 'payment' | 'transfer' | 'funds' | 'customer-ledger' | 'reports';
    customerName?: string;
    customerId?: string;
    liabilityCurrency?: string;
    showAddModal?: boolean;
    invoiceNumber?: string;
    invoiceId?: string;
  } | null>(null);

  // Settle Outstanding Payment state
  const [settleInvoice, setSettleInvoice] = useState<any | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>('');
  const [isSettling, setIsSettling] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncMode, setSyncMode] = useState<'quick' | 'advanced' | null>(null);
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const longPressTimerRef = useRef<any>(null);
  const isLongPressRef = useRef<boolean>(false);
  const clickTimeoutRef = useRef<any>(null);

  const handleManualSync = async (force: boolean = false) => {
    if (isSyncingAll) return;
    setIsSyncingAll(true);
    setSyncMode(force ? 'advanced' : 'quick');
    setSyncToast({
      message: force 
        ? 'مزامنة شاملة جارية...' 
        : 'مزامنة التحديثات جارية...',
      type: 'info'
    });

    try {
      const { SyncEngine } = await import('./data/SyncEngine');
      // force = false: Fast outbox sync, force = true: Comprehensive down/up sync
      const result = await SyncEngine.syncAll(force);

      // Refresh local shop config after sync
      try {
        const shopSnap = await getDoc(doc(db, 'company_details', 'main_details'));
        if (shopSnap.exists()) {
          setShopConfig(prev => ({ ...prev, ...(shopSnap.data() as ShopConfig) }));
        } else {
          const localDetails = await localDb.query("SELECT * FROM company_details WHERE id = 'main_details' OR (shopName != '' AND shopName != 'اسم المؤسسة / المركز') ORDER BY CASE WHEN id = 'main_details' THEN 0 ELSE 1 END LIMIT 1");
          if (localDetails.values && localDetails.values.length > 0) {
            const det = localDetails.values[0];
            if ((det.name || det.shopName) && det.id !== 'default-company') {
              setShopConfig(det as ShopConfig);
            }
          }
        }
      } catch (confErr) {
        console.warn("Error refreshing shop config after sync:", confErr);
      }

      window.dispatchEvent(new CustomEvent('snd_data_synced'));
      
      let successMsg = '';
      if (force) {
        successMsg = result?.syncedCount && result.syncedCount > 0
          ? `مزامنة شاملة: تم تحديث ${result.syncedCount}`
          : 'المزامنة الشاملة: مكتملة بنجاح';
      } else {
        successMsg = result?.syncedCount && result.syncedCount > 0
          ? `مزامنة سريعة: تم تحديث ${result.syncedCount}`
          : 'تمت مزامنة صندوق التحديثات';
      }

      setSyncToast({ message: successMsg, type: 'success' });
      setTimeout(() => {
        setSyncToast(prev => (prev?.message === successMsg ? null : prev));
      }, 3000);
    } catch (e: any) {
      console.error("Manual sync failed:", e);
      setSyncToast({ message: "فشلت المزامنة", type: 'error' });
      setTimeout(() => {
        setSyncToast(null);
      }, 3500);
    } finally {
      setIsSyncingAll(false);
      setSyncMode(null);
    }
  };

  const handleSyncPressStart = () => {
    isLongPressRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(60); } catch (_) {}
      }
      handleManualSync(true); // Long press -> Advanced Sync
    }, 650);
  };

  const handleSyncPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSyncClick = () => {
    if (activeTab === 'dashboard') {
      setDashboardResetTrigger(prev => prev + 1);
      window.dispatchEvent(new CustomEvent('reset-dashboard-counter'));
    }
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }
    clickTimeoutRef.current = setTimeout(() => {
      handleManualSync(false); // Single Click -> Fast Sync
    }, 220);
  };

  const handleSyncDoubleClick = () => {
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    handleManualSync(true); // Double Click -> Advanced Sync
  };

  const stateRefs = useRef({
    activeTab,
    movementView,
    entryExitView,
    showAllAlertsModal,
    showDataAuditModal,
    showSetup,
    user,
    settleInvoice
  });

  useEffect(() => {
    stateRefs.current = {
      activeTab,
      movementView,
      entryExitView,
      showAllAlertsModal,
      showDataAuditModal,
      showSetup,
      user,
      settleInvoice
    };
  }, [activeTab, movementView, entryExitView, showAllAlertsModal, showDataAuditModal, showSetup, user, settleInvoice]);

  useEffect(() => {
    const handleBackButton = async ({ canGoBack }: { canGoBack: boolean }) => {
      const state = stateRefs.current;

      const handlers = (window as any).backHandlers || [];
      if (handlers.length > 0) {
        const topHandler = handlers[handlers.length - 1];
        if (topHandler()) return;
      }
      
      if (!state.user || state.showSetup) {
        if (confirm("هل تريد الخروج من البرنامج؟")) {
          sessionStorage.removeItem('snd_user');
          CapacitorApp.exitApp();
        }
        return;
      }

      if (state.settleInvoice) {
        setSettleInvoice(null);
        return;
      }

      if (state.showAllAlertsModal) {
        setShowAllAlertsModal(false);
        return;
      }

      if (state.showDataAuditModal) {
        setShowDataAuditModal(false);
        return;
      }

      if (state.activeTab === 'device-movement' && state.movementView !== 'hub') {
        setMovementView('hub');
        return;
      }

      if (state.activeTab === 'entry-exit' && state.entryExitView !== 'hub') {
        setEntryExitView('hub');
        return;
      }

      if (state.activeTab === 'other-services') {
        const storedTab = localStorage.getItem('otherServicesTab');
        if (storedTab && storedTab !== 'hub') {
          localStorage.setItem('otherServicesTab', 'hub');
          window.dispatchEvent(new CustomEvent('changeOtherServicesTab', { detail: 'hub' }));
          return;
        }
      }

      if (state.activeTab === 'settings' && (window as any).isSettingsDeepView) {
        window.dispatchEvent(new Event('closeSettingsDeepView'));
        return;
      }
      
      if (state.activeTab !== 'dashboard') {
        goToDashboard();
        return;
      }

      if (confirm("هل تريد الخروج من البرنامج؟")) {
        sessionStorage.removeItem('snd_user');
        CapacitorApp.exitApp();
      }
    };

    let listenerHandle: any = null;

    CapacitorApp.addListener('backButton', handleBackButton).then(handle => {
      listenerHandle = handle;
    });

    return () => {
      if (listenerHandle) {
        listenerHandle.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (snapshot) => {
      setInvoicesList(snapshot.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (snapshot) => {
      setItemsList(snapshot.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomersList(snapshot.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubTransactions = onSnapshot(collection(db, 'vault_transactions'), (snapshot) => {
      setTransactionsList(snapshot.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    return () => {
      unsubInvoices();
      unsubItems();
      unsubCustomers();
      unsubTransactions();
    };
  }, [user]);



  // Helper function to calculate actual invoice cost according to items status and discounts/taxes
  const getInvoiceActualCost = (invoiceItems: any[], invoice?: any) => {
    if (invoice) {
      const isPurchase = isPurchaseInvoice(invoice);
      const explicitType = String(invoice.invoiceType || invoice.templateType || invoice.type || '').toLowerCase();
      if (isPurchase || explicitType.startsWith('sale_') || String(invoice.invoiceNumber || '').startsWith('O-')) {
        return Number(invoice.totalCost || invoice.batchTotalCost || invoice.amountPaid || 0);
      }
    }

    return invoiceItems.reduce((sum, item) => {
      if (['10', '20', '25', '30', '35', '40', 'new', 'in_progress', 'awaiting_parts', 'awaiting_approval', 'repairing'].includes(item.status)) {
        return sum;
      }
      
      if (isItemRefusedOrFailed(item)) {
        return sum;
      }
      
      return sum + getItemBillableCost(item);
    }, 0) - (invoice ? Number(invoice.discount || 0) : 0) + (invoice ? Number(invoice.tax || 0) : 0);
  };

  // Real-time synchronization of the currently logged-in user's status and permissions
  useEffect(() => {
    if (!user?.id) return;
    const unsubUser = onSnapshot(doc(db, 'users', user.id), (snapshot) => {
      if (snapshot.exists()) {
        const updatedUserData = snapshot.data() as User;
        const isActiveVal = updatedUserData.isActive as any;
        if (isActiveVal === false || isActiveVal === 0 || isActiveVal === 'false') {
          alert("تم تعطيل هذا الحساب من قبل المسؤول. سيتم تسجيل الخروج الآن.");
          setUser(null);
          sessionStorage.removeItem('snd_user');
          return;
        }
        // Sync any updates (permissions, password, name) back to the session state
        setUser({ ...updatedUserData, id: snapshot.id });
        sessionStorage.setItem('snd_user', JSON.stringify({ ...updatedUserData, id: snapshot.id }));
      }
    }, (error) => {
      console.warn("Failed to listen to user document:", error);
    });
    return () => unsubUser();
  }, [user?.id]);

  useEffect(() => {
    const generatedAlerts: any[] = [];
    const now = Date.now();
    const warrantyDurationMs = 14 * 24 * 60 * 60 * 1000; // 14 days standard warranty

    // 1. Outstanding Invoices & Debts Check (Calculated exactly like Customer Account Statement)
    const customerMap = new Map<string, any>();

    customersList.forEach(c => {
      if (c && (c.id || c.name)) {
        const key = c.id || c.name;
        customerMap.set(key, c);
      }
    });

    invoicesList.forEach(inv => {
      if (inv.customerId && !customerMap.has(inv.customerId)) {
        customerMap.set(inv.customerId, {
          id: inv.customerId,
          name: inv.customerName,
          phone1: inv.customerPhone,
          liabilityCurrency: inv.currency || 'USD'
        });
      } else if (!inv.customerId && inv.customerName && !customerMap.has(inv.customerName)) {
        customerMap.set(inv.customerName, {
          name: inv.customerName,
          phone1: inv.customerPhone,
          liabilityCurrency: inv.currency || 'USD'
        });
      }
    });

    customerMap.forEach((cust) => {
      const customerId = cust.id;
      const customerName = cust.name || '';
      if (!customerName && !customerId) return;

      const customerInvs = invoicesList.filter(inv => (customerId && inv.customerId === customerId) || (customerName && inv.customerName === customerName));
      
      let totalDebit = 0;
      let totalCredit = 0;

      customerInvs.forEach(inv => {
        const invItems = itemsList.filter(it => it.invoiceNumber === inv.invoiceNumber);
        const actualCost = getInvoiceActualCost(invItems, inv);
        
        const explicitType = inv.invoiceType || inv.templateType || inv.type || '';
        let isPurchase = explicitType === 'purchase' || String(explicitType).startsWith('purchase') || inv.type === 'purchase' || String(inv.invoiceNumber).startsWith('PUR-') || String(inv.invoiceNumber).startsWith('DIS-');
        if (inv.notes && (inv.notes.includes('شراء') || inv.notes.includes('مورد') || inv.notes.includes('مشتريات'))) {
          isPurchase = true;
        }

        if (isPurchase) {
          totalCredit += actualCost;
        } else {
          totalDebit += actualCost;
        }
      });

      const customerTransactions = transactionsList.filter(tx => 
        ((customerId && tx.customerId === customerId) || (customerName && tx.customerName === customerName)) &&
        !tx.isReversed &&
        !tx.isReversal &&
        tx.status !== 'reversed' &&
        tx.status !== 'reversal'
      );

      customerTransactions.forEach(tx => {
        const liabilityAmount = (tx.liabilityAmount !== undefined && tx.liabilityAmount !== null && !isNaN(Number(tx.liabilityAmount))) 
          ? Number(tx.liabilityAmount) 
          : Math.abs(Number(tx.amount || 0));

        if (tx.type === 'receipt' || tx.type === 'invoice_payment') {
          totalCredit += liabilityAmount;
        } else if (tx.type === 'payment') {
          totalDebit += liabilityAmount;
        }
      });

      const outstandingBalance = totalDebit - totalCredit;
      const currency = cust.liabilityCurrency || 'USD';

      if (outstandingBalance > 0.05) {
        const latestInv = customerInvs.length > 0 ? customerInvs[customerInvs.length - 1] : null;

        generatedAlerts.push({
          id: `outstanding-${cust.id || cust.name}`,
          type: 'outstanding',
          title: 'مستحقات وذمم عميل',
          message: `العميل (${cust.name}) متبقي بذمته مبلغ ${outstandingBalance.toLocaleString('en-US')} ${currency}`,
          customerId: cust.id || '',
          customerNumber: cust.customerNumber || (cust.id ? cust.id.substring(0, 5) : ''),
          customerName: cust.name,
          customerPhone: cust.phone1 || cust.phone || (latestInv ? latestInv.customerPhone : ''),
          companyName: cust.companyName || '',
          hasWhatsapp: cust.hasWhatsapp !== undefined ? cust.hasWhatsapp : true,
          createdAt: cust.createdAt || (latestInv ? latestInv.createdAt : null),
          latestInvoiceNumber: latestInv?.invoiceNumber || '',
          allInvoiceNumbers: customerInvs.map(inv => String(inv.invoiceNumber || '')).filter(Boolean),
          remainingAmount: outstandingBalance,
          totalCost: totalDebit,
          amountPaid: totalCredit,
          currency: currency,
          severity: outstandingBalance > 100 ? 'high' : 'medium'
        });
      }
    });

    // 2. Warranty Check on delivered items
    itemsList.forEach(item => {
      if ((item.status === '60' || item.status === 'delivered') && item.deliveredAt) {
        const deliveredTime = Number(item.deliveredAt);
        const expiryTime = deliveredTime + warrantyDurationMs;
        const diffMs = expiryTime - now;
        const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

        const formattedDate = new Date(expiryTime).toLocaleDateString('ar-EG', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        if (diffDays >= 0 && diffDays <= 3) {
          generatedAlerts.push({
            id: `war-exp-soon-${item.id}`,
            type: 'warranty_soon',
            title: 'ضمان ينتهي قريباً',
            message: `الجهاز (${item.deviceType} - ${item.deviceName}) للفاتورة #${item.invoiceNumber || '-'} ينتهي ضمانه خلال ${diffDays === 0 ? 'اليوم' : diffDays === 1 ? 'يوم واحد' : diffDays === 2 ? 'يومين' : `${diffDays} أيام`} بتاريخ ${formattedDate}`,
            itemId: item.id,
            deviceName: item.deviceName,
            deviceType: item.deviceType,
            invoiceNumber: item.invoiceNumber,
            customerName: item.customerName || '',
            expiryDate: formattedDate,
            diffDays,
            severity: 'medium'
          });
        } else if (diffDays < 0 && diffDays >= -7) {
          const expiredDaysAgo = Math.abs(diffDays);
          generatedAlerts.push({
            id: `war-expired-${item.id}`,
            type: 'warranty_expired',
            title: 'انتهى ضمان الجهاز',
            message: `الجهاز (${item.deviceType} - ${item.deviceName}) للفاتورة #${item.invoiceNumber || '-'} انتهى ضمانه منذ ${expiredDaysAgo === 1 ? 'يوم واحد' : expiredDaysAgo === 2 ? 'يومين' : `${expiredDaysAgo} أيام`} بتاريخ ${formattedDate}`,
            itemId: item.id,
            deviceName: item.deviceName,
            deviceType: item.deviceType,
            invoiceNumber: item.invoiceNumber,
            customerName: item.customerName || '',
            expiryDate: formattedDate,
            diffDays: expiredDaysAgo,
            severity: 'low'
          });
        }
      }
    });

    setActiveAlerts(generatedAlerts);
  }, [invoicesList, itemsList, customersList, transactionsList]);

  // Search & sort outstanding alerts
  const getProcessedOutstandingAlerts = () => {
    let list = [...activeAlerts.filter(a => a.type === 'outstanding')];

    // Search filter: customer name, company name, customer number, phone, invoice number
    const query = alertsSearchQuery.trim().toLowerCase();
    if (query) {
      const cleanNumQuery = query.replace(/^#/, '');
      list = list.filter(a => {
        const name = (a.customerName || '').toLowerCase();
        const company = (a.companyName || '').toLowerCase();
        const custNum = String(a.customerNumber || '').toLowerCase();
        const phone = String(a.customerPhone || '').toLowerCase();
        const latestInv = String(a.latestInvoiceNumber || '').toLowerCase();
        const allInvs = Array.isArray(a.allInvoiceNumbers) ? a.allInvoiceNumbers.map((n: any) => String(n).toLowerCase()) : [];

        return (
          name.includes(query) ||
          company.includes(query) ||
          custNum.includes(cleanNumQuery) ||
          phone.includes(query) ||
          latestInv.includes(cleanNumQuery) ||
          allInvs.some((invNum: string) => invNum.includes(cleanNumQuery))
        );
      });
    }

    list.sort((a, b) => {
      if (alertsSortType === 'alpha') {
        const nameA = a.customerName || '';
        const nameB = b.customerName || '';
        return alertsSortDir === 'asc'
          ? nameA.localeCompare(nameB, 'ar')
          : nameB.localeCompare(nameA, 'ar');
      } else if (alertsSortType === 'date') {
        const dateA = a.createdAt ? (typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
        const dateB = b.createdAt ? (typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
        return alertsSortDir === 'asc' ? dateA - dateB : dateB - dateA;
      } else if (alertsSortType === 'debt') {
        const debtA = Number(a.remainingAmount || 0);
        const debtB = Number(b.remainingAmount || 0);
        return alertsSortDir === 'asc' ? debtA - debtB : debtB - debtA;
      }
      return 0;
    });

    return list;
  };

  // Search warranty alerts
  const getProcessedWarrantyAlerts = () => {
    let list = [...activeAlerts.filter(a => a.type.startsWith('warranty'))];
    const query = alertsSearchQuery.trim().toLowerCase();
    if (query) {
      const cleanNumQuery = query.replace(/^#/, '');
      list = list.filter(a => {
        const devName = (a.deviceName || '').toLowerCase();
        const devType = (a.deviceType || '').toLowerCase();
        const invNum = String(a.invoiceNumber || '').toLowerCase();
        const custName = (a.customerName || '').toLowerCase();
        return (
          devName.includes(query) ||
          devType.includes(query) ||
          invNum.includes(cleanNumQuery) ||
          custName.includes(query)
        );
      });
    }
    return list;
  };

  const handleAlertsSortClick = (type: 'alpha' | 'date' | 'debt') => {
    if (alertsSortType === type) {
      setAlertsSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setAlertsSortType(type);
      setAlertsSortDir(type === 'alpha' ? 'asc' : 'desc');
    }
  };

  // Generate and open Customer Account Statement preview
  const handleOpenCustomerStatement = (alertItem: any) => {
    const custId = alertItem.customerId;
    const custName = alertItem.customerName;
    const targetCust = customersList.find(c => (custId && c.id === custId) || (custName && c.name === custName)) || {
      id: custId,
      name: custName,
      phone1: alertItem.customerPhone,
      companyName: alertItem.companyName,
      customerNumber: alertItem.customerNumber,
      liabilityCurrency: alertItem.currency
    };

    const entries: any[] = [];
    const customerInvs = invoicesList.filter(inv => (targetCust.id && inv.customerId === targetCust.id) || (targetCust.name && inv.customerName === targetCust.name));
    
    customerInvs.forEach(inv => {
      const invItems = itemsList.filter(it => it.invoiceNumber === inv.invoiceNumber);
      const actualCost = getInvoiceActualCost(invItems, inv);
      const invDate = parseDate(inv.createdAt) || new Date();
      
      const explicitType = inv.invoiceType || inv.templateType || inv.type || '';
      let invTypeTitle = 'فاتورة صيانة';
      let invLabel = 'فاتورة صيانة أجهزة فنية';
      let isPurchase = explicitType === 'purchase' || String(explicitType).startsWith('purchase') || inv.type === 'purchase' || String(inv.invoiceNumber).startsWith('PUR-') || String(inv.invoiceNumber).startsWith('DIS-');
      if (inv.notes && (inv.notes.includes('شراء') || inv.notes.includes('مورد') || inv.notes.includes('مشتريات'))) {
        isPurchase = true;
      }

      if (isPurchase) {
        invTypeTitle = 'فاتورة شراء';
        invLabel = inv.notes || 'فاتورة شراء قطع / ملحقات من المورد';
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
        const sub = explicitType.replace('sale_', '');
        invTypeTitle = `فاتورة مبيعات (${sub})`;
        invLabel = `فاتورة مبيعات - ${sub}`;
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

      entries.push({
        id: `inv-cost-${inv.id}`,
        date: invDate,
        type: invTypeTitle,
        label: invLabel,
        reference: String(inv.invoiceNumber).replace(/#/g, ''),
        notes: inv.notes || itemNotes || 'فاتورة خدمات/مبيعات',
        debit: isPurchase ? 0 : actualCost,
        credit: isPurchase ? actualCost : 0
      });
    });

    const targetCustLiabilityCurrency = targetCust.liabilityCurrency || alertItem.currency || 'USD';
    const customerTransactions = transactionsList.filter(tx => 
      ((targetCust.id && tx.customerId === targetCust.id) || (targetCust.name && tx.customerName === targetCust.name)) &&
      !tx.isReversed &&
      !tx.isReversal &&
      tx.status !== 'reversed' &&
      tx.status !== 'reversal'
    );

    customerTransactions.forEach(tx => {
      const txDate = parseTxDate(tx);
      const liabilityAmount = (tx.liabilityAmount !== undefined && tx.liabilityAmount !== null && !isNaN(Number(tx.liabilityAmount))) 
        ? Number(tx.liabilityAmount) 
        : Math.abs(Number(tx.amount || 0));

      const rawAmount = Math.abs(Number(tx.amount || 0));
      const payCurr = tx.currency || tx.receiptCurrency || '';

      let currencyNote = '';
      if (payCurr && targetCustLiabilityCurrency && payCurr.toUpperCase() !== targetCustLiabilityCurrency.toUpperCase() && rawAmount > 0) {
        currencyNote = ` [المسدد فعلياً: ${rawAmount.toLocaleString('en-US')} ${payCurr} | المعادل بالذمة: ${liabilityAmount.toLocaleString('en-US')} ${targetCustLiabilityCurrency}]`;
      }

      if (tx.type === 'receipt' || tx.type === 'invoice_payment') {
        const isLinkedToInvoice = !!tx.invoiceNumber;
        let docType = 'سند قبض';
        let statement = tx.transactionCategory || 'سند قبض / دفعه تحت الحساب';
        let details = (tx.statementNote || tx.notes || '') + currencyNote;
        let refStr = String(tx.voucherNumber || tx.id?.substring(0, 5)).replace(/#/g, '');

        if (isLinkedToInvoice) {
           docType = 'سند قبض';
           statement = `سند قبض / سداد في فاتورة رقم ${tx.invoiceNumber}`;
           refStr = String(tx.voucherNumber || tx.invoiceNumber).replace(/#/g, '');
        }

        entries.push({
          id: `tx-${tx.id}`,
          date: txDate,
          type: docType,
          label: statement,
          reference: refStr,
          notes: details,
          debit: 0,
          credit: liabilityAmount
        });
      } else if (tx.type === 'payment') {
        const refStr = String(tx.voucherNumber || tx.invoiceNumber || tx.id?.substring(0, 5)).replace(/#/g, '');
        const labelStr = (tx.notes || (tx.invoiceNumber ? `سند صرف قيمة فاتورة مشتريات رقم ${tx.invoiceNumber}` : (tx.transactionCategory || 'سند صرف'))) + currencyNote;
        entries.push({
          id: `tx-${tx.id}`,
          date: txDate,
          type: 'سند صرف',
          label: labelStr,
          reference: refStr,
          notes: (tx.notes || '') + currencyNote,
          debit: liabilityAmount,
          credit: 0
        });
      }
    });

    entries.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const activeEntries = entries.filter(e => e.debit > 0.001 || e.credit > 0.001);
    let balance = 0;
    const formattedEntries = activeEntries.map(entry => {
      balance += entry.debit - entry.credit;
      return {
        ...entry,
        formattedDate: formatDateTime(entry.date),
        runningBalance: balance
      };
    });

    const getArabicCurrencyName = (currCode: string) => {
      if (!currCode) return 'دولار';
      if (currCode.toUpperCase() === 'USD') return 'دولار';
      if (currCode.toUpperCase() === 'YER') return 'ريال يمني';
      if (currCode.toUpperCase().includes('USD') && currCode.toUpperCase().includes('YER')) return 'دولار / ريال يمني';
      return currCode;
    };
    const arCurrency = getArabicCurrencyName(targetCustLiabilityCurrency);

    let totalDebit = 0;
    let totalCredit = 0;
    formattedEntries.forEach(e => {
      totalDebit += e.debit;
      totalCredit += e.credit;
    });
    const diff = totalCredit - totalDebit;
    const isCreditor = diff > 0.01;
    const isDebtor = diff < -0.01;
    const balanceStatus = isCreditor ? 'دائن (له في الحساب)' : isDebtor ? 'مدين (متبقي عليه ديون)' : 'متزن الحساب';

    setPreviewData({
      type: 'statement',
      data: {
        statement: {
          customerName: targetCust.name,
          companyName: targetCust.companyName || '',
          customerPhone: targetCust.phone1 || '',
          customerNumber: targetCust.customerNumber || targetCust.id?.substring(0, 5) || '',
          balance: diff,
          balanceStatus: balanceStatus,
          currency: arCurrency,
          liabilityCurrency: targetCustLiabilityCurrency,
          entries: formattedEntries
        }
      }
    });
  };

  const handleSettleSubmit = async () => {
    if (!settleInvoice || !settleAmount || isNaN(Number(settleAmount))) return;
    setIsSettling(true);
    try {
      const amount = Number(settleAmount);
      const batch = writeBatch(db);
      
      const invId = settleInvoice.invoiceId || settleInvoice.id || '';
      const invoiceRef = doc(db, 'invoices', invId);
      const updatedAmountPaid = Number(settleInvoice.amountPaid || 0) + amount;
      
      batch.update(invoiceRef, {
        amountPaid: updatedAmountPaid,
        updatedAt: serverTimestamp()
      });

      let nextVoucherNum = 1;
      try {
        const { localDb } = await import('./lib/local-db');
        const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 0) as maxNum FROM vault_transactions");
        nextVoucherNum = (resNum.values?.[0]?.maxNum || 0) + 1;
      } catch (e) {}

      const timestampIso = new Date().toISOString();
      const txRef = doc(collection(db, 'vault_transactions'));
      batch.set(txRef, {
        id: txRef.id,
        currency: settleInvoice.currency || 'USD',
        amount: amount,
        customerName: settleInvoice.customerName || 'عميل نقدي',
        customerId: settleInvoice.customerId || '',
        invoiceNumber: String(settleInvoice.invoiceNumber || '').replace('#', '').trim(),
        invoiceId: invId,
        userName: user?.name || user?.username || 'مدير النظام',
        userId: user?.id || 'admin',
        timestamp: timestampIso,
        updatedAt: timestampIso,
        voucherNumber: nextVoucherNum,
        type: 'receipt',
        transactionCategory: 'سداد تنبيهات',
        paymentType: 1,
        liabilityCurrency: settleInvoice.currency || 'USD',
        liabilityAmount: amount,
        receiptCurrency: settleInvoice.currency || 'USD',
        receiptAmount: amount,
        notes: `تسوية جزئية/كلية من خلال نافذة التنبيهات للفاتورة ${settleInvoice.invoiceNumber}`
      });

      await batch.commit();
      setSettleInvoice(null);
      setSettleAmount('');
      alert('تم تسجيل عملية الدفع والخصم من المستحقات وتحديث الخزنة بنجاح!');
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء عملية السداد والخصم.');
    } finally {
      setIsSettling(false);
    }
  };



  useEffect(() => {
    document.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
  }, [i18n.language]);

  useEffect(() => {
    const applyTheme = () => {
      try {
        const settings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
        const currentAppearance = settings.appearance !== undefined ? settings.appearance : 'auto';
        
        let isLight = false;
        if (currentAppearance === 'normal') {
          isLight = true;
        } else if (currentAppearance === 'dark') {
          isLight = false;
        } else {
          // 'auto' (حسب وضع الهاتف)
          const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          isLight = !prefersDark;
        }

        if (isLight) {
          document.documentElement.classList.add('light-app');
        } else {
          document.documentElement.classList.remove('light-app');
        }
        setShowAlertsBell(settings.showAlertsBell !== false);
      } catch (e) {
        console.error("Theme apply failed", e);
      }
    };
    applyTheme();

    const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const handleMediaChange = () => {
      try {
        const settings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
        const currentAppearance = settings.appearance !== undefined ? settings.appearance : 'auto';
        if (currentAppearance === 'auto') {
          applyTheme();
        }
      } catch (e) {}
    };

    if (mediaQuery) {
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleMediaChange);
      } else if ((mediaQuery as any).addListener) {
        (mediaQuery as any).addListener(handleMediaChange);
      }
    }

    window.addEventListener('snd_settings_changed', applyTheme);
    return () => {
      window.removeEventListener('snd_settings_changed', applyTheme);
      if (mediaQuery) {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', handleMediaChange);
        } else if ((mediaQuery as any).removeListener) {
          (mediaQuery as any).removeListener(handleMediaChange);
        }
      }
    };
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        // Check for session in localStorage
        const savedUser = sessionStorage.getItem('snd_user');
        if (savedUser) {
          setUser(JSON.parse(savedUser));
          checkAutoBackup();
        }

        // Fetch Shop Config with timeout/resilience
        // We'll try to get it, if it fails we just log it and proceed
        try {
          // Cleanup legacy 'shop' document from 'settings' collection
          try {
            await deleteDoc(doc(db, 'settings', 'shop'));
            await localDb.run("DELETE FROM settings WHERE id = 'shop'");
          } catch (cleanupErr) {
            console.warn("Could not cleanup legacy shop doc:", cleanupErr);
          }

          let loadedConfig: any = null;
          try {
            const localDetails = await localDb.query("SELECT * FROM company_details WHERE id = 'main_details' OR (shopName != '' AND shopName != 'اسم المؤسسة / المركز') ORDER BY CASE WHEN id = 'main_details' THEN 0 ELSE 1 END LIMIT 1");
            if (localDetails.values && localDetails.values.length > 0) {
              const det = localDetails.values[0];
              if ((det.name || det.shopName) && det.shopName !== 'اسم المؤسسة / المركز') {
                loadedConfig = det as ShopConfig;
                setShopConfig(loadedConfig);
              }
            }
          } catch (localErr) {}

          const shopSnap = await getDoc(doc(db, 'company_details', 'main_details'));
          if (shopSnap.exists()) {
            loadedConfig = { ...loadedConfig, ...shopSnap.data() as ShopConfig };
            setShopConfig(loadedConfig);
          } else if (!loadedConfig) {
            if (savedUser) setShowSetup(true);
          }
        } catch (shopErr) {
          console.warn("Failed to fetch shop config, might be offline:", shopErr);
        }

        // Ensure default admin exists - wrap in try to prevent blocking
        try {
          const adminDoc = await getDoc(doc(db, 'users', 'primary-admin'));
          if (!adminDoc.exists()) {
            await setDoc(doc(db, 'users', 'primary-admin'), {
              username: 'admin',
              password: 'admin',
              name: 'المدير العام',
              role: 'admin',
              isPrimary: true
            });
            console.log("Default admin created");
          }
        } catch (adminErr) {
          console.warn("Could not check/create admin, might be offline:", adminErr);
        }
      } catch (e) {
        console.error("Initialization error", e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleLogin = async (loggedInUser: User) => {
    setUser(loggedInUser);
    sessionStorage.setItem('snd_user', JSON.stringify(loggedInUser));
    sessionStorage.setItem('snd_security_unlocked', 'true');
    
    // Check if shop config exists in Cloud or SQLite before prompting for setup
    try {
      const shopSnap = await getDoc(doc(db, 'company_details', 'main_details'));
      if (shopSnap.exists()) {
        setShopConfig(shopSnap.data() as ShopConfig);
        setShowSetup(false);
        return;
      }
    } catch (e) {}

    try {
      const localDetails = await localDb.query("SELECT * FROM company_details WHERE id = 'main_details' OR (shopName != '' AND shopName != 'اسم المؤسسة / المركز') ORDER BY CASE WHEN id = 'main_details' THEN 0 ELSE 1 END LIMIT 1");
      if (localDetails.values && localDetails.values.length > 0) {
        const det = localDetails.values[0];
        if ((det.name || det.shopName) && det.id !== 'default-company') {
          setShopConfig(det as ShopConfig);
          setShowSetup(false);
          return;
        }
      }
    } catch (e) {}

    setShowSetup(true);
  };

  const handleSignOut = () => {
    setShowSignOutModal(true);
  };

  const confirmSignOut = async () => {
    if (user) {
      try {
        const devSnap = await getDocs(collection(db, 'user_devices'));
        const nowIso = new Date().toISOString();
        const uUsername = (user.username || '').toLowerCase().trim();
        const uName = (user.name || '').toLowerCase().trim();
        const uId = (user.id || '').toLowerCase().trim();

        for (const devDoc of devSnap.docs) {
          const d = { id: devDoc.id, ...devDoc.data() } as any;
          const dLinkedName = (d.linkedUserName || '').toLowerCase().trim();
          const dLinkedId = (d.linkedUserId || '').toLowerCase().trim();
          
          const isMatch = (
            (uUsername && dLinkedName === uUsername) ||
            (uName && dLinkedName === uName) ||
            (uId && dLinkedId === uId) ||
            (uUsername && dLinkedId === uUsername) ||
            (user.linked_device_id && (d.id === user.linked_device_id || d.serialImei === user.linked_device_id))
          );
          
          if (isMatch) {
            try {
              await updateDoc(doc(db, 'user_devices', devDoc.id), {
                lastLogout: nowIso,
                networkStatus: 'غير متصل'
              });
            } catch (err) {}
          }
        }
      } catch (e) {
        console.warn('Logout status update failed:', e);
      }
    }
    setUser(null);
    sessionStorage.removeItem('snd_user');
    sessionStorage.removeItem('snd_security_unlocked');
    sessionStorage.removeItem('alertsClosed');
    setShowSignOutModal(false);
  };

  const handleSetupComplete = (config: ShopConfig) => {
    setShopConfig(config);
    setShowSetup(false);
  };

  const checkAutoBackup = async () => {
    try {
      const settings = JSON.parse(localStorage.getItem('snd_settings') || '{}');
      if (!settings.autoBackup) return;

      const lastBackup = localStorage.getItem('last_auto_backup');
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      if (lastBackup !== todayStr) {
        // Check if current time matches or passed the backupTime
        const [targetH, targetM] = settings.backupTime.split(':').map(Number);
        if (now.getHours() > targetH || (now.getHours() === targetH && now.getMinutes() >= targetM)) {
          await runBackup(settings.backupPath);
          localStorage.setItem('last_auto_backup', todayStr);
        }
      }
    } catch (e) {
      console.error("Auto backup check failed", e);
    }
  };

  const runBackup = async (path: string) => {
    try {
      // Mock backup: Get all firestore data and save as JSON
      const collections = ['invoices', 'customers', 'inventory_items'];
      const backupData: any = {};
      
      for (const col of collections) {
        const snap = await getDocs(collection(db, col));
        backupData[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      await Filesystem.writeFile({
        path: `SND_App/Backups/backup_${new Date().getTime()}.json`,
        data: JSON.stringify(backupData),
        directory: Directory.Documents,
        recursive: true,
        encoding: Encoding.UTF8
      });
      console.log("Automatic backup completed successfully");
    } catch (e) {
      console.error("Backup execution failed", e);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-[#0f0f0f] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-orange-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  if (showSetup) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard 
            onNavigate={(tab: any, subView?: any) => {
              setVaultInitialProps(null);
              if (tab === 'entry-exit' && subView) {
                setEntryExitView(subView);
              }
              setActiveTab(tab);
            }} 
            shopName={shopConfig?.shopName} 
            fiscalYear={shopConfig?.fiscalYear} 
            activeAlertsCount={activeAlerts.length} 
            onShowAlerts={() => setShowAllAlertsModal(true)} 
            resetTrigger={dashboardResetTrigger}
          />
        );
      case 'entry-exit':
        return <EntryExit onBack={goToDashboard} user={user} view={entryExitView} setView={setEntryExitView} />;
      case 'device-movement':
        return <DeviceMovement onBack={goToDashboard} user={user} view={movementView} setView={setMovementView} />;
      case 'approval':
        return <ApprovalAndParts user={user} onBack={goToDashboard} />;
      case 'inspection':
        return <Inspection user={user} onBack={goToDashboard} />;
      case 'maintenance':
        return <Maintenance user={user} onBack={goToDashboard} />;
      case 'inventory':
        return <Inventory user={user} onBack={goToDashboard} />;
      case 'reports':
        return <Reports user={user} onBack={goToDashboard} />;
      case 'vault':
        return (
          <Vault 
            user={user} 
            shopConfig={shopConfig} 
            onBack={() => {
              setVaultInitialProps(null);
              goToDashboard();
            }} 
            initialSegment={vaultInitialProps?.segment}
            initialCustomerName={vaultInitialProps?.customerName}
            initialCustomerId={vaultInitialProps?.customerId}
            initialLiabilityCurrency={vaultInitialProps?.liabilityCurrency}
            initialShowAddModal={vaultInitialProps?.showAddModal}
            initialInvoiceNumber={vaultInitialProps?.invoiceNumber}
            initialInvoiceId={vaultInitialProps?.invoiceId}
            onClearInitialProps={() => setVaultInitialProps(null)}
          />
        );
      case 'customers':
        return <Customers user={user} shopConfig={shopConfig} onBack={goToDashboard} />;
      case 'settings':
        return (
          <Settings 
            user={user} 
            shopConfig={shopConfig} 
            onShopConfigUpdate={setShopConfig} 
            onSignOut={() => setShowSignOutModal(true)} 
            onNavigateToAdvancedMaintenance={() => setActiveTab('advanced-database-maintenance')}
          />
        );
      case 'advanced-database-maintenance':
        const canViewAdvMaintenance = user?.isPrimary || user?.role === 'admin' || !!user?.permissions?.settings_advanced_maintenance?.view;
        if (!canViewAdvMaintenance) {
          return (
            <Settings 
              user={user} 
              shopConfig={shopConfig} 
              onShopConfigUpdate={setShopConfig} 
              onSignOut={() => setShowSignOutModal(true)} 
              onNavigateToAdvancedMaintenance={() => setActiveTab('advanced-database-maintenance')}
            />
          );
        }
        return <AdvancedDatabaseMaintenance onBack={() => setActiveTab('settings')} />;
      case 'search':
        return <SearchInvoice onBack={goToDashboard} user={user} />;
      case 'device-management':
        return <DeviceManagement user={user} onBack={goToDashboard} shopConfig={shopConfig} />;
      case 'other-services':
        const storedTab = localStorage.getItem('otherServicesTab');
        let type: 'hub' | 'software' | 'maintenance' | 'parts' | 'purchase' | 'catalog' | 'stock' = 'hub';
        if (storedTab === 'software_services' || storedTab === 'software') type = 'software';
        if (storedTab === 'external_maintenance' || storedTab === 'maintenance') type = 'maintenance';
        if (storedTab === 'spare_parts' || storedTab === 'parts') type = 'parts';
        if (storedTab === 'purchase') type = 'purchase';
        if (storedTab === 'catalog') type = 'catalog';
        if (storedTab === 'stock') type = 'stock';
        return <OtherServiceInvoice type={type} user={user} shopConfig={shopConfig} onBack={goToDashboard} />;
      default:
        return <Dashboard onNavigate={setActiveTab} shopName={shopConfig?.shopName} fiscalYear={shopConfig?.fiscalYear} activeAlertsCount={activeAlerts.length} onShowAlerts={() => setShowAllAlertsModal(true)} resetTrigger={dashboardResetTrigger} />;
    }
  };

  return (
    <SecurityGuard>
      <div className={`min-h-screen bg-[#0a0a0a] text-gray-100 font-sans selection:bg-orange-500/30 ${i18n.language === 'ar' ? 'font-arabic' : ''}`} dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="flex h-screen overflow-hidden">
          {/* ... desktop navigation and main content handled below ... */}
          <aside className="w-20 lg:w-72 bg-[#0f0f0f] border-r border-white/5 flex-col hidden md:flex sticky top-0 h-screen transition-all z-50">
          <div className="p-6 flex items-center lg:justify-start justify-center gap-3">
            {shopConfig?.logoUrl ? (
              <img src={shopConfig.logoUrl} alt="Logo" className="w-10 h-10 rounded-xl object-contain shadow-lg shadow-black/50" />
            ) : (
              <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-900/20">
                <Router className="text-white w-6 h-6" />
              </div>
            )}
            <span className="font-black text-xl tracking-tighter text-white hidden lg:block truncate">{shopConfig?.shopName || 'SND SYSTEM'}</span>
          </div>

          <nav className="flex-1 px-4 py-8 space-y-2 overflow-hidden">
            <NavItem active={activeTab === 'dashboard'} onClick={goToDashboard} icon={<LayoutDashboard size={22} />} label={t('common.dashboard')} />
            <NavItem active={activeTab === 'entry-exit'} onClick={() => { setVaultInitialProps(null); setEntryExitView('hub'); setActiveTab('entry-exit'); }} icon={<FilePlus size={22} />} label={t('common.entryExit')} />
            <NavItem active={activeTab === 'vault'} onClick={() => { setVaultInitialProps(null); setActiveTab('vault'); }} icon={<CircleDollarSign size={22} />} label={t('common.vault')} />
            <NavItem active={activeTab === 'customers'} onClick={() => { setVaultInitialProps(null); setActiveTab('customers'); }} icon={<Users size={22} />} label={t('common.customers')} />
            <NavItem active={activeTab === 'device-movement'} onClick={() => { setVaultInitialProps(null); setMovementView('hub'); setActiveTab('device-movement'); }} icon={<SettingsIcon size={22} />} label={t('common.deviceMovement')} />
            <NavItem active={activeTab === 'inspection'} onClick={() => { setVaultInitialProps(null); setActiveTab('inspection'); }} icon={<ClipboardCheck size={22} />} label="فحص" />
            <NavItem active={activeTab === 'maintenance'} onClick={() => { setVaultInitialProps(null); setActiveTab('maintenance'); }} icon={<Wrench size={22} />} label="صيانة" />
          </nav>

          <div className="p-4 border-t border-white/5 space-y-2">
            <button 
              onClick={handleSignOut} 
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all border border-red-500/20 group font-bold"
              title={t('common.signOut')}
            >
              <LogOut size={22} className="group-hover:scale-110 transition-transform" />
            </button>
          </div>
        </aside>

        {/* Main View Area */}
        <main className="flex-1 flex flex-col relative bg-[#0a0a0a] overflow-hidden">
          {/* Top Bar */}
          <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-white/5 px-4 md:px-8 py-3 flex items-center justify-between min-h-[64px]">
            <div className="flex items-center gap-3">
              <div className="md:hidden flex items-center gap-2 -mr-1.5">
                 {shopConfig?.logoUrl ? (
                   <img src={shopConfig.logoUrl} alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
                 ) : (
                   <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
                      <Router className="text-white w-5 h-5" />
                   </div>
                 )}
              </div>

              {activeTab !== 'dashboard' && (
                (() => {
                  const storedOtherTab = activeTab === 'other-services' ? localStorage.getItem('otherServicesTab') : null;
                  const isSubView = (activeTab === 'device-movement' && movementView !== 'hub') || 
                                    (activeTab === 'entry-exit' && entryExitView !== 'hub') ||
                                    (activeTab === 'other-services' && storedOtherTab && storedOtherTab !== 'hub');
                  return (
                    <button 
                      onClick={() => {
                        const handlers = (window as any).backHandlers || [];
                        if (handlers.length > 0) {
                          const topHandler = handlers[handlers.length - 1];
                          if (topHandler()) return;
                        }

                        if (activeTab === 'device-movement' && movementView !== 'hub') {
                          setMovementView('hub');
                        } else if (activeTab === 'entry-exit' && entryExitView !== 'hub') {
                          setEntryExitView('hub');
                        } else if (activeTab === 'other-services' && storedOtherTab && storedOtherTab !== 'hub') {
                          localStorage.setItem('otherServicesTab', 'hub');
                          window.dispatchEvent(new CustomEvent('changeOtherServicesTab', { detail: 'hub' }));
                        } else {
                          goToDashboard();
                        }
                      }}
                      className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all flex items-center justify-center"
                      title={isSubView ? "الرجوع للخلف" : "خروج للرئيسية"}
                    >
                      {isSubView ? (
                        <ArrowRight size={18} />
                      ) : (
                        <LogOut size={18} className="rotate-180 text-red-400 hover:text-red-300" />
                      )}
                    </button>
                  );
                })()
              )}

              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest font-cairo">
                {activeTab === 'other-services' ? 'الخدمات الإضافية' :
                 activeTab === 'device-management' ? 'إدارة الأجهزة' : 
                 activeTab === 'entry-exit' ? (
                   entryExitView === 'entry' ? 'دخول وخروج أجهزة - دخول أجهزة' :
                   entryExitView === 'exit' ? 'دخول وخروج أجهزة - خروج أجهزة' :
                   (i18n.language === 'ar' ? 'دخول وخروج أجهزة' : 'Device Entry & Exit')
                 ) :
                 activeTab === 'device-movement' ? (
                   movementView === 'inspection' ? 'قسم الصيانة - إجراء فحص' :
                   movementView === 'maintenance' ? 'قسم الصيانة - إجراء صيانة' :
                   movementView === 'approval' ? 'قسم الصيانة - انتظار الموافقة والقطع' :
                   (i18n.language === 'ar' ? 'قسم الصيانة' : 'Maintenance Department')
                 ) :
                 activeTab === 'inspection' ? (i18n.language === 'ar' ? 'فحص الأجهزة' : 'Inspection') :
                 activeTab === 'maintenance' ? (i18n.language === 'ar' ? 'صيانة الأجهزة' : 'Maintenance') :
                 activeTab === 'approval' ? (i18n.language === 'ar' ? 'انتظار الموافقة والقطع' : 'Approval & Parts') :
                 activeTab === 'vault' ? (i18n.language === 'ar' ? 'الحسابات' : 'Accounts') :
                 t(`common.${activeTab.replace(/-([a-z])/g, (g) => g[1].toUpperCase())}`)}
              </h2>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4">
              <div className="relative inline-flex items-center">
                <button
                  onClick={handleSyncClick}
                  onDoubleClick={handleSyncDoubleClick}
                  onMouseDown={handleSyncPressStart}
                  onMouseUp={handleSyncPressEnd}
                  onMouseLeave={handleSyncPressEnd}
                  onTouchStart={handleSyncPressStart}
                  onTouchEnd={handleSyncPressEnd}
                  onTouchCancel={handleSyncPressEnd}
                  disabled={isSyncingAll}
                  className={`p-2 rounded-xl transition-all relative border mr-1 cursor-pointer flex items-center justify-center select-none active:scale-95 disabled:opacity-50 ${
                    isSyncingAll
                      ? syncMode === 'advanced'
                        ? 'bg-purple-600/20 text-purple-400 border-purple-500/50 shadow-lg shadow-purple-900/30'
                        : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/50 shadow-lg shadow-emerald-900/30'
                      : ProviderFactory.getMode() === 'CLOUD' 
                        ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 border-blue-500/20'
                        : ProviderFactory.getMode() === 'LOCAL'
                          ? 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 border-orange-500/20'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border-emerald-500/20'
                  }`}
                  title="نقرة واحدة: مزامنة صندوق التحديثات (سريعة) | نقرة مزدوجة أو مطولة: مزامنة متقدمة شاملة لكامل البرنامج"
                >
                  <RefreshCw size={18} className={isSyncingAll ? "animate-spin" : ""} />
                  {isSyncingAll && (
                    <span className="absolute -top-1 -right-1 text-[8px] font-black px-1 rounded bg-black/90 text-amber-400 border border-amber-500/30">
                      {syncMode === 'advanced' ? 'شاملة' : 'سريعة'}
                    </span>
                  )}
                </button>

                {/* Small sync status indicator right next to the button */}
                {syncToast && (
                  <div className="absolute top-full mt-1.5 start-0 z-50 pointer-events-none whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                    <div className={`px-2 py-1 rounded-lg shadow-xl backdrop-blur-md border flex items-center gap-1.5 text-[10px] font-bold font-cairo leading-tight ${
                      syncToast.type === 'error'
                        ? 'bg-red-950/95 text-red-200 border-red-500/40 shadow-red-950/40'
                        : syncToast.type === 'info'
                          ? 'bg-[#161922]/95 text-cyan-300 border-cyan-500/30 shadow-black/80'
                          : 'bg-[#122316]/95 text-emerald-300 border-emerald-500/30 shadow-emerald-950/40'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        syncToast.type === 'error'
                          ? 'bg-red-400'
                          : syncToast.type === 'info'
                            ? 'bg-cyan-400 animate-ping'
                            : 'bg-emerald-400'
                      }`} />
                      <span>{syncToast.message}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Notification Bell */}
              {showAlertsBell && (
                <button
                  onClick={() => setShowAllAlertsModal(true)}
                  className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded-xl transition-all relative border border-amber-500/20 mr-1 cursor-pointer flex items-center justify-center"
                  title="التنبيهات والمستحقات"
                >
                  <Bell size={18} className={activeAlerts.length > 0 ? "animate-pulse" : ""} />
                  {activeAlerts.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-black rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center shadow-sm">
                      {activeAlerts.length}
                    </span>
                  )}
                </button>
              )}

              <button
                onClick={() => setShowDataAuditModal(true)}
                className="p-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 rounded-xl transition-all relative border border-orange-500/20 mr-1 cursor-pointer flex items-center justify-center"
                title="تدقيق ومطابقة السجلات وتصحيح التضاربات"
              >
                <ShieldCheck size={18} />
              </button>

              <button onClick={handleSignOut} className="flex items-center gap-2 mr-1 md:mr-0 group relative" title={t('common.signOut')}>
                <div className="text-right hidden sm:block group-hover:text-red-400 transition-colors">
                  <p className="text-[10px] font-bold text-gray-200 line-clamp-1">{user.name}</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 group-hover:bg-red-500 group-hover:text-white flex items-center justify-center transition-all relative">
                  <span className="absolute group-hover:opacity-0 transition-opacity font-black text-xs font-mono">{user.name.charAt(0)}</span>
                  <LogOut size={14} className="opacity-0 group-hover:opacity-100 absolute transition-opacity" />
                </div>
              </button>

              <div className="md:hidden flex items-center">
                 <button 
                   onClick={() => setActiveTab('settings')}
                   className="p-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/5 transition-all text-gray-400 hover:text-white"
                 >
                   <MoreVertical size={20} />
                 </button>
              </div>
            </div>
          </header>

          {/* Active Alerts Banner Area Removed */}

          {/* Tab Content */}
          <div className={`flex-1 ${activeTab === 'dashboard' ? 'overflow-hidden' : 'overflow-y-auto'} ${['search', 'customers', 'inspection', 'maintenance', 'inventory', 'vault', 'device-movement', 'approval', 'entry-exit'].includes(activeTab) ? 'p-0 pb-28 md:pb-8' : 'p-4 md:p-8 pb-28 md:pb-8'}`}>
            <div className={`${['search', 'customers', 'inspection', 'maintenance', 'inventory', 'vault', 'device-movement', 'approval', 'entry-exit'].includes(activeTab) ? 'w-full' : 'max-w-7xl mx-auto'} h-full`}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {renderContent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom Navigation - Mobile Only */}
          <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-[#0f0f0f]/90 backdrop-blur-xl border-t border-gray-200 dark:border-white/5 py-2 px-6 flex items-center justify-around shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] dark:shadow-2xl mobile-bottom-nav" dir="rtl">
            <MobileNavItem 
              active={activeTab === 'entry-exit'} 
              onClick={() => { setEntryExitView('hub'); setActiveTab('entry-exit'); }} 
              icon={<ArrowRightLeft size={22} />} 
              label="دخول وخروج أجهزة"
              colorClass="text-orange-500"
            />
            <MobileNavItem 
              active={activeTab === 'inspection'} 
              onClick={() => setActiveTab('inspection')} 
              icon={<ClipboardCheck size={22} />} 
              label="فحص"
              colorClass="text-purple-500"
            />
            <div className="relative -top-3">
              <button 
                onClick={goToDashboard}
                className="w-14 h-14 bg-white dark:bg-[#1a1a1a] rounded-full flex flex-col items-center justify-center shadow-xl ring-4 ring-gray-100 dark:ring-[#0f0f0f] mobile-center-btn border border-gray-200 dark:border-white/5 cursor-pointer active:scale-95 transition-transform"
                title="الصفحة الرئيسية / العداد الرئيسي"
              >
                <div className="grid grid-cols-2 gap-[2px] w-[20px] h-[20px]">
                  <div className="bg-orange-600 rounded-[3px]"></div>
                  <div className="bg-blue-600 rounded-[3px]"></div>
                  <div className="bg-amber-500 rounded-[3px]"></div>
                  <div className="bg-emerald-600 rounded-[3px]"></div>
                </div>
              </button>
            </div>
            <MobileNavItem 
              active={activeTab === 'approval'} 
              onClick={() => setActiveTab('approval')} 
              icon={<Clock size={22} />} 
              label="انتظار الموافقة والقطع"
              colorClass="text-amber-500"
            />
            <MobileNavItem 
              active={activeTab === 'maintenance'} 
              onClick={() => setActiveTab('maintenance')} 
              icon={<Wrench size={22} />} 
              label="صيانة"
              colorClass="text-emerald-500"
            />
          </nav>
        </main>
      </div>
    </div>

    {/* Detailed Alerts Modal */}
    <AnimatePresence>
      {showAllAlertsModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-cairo text-right" dir="rtl">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative w-full max-w-4xl bg-[#0f0f0f] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-[#141414]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                  <Bell size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">إشعارات التنبيه والضمان والمستحقات</h3>
                  <p className="text-xs text-gray-400 mt-0.5">تتبع الفواتير المتأخرة وضمانات الأجهزة النشطة والمنتهية حديثاً.</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAllAlertsModal(false);
                  setSettleInvoice(null);
                }}
                className="p-2 hover:bg-white/5 text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabs Selection */}
            <div className="flex border-b border-white/5 bg-[#121212] p-1 gap-1 m-4 rounded-xl">
              <button
                onClick={() => {
                  setAlertsTab('outstanding');
                  setSettleInvoice(null);
                }}
                className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  alertsTab === 'outstanding'
                    ? 'bg-amber-500 text-black font-black shadow-lg shadow-amber-500/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <CircleDollarSign size={16} />
                الفواتير المستحقة والديون ({activeAlerts.filter(a => a.type === 'outstanding').length})
              </button>
              <button
                onClick={() => {
                  setAlertsTab('warranty');
                  setSettleInvoice(null);
                }}
                className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  alertsTab === 'warranty'
                    ? 'bg-amber-500 text-black font-black shadow-lg shadow-amber-500/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Clock size={16} />
                متابعة صلاحية الضمان ({activeAlerts.filter(a => a.type.startsWith('warranty')).length})
              </button>
            </div>

            {/* Modal Body / Tab Content */}
            <div className="flex-1 overflow-y-auto p-6 min-h-[300px]">
              {alertsTab === 'outstanding' ? (
                /* Outstanding Invoices & Debts Tab */
                <div>
                  {activeAlerts.filter(a => a.type === 'outstanding').length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <CheckCircle size={48} className="text-emerald-500 mx-auto mb-3 opacity-60" />
                      <p className="font-bold text-sm">ممتاز! لا توجد فواتير معلقة أو ديون غير مسددة حالياً.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Search & Sort Controls Bar */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="p-1.5 bg-amber-500/10 text-amber-500 rounded-lg">
                            <Users size={16} />
                          </div>
                          <span className="text-xs sm:text-sm font-black text-white font-cairo">
                            العملاء ذوو الذمم والمستحقات ({getProcessedOutstandingAlerts().length})
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-1 sm:justify-end">
                          {/* Search input field: by customer name or invoice number */}
                          <div className="relative flex-1 sm:max-w-xs">
                            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <input
                              type="text"
                              value={alertsSearchQuery}
                              onChange={(e) => setAlertsSearchQuery(e.target.value)}
                              placeholder="بحث بالاسم أو رقم الفاتورة..."
                              className="w-full bg-[#161616] border border-white/10 focus:border-amber-500/50 rounded-xl pr-8 pl-8 py-2 text-xs text-white placeholder-gray-500 outline-none transition-all font-cairo shadow-inner"
                            />
                            {alertsSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setAlertsSearchQuery('')}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                                title="تفريغ البحث"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>

                          {/* Small icon sort filter ("رمز صغير") */}
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setShowAlertsSortDropdown(!showAlertsSortDropdown)}
                              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                                showAlertsSortDropdown 
                                  ? 'bg-amber-500 text-black border-amber-500 shadow-md shadow-amber-500/20 font-bold' 
                                  : 'bg-white/5 hover:bg-amber-500/20 text-gray-300 hover:text-amber-400 border-white/10'
                              }`}
                              title={`ترتيب: ${
                                alertsSortType === 'alpha' ? (alertsSortDir === 'asc' ? 'الاسم (أ - ي)' : 'الاسم (ي - أ)') :
                                alertsSortType === 'date' ? (alertsSortDir === 'desc' ? 'الأحدث تسجيلاً' : 'الأقدم تسجيلاً') :
                                (alertsSortDir === 'desc' ? 'المديونية الأعلى' : 'المديونية الأقل')
                              }`}
                            >
                              <ArrowUpDown size={15} />
                            </button>

                            {/* Dropdown Menu with Backdrop */}
                            {showAlertsSortDropdown && (
                              <>
                                <div 
                                  className="fixed inset-0 z-40" 
                                  onClick={() => setShowAlertsSortDropdown(false)} 
                                />
                                <div className="absolute z-50 left-0 mt-2 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl p-1.5 w-56 space-y-1">
                                  <div className="px-3 py-1.5 text-[10px] text-gray-400 font-bold border-b border-white/5">
                                    خيارات ترتيب المستحقات:
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertsSortType('alpha');
                                      setAlertsSortDir('asc');
                                      setShowAlertsSortDropdown(false);
                                    }}
                                    className={`w-full text-right px-3 py-2 text-xs rounded-xl font-bold font-cairo transition-colors cursor-pointer flex items-center justify-between ${
                                      alertsSortType === 'alpha' && alertsSortDir === 'asc' ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-white/10'
                                    }`}
                                  >
                                    <span>حسب الاسم (أ إلى ي)</span>
                                    <span className="text-[10px] opacity-75">أ - ي</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertsSortType('alpha');
                                      setAlertsSortDir('desc');
                                      setShowAlertsSortDropdown(false);
                                    }}
                                    className={`w-full text-right px-3 py-2 text-xs rounded-xl font-bold font-cairo transition-colors cursor-pointer flex items-center justify-between ${
                                      alertsSortType === 'alpha' && alertsSortDir === 'desc' ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-white/10'
                                    }`}
                                  >
                                    <span>حسب الاسم (ي إلى أ)</span>
                                    <span className="text-[10px] opacity-75">ي - أ</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertsSortType('date');
                                      setAlertsSortDir('desc');
                                      setShowAlertsSortDropdown(false);
                                    }}
                                    className={`w-full text-right px-3 py-2 text-xs rounded-xl font-bold font-cairo transition-colors cursor-pointer flex items-center justify-between ${
                                      alertsSortType === 'date' && alertsSortDir === 'desc' ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-white/10'
                                    }`}
                                  >
                                    <span>حسب الأحدث (تاريخ التسجيل)</span>
                                    <span className="text-[10px] opacity-75">الأحدث</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertsSortType('date');
                                      setAlertsSortDir('asc');
                                      setShowAlertsSortDropdown(false);
                                    }}
                                    className={`w-full text-right px-3 py-2 text-xs rounded-xl font-bold font-cairo transition-colors cursor-pointer flex items-center justify-between ${
                                      alertsSortType === 'date' && alertsSortDir === 'asc' ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-white/10'
                                    }`}
                                  >
                                    <span>حسب الأقدم (تاريخ التسجيل)</span>
                                    <span className="text-[10px] opacity-75">الأقدم</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertsSortType('debt');
                                      setAlertsSortDir('desc');
                                      setShowAlertsSortDropdown(false);
                                    }}
                                    className={`w-full text-right px-3 py-2 text-xs rounded-xl font-bold font-cairo transition-colors cursor-pointer flex items-center justify-between ${
                                      alertsSortType === 'debt' && alertsSortDir === 'desc' ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-white/10'
                                    }`}
                                  >
                                    <span>حسب المديونية الأعلى (الأكثر أولاً)</span>
                                    <span className="text-[10px] opacity-75">الأعلى</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAlertsSortType('debt');
                                      setAlertsSortDir('asc');
                                      setShowAlertsSortDropdown(false);
                                    }}
                                    className={`w-full text-right px-3 py-2 text-xs rounded-xl font-bold font-cairo transition-colors cursor-pointer flex items-center justify-between ${
                                      alertsSortType === 'debt' && alertsSortDir === 'asc' ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-white/10'
                                    }`}
                                  >
                                    <span>حسب المديونية الأقل (الأقل أولاً)</span>
                                    <span className="text-[10px] opacity-75">الأقل</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Content: Results Table or Empty Search Result */}
                      {getProcessedOutstandingAlerts().length === 0 ? (
                        <div className="text-center py-12 text-gray-400 bg-white/[0.01] border border-white/5 rounded-2xl">
                          <AlertCircle size={40} className="text-amber-500 mx-auto mb-3 opacity-60" />
                          <p className="font-bold text-sm text-gray-200">لا توجد نتائج مطابقة لبحثك "{alertsSearchQuery}"</p>
                          <p className="text-xs text-gray-500 mt-1">تأكد من كتابة الاسم أو رقم الفاتورة بشكل صحيح أو قم بتفريغ حقل البحث.</p>
                          <button
                            type="button"
                            onClick={() => setAlertsSearchQuery('')}
                            className="mt-3 px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-amber-400 text-xs rounded-xl font-bold transition-all border border-white/10 cursor-pointer"
                          >
                            مسح نص البحث
                          </button>
                        </div>
                      ) : (
                        /* Table of Customers with Outstanding Balances */
                        <div className="overflow-x-auto border border-white/5 rounded-2xl">
                          <table className="w-full text-right border-collapse">
                          <thead>
                            <tr className="bg-white/5 border-b border-white/5 text-gray-400 text-xs font-bold">
                              <th 
                                onClick={() => handleAlertsSortClick('date')} 
                                className="p-4 cursor-pointer hover:text-white transition-colors"
                              >
                                رقم العميل / الفاتورة {alertsSortType === 'date' && (alertsSortDir === 'asc' ? '▲' : '▼')}
                              </th>
                              <th 
                                onClick={() => handleAlertsSortClick('alpha')} 
                                className="p-4 cursor-pointer hover:text-white transition-colors"
                              >
                                اسم العميل {alertsSortType === 'alpha' && (alertsSortDir === 'asc' ? '▲' : '▼')}
                              </th>
                              <th className="p-4">إجمالي الحساب</th>
                              <th className="p-4">المدفوع</th>
                              <th 
                                onClick={() => handleAlertsSortClick('debt')} 
                                className="p-4 cursor-pointer hover:text-white transition-colors"
                              >
                                المتبقي المطلوب {alertsSortType === 'debt' && (alertsSortDir === 'asc' ? '▲' : '▼')}
                              </th>
                              <th className="p-4 text-center">الإجراءات</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-xs">
                            {getProcessedOutstandingAlerts().map(a => (
                              <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                                <td className="p-4 font-mono font-bold text-white">
                                  {a.customerNumber ? `#${a.customerNumber}` : a.latestInvoiceNumber ? `#${a.latestInvoiceNumber}` : '-'}
                                </td>
                                <td className="p-4">
                                  <div className="font-bold text-gray-200">{a.customerName}</div>
                                  {a.companyName && <div className="text-[10px] text-gray-400">{a.companyName}</div>}
                                </td>
                                <td className="p-4 text-gray-300 font-mono font-bold">
                                  {Number(a.totalCost || 0).toLocaleString('en-US')} <span className="text-[10px] opacity-75 font-sans">{a.currency}</span>
                                </td>
                                <td className="p-4 text-emerald-400 font-mono font-bold">
                                  {Number(a.amountPaid || 0).toLocaleString('en-US')} <span className="text-[10px] opacity-75 font-sans">{a.currency}</span>
                                </td>
                                <td className="p-4 text-amber-500 font-mono font-black text-sm">
                                  {Number(a.remainingAmount || 0).toLocaleString('en-US')} <span className="text-[10px] opacity-75 font-sans">{a.currency}</span>
                                </td>
                                <td className="p-4">
                                  <div className="flex items-center justify-center gap-2">
                                    {/* زر تسديد دفعة */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowAllAlertsModal(false);
                                        setVaultInitialProps({
                                          segment: 'receipt',
                                          showAddModal: true,
                                          customerName: a.customerName,
                                          customerId: a.customerId,
                                          liabilityCurrency: a.currency,
                                          invoiceNumber: a.latestInvoiceNumber || '',
                                          invoiceId: a.latestInvoiceId || ''
                                        });
                                        setActiveTab('vault');
                                      }}
                                      className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-black rounded-xl text-xs font-black transition-all cursor-pointer border border-amber-500/20 shadow-sm flex items-center gap-1.5"
                                      title="تسديد دفعة / فتح سند قبض جديد"
                                    >
                                      <CircleDollarSign size={14} />
                                      <span>تسديد دفعة</span>
                                    </button>

                                    {/* زر استعراض */}
                                    <button
                                      type="button"
                                      onClick={() => handleOpenCustomerStatement(a)}
                                      className="px-3 py-1.5 bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer border border-white/10 flex items-center gap-1.5"
                                      title="معاينة كشف حساب العميل"
                                    >
                                      <Eye size={14} />
                                      <span>استعراض</span>
                                    </button>

                                    {/* زر تذكير سداد */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!a.customerPhone) {
                                          alert('لا يوجد رقم هاتف مسجل لهذا العميل');
                                          return;
                                        }
                                        sendUniversalReminder({
                                          customerName: a.customerName,
                                          phone: a.customerPhone,
                                          amount: a.remainingAmount,
                                          currency: a.currency || 'USD',
                                          invoiceNumber: a.latestInvoiceNumber || '',
                                          hasWhatsapp: a.hasWhatsapp !== undefined ? a.hasWhatsapp : true,
                                          countryCode: shopConfig?.countryCode,
                                          shopName: shopConfig?.shopName
                                        });
                                      }}
                                      className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl transition-all border border-emerald-500/20 cursor-pointer"
                                      title="إرسال تذكير سداد عبر واتساب أو SMS"
                                    >
                                      <MessageCircle size={15} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Warranty Tracking Tab */
                <div>
                  {activeAlerts.filter(a => a.type.startsWith('warranty')).length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <CheckCircle size={48} className="text-emerald-500 mx-auto mb-3 opacity-60" />
                      <p className="font-bold text-sm">لا توجد تنبيهات لضمانات أجهزة منتهية أو على وشك الانتهاء حالياً.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Search Bar for Warranty */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="p-1.5 bg-amber-500/10 text-amber-500 rounded-lg">
                            <Clock size={16} />
                          </div>
                          <span className="text-xs sm:text-sm font-black text-white font-cairo">
                            الأجهزة الخاضعة لمتابعة الضمان ({getProcessedWarrantyAlerts().length})
                          </span>
                        </div>

                        <div className="relative flex-1 sm:max-w-xs">
                          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          <input
                            type="text"
                            value={alertsSearchQuery}
                            onChange={(e) => setAlertsSearchQuery(e.target.value)}
                            placeholder="بحث بالاسم أو رقم الفاتورة أو الجهاز..."
                            className="w-full bg-[#161616] border border-white/10 focus:border-amber-500/50 rounded-xl pr-8 pl-8 py-2 text-xs text-white placeholder-gray-500 outline-none transition-all font-cairo shadow-inner"
                          />
                          {alertsSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setAlertsSearchQuery('')}
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                              title="تفريغ البحث"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {getProcessedWarrantyAlerts().length === 0 ? (
                        <div className="text-center py-12 text-gray-400 bg-white/[0.01] border border-white/5 rounded-2xl">
                          <AlertCircle size={40} className="text-amber-500 mx-auto mb-3 opacity-60" />
                          <p className="font-bold text-sm text-gray-200">لا توجد أجهزة مطابقة لبحثك "{alertsSearchQuery}"</p>
                          <p className="text-xs text-gray-500 mt-1">تأكد من كتابة اسم العميل، الجهاز، أو رقم الفاتورة بشكل صحيح أو قم بتفريغ حقل البحث.</p>
                          <button
                            type="button"
                            onClick={() => setAlertsSearchQuery('')}
                            className="mt-3 px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-amber-400 text-xs rounded-xl font-bold transition-all border border-white/10 cursor-pointer"
                          >
                            مسح نص البحث
                          </button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-white/5 rounded-2xl">
                          <table className="w-full text-right border-collapse">
                            <thead>
                              <tr className="bg-white/5 border-b border-white/5 text-gray-400 text-xs font-bold">
                                <th className="p-4">نوع وجهاز الصيانة</th>
                                <th className="p-4">الفاتورة المرجعية</th>
                                <th className="p-4 text-center">حالة الضمان</th>
                                <th className="p-4 text-center">تاريخ انتهاء الضمان</th>
                                <th className="p-4 text-center">الإجراء</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-xs">
                              {getProcessedWarrantyAlerts()
                                .map(a => (
                                  <tr key={a.id} className="hover:bg-white/[0.01] transition-colors">
                                    <td className="p-4 text-white font-bold">
                                      <span className="text-amber-500 text-[10px] bg-amber-500/10 px-2 py-0.5 rounded-md ml-2">{a.deviceType}</span>
                                      {a.deviceName}
                                      {a.customerName && <span className="text-[10px] text-gray-400 block mt-0.5">{a.customerName}</span>}
                                    </td>
                                    <td className="p-4 font-mono font-bold text-gray-300">#{a.invoiceNumber || '-'}</td>
                                    <td className="p-4 text-center">
                                      <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black ${
                                        a.type === 'warranty_soon'
                                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                      }`}>
                                        {a.type === 'warranty_soon' ? 'ينتهي قريباً جداً' : 'منتهي الصلاحية'}
                                      </span>
                                    </td>
                                    <td className="p-4 text-center text-gray-400 font-bold">{a.expiryDate}</td>
                                    <td className="p-4 text-center">
                                      <button
                                        onClick={() => {
                                          setShowAllAlertsModal(false);
                                          setActiveTab('search');
                                        }}
                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                                      >
                                        تفاصيل الفاتورة
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-white/5 bg-[#141414] text-left">
              <button
                onClick={() => {
                  setShowAllAlertsModal(false);
                  setSettleInvoice(null);
                }}
                className="p-2.5 bg-white/5 hover:bg-red-500/10 text-gray-400 hover:text-red-500 rounded-xl transition-all border border-white/5 cursor-pointer"
                title="إغلاق التنبيهات"
              >
                <X size={20} />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Customer Statement / Document Print Preview Overlay */}
    {previewData && (
      <PrintPreviewOverlay
        type={previewData.type}
        data={previewData.data}
        onClose={() => setPreviewData(null)}
        shopConfig={shopConfig}
        user={user}
      />
    )}

    {showSignOutModal && (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div
          className="bg-[#1a1a1a] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl text-center animate-in zoom-in-95 duration-150"
          dir="rtl"
        >
          <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
            <LogOut size={22} className="rotate-180" />
          </div>
          <h3 className="text-lg font-black text-white font-cairo mb-2">تسجيل الخروج</h3>
          <p className="text-sm text-gray-400 font-cairo mb-6">هل أنت متأكد من رغبتك في تسجيل الخروج من النظام؟</p>
          <div className="flex gap-3">
            <button
              onClick={confirmSignOut}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-2xl font-bold font-cairo transition-all cursor-pointer text-sm"
            >
              تسجيل الخروج
            </button>
            <button
              onClick={() => setShowSignOutModal(false)}
              className="flex-1 bg-[#242424] hover:bg-white/5 text-gray-300 py-3 rounded-2xl font-bold font-cairo border border-white/5 transition-all cursor-pointer text-sm"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Data Audit and Conflict Resolution Modal */}
    <DataAuditModal 
      isOpen={showDataAuditModal} 
      onClose={() => setShowDataAuditModal(false)} 
      user={user!} 
    />
    </SecurityGuard>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-center lg:justify-start gap-3 px-4 py-3.5 rounded-2xl transition-all duration-200 group relative ${
        active 
        ? 'bg-orange-600 text-white shadow-xl shadow-orange-900/30' 
        : 'text-gray-500 hover:text-white hover:bg-white/5'
      }`}
    >
      <span className={`${active ? 'text-white' : 'group-hover:scale-110 transition-transform'}`}>{icon}</span>
      <span className="font-bold text-sm hidden lg:block">{label}</span>
      {active && <motion.div layoutId="nav-active" className="absolute left-0 w-1 lg:hidden h-6 bg-white rounded-full translate-x-[-8px]" />}
    </button>
  );
}

function MobileNavItem({ active, onClick, icon, label, colorClass }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, colorClass: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all ${active ? colorClass : 'text-gray-400 dark:text-gray-500 hover:' + colorClass}`}
    >
      <div className={`p-1.5 rounded-lg transition-colors ${active ? 'bg-gray-100 dark:bg-white/10 shadow-inner' : ''}`}>
        {icon}
      </div>
      <span className={`text-[9px] font-black uppercase tracking-tighter opacity-80`}>{label}</span>
    </button>
  );
}
