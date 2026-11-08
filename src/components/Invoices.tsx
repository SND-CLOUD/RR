import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, Search as SearchIcon, Calendar, ArrowRight, Activity, 
  CheckCircle, Trash2, Plus, AlertTriangle, ShieldAlert, X, 
  ShieldCheck, ArrowUpDown, RefreshCw, Layers, Wrench, Package, 
  RotateCcw, Eye, Clock, Check, Filter, ChevronDown, Printer
} from 'lucide-react';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, getDoc, updateDoc } from '../firebase';
import { db } from '../firebase';
import { Invoice, InvoiceItem, User, OperationType, ShopConfig, isPurchaseInvoice, isSaleInvoice } from '../types';
import { handleFirestoreError } from '../lib/error-handler';
import { usePermissions } from '../hooks/usePermissions';
import { localDb } from '../lib/local-db';
import { ProviderFactory } from '../data/ProviderFactory';
import { deleteInvoiceWithCascade, checkIsPurchase, checkIsSale, restoreItemSparePartsToStock } from '../lib/invoiceCascadeService';
import { calculateInvoiceBillableTotal } from '../lib/billableService';
import { useBackHandler } from '../hooks/useBackHandler';

export default function Invoices({ 
  user, 
  onBack, 
  shopConfig 
}: { 
  user: User; 
  onBack: () => void; 
  shopConfig: ShopConfig | null;
}) {
  const { hasPermission } = usePermissions(user);
  
  // Permissions for invoices
  const canViewInvoices = user?.role === 'admin' || user?.isPrimary || hasPermission('invoices', 'view');
  const canEditInvoices = user?.role === 'admin' || user?.isPrimary || hasPermission('invoices', 'edit');
  const canAddInvoices = user?.role === 'admin' || user?.isPrimary || hasPermission('invoices', 'add');
  const canDeleteInvoices = user?.role === 'admin' || user?.isPrimary || hasPermission('invoices', 'delete');
  const canPrintInvoices = user?.role === 'admin' || user?.isPrimary || hasPermission('invoices', 'print');

  // Subview State: 'list' (main invoice table) or 'detail_action' (detailed invoice item modification)
  const [subview, setSubview] = useState<'list' | 'detail_action'>('list');
  const [showTimeFilters, setShowTimeFilters] = useState(false);

  // Back handler for android / web navigation
  useBackHandler(true, () => {
    if (subview === 'detail_action') {
      setSubview('list');
    } else {
      onBack();
    }
  });

  // Data states
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [timeFilter, setTimeFilter] = useState<'day' | 'week' | 'month' | 'custom' | 'all'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'maintenance' | 'other'>('all');

  // Categories and Models from system
  const [deviceCategories, setDeviceCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [deviceModels, setDeviceModels] = useState<Array<{ id: string; name: string; categoryId?: string }>>([]);

  // Table row interaction states
  const [detailedModes, setDetailedModes] = useState<Record<string, boolean>>({});
  const [invoiceStatuses, setInvoiceStatuses] = useState<Record<string, string>>({});
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Detailed Action States
  const [detailedSelectType, setDetailedSelectType] = useState<string>('NEW_DEVICE');
  const [detailedDeviceType, setDetailedDeviceType] = useState<string>('');
  const [detailedDeviceName, setDetailedDeviceName] = useState<string>('');
  const [detailedFaultType, setDetailedFaultType] = useState<string>('');
  const [detailedDeviceNotes, setDetailedDeviceNotes] = useState<string>('');
  const [detailedEngineerReport, setDetailedEngineerReport] = useState<string>('');
  const [detailedQuantity, setDetailedQuantity] = useState<number>(1);
  const [detailedPrice, setDetailedPrice] = useState<number>(0);
  const [detailedStatus, setDetailedStatus] = useState<string>('10');

  const [stagedChanges, setStagedChanges] = useState<Array<{
    id?: string;
    isNew: boolean;
    deviceType: string;
    deviceName: string;
    faultType: string;
    deviceNotes?: string;
    engineerReport?: string;
    technicalNotes?: string;
    quantity: number;
    unitCost: number;
    status: string;
  }>>([]);

  // Staged item IDs marked for deletion when saving invoice
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);

  // Format numbers in Western Arabic / English digits (0, 1, 2, 3...)
  const formatEnglishNumber = (val: number | string | undefined | null): string => {
    if (val === null || val === undefined || val === '') return '0';
    const num = typeof val === 'number' ? val : Number(val);
    if (isNaN(num)) return String(val);
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
  };

  const [saveLoading, setSaveLoading] = useState(false);
  const [reversalConfirmData, setReversalConfirmData] = useState<{
    invoice: Invoice;
    newStatus: string;
    transactionsToReverse: any[];
    isDetailed: boolean;
    onConfirm: () => void;
  } | null>(null);

  const [deleteConfirmData, setDeleteConfirmData] = useState<{
    invoice: Invoice;
    invoiceNumber: string;
    customerName: string;
    itemCount?: number;
  } | null>(null);

  const [activeAutocomplete, setActiveAutocomplete] = useState<{ type: 'deviceType' | 'deviceName' } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Helper date parser
  const parseDate = (d: any): Date | null => {
    if (!d) return null;
    if (d.toDate && typeof d.toDate === 'function') return d.toDate();
    if (d.seconds) return new Date(d.seconds * 1000);
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Fetch Invoices and Items from SQLite and sync with Firestore
  useEffect(() => {
    let isMounted = true;

    const loadLocalData = async () => {
      try {
        const invRes = await localDb.query("SELECT * FROM invoices");
        if (invRes.values && isMounted) {
          setInvoices(invRes.values);
        }
        const itmRes = await localDb.query("SELECT * FROM invoice_items");
        if (itmRes.values && isMounted) {
          setItems(itmRes.values);
        }
      } catch (e) {
        console.warn('Error loading initial local invoices:', e);
      }
    };
    loadLocalData();

    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (snapshot) => {
      const liveInvoices = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice));
      if (isMounted) setInvoices(liveInvoices);
    }, (err) => {
      console.warn('Invoices onSnapshot error:', err);
    });

    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (snapshot) => {
      const liveItems = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InvoiceItem));
      if (isMounted) setItems(liveItems);
    }, (err) => {
      console.warn('InvoiceItems onSnapshot error:', err);
    });

    const unsubCats = onSnapshot(collection(db, 'device_categories'), (s) => {
      setDeviceCategories(s.docs.map(d => ({ ...d.data(), id: d.id } as any)));
    });
    const unsubModels = onSnapshot(collection(db, 'device_models'), (s) => {
      setDeviceModels(s.docs.map(d => ({ ...d.data(), id: d.id } as any)));
    });

    const fetchLocalCats = async () => {
      try {
        const localCats = await localDb.query("SELECT * FROM device_categories");
        if (localCats.values && localCats.values.length > 0) {
          setDeviceCategories(prev => prev.length > 0 ? prev : localCats.values);
        }
        const localMods = await localDb.query("SELECT * FROM device_models");
        if (localMods.values && localMods.values.length > 0) {
          setDeviceModels(prev => prev.length > 0 ? prev : localMods.values);
        }
      } catch (e) {}
    };
    fetchLocalCats();

    return () => {
      isMounted = false;
      unsubInvoices();
      unsubItems();
      unsubCats();
      unsubModels();
    };
  }, []);

  // Registered helpers for inputs
  const registeredCategoryNames = Array.from(
    new Set([
      ...deviceCategories.map(c => String(c.name || '').trim()).filter(Boolean),
      ...items.map(i => String(i.deviceType || '').trim()).filter(Boolean)
    ])
  );

  const registeredModelNames = Array.from(
    new Set([
      ...deviceModels.map(m => String(m.name || '').trim()).filter(Boolean),
      ...items.map(i => String(i.deviceName || '').trim()).filter(Boolean)
    ])
  );

  const filteredModelNames = String(detailedDeviceType || '').trim()
    ? Array.from(
        new Set([
          ...deviceModels
            .filter(m => {
              const catId = String(detailedDeviceType || '').trim().replace(/\//g, '_');
              return m.categoryId === catId || m.categoryId === String(detailedDeviceType || '').trim();
            })
            .map(m => String(m.name || '').trim())
            .filter(Boolean),
          ...items
            .filter(i => String(i.deviceType || '').trim() === String(detailedDeviceType || '').trim())
            .map(i => String(i.deviceName || '').trim())
            .filter(Boolean)
        ])
      )
    : registeredModelNames;

  // Maintenance statuses (10 - 60)
  const MAINTENANCE_STATUSES = [
    { value: '10', label: '10 - دخول جديد (استلام)' },
    { value: '20', label: '20 - فحص (تشخيص العطل)' },
    { value: '30', label: '30 - انتظار الموافقة والقطع' },
    { value: '40', label: '40 - صيانة (قيد الإصلاح)' },
    { value: '50', label: '50 - جاهز للتسليم (مكتمل)' },
    { value: '60', label: '60 - تم التسليم (خروج نهائي)' }
  ];

  // Other services statuses
  const OTHER_SERVICES_STATUSES = [
    { value: 'purchase_parts', label: 'فاتورة شراء ملحقات وقطع' },
    { value: 'sale_parts', label: 'فاتورة بيع ملحقات وقطع' },
    { value: 'sale_maintenance', label: 'فاتورة صيانة خارجية' },
    { value: 'sale_software', label: 'فاتورة خدمات برمجية' }
  ];

  // Combined statuses
  const ALL_STATUSES = [
    ...MAINTENANCE_STATUSES,
    ...OTHER_SERVICES_STATUSES
  ];

  const DEVICE_STATUSES = MAINTENANCE_STATUSES;

  // Smart helper to detect if an invoice belongs to other services
  const isOtherServiceInvoice = (inv: Invoice | null | undefined): boolean => {
    if (!inv) return false;
    const rawStatus = String(inv.status || '').trim();
    if (['purchase_parts', 'sale_parts', 'sale_maintenance', 'sale_software'].includes(rawStatus)) {
      return true;
    }
    if (isPurchaseInvoice(inv) || checkIsPurchase(inv)) {
      return true;
    }
    if (isSaleInvoice(inv) || checkIsSale(inv)) {
      return true;
    }
    const explicitType = String(inv.invoiceType || (inv as any).templateType || (inv as any).type || '').trim().toLowerCase();
    if (['purchase', 'sale_software', 'sale_maintenance', 'sale_parts', 'software', 'parts'].includes(explicitType)) {
      return true;
    }
    const invNo = String(inv.invoiceNumber || '').trim().toUpperCase();
    if (invNo.startsWith('PUR-') || invNo.startsWith('DIS-') || invNo.startsWith('O-')) {
      return true;
    }
    return false;
  };

  // Smart function to determine available statuses for an invoice
  const getAvailableStatusesForInvoice = (inv: Invoice | null | undefined): Array<{ value: string; label: string }> => {
    if (!inv) return ALL_STATUSES;
    if (isOtherServiceInvoice(inv)) {
      const currentResolved = resolveInvoiceStatus(inv);
      const matched = OTHER_SERVICES_STATUSES.filter(s => s.value === currentResolved);
      if (matched.length > 0) return matched;
      return OTHER_SERVICES_STATUSES;
    }
    return MAINTENANCE_STATUSES;
  };

  const getStatusLabel = (st: string) => {
    const found = ALL_STATUSES.find(s => s.value === st);
    if (found) return found.label;
    if (st === 'purchase_parts') return 'فاتورة شراء ملحقات وقطع';
    if (st === 'sale_parts') return 'فاتورة بيع ملحقات وقطع';
    if (st === 'sale_maintenance') return 'فاتورة صيانة خارجية';
    if (st === 'sale_software') return 'فاتورة خدمات برمجية';
    if (st === 'new') return '10 - دخول جديد';
    if (st === 'testing') return '20 - فحص';
    if (st === 'awaiting_approval') return '30 - انتظار موافقة';
    if (st === 'repairing') return '40 - صيانة';
    if (st === 'ready') return '50 - جاهز للتسليم';
    if (st === 'delivered') return '60 - تم التسليم';
    return st || '10 - دخول جديد';
  };

  const getStatusSelectStyle = (val: string) => {
    switch (val) {
      case 'purchase_parts':
        return 'text-sky-300 border-sky-500/40 bg-sky-950/50';
      case 'sale_parts':
        return 'text-emerald-300 border-emerald-500/40 bg-emerald-950/50';
      case 'sale_maintenance':
        return 'text-amber-300 border-amber-500/40 bg-amber-950/50';
      case 'sale_software':
        return 'text-purple-300 border-purple-500/40 bg-purple-950/50';
      case '60':
        return 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30';
      case '50':
        return 'text-cyan-300 border-cyan-500/30 bg-cyan-950/30';
      case '40':
        return 'text-yellow-300 border-yellow-500/30 bg-yellow-950/30';
      case '30':
        return 'text-orange-300 border-orange-500/30 bg-orange-950/30';
      case '20':
        return 'text-blue-300 border-blue-500/30 bg-blue-950/30';
      case '10':
      default:
        return 'text-white border-white/10 bg-black/60';
    }
  };

  const computeInvoiceStatusFromItems = (itemsList: Array<{ status: string }>, currentInvoice?: Invoice | null): string => {
    // 1. If any item has explicit other-services status, it takes precedence
    const itemWithOtherStatus = itemsList?.find(it => 
      ['purchase_parts', 'sale_parts', 'sale_maintenance', 'sale_software'].includes(String(it.status || ''))
    );
    if (itemWithOtherStatus) {
      return String(itemWithOtherStatus.status);
    }

    // 2. If current invoice has explicit other-services status, keep it directly without calling resolveInvoiceStatus
    if (currentInvoice) {
      const curRaw = String(currentInvoice.status || '').trim();
      if (['purchase_parts', 'sale_parts', 'sale_maintenance', 'sale_software'].includes(curRaw)) {
        return curRaw;
      }
    }

    if (!itemsList || itemsList.length === 0) return '10';
    const numStatuses = itemsList.map(it => {
      const s = String(it.status || '10');
      if (s === 'new') return 10;
      if (s === 'testing') return 20;
      if (s === 'awaiting_approval' || s === 'awaiting_parts') return 30;
      if (s === 'repairing') return 40;
      if (['ready', 'intact', 'unrepairable', 'refused'].includes(s)) return 50;
      if (s === 'delivered') return 60;
      const parsed = parseInt(s, 10);
      return isNaN(parsed) ? 10 : parsed;
    });

    const minStatus = Math.min(...numStatuses);
    if (minStatus >= 60) return '60';
    if (minStatus >= 50) return '50';
    if (minStatus >= 40) return '40';
    if (minStatus >= 30) return '30';
    if (minStatus >= 20) return '20';
    return '10';
  };

  const resolveInvoiceStatus = (inv: Invoice): string => {
    // 1. Direct match with new other-services status values
    const rawStatus = String(inv.status || '').trim();
    if (rawStatus === 'purchase_parts' || rawStatus === 'sale_parts' || rawStatus === 'sale_maintenance' || rawStatus === 'sale_software') {
      return rawStatus;
    }

    // 2. Check Purchase invoice from Other Services
    if (
      isPurchaseInvoice(inv) ||
      checkIsPurchase(inv) ||
      inv.invoiceType === 'purchase' ||
      (inv as any).templateType === 'purchase' ||
      (inv as any).isPurchase === 1 ||
      (inv as any).isPurchase === true ||
      (inv as any).type === 'purchase' ||
      String(inv.invoiceNumber || '').trim().startsWith('PUR-') ||
      String(inv.invoiceNumber || '').trim().startsWith('DIS-')
    ) {
      return 'purchase_parts';
    }

    // 3. Check Other Services Sales invoices by explicit type
    const invType = String(inv.invoiceType || (inv as any).templateType || (inv as any).type || '').trim().toLowerCase();
    if (invType === 'sale_software' || invType === 'software') {
      return 'sale_software';
    }
    if (invType === 'sale_maintenance' || invType === 'maintenance_external' || invType === 'external_maintenance') {
      return 'sale_maintenance';
    }
    if (invType === 'sale_parts' || invType === 'parts') {
      return 'sale_parts';
    }

    // 4. Check if marked as other sale (e.g. 'O-' or checkIsSale) but sub-category needs deduction
    const isOtherSale = isSaleInvoice(inv) || checkIsSale(inv) || String(inv.invoiceNumber || '').trim().startsWith('O-');
    if (isOtherSale) {
      const cleanNo = String(inv.invoiceNumber || '').replace('#', '').trim();
      const invItems = items.filter(it => String(it.invoiceNumber || '').replace('#', '').trim() === cleanNo);
      const combinedText = [
        inv.notes || '',
        ...invItems.map(it => `${it.deviceName || ''} ${it.deviceType || ''} ${(it as any).category || ''} ${it.faultType || ''}`)
      ].join(' ').toLowerCase();

      if (combinedText.includes('برمج') || combinedText.includes('سوفت') || combinedText.includes('software')) {
        return 'sale_software';
      }
      if (combinedText.includes('صيانة') || combinedText.includes('خارجية') || combinedText.includes('external')) {
        return 'sale_maintenance';
      }
      return 'sale_parts';
    }

    // 5. Standard workshop maintenance invoice
    const manualStatus = invoiceStatuses[inv.id!];
    if (manualStatus) return manualStatus;

    if (rawStatus === 'new') return '10';
    if (rawStatus === 'testing') return '20';
    if (rawStatus === 'awaiting_approval' || rawStatus === 'awaiting_parts') return '30';
    if (rawStatus === 'repairing') return '40';
    if (['ready', 'intact', 'unrepairable', 'refused'].includes(rawStatus)) return '50';
    if (rawStatus === 'delivered') return '60';

    if (['10', '20', '30', '40', '50', '60'].includes(rawStatus)) {
      return rawStatus;
    }

    // Check items if available
    const cleanNo = String(inv.invoiceNumber || '').replace('#', '').trim();
    const invItems = items.filter(it => String(it.invoiceNumber || '').replace('#', '').trim() === cleanNo);
    if (invItems.length > 0) {
      return computeInvoiceStatusFromItems(invItems);
    }

    return '10';
  };

  const getItemsPiecesCount = (invoiceNumber?: string) => {
    if (!invoiceNumber) return 0;
    const cleanNo = String(invoiceNumber).replace('#', '').trim();
    return items
      .filter(it => {
        const itClean = String(it.invoiceNumber || '').replace('#', '').trim();
        return itClean === cleanNo;
      })
      .reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
  };

  // Filtered Invoices
  const filteredInvoices = invoices.filter(inv => {
    // Type Filter
    const isOther = isPurchaseInvoice(inv) || isSaleInvoice(inv) || checkIsPurchase(inv) || checkIsSale(inv);
    if (typeFilter === 'maintenance' && isOther) return false;
    if (typeFilter === 'other' && !isOther) return false;

    // Search Query (Smart Search)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase().replace('#', '');
      const invNo = String(inv.invoiceNumber || '').toLowerCase().replace('#', '');
      const custName = String(inv.customerName || '').toLowerCase();
      const custPhone = String(inv.customerPhone || '').toLowerCase();
      if (!invNo.includes(query) && !custName.includes(query) && !custPhone.includes(query)) {
        return false;
      }
    }

    // Time Filter
    const rawDate = inv.createdAt || inv.date || (inv as any).entryDate;
    const createdAtDate = parseDate(rawDate);
    if (!createdAtDate) return true;

    const now = new Date();
    if (timeFilter === 'day') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return createdAtDate >= todayStart;
    } else if (timeFilter === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      return createdAtDate >= sevenDaysAgo;
    } else if (timeFilter === 'month') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      return createdAtDate >= thirtyDaysAgo;
    } else if (timeFilter === 'custom') {
      if (customStartDate && customEndDate) {
        const start = new Date(customStartDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(customEndDate);
        end.setHours(23, 59, 59, 999);
        return createdAtDate >= start && createdAtDate <= end;
      }
      return true;
    }
    return true;
  }).sort((a, b) => {
    const timeA = parseDate(a.createdAt || a.date || (a as any).entryDate)?.getTime() || 0;
    const timeB = parseDate(b.createdAt || b.date || (b as any).entryDate)?.getTime() || 0;
    if (timeB !== timeA) return timeB - timeA;
    return Number(String(b.invoiceNumber || 0).replace('#', '')) - Number(String(a.invoiceNumber || 0).replace('#', ''));
  });

  // Aggregate stats
  const totalInvoicesCount = invoices.length;
  const maintenanceInvoicesCount = invoices.filter(inv => !isPurchaseInvoice(inv) && !isSaleInvoice(inv) && !checkIsPurchase(inv) && !checkIsSale(inv)).length;
  const otherInvoicesCount = invoices.filter(inv => isPurchaseInvoice(inv) || isSaleInvoice(inv) || checkIsPurchase(inv) || checkIsSale(inv)).length;
  const deliveredInvoicesCount = invoices.filter(inv => inv.status === '60' || inv.status === 'delivered').length;

  // Reversal check when changing from delivered 60
  const checkReversalNeeded = async (invoiceNum: string, oldStatus: string, newStatus: string, invoiceId?: string) => {
    if (oldStatus === '60' && newStatus !== '60') {
      const cleanNo = String(invoiceNum).replace('#', '').trim();
      const queryStr = `
        SELECT * FROM vault_transactions 
        WHERE (invoiceNumber = ? OR invoiceNumber = ? OR invoiceNumber = ? ${invoiceId ? 'OR invoiceId = ?' : ''})
      `;
      const params = invoiceId ? [cleanNo, `#${cleanNo}`, invoiceNum, invoiceId] : [cleanNo, `#${cleanNo}`, invoiceNum];
      const res = await localDb.query(queryStr, params);
      if (res.values && res.values.length > 0) {
        return res.values.filter((tx: any) => tx.isDeleted !== 1 && tx.isDeleted !== true && tx.deleted !== true && tx.deleted !== 1);
      }
    }
    return [];
  };

  const processDeleteReceiptTransactions = async (inv: Invoice, newStatus: string, txs: any[]): Promise<number> => {
    const deletedIdsSet = new Set<string>();

    for (const tx of txs) {
      if (!tx || !tx.id) continue;
      deletedIdsSet.add(tx.id);
      if (tx.reversalOf) deletedIdsSet.add(tx.reversalOf);

      try {
        const revRes = await localDb.query("SELECT id FROM vault_transactions WHERE reversalOf = ? OR id = ?", [tx.id, tx.reversalOf || '']);
        if (revRes.values) {
          revRes.values.forEach((r: any) => { if (r.id) deletedIdsSet.add(r.id); });
        }
      } catch (e) {}

      if (tx.fundId) {
        const fundAmount = Math.abs(Number(tx.receiptAmount !== undefined && tx.receiptAmount !== null ? tx.receiptAmount : tx.amount || 0));
        const isReceipt = tx.type === 'receipt' || tx.type === 'invoice_payment' || tx.type === 'deposit';
        const isReversal = tx.isReversal === 1 || tx.isReversal === true || tx.isReversal === '1' || !!tx.reversalOf || (tx.notes && tx.notes.includes('عكس قيد')) || tx.transactionCategory === 'عكس قيد مال';
        
        const fundAdj = isReceipt ? -fundAmount : (isReversal ? fundAmount : 0);

        if (fundAdj !== 0) {
          try {
            await ProviderFactory.getProvider().updateDoc('fin_funds', tx.fundId, { 
              balance: { type: 'increment', value: fundAdj } 
            });
          } catch (e) {
            console.warn('Provider fund update error:', e);
          }

          try {
            await localDb.run("UPDATE fin_funds SET balance = balance + ? WHERE id = ?", [fundAdj, tx.fundId]);
          } catch (e) {
            console.warn('LocalDb fund update error:', e);
          }

          try {
            const fundRef = doc(db, 'fin_funds', tx.fundId);
            const fundSnap = await getDoc(fundRef);
            if (fundSnap.exists()) {
              const curBal = Number(fundSnap.data().balance || 0);
              await updateDoc(fundRef, {
                balance: curBal + fundAdj,
                updatedAt: serverTimestamp()
              });
            }
          } catch (e) {
            console.warn('Firestore fund update error:', e);
          }
        }
      }
    }

    // Delete targeted transactions
    for (const targetId of deletedIdsSet) {
      try {
        await ProviderFactory.getProvider().deleteDoc('vault_transactions', targetId);
      } catch (e) {}
      try {
        await localDb.run("DELETE FROM vault_transactions WHERE id = ?", [targetId]);
      } catch (e) {}
      try {
        await localDb.run("UPDATE vault_transactions SET isDeleted = 1, deleted = 1 WHERE id = ?", [targetId]);
      } catch (e) {}
    }

    // Reset invoice amountPaid accurately
    const targetInvId = inv.id;
    if (targetInvId) {
      try {
        const remainingTxRes = await localDb.query(`
          SELECT amount, receiptAmount, type, isReversal, reversalOf, currency FROM vault_transactions 
          WHERE (invoiceId = ? OR invoiceNumber = ? OR invoiceNumber = ?) 
            AND isDeleted != 1 AND deleted != 1
        `, [targetInvId, inv.invoiceNumber, `#${inv.invoiceNumber}`]);

        let remainingPaid = 0;
        if (remainingTxRes.values) {
          remainingTxRes.values.forEach((r: any) => {
            const isReceipt = r.type === 'receipt' || r.type === 'invoice_payment' || r.type === 'deposit';
            const isRev = r.isReversal === 1 || r.isReversal === true || r.isReversal === '1' || !!r.reversalOf;
            if (isReceipt && !isRev && !deletedIdsSet.has(r.id)) {
              const rCur = r.currency || 'USD';
              const invCur = inv.currency || 'USD';
              if (rCur === invCur) {
                remainingPaid += Number(r.amount || 0);
              }
            }
          });
        }

        await ProviderFactory.getProvider().updateDoc('invoices', targetInvId, { amountPaid: remainingPaid });
        await localDb.run("UPDATE invoices SET amountPaid = ? WHERE id = ?", [remainingPaid, targetInvId]);
        const invRef = doc(db, 'invoices', targetInvId);
        await updateDoc(invRef, { amountPaid: remainingPaid, updatedAt: serverTimestamp() });
      } catch (e) {
        console.warn('Error resetting invoice amountPaid:', e);
      }
    }

    return deletedIdsSet.size;
  };

  // Quick Status Change Execution
  const executeQuickStatusChange = async (inv: Invoice, newStatus: string, txsToReverse: any[]) => {
    setSaveLoading(true);
    try {
      let deletedReceiptsCount = 0;
      if (txsToReverse.length > 0) {
        deletedReceiptsCount = await processDeleteReceiptTransactions(inv, newStatus, txsToReverse);
      }

      const batch = writeBatch(db);
      const cleanNo = String(inv.invoiceNumber).replace('#', '').trim();
      const currentItems = items.filter(it => String(it.invoiceNumber || '').replace('#', '').trim() === cleanNo);
      
      currentItems.forEach(it => {
        if (it.id) {
          const itRef = doc(db, 'invoice_items', it.id);
          batch.update(itRef, {
            status: newStatus,
            updatedAt: serverTimestamp(),
            updatedBy: user?.name || user?.username || 'مدير النظام'
          });
        }
      });

      const invRef = doc(db, 'invoices', inv.id!);
      const updateData: any = {
        status: newStatus,
        updatedAt: serverTimestamp()
      };
      if (txsToReverse.length > 0) {
        updateData.amountPaid = 0;
      }
      batch.update(invRef, updateData);

      // Inventory Reversal Logic: If moving back from Ready/Delivered (50/60) to a lower status
      const isOldStatusReady = ['50', '55', '60'].includes(inv.status || '');
      const isNewStatusLower = !['50', '55', '60', '70'].includes(newStatus);
      
      if (isOldStatusReady && isNewStatusLower) {
        for (const it of currentItems) {
           if (it.partsUsed && it.partsUsed.length > 0) {
             await restoreItemSparePartsToStock(it);
           }
        }
      }

      await batch.commit();

      // SQLite update
      await localDb.run("UPDATE invoices SET status = ? WHERE id = ?", [newStatus, inv.id]);
      await localDb.run("UPDATE invoice_items SET status = ? WHERE invoiceNumber = ? OR invoiceNumber = ?", [newStatus, cleanNo, `#${cleanNo}`]);

      const isRestored = isOldStatusReady && isNewStatusLower && currentItems.some(it => (it.partsUsed || []).length > 0);
      showToast(`تم تحديث حالة الفاتورة #${inv.invoiceNumber} إلى: ${getStatusLabel(newStatus)}${deletedReceiptsCount > 0 ? ` مع إلغاء سند القبض ومزامنة الصناديق` : ''}${isRestored ? ' وإعادة قطع الغيار للمخزون' : ''}`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'InvoicesManagement');
    } finally {
      setSaveLoading(false);
      setReversalConfirmData(null);
    }
  };

  // Detailed select item change
  const handleDetailedSelectChange = (val: string) => {
    setDetailedSelectType(val);
    const fallbackStatus = selectedInvoice ? resolveInvoiceStatus(selectedInvoice) : '10';
    if (val === 'NEW_DEVICE') {
      setDetailedDeviceType('');
      setDetailedDeviceName('');
      setDetailedFaultType('');
      setDetailedDeviceNotes('');
      setDetailedEngineerReport('');
      setDetailedQuantity(1);
      setDetailedPrice(0);
      setDetailedStatus(fallbackStatus);
      return;
    }

    const found = items.find(it => it.id === val);
    if (found) {
      setDetailedDeviceType(found.deviceType || '');
      setDetailedDeviceName(found.deviceName || '');
      setDetailedFaultType(found.faultType || (found as any).customerProblem || '');
      setDetailedDeviceNotes(found.deviceNotes || '');
      setDetailedEngineerReport((found as any).engineerReport || (found as any).technicalNotes || '');
      setDetailedQuantity(Number(found.quantity) || 1);
      setDetailedPrice(Number(found.unitCost) || Number(found.cost) || 0);
      setDetailedStatus(found.status || fallbackStatus);
    }
  };

  const handleAddStagedChange = () => {
    if (detailedSelectType === 'NEW_DEVICE' && !canAddInvoices) {
      showToast('ليس لديك صلاحية إضافة أجهزة جديدة للفاتورة');
      return;
    }

    if (!detailedDeviceType.trim()) {
      showToast('يجب إدخال نوع الجهاز أولاً');
      return;
    }

    const idToUse = detailedSelectType === 'NEW_DEVICE' ? undefined : detailedSelectType;
    const isEntryStatus = ['10', 'new'].includes(detailedStatus);

    const newStaged = {
      id: idToUse,
      isNew: detailedSelectType === 'NEW_DEVICE',
      deviceType: detailedDeviceType.trim(),
      deviceName: detailedDeviceName.trim(),
      faultType: detailedFaultType.trim(),
      deviceNotes: detailedDeviceNotes.trim(),
      engineerReport: isEntryStatus ? '' : detailedEngineerReport.trim(),
      technicalNotes: isEntryStatus ? '' : detailedEngineerReport.trim(),
      quantity: detailedQuantity,
      unitCost: detailedPrice,
      status: detailedStatus
    };

    setStagedChanges(prev => {
      const filtered = prev.filter(c => (idToUse ? c.id !== idToUse : true));
      return [...filtered, newStaged];
    });

    showToast('تمت إضافة التعديل للجدول المؤقت بنجاح');
  };

  const handleSaveDetailedChanges = async () => {
    if (!selectedInvoice) return;
    setSaveLoading(true);

    try {
      const cleanInvNo = String(selectedInvoice.invoiceNumber || '').replace('#', '');
      const originalItems = items.filter(it => {
        const itClean = String(it.invoiceNumber || '').replace('#', '');
        return itClean === cleanInvNo || it.invoiceId === selectedInvoice.id;
      });

      const finalItemsToSave: any[] = [];

      originalItems.forEach(orig => {
        // Skip items marked for deletion
        if (deletedItemIds.includes(orig.id!)) return;

        const staged = stagedChanges.find(s => s.id === orig.id);
        if (staged) {
          finalItemsToSave.push({
            ...orig,
            deviceType: staged.deviceType,
            deviceName: staged.deviceName,
            faultType: staged.faultType,
            deviceNotes: staged.deviceNotes,
            engineerReport: staged.engineerReport,
            quantity: staged.quantity,
            unitCost: staged.unitCost,
            cost: staged.quantity * staged.unitCost,
            status: staged.status
          });
        } else {
          finalItemsToSave.push(orig);
        }
      });

      stagedChanges.forEach(st => {
        if (st.isNew) {
          finalItemsToSave.push({
            isNewDevice: true,
            invoiceId: selectedInvoice.id,
            invoiceNumber: selectedInvoice.invoiceNumber,
            deviceType: st.deviceType,
            deviceName: st.deviceName,
            faultType: st.faultType,
            deviceNotes: st.deviceNotes,
            engineerReport: st.engineerReport,
            quantity: st.quantity,
            unitCost: st.unitCost,
            cost: st.quantity * st.unitCost,
            status: st.status
          });
        }
      });

      const totalCost = calculateInvoiceBillableTotal(selectedInvoice, finalItemsToSave);
      const computedStatus = computeInvoiceStatusFromItems(finalItemsToSave, selectedInvoice);

      const txs = await checkReversalNeeded(selectedInvoice.invoiceNumber, selectedInvoice.status, computedStatus, selectedInvoice.id);
      if (txs.length > 0) {
        setReversalConfirmData({
          invoice: selectedInvoice,
          newStatus: computedStatus,
          transactionsToReverse: txs,
          isDetailed: true,
          onConfirm: () => executeDetailedSave(finalItemsToSave, computedStatus, totalCost, txs, deletedItemIds)
        });
        return;
      }

      await executeDetailedSave(finalItemsToSave, computedStatus, totalCost, [], deletedItemIds);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'InvoicesManagement');
    } finally {
      setSaveLoading(false);
    }
  };

  const executeDetailedSave = async (finalItems: any[], computedStatus: string, totalCost: number, txs: any[], itemsToDelete: string[] = []) => {
    try {
      if (txs.length > 0) {
        await processDeleteReceiptTransactions(selectedInvoice!, computedStatus, txs);
      }

      const batch = writeBatch(db);

      // 1. Delete items marked for deletion from Firestore & SQLite
      for (const delId of itemsToDelete) {
        if (!delId) continue;
        const itemRef = doc(db, 'invoice_items', delId);
        batch.delete(itemRef);
        await localDb.run("DELETE FROM invoice_items WHERE id = ?", [delId]);

        // Restore spare parts to inventory if the item was in status 50/60
        const itemToDel = items.find(it => it.id === delId);
        if (itemToDel && ['50', '55', '60'].includes(itemToDel.status || '') && (itemToDel.partsUsed || []).length > 0) {
           await restoreItemSparePartsToStock(itemToDel);
        }

        // Cascade delete related actions
        try {
          const mRes = await localDb.query("SELECT id FROM maintenance_actions WHERE itemId = ?", [delId]);
          for (const m of (mRes?.values || [])) {
            if (m.id) {
              try { batch.delete(doc(db, 'maintenance_actions', m.id)); } catch (e) {}
              try { await localDb.run("DELETE FROM maintenance_actions WHERE id = ?", [m.id]); } catch (e) {}
            }
          }
        } catch (e) {}

        try {
          const aRes = await localDb.query("SELECT id FROM approval_actions WHERE itemId = ?", [delId]);
          for (const a of (aRes?.values || [])) {
            if (a.id) {
              try { batch.delete(doc(db, 'approval_actions', a.id)); } catch (e) {}
              try { await localDb.run("DELETE FROM approval_actions WHERE id = ?", [a.id]); } catch (e) {}
            }
          }
        } catch (e) {}
      }

      // 2. Insert new devices or update existing devices
      for (const item of finalItems) {
        if (item.isNewDevice) {
          const newDocRef = doc(collection(db, 'invoice_items'));
          const itemPayload = {
            ...item,
            id: newDocRef.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          delete itemPayload.isNewDevice;
          batch.set(newDocRef, itemPayload);
          await localDb.run(`
            INSERT OR REPLACE INTO invoice_items (id, invoiceId, invoiceNumber, deviceType, deviceName, faultType, deviceNotes, quantity, unitCost, cost, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [newDocRef.id, item.invoiceId, item.invoiceNumber, item.deviceType, item.deviceName, item.faultType, item.deviceNotes, item.quantity, item.unitCost, item.cost, item.status]);
        } else if (item.id) {
          const itemRef = doc(db, 'invoice_items', item.id);
          batch.update(itemRef, {
            deviceType: item.deviceType,
            deviceName: item.deviceName,
            faultType: item.faultType,
            deviceNotes: item.deviceNotes,
            engineerReport: item.engineerReport,
            quantity: item.quantity,
            unitCost: item.unitCost,
            cost: item.cost,
            status: item.status,
            updatedAt: serverTimestamp()
          });
          await localDb.run(`
            UPDATE invoice_items SET deviceType = ?, deviceName = ?, faultType = ?, deviceNotes = ?, quantity = ?, unitCost = ?, cost = ?, status = ?
            WHERE id = ?
          `, [item.deviceType, item.deviceName, item.faultType, item.deviceNotes, item.quantity, item.unitCost, item.cost, item.status, item.id]);

          // Restoration check if status changed from 50/60 to lower
          const originalItem = items.find(it => it.id === item.id);
          const wasReady = originalItem && ['50', '55', '60'].includes(originalItem.status || '');
          const isNowLower = !['50', '55', '60', '70'].includes(item.status || '');
          if (wasReady && isNowLower && originalItem.partsUsed && originalItem.partsUsed.length > 0) {
             await restoreItemSparePartsToStock(originalItem);
          }
        }
      }

      const invoiceRef = doc(db, 'invoices', selectedInvoice!.id!);
      const invUpdate: any = {
        status: computedStatus,
        totalCost: totalCost,
        updatedAt: serverTimestamp()
      };
      if (txs.length > 0) {
        invUpdate.amountPaid = 0;
      }
      batch.update(invoiceRef, invUpdate);
      await batch.commit();

      await localDb.run("UPDATE invoices SET status = ?, totalCost = ? WHERE id = ?", [computedStatus, totalCost, selectedInvoice!.id]);

      const hasRestored = itemsToDelete.some(id => {
        const item = items.find(it => it.id === id);
        return item && ['50', '55', '60'].includes(item.status || '') && (item.partsUsed || []).length > 0;
      }) || finalItems.some(item => {
        const originalItem = items.find(it => it.id === item.id);
        const wasReady = originalItem && ['50', '55', '60'].includes(originalItem.status || '');
        const isNowLower = !['50', '55', '60', '70'].includes(item.status || '');
        return wasReady && isNowLower && originalItem.partsUsed && originalItem.partsUsed.length > 0;
      });

      showToast(`تم حفظ وتحديث الفاتورة #${selectedInvoice!.invoiceNumber} بنجاح${hasRestored ? ' مع إعادة قطع الغيار للمخزون' : ''}`);
      setStagedChanges([]);
      setDeletedItemIds([]);
      setSubview('list');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'InvoicesManagement');
    } finally {
      setReversalConfirmData(null);
    }
  };

  const executeDeleteInvoice = async () => {
    if (!deleteConfirmData || !canDeleteInvoices) return;
    setSaveLoading(true);
    try {
      // Pass the full invoice object as required by the service
      await deleteInvoiceWithCascade(deleteConfirmData.invoice);
      showToast(`تم حذف الفاتورة #${deleteConfirmData.invoiceNumber} بالكامل مع بنودها وسنداتها`);
      setDeleteConfirmData(null);
      setSubview('list');
      setSelectedInvoice(null);
    } catch (err: any) {
      showToast(`فشل حذف الفاتورة: ${err?.message || err}`);
    } finally {
      setSaveLoading(false);
    }
  };

  // Permission Guard
  if (!canViewInvoices) {
    return (
      <div className="bg-[#1a1a1a] rounded-3xl p-8 border border-white/5 text-center space-y-4 max-w-lg mx-auto mt-12 font-cairo" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto">
          <AlertTriangle size={32} />
        </div>
        <h3 className="text-xl font-black text-white">غير مصرح بالدخول</h3>
        <p className="text-sm text-gray-400 font-bold">ليس لديك صلاحية عرض صفحة الفواتير. يرجى مراجعة إدارة النظام.</p>
        <button onClick={onBack} className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-bold transition-all cursor-pointer">
          العودة للرئيسية
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-cairo text-right" dir="rtl">
      {/* Toast Alert */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-sm flex items-center gap-2 border border-emerald-400/30"
          >
            <Check size={18} />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* VIEW 1: Main Invoices Table */}
      {subview === 'list' && (
        <div className="space-y-6">
          {/* Search & Filter Bar */}
          <div className="bg-[#161616] rounded-3xl p-6 border border-white/5 shadow-2xl space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Search Bar & Time Filter Toggle */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="البحث الذكي بالاسم أو برقم الفاتورة أو الهاتف..."
                    className="w-full bg-black/50 border border-white/10 rounded-2xl pr-11 pl-10 py-3 text-sm font-bold text-white focus:border-emerald-500 outline-none transition-all placeholder:text-gray-500"
                  />
                  <SearchIcon className="absolute right-4 top-3.5 text-gray-400" size={18} />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute left-3 top-3 p-1 text-gray-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                
                <button
                  onClick={() => setShowTimeFilters(!showTimeFilters)}
                  className={`p-3 rounded-2xl transition-all border cursor-pointer active:scale-95 ${
                    showTimeFilters 
                      ? 'bg-orange-500 text-black border-orange-400 shadow-lg shadow-orange-900/40' 
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 border-white/10'
                  }`}
                  title="تصفية حسب الفترة الزمنية"
                >
                  <Calendar size={20} />
                </button>
              </div>

              {/* Type Filter */}
              <div className="flex items-center gap-2 p-1.5 bg-black/40 border border-white/5 rounded-2xl text-xs font-bold">
                <button
                  onClick={() => setTypeFilter('all')}
                  className={`px-5 py-2.5 rounded-xl transition-all cursor-pointer flex flex-col items-center justify-center min-w-[90px] ${
                    typeFilter === 'all' 
                      ? 'bg-emerald-600 text-white font-black shadow-lg' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>كافة الأنواع</span>
                  <span className={`text-[10px] font-mono mt-0.5 opacity-90 ${typeFilter === 'all' ? 'text-white' : 'text-gray-400'}`}>{formatEnglishNumber(totalInvoicesCount)}</span>
                </button>
                <button
                  onClick={() => setTypeFilter('maintenance')}
                  className={`px-5 py-2.5 rounded-xl transition-all cursor-pointer flex flex-col items-center justify-center min-w-[90px] ${
                    typeFilter === 'maintenance' 
                      ? 'bg-emerald-600 text-white font-black shadow-lg' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>صيانة أجهزة</span>
                  <span className={`text-[10px] font-mono mt-0.5 opacity-90 ${typeFilter === 'maintenance' ? 'text-white' : 'text-gray-400'}`}>{formatEnglishNumber(maintenanceInvoicesCount)}</span>
                </button>
                <button
                  onClick={() => setTypeFilter('other')}
                  className={`px-5 py-2.5 rounded-xl transition-all cursor-pointer flex flex-col items-center justify-center min-w-[90px] ${
                    typeFilter === 'other' 
                      ? 'bg-emerald-600 text-white font-black shadow-lg' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>خدمات ومبيعات</span>
                  <span className={`text-[10px] font-mono mt-0.5 opacity-90 ${typeFilter === 'other' ? 'text-white' : 'text-gray-400'}`}>{formatEnglishNumber(otherInvoicesCount)}</span>
                </button>
              </div>
            </div>

            {/* Hidden Date Filter Tabs */}
            <AnimatePresence>
              {showTimeFilters && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-wrap items-center gap-2 p-3 bg-black/20 rounded-2xl border border-white/5"
                >
                  <div className="flex items-center gap-1.5 p-1 bg-black/40 rounded-xl border border-white/5">
                    <button
                      onClick={() => setTimeFilter('all')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${timeFilter === 'all' ? 'bg-orange-500 text-black font-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      الكل
                    </button>
                    <button
                      onClick={() => setTimeFilter('day')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${timeFilter === 'day' ? 'bg-orange-500 text-black font-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      اليوم
                    </button>
                    <button
                      onClick={() => setTimeFilter('week')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${timeFilter === 'week' ? 'bg-orange-500 text-black font-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      الأسبوع
                    </button>
                    <button
                      onClick={() => setTimeFilter('month')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${timeFilter === 'month' ? 'bg-orange-500 text-black font-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      الشهر
                    </button>
                    <button
                      onClick={() => setTimeFilter('custom')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${timeFilter === 'custom' ? 'bg-orange-500 text-black font-black' : 'text-gray-400 hover:text-white'}`}
                    >
                      مخصص
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Custom Date Pickers */}
            {timeFilter === 'custom' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-white/5 max-w-md mr-auto"
              >
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-400 font-bold block">من تاريخ:</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-emerald-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-400 font-bold block">إلى تاريخ:</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-emerald-500 outline-none transition-all"
                  />
                </div>
              </motion.div>
            )}

            {/* Table */}
            <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20">
              <table className="w-full text-right text-sm">
                <thead className="bg-black/60 text-gray-400 font-bold">
                  <tr>
                    <th className="p-4 whitespace-nowrap">رقم الفاتورة</th>
                    <th className="p-4 whitespace-nowrap">العميل</th>
                    <th className="p-4 whitespace-nowrap text-center">عدد القطع</th>
                    <th className="p-4 whitespace-nowrap text-right">حالة الفاتورة</th>
                    {canEditInvoices && <th className="p-4 whitespace-nowrap text-center">تعديل</th>}
                    {canPrintInvoices && <th className="p-4 whitespace-nowrap text-center">طباعة</th>}
                    {canDeleteInvoices && <th className="p-4 whitespace-nowrap text-center text-rose-500">حذف</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredInvoices.map((inv, idx) => {
                    const isDetailed = detailedModes[inv.id!] !== false;
                    const currentStatusVal = resolveInvoiceStatus(inv);
                    const isOther = isPurchaseInvoice(inv) || isSaleInvoice(inv) || checkIsPurchase(inv) || checkIsSale(inv);

                    return (
                      <React.Fragment key={inv.id ? `inv-frag-${inv.id}` : `inv-frag-idx-${idx}`}>
                        <tr className="hover:bg-white/[0.02] transition-colors whitespace-nowrap">
                          <td className="p-4 font-mono text-white font-bold whitespace-nowrap">
                            #{inv.invoiceNumber}
                          </td>

                          <td className="p-4 font-bold text-rose-300 whitespace-nowrap">
                            {String(inv.customerName || 'عميل نقدي').substring(0, 32)}
                          </td>
                          <td className="p-4 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-2">
                              <span className="font-mono font-bold text-gray-200">
                                {formatEnglishNumber(getItemsPiecesCount(inv.invoiceNumber))}
                              </span>
                              <button
                                type="button"
                                onClick={() => setDetailedModes(prev => ({ ...prev, [inv.id!]: !prev[inv.id!] }))}
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                  detailedModes[inv.id!]
                                    ? 'bg-orange-500 text-black font-bold shadow-md'
                                    : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
                                }`}
                                title={detailedModes[inv.id!] ? 'إخفاء تفاصيل بنود وقطع الفاتورة' : 'عرض تفاصيل قطع وبنود الفاتورة (معاينة سريعة)'}
                              >
                                <Eye size={15} />
                              </button>
                            </div>
                          </td>

                          {/* Invoice Status Display (Permanently frozen in main table for display only to avoid multi-device desync) */}
                          <td className="p-4 whitespace-nowrap">
                            <select
                              disabled={true}
                              value={currentStatusVal}
                              className={`border rounded-xl px-3 py-1.5 text-xs font-bold font-cairo outline-none shadow-sm transition-all cursor-default disabled:opacity-100 ${getStatusSelectStyle(currentStatusVal)}`}
                              title="حالة الفاتورة (للتعديل يرجى فتح صفحة تعديل الفاتورة لمتابعة كل جهاز على انفراد)"
                            >
                              {getAvailableStatusesForInvoice(inv).map((st, stIdx) => (
                                <option key={`st-opt-${st.value}-${stIdx}`} value={st.value} className="bg-[#121212] text-white">
                                  {st.label}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Edit Button */}
                          {canEditInvoices && (
                            <td className="p-4 text-center whitespace-nowrap">
                              <button
                                onClick={async () => {
                                  setSelectedInvoice(inv);
                                  setStagedChanges([]);
                                  setDeletedItemIds([]);
                                  const cleanNo = String(inv.invoiceNumber).replace('#', '').trim();
                                  const invItems = items.filter(it => String(it.invoiceNumber || '').replace('#', '').trim() === cleanNo);
                                  const resolvedSt = resolveInvoiceStatus(inv);
                                  if (invItems.length > 0) {
                                    handleDetailedSelectChange(invItems[0].id!);
                                    setDetailedStatus(invItems[0].status || resolvedSt || '10');
                                  } else {
                                    if (canAddInvoices) {
                                      handleDetailedSelectChange('NEW_DEVICE');
                                    }
                                    setDetailedStatus(resolvedSt || '10');
                                  }
                                  setSubview('detail_action');
                                }}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold transition-all border border-white/5 cursor-pointer"
                              >
                                تعديل
                              </button>
                            </td>
                          )}

                          {/* Print Button (Placeholder) */}
                          {canPrintInvoices && (
                            <td className="p-4 text-center whitespace-nowrap">
                              <button className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-all cursor-pointer">
                                <Printer size={16} />
                              </button>
                            </td>
                          )}

                          {/* Delete Button */}
                          {canDeleteInvoices && (
                            <td className="p-4 text-center whitespace-nowrap">
                              <button
                                onClick={() => {
                                  const cleanNo = String(inv.invoiceNumber).replace('#', '').trim();
                                  const invItems = items.filter(it => String(it.invoiceNumber || '').replace('#', '').trim() === cleanNo);
                                  setDeleteConfirmData({
                                    invoice: inv,
                                    invoiceNumber: inv.invoiceNumber,
                                    customerName: inv.customerName || 'عميل نقدي',
                                    itemCount: invItems.length
                                  });
                                }}
                                className="p-2 bg-rose-500/10 hover:bg-rose-600 text-rose-500 hover:text-white rounded-lg transition-all cursor-pointer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>

                        {/* Expandable Devices Preview Row via Eye button */}
                        {detailedModes[inv.id!] && (
                          <tr className="bg-white/[0.015]">
                            <td colSpan={4 + (canEditInvoices ? 1 : 0) + (canPrintInvoices ? 1 : 0) + (canDeleteInvoices ? 1 : 0)} className="p-4 bg-black/40 border-y border-white/5">
                              <div className="space-y-3">
                                <div className="text-xs font-black text-orange-400 flex items-center gap-1.5">
                                  <Eye size={15} />
                                  <span>معاينة تفاصيل قطع وبنود الفاتورة #{inv.invoiceNumber}:</span>
                                </div>
                                {(() => {
                                  const cleanNo = String(inv.invoiceNumber || '').replace('#', '').trim();
                                  const invItems = items.filter(it => String(it.invoiceNumber || '').replace('#', '').trim() === cleanNo || it.invoiceId === inv.id);
                                  if (invItems.length === 0) {
                                    return <div className="text-xs text-gray-500 py-2">لا توجد قطع أو بنود مسجلة في هذه الفاتورة.</div>;
                                  }
                                  return (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {invItems.map((item, itemIdx) => (
                                        <div key={item.id ? `sub-it-${item.id}` : `sub-it-${itemIdx}`} className="p-3 bg-[#131313] border border-white/5 rounded-2xl text-xs space-y-2 shadow-inner">
                                          <div className="flex items-center justify-between">
                                            <span className="font-bold text-white">{item.deviceType} {item.deviceName ? `- ${item.deviceName}` : ''}</span>
                                            <span className="font-mono text-emerald-400 font-bold">{formatEnglishNumber(item.cost || item.unitCost || 0)} {inv.currency || 'USD'}</span>
                                          </div>
                                          <div className="flex items-center justify-between text-[11px] text-gray-400">
                                            <span>العطل: {item.faultType || '-'}</span>
                                            <span className="font-mono">الكمية: {formatEnglishNumber(item.quantity || 1)}</span>
                                          </div>
                                          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                                            <span className="text-gray-400">حالة الجهاز:</span>
                                            <span className="text-gray-200 font-bold">{getStatusLabel(item.status || '10')}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {filteredInvoices.length === 0 && (
                    <tr>
                      <td colSpan={4 + (canEditInvoices ? 1 : 0) + (canPrintInvoices ? 1 : 0) + (canDeleteInvoices ? 1 : 0)} className="p-8 text-center text-gray-500 font-bold">
                        لا توجد فواتير مطابقة للبحث أو الفلتر المحدد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Detailed Invoice Action Form */}
      {subview === 'detail_action' && selectedInvoice && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Header Card */}
          <div className="bg-[#161616] rounded-3xl p-6 border border-white/5 shadow-2xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] bg-orange-500/20 text-orange-400 font-bold px-3 py-1 rounded-lg uppercase tracking-wider font-mono">
                  إجراء إداري تفصيلي للفاتورة #{selectedInvoice.invoiceNumber}
                </span>
                <h2 className="text-2xl font-black text-white mt-1">
                  العميل: {selectedInvoice.customerName || 'عميل نقدي'}
                </h2>
              </div>

              <div className="text-right text-xs text-gray-400 space-y-1 bg-black/30 p-3 rounded-2xl border border-white/5">
                <div>المستخدم المسؤول: <span className="text-white font-bold">{user?.name || user?.username}</span></div>
                <div>العملة المعتمدة: <span className="text-emerald-400 font-bold">{selectedInvoice.currency || 'USD'}</span></div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/5">
              <div className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                <span>تعديل ومتابعة حالات وبيانات كل جهاز على حدة في الفاتورة</span>
              </div>

              <button
                onClick={() => setSubview('list')}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl transition-all border border-white/5 flex items-center gap-2 text-xs font-bold cursor-pointer"
              >
                <ArrowRight size={16} />
                <span>العودة لجدول الفواتير</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Form: Add / Edit Item (5 cols) */}
            <div className="lg:col-span-5 bg-[#161616] border border-white/5 rounded-3xl p-6 space-y-4 shadow-xl">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Activity className="text-orange-500" size={20} />
                  تعديل وإضافة أجهزة الفاتورة
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  اختر جهازاً لتعديل بياناته أو إضافة جهاز جديد بالكامل
                </p>
              </div>

              {/* Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 block">الجهاز المستهدف:</label>
                <select
                  value={detailedSelectType}
                  onChange={(e) => handleDetailedSelectChange(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs focus:border-emerald-500 outline-none transition-all text-white font-bold"
                >
                  {canAddInvoices && (
                    <option value="NEW_DEVICE">🆕 إضافة جهاز جديد كلياً (New Device)</option>
                  )}
                  {items
                    .filter(it => {
                      const cleanInv = String(selectedInvoice.invoiceNumber).replace('#', '').trim();
                      const itClean = String(it.invoiceNumber || '').replace('#', '').trim();
                      return (itClean === cleanInv || it.invoiceId === selectedInvoice.id) && !deletedItemIds.includes(it.id!);
                    })
                    .map((it, itIdx) => (
                      <option key={it.id ? `dev-${it.id}` : `dev-idx-${itIdx}`} value={it.id}>
                        🛠️ {it.deviceType} {it.deviceName ? `- ${it.deviceName}` : ''} ({formatEnglishNumber(it.quantity || 1)} حبة)
                      </option>
                    ))}
                </select>
              </div>

              {/* Form fields */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400">نوع الجهاز (الصنف / الفئة):</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="ابحث عن نوع أو اكتب جديداً..."
                      value={detailedDeviceType}
                      onChange={(e) => {
                        setDetailedDeviceType(e.target.value);
                        setActiveAutocomplete({ type: 'deviceType' });
                      }}
                      onFocus={() => setActiveAutocomplete({ type: 'deviceType' })}
                      onBlur={() => setTimeout(() => setActiveAutocomplete(null), 200)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:border-emerald-500 outline-none transition-all"
                    />
                    <div className="absolute left-3 top-2.5 text-gray-500 pointer-events-none">
                      <SearchIcon size={16} />
                    </div>
                    
                    {activeAutocomplete?.type === 'deviceType' && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-50 max-h-40 overflow-y-auto py-1">
                        {registeredCategoryNames
                          .filter(name => name.toLowerCase().includes(detailedDeviceType.toLowerCase()))
                          .map((name, i) => (
                            <button
                              key={`cat-opt-${i}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setDetailedDeviceType(name);
                                setActiveAutocomplete(null);
                              }}
                              className="w-full text-right px-4 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              {name}
                            </button>
                          ))}
                        {detailedDeviceType && !registeredCategoryNames.some(n => n.toLowerCase() === detailedDeviceType.toLowerCase()) && (
                          <div className="px-4 py-2 text-[10px] text-emerald-500 font-bold bg-emerald-500/5">
                            سيتم إضافة النوع "{detailedDeviceType}" كجديد
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400">موديل / اسم الجهاز:</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="ابحث عن موديل أو اكتب جديداً..."
                      value={detailedDeviceName}
                      onChange={(e) => {
                        setDetailedDeviceName(e.target.value);
                        setActiveAutocomplete({ type: 'deviceName' });
                      }}
                      onFocus={() => setActiveAutocomplete({ type: 'deviceName' })}
                      onBlur={() => setTimeout(() => setActiveAutocomplete(null), 200)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:border-emerald-500 outline-none transition-all"
                    />
                    <div className="absolute left-3 top-2.5 text-gray-500 pointer-events-none">
                      <SearchIcon size={16} />
                    </div>

                    {activeAutocomplete?.type === 'deviceName' && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-50 max-h-40 overflow-y-auto py-1">
                        {filteredModelNames
                          .filter(name => name.toLowerCase().includes(detailedDeviceName.toLowerCase()))
                          .map((name, i) => (
                            <button
                              key={`mod-opt-${i}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setDetailedDeviceName(name);
                                setActiveAutocomplete(null);
                              }}
                              className="w-full text-right px-4 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              {name}
                            </button>
                          ))}
                        {detailedDeviceName && !filteredModelNames.some(n => n.toLowerCase() === detailedDeviceName.toLowerCase()) && (
                          <div className="px-4 py-2 text-[10px] text-emerald-500 font-bold bg-emerald-500/5">
                            سيتم إضافة الموديل "{detailedDeviceName}" كجديد
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400">العطل والمشكلة المشتكى منها:</label>
                  <input
                    type="text"
                    placeholder="وصف المشكلة والعطل..."
                    value={detailedFaultType}
                    onChange={(e) => setDetailedFaultType(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-emerald-500 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400">ملاحظات الاستلام والملحقات:</label>
                  <textarea
                    rows={2}
                    placeholder="ملحقات مستلمة مع الجهاز، حالة الخدوش..."
                    value={detailedDeviceNotes}
                    onChange={(e) => setDetailedDeviceNotes(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:border-emerald-500 outline-none resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 block">الكمية:</label>
                    <input
                      type="number"
                      min={1}
                      value={detailedQuantity}
                      onChange={(e) => setDetailedQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white text-center outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 block">سعر الوحدة ({selectedInvoice.currency || 'USD'}):</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={detailedPrice}
                      onChange={(e) => setDetailedPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white text-center outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-400 block">الحالة التشغيلية للجهاز / حالة الفاتورة:</label>
                    {isOtherServiceInvoice(selectedInvoice) && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md font-bold">
                        🔒 مجمدة لحماية نوع الفاتورة
                      </span>
                    )}
                  </div>
                  <select
                    disabled={isOtherServiceInvoice(selectedInvoice)}
                    value={detailedStatus}
                    onChange={(e) => setDetailedStatus(e.target.value)}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-bold outline-none transition-all ${
                      isOtherServiceInvoice(selectedInvoice) ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                    } ${getStatusSelectStyle(detailedStatus)}`}
                    title={
                      isOtherServiceInvoice(selectedInvoice)
                        ? 'الحالة مجمدة لمنع حدوث خلل في النظام والتحويل بين الأنواع'
                        : 'تحديد حالة الجهاز'
                    }
                  >
                    {getAvailableStatusesForInvoice(selectedInvoice).map((st, stIdx) => (
                      <option key={`st-opt2-${st.value}-${stIdx}`} value={st.value} className="bg-[#121212] text-white">
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 block">التقرير الفني وملاحظات الصيانة:</label>
                  <textarea
                    rows={2}
                    placeholder="تقرير الفني، القطع المستبدلة..."
                    value={detailedEngineerReport}
                    onChange={(e) => setDetailedEngineerReport(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white outline-none resize-none focus:border-emerald-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddStagedChange}
                  className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center justify-center gap-2 mt-2 cursor-pointer"
                >
                  <Plus size={16} />
                  <span>إضافة للتعديلات المؤقتة</span>
                </button>
              </div>
            </div>

            {/* Right Review & Save Migration (7 cols) */}
            <div className="lg:col-span-7 bg-[#161616] border border-white/5 rounded-3xl p-6 space-y-5 shadow-xl flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-black text-white flex items-center gap-2">
                      <CheckCircle className="text-emerald-500" size={20} />
                      مراجعة الفاتورة قبل الحفظ النهائي
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      الأجهزة الأصلية والمعدلة والمضافة حديثاً في هذه الفاتورة
                    </p>
                  </div>
                  {(() => {
                    const cleanInvNo = String(selectedInvoice.invoiceNumber || '').replace('#', '');
                    const origSurviving = items.filter(it => {
                      const itClean = String(it.invoiceNumber || '').replace('#', '');
                      return (itClean === cleanInvNo || it.invoiceId === selectedInvoice.id) && !deletedItemIds.includes(it.id!);
                    });
                    const newItemsCount = stagedChanges.filter(s => s.isNew).length;
                    const totalDevs = origSurviving.length + newItemsCount;
                    return (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="bg-black/40 border border-white/10 px-3 py-1.5 rounded-xl font-bold text-gray-300">
                          الأجهزة المعتمدة: <span className="font-mono text-emerald-400 font-black">{formatEnglishNumber(totalDevs)}</span>
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/5 bg-black/20">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-black/60 text-gray-400 font-bold">
                      <tr>
                        <th className="p-3">الجهاز</th>
                        <th className="p-3">العطل</th>
                        <th className="p-3 text-center">الكمية</th>
                        <th className="p-3 text-right">المجموع</th>
                        <th className="p-3">الحالة</th>
                        <th className="p-3">المصدر</th>
                        <th className="p-3 text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(() => {
                        const cleanInvNo = String(selectedInvoice.invoiceNumber || '').replace('#', '');
                        const originalItems = items.filter(it => {
                          const itClean = String(it.invoiceNumber || '').replace('#', '');
                          return itClean === cleanInvNo || it.invoiceId === selectedInvoice.id;
                        });

                        const displayList: any[] = [];

                        originalItems.forEach(orig => {
                          const isMarkedDeleted = deletedItemIds.includes(orig.id!);
                          const stagedIdx = stagedChanges.findIndex(s => s.id === orig.id);
                          if (stagedIdx !== -1) {
                            const staged = stagedChanges[stagedIdx];
                            displayList.push({
                              id: orig.id,
                              stagedIndex: stagedIdx,
                              isModified: true,
                              isDeleted: isMarkedDeleted,
                              deviceType: staged.deviceType,
                              deviceName: staged.deviceName,
                              faultType: staged.faultType,
                              quantity: staged.quantity,
                              unitCost: staged.unitCost,
                              cost: staged.quantity * staged.unitCost,
                              status: staged.status
                            });
                          } else {
                            displayList.push({
                              id: orig.id,
                              isModified: false,
                              isDeleted: isMarkedDeleted,
                              deviceType: orig.deviceType,
                              deviceName: orig.deviceName,
                              faultType: orig.faultType || (orig as any).customerProblem || '',
                              quantity: Number(orig.quantity) || 1,
                              unitCost: Number(orig.unitCost) || Number(orig.cost) || 0,
                              cost: (Number(orig.quantity) || 1) * (Number(orig.unitCost) || Number(orig.cost) || 0),
                              status: orig.status || '10'
                            });
                          }
                        });

                        stagedChanges.forEach((st, idx) => {
                          if (st.isNew) {
                            displayList.push({
                              stagedIndex: idx,
                              isNew: true,
                              isDeleted: false,
                              deviceType: st.deviceType,
                              deviceName: st.deviceName,
                              faultType: st.faultType,
                              quantity: st.quantity,
                              unitCost: st.unitCost,
                              cost: st.quantity * st.unitCost,
                              status: st.status
                            });
                          }
                        });

                        return displayList.map((item, index) => (
                          <tr key={index} className={`transition-colors ${item.isDeleted ? 'bg-rose-950/25 opacity-60' : 'hover:bg-white/[0.02]'}`}>
                            <td className="p-3">
                              <div className={`font-bold text-white ${item.isDeleted ? 'line-through text-rose-300' : ''}`}>{item.deviceType}</div>
                              {item.deviceName && <div className="text-[10px] text-gray-400">{item.deviceName}</div>}
                            </td>
                            <td className="p-3 text-gray-300">{item.faultType || '-'}</td>
                            <td className="p-3 text-center font-mono font-bold text-white">
                              {formatEnglishNumber(item.quantity)}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-emerald-400">
                              {formatEnglishNumber(item.cost)} {selectedInvoice.currency || 'USD'}
                            </td>
                            <td className="p-3">
                              {/* Clean unshaded status label for high contrast and readability */}
                              <span className="text-xs font-bold text-gray-100 tracking-wide">
                                {getStatusLabel(item.status)}
                              </span>
                            </td>
                            <td className="p-3">
                              {item.isDeleted ? (
                                <span className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 rounded font-bold">
                                  سيحذف عند الحفظ
                                </span>
                              ) : item.isNew ? (
                                <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded font-bold">
                                  جديد مؤقت
                                </span>
                              ) : item.isModified ? (
                                <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded font-bold">
                                  تعديل مؤقت
                                </span>
                              ) : (
                                <span className="text-[10px] text-gray-400 bg-white/5 px-1.5 py-0.5 rounded font-bold">
                                  أصلي محفوظ
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                {item.isDeleted ? (
                                  <button
                                    type="button"
                                    onClick={() => setDeletedItemIds(prev => prev.filter(id => id !== item.id))}
                                    className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                    title="تراجع عن حذف هذا الجهاز"
                                  >
                                    <RotateCcw size={12} />
                                    <span>تراجع</span>
                                  </button>
                                ) : (
                                  <>
                                    {/* Revert modified stage */}
                                    {item.isModified && item.stagedIndex !== undefined && (
                                      <button
                                        type="button"
                                        onClick={() => setStagedChanges(prev => prev.filter((_, i) => i !== item.stagedIndex))}
                                        className="px-2 py-1 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 border border-yellow-500/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                        title="إلغاء التعديل المؤقت والعودة للحالة الأصلية"
                                      >
                                        <RotateCcw size={11} />
                                        <span>إلغاء التعديل</span>
                                      </button>
                                    )}

                                    {/* Edit button to load device into the form */}
                                    {!item.isNew && item.id && (
                                      <button
                                        type="button"
                                        onClick={() => handleDetailedSelectChange(item.id)}
                                        className="px-2 py-1 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                                        title="اختيار هذا الجهاز لتعديل بياناته"
                                      >
                                        تعديل
                                      </button>
                                    )}

                                    {/* Permanent Delete Button: Always visible for deleting devices entered by mistake */}
                                    {item.isNew ? (
                                      <button
                                        type="button"
                                        onClick={() => setStagedChanges(prev => prev.filter((_, i) => i !== item.stagedIndex))}
                                        className="p-1.5 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-lg transition-colors cursor-pointer"
                                        title="حذف هذا الجهاز الجديد"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (item.id) {
                                            setDeletedItemIds(prev => [...prev, item.id]);
                                            if (item.stagedIndex !== undefined) {
                                              setStagedChanges(prev => prev.filter((_, i) => i !== item.stagedIndex));
                                            }
                                          }
                                        }}
                                        className="p-1.5 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-lg transition-colors cursor-pointer"
                                        title="حذف هذا الجهاز من الفاتورة (يطبق عند الحفظ النهائي)"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action buttons & Delete Invoice */}
              <div className="pt-4 border-t border-white/5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Delete Invoice Button (Only if canDeleteInvoices is true) */}
                  {canDeleteInvoices && (
                    <button
                      type="button"
                      disabled={saveLoading}
                      onClick={() => {
                        setDeleteConfirmData({
                          invoice: selectedInvoice,
                          invoiceNumber: selectedInvoice.invoiceNumber,
                          customerName: selectedInvoice.customerName || 'عميل'
                        });
                      }}
                      className="px-4 py-2.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 size={15} />
                      <span>حذف الفاتورة بالكامل</span>
                    </button>
                  )}

                  <div className="flex items-center gap-3 mr-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setStagedChanges([]);
                        setDeletedItemIds([]);
                        setSubview('list');
                      }}
                      className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      إلغاء والرجوع
                    </button>

                    <button
                      type="button"
                      disabled={saveLoading}
                      onClick={handleSaveDetailedChanges}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-emerald-950/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle size={16} />
                      <span>{saveLoading ? 'جاري الحفظ...' : 'حفظ الفاتورة النهائية'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Confirmation Modal: Delete Invoice */}
      <AnimatePresence>
        {deleteConfirmData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#181818] border border-rose-500/30 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 text-right"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto">
                <AlertTriangle size={28} />
              </div>
              <h3 className="text-lg font-black text-white text-center">
                تأكيد حذف الفاتورة بالكامل
              </h3>
              <p className="text-xs text-gray-300 font-bold leading-relaxed text-center">
                هل أنت متأكد من حذف الفاتورة <span className="text-rose-400 font-mono">#{deleteConfirmData.invoiceNumber}</span> التابعة للعميل <span className="text-white font-bold">{deleteConfirmData.customerName}</span>؟
                <br />
                <span className="text-gray-400 text-[11px] mt-1 block">سيتم حذف كافة بنود الأجهزة وسندات القبض المسجلة وتحديث رصيد الصندوق وكشف حساب العميل تلقائياً.</span>
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={saveLoading}
                  onClick={executeDeleteInvoice}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer"
                >
                  {saveLoading ? 'جاري الحذف...' : 'نعم، حذف نهائي'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmData(null)}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Reversal / Delete Receipts */}
      <AnimatePresence>
        {reversalConfirmData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#181818] border border-amber-500/30 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 text-right"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
                <RotateCcw size={28} />
              </div>
              <h3 className="text-lg font-black text-white text-center">
                تنبيه: التراجع عن تسليم الفاتورة
              </h3>
              <p className="text-xs text-gray-300 font-bold leading-relaxed text-center">
                الفاتورة <span className="text-amber-400 font-mono">#{reversalConfirmData.invoice.invoiceNumber}</span> تم تسليمها مسبقاً وتوجد عليها سندات قبض مالية.
                <br />
                تغيير حالتها سيتطلب حذف سند القبض وإسقاط المبلغ من الصناديق لتصحيح الدورة النقدية ومطابقة الحسابات.
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={saveLoading}
                  onClick={reversalConfirmData.onConfirm}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer"
                >
                  {saveLoading ? 'جاري المعالجة...' : 'تأكيد وحذف السند'}
                </button>
                <button
                  type="button"
                  onClick={() => setReversalConfirmData(null)}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
