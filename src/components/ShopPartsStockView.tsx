import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, doc, deleteDoc } from '../firebase';
import { ShopPartItem, DisassemblyBatch } from '../types';
import { 
  Package, Layers, CircleDollarSign, CheckCircle, TrendingUp, AlertTriangle, 
  Search, Trash2, Tag, Calendar, User, ShieldAlert, Sparkles, RefreshCw, X, 
  Check, ChevronDown, ChevronUp, DollarSign, ArrowUpRight, ShoppingCart, 
  Boxes, Percent, HelpCircle
} from 'lucide-react';
import { formatMoney } from '../lib/fundUtils';
import { ProviderFactory } from '../data/ProviderFactory';
import { auditOrphanedPartsStock, cleanOrphanedPartsStock, recalculateDisassemblyBatchesRecovery } from '../lib/invoiceCascadeService';
import { useBackHandler } from '../hooks/useBackHandler';

export default function ShopPartsStockView() {
  const [stockItems, setStockItems] = useState<ShopPartItem[]>([]);
  const [batches, setBatches] = useState<DisassemblyBatch[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'inventory' | 'batches'>('inventory');
  const [stockFilter, setStockFilter] = useState<'available' | 'sold' | 'all'>('available');
  const [search, setSearch] = useState('');

  // Expanded batch cards for detailed breakdown
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});

  // Custom Delete Modal State (replaces blocked window.confirm)
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'item' | 'batch';
    id: string;
    name: string;
    isDeleting: boolean;
  } | null>(null);

  // Orphaned stock audit state
  const [isAuditing, setIsAuditing] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [orphanedItems, setOrphanedItems] = useState<any[]>([]);
  const [orphanedBatches, setOrphanedBatches] = useState<any[]>([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);

  // Recalculate batches recovery state
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Handle hardware back button for open modals
  useBackHandler(Boolean(deleteModal?.isOpen || showAuditModal), () => {
    if (deleteModal?.isOpen) {
      setDeleteModal(null);
    } else if (showAuditModal) {
      setShowAuditModal(false);
    }
  });

  useEffect(() => {
    const unsubStock = onSnapshot(collection(db, 'shop_parts_inventory'), (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ShopPartItem));
      setStockItems(items);
    });

    const unsubBatches = onSnapshot(collection(db, 'disassembly_batches'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DisassemblyBatch));
      setBatches(list);
    });

    const unsubInvoiceItems = onSnapshot(collection(db, 'invoice_items'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setInvoiceItems(list);
    });

    return () => {
      unsubStock();
      unsubBatches();
      unsubInvoiceItems();
    };
  }, []);

  // Filter stock items according to user filter and search
  const filteredStock = stockItems.filter(item => {
    // Stock availability filter
    const qty = Number(item.quantity || 0);
    if (stockFilter === 'available' && qty <= 0) return false;
    if (stockFilter === 'sold' && qty > 0) return false;

    // Search query
    const q = (search || '').toLowerCase();
    const matchName = (item.name || '').toLowerCase().includes(q);
    const matchSupplier = (item.supplierName || '').toLowerCase().includes(q);
    const matchBatch = (item.batchName || '').toLowerCase().includes(q);

    return matchName || matchSupplier || matchBatch;
  });

  // Filter batches according to search
  const filteredBatches = batches.filter(batch => {
    const q = (search || '').toLowerCase();
    const matchName = (batch.batchName || '').toLowerCase().includes(q);
    const matchSupplier = (batch.supplierName || '').toLowerCase().includes(q);
    const matchNumber = (batch.batchNumber && String(batch.batchNumber).toLowerCase().includes(q));

    return matchName || matchSupplier || matchNumber;
  });

  // Toggle batch breakdown accordion
  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatches(prev => ({
      ...prev,
      [batchId]: !prev[batchId]
    }));
  };

  // Safe In-App Delete Handler (works in iframes, Capacitor, and mobile)
  const handleConfirmDelete = async () => {
    if (!deleteModal) return;
    const { id, type, name } = deleteModal;
    setDeleteModal(prev => prev ? { ...prev, isDeleting: true } : null);

    const collectionName = type === 'item' ? 'shop_parts_inventory' : 'disassembly_batches';
    try {
      // 1. Direct SQLite execution
      const { localDb } = await import('../lib/local-db');
      await localDb.run(`DELETE FROM ${collectionName} WHERE id = ?`, [id]);
      const res = await localDb.query(`SELECT * FROM ${collectionName}`);
      localDb.notify(collectionName, res.values || []);

      // 2. Provider deletion
      const provider = ProviderFactory.getProvider();
      try { await provider.deleteDoc(collectionName, id); } catch (e) {}

      // 3. Cloud Firestore deletion if reachable
      try {
        await deleteDoc(doc(db, collectionName, id));
      } catch (e) {}

      // 4. Instant UI state update
      if (type === 'item') {
        setStockItems(prev => prev.filter(i => i.id !== id));
      } else {
        setBatches(prev => prev.filter(b => b.id !== id));
      }

      setNotificationMsg({
        text: `تم حذف ${type === 'item' ? 'الصنف' : 'دفعة التفكيك'} "${name}" بنجاح.`,
        type: 'success'
      });
      setTimeout(() => setNotificationMsg(null), 4000);
    } catch (err) {
      console.error('Failed to delete item:', err);
      setNotificationMsg({
        text: 'حدث خطأ أثناء محاولة الحذف، يرجى المحاولة مرة أخرى.',
        type: 'error'
      });
      setTimeout(() => setNotificationMsg(null), 4000);
    } finally {
      setDeleteModal(null);
    }
  };

  const handleRunOrphanAudit = async () => {
    setIsAuditing(true);
    setAuditMessage(null);
    try {
      const { orphanedItems: oItems, orphanedBatches: oBatches } = await auditOrphanedPartsStock();
      setOrphanedItems(oItems);
      setOrphanedBatches(oBatches);
      setShowAuditModal(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleCleanOrphans = async () => {
    setIsCleaning(true);
    try {
      const itemIds = orphanedItems.map(i => i.id);
      const batchIds = orphanedBatches.map(b => b.id);
      const res = await cleanOrphanedPartsStock(itemIds, batchIds);
      setAuditMessage(`تم تنظيف وحذف ${res.cleanedCount} عنصر/دفعة معلقة بنجاح!`);
      setOrphanedItems([]);
      setOrphanedBatches([]);
    } catch (err) {
      console.error(err);
      setAuditMessage('حدث خطأ أثناء تنظيف العناصر');
    } finally {
      setIsCleaning(false);
    }
  };

  const handleRecalculateBatches = async () => {
    setIsRecalculating(true);
    setNotificationMsg(null);
    try {
      const res = await recalculateDisassemblyBatchesRecovery();
      setNotificationMsg({
        text: `تم التدقيق بنجاح! تم فحص جميع فواتير البيع وتحديث ${res.updatedCount} دفعة تفكيك بالمبالغ المستردة الحقيقية والأرباح.`,
        type: 'success'
      });
      setTimeout(() => setNotificationMsg(null), 6000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRecalculating(false);
    }
  };

  // Calculate Batch Financial Metrics
  const getBatchFinancials = (batch: DisassemblyBatch) => {
    const totalCost = Number(batch.totalBatchCost || 0);

    // Matching extracted parts in inventory strictly by unique ID
    const matchedParts = stockItems.filter(item => 
      Boolean(item.batchId && (item.batchId === batch.id || (batch.batchNumber && item.batchId === batch.batchNumber)))
    );

    // Matching sales from invoice_items (excluding purchase items) strictly by unique batchId
    const matchedSales = invoiceItems.filter(it => {
      if (it.source === 'purchase' || it.isPurchase === 1 || it.isPurchase === true) return false;
      if (it.batchId && (it.batchId === batch.id || (batch.batchNumber && it.batchId === batch.batchNumber))) return true;
      return false;
    });

    // Actual revenue from recorded sales
    const salesRevenue = matchedSales.reduce((sum, it) => {
      const qty = Math.max(1, Number(it.quantity || 1));
      const unit = Number(it.unitCost || 0);
      const itCost = Number(it.cost || (qty * unit));
      return sum + itCost;
    }, 0);

    // Total recovered (batch.recoveredAmount or calculated from sales)
    const recovered = Math.max(Number(batch.recoveredAmount || 0), salesRevenue);
    
    // Recovery percentage
    const percent = totalCost > 0 ? Math.min(100, Math.round((recovered / totalCost) * 100)) : 100;
    
    // Net profit (only what exceeds the total device cost)
    const netProfit = recovered > totalCost ? recovered - totalCost : 0;
    
    // Remaining to recover before reaching profit
    const remainingToBreakEven = Math.max(0, totalCost - recovered);
    
    // Is capital fully recovered?
    const isCostCovered = recovered >= totalCost && totalCost > 0;

    // Remaining unsold parts in stock
    const unsoldParts = matchedParts.filter(p => Number(p.quantity || 0) > 0);
    const remainingPartsCount = unsoldParts.reduce((sum, p) => sum + Math.max(0, Number(p.quantity || 0)), 0);
    const projectedRemainingValue = unsoldParts.reduce((sum, p) => sum + (Math.max(0, Number(p.quantity || 0)) * Number(p.salePrice || 0)), 0);

    // Total projected profit once all parts are sold
    const totalProjectedProfit = (recovered + projectedRemainingValue) - totalCost;

    return {
      totalCost,
      recovered,
      percent,
      netProfit,
      remainingToBreakEven,
      isCostCovered,
      matchedParts,
      matchedSales,
      unsoldParts,
      remainingPartsCount,
      projectedRemainingValue,
      totalProjectedProfit
    };
  };

  // Inventory Totals
  const availableItemsCount = stockItems.filter(i => Number(i.quantity || 0) > 0).length;
  const soldItemsCount = stockItems.filter(i => Number(i.quantity || 0) <= 0).length;
  const totalStockQuantity = stockItems.reduce((acc, i) => acc + Math.max(0, Number(i.quantity || 0)), 0);
  const totalStockSaleValue = stockItems.reduce((acc, i) => acc + (Math.max(0, Number(i.quantity || 0)) * Number(i.salePrice || 0)), 0);

  // Batches Totals
  const totalBatchesCost = batches.reduce((sum, b) => sum + Number(b.totalBatchCost || 0), 0);
  const totalBatchesRecovered = batches.reduce((sum, b) => {
    const fin = getBatchFinancials(b);
    return sum + fin.recovered;
  }, 0);
  const totalBatchesNetProfit = batches.reduce((sum, b) => {
    const fin = getBatchFinancials(b);
    return sum + fin.netProfit;
  }, 0);

  return (
    <div className="space-y-6 font-cairo text-right pb-32 md:pb-16" dir="rtl">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#141414] p-4 rounded-2xl border border-white/5 shadow-xl">
        <div className="flex items-center gap-2 p-1 bg-[#1a1a1a] rounded-xl border border-white/5 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'inventory' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Package size={16} />
            <span>قطع الغيار والملحقات ({stockItems.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('batches')}
            className={`flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'batches' ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Layers size={16} />
            <span>دفعة أجهزة التفكيك/التشليح ({batches.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
          {activeTab === 'batches' && (
            <button
              onClick={handleRecalculateBatches}
              disabled={isRecalculating}
              className="px-3.5 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              title="إعادة احتساب وتحديث المبالغ المستردة لجميع أجهزة التفكيك من واقع فواتير المبيعات"
            >
              <RefreshCw className={isRecalculating ? 'animate-spin' : ''} size={14} />
              <span>{isRecalculating ? 'جاري التدقيق...' : 'تدقيق وتحديث مبيعات الدفعات'}</span>
            </button>
          )}

          <button
            onClick={handleRunOrphanAudit}
            disabled={isAuditing}
            className="px-3.5 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            title="فحص وتدقيق القطع والدفعات المعلقة"
          >
            {isAuditing ? <RefreshCw className="animate-spin" size={14} /> : <ShieldAlert size={14} />}
            <span>تدقيق المخزون المعلق</span>
          </button>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالصنف، الدفعة، أو المورد..."
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            <Search size={14} className="absolute right-3 top-2.5 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Global Notification Banner */}
      {notificationMsg && (
        <div className={`p-3.5 rounded-2xl flex items-center justify-between text-xs border ${
          notificationMsg.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          <div className="flex items-center gap-2">
            {notificationMsg.type === 'success' ? <Check size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-red-400" />}
            <span className="font-bold">{notificationMsg.text}</span>
          </div>
          <button onClick={() => setNotificationMsg(null)} className="text-gray-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* TAB 1: INVENTORY (قطع الغيار والملحقات) */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Quick Metrics & Filter Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-[#141414] p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-gray-400 block">القطع المتاحة بالمخزن</span>
                <span className="text-lg font-mono font-black text-emerald-400">{availableItemsCount} صنف ({totalStockQuantity} قطعة)</span>
              </div>
              <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
                <Boxes size={20} />
              </div>
            </div>

            <div className="bg-[#141414] p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-gray-400 block">قطع بيعت بالكامل</span>
                <span className="text-lg font-mono font-black text-blue-400">{soldItemsCount} صنف</span>
              </div>
              <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
                <ShoppingCart size={20} />
              </div>
            </div>

            <div className="bg-[#141414] p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-gray-400 block">قيمة المخزون المتاح المتوقعة</span>
                <span className="text-lg font-mono font-black text-amber-400">{formatMoney(totalStockSaleValue, 'USD')}</span>
              </div>
              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                <CircleDollarSign size={20} />
              </div>
            </div>

            {/* Filter Selector */}
            <div className="bg-[#141414] p-2 rounded-2xl border border-white/5 flex items-center gap-1.5">
              <button
                onClick={() => setStockFilter('available')}
                className={`flex-1 py-2 px-2 text-center rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                  stockFilter === 'available'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                المتاح ({availableItemsCount})
              </button>
              <button
                onClick={() => setStockFilter('sold')}
                className={`flex-1 py-2 px-2 text-center rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                  stockFilter === 'sold'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                المباعة ({soldItemsCount})
              </button>
              <button
                onClick={() => setStockFilter('all')}
                className={`flex-1 py-2 px-2 text-center rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                  stockFilter === 'all'
                    ? 'bg-white/10 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                الكل ({stockItems.length})
              </button>
            </div>
          </div>

          {/* Parts Table */}
          <div className="bg-[#121212] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
                  <tr>
                    <th className="p-3.5">#</th>
                    <th className="p-3.5">اسم القطعة / الملحق</th>
                    <th className="p-3.5">المصدر / الدفعة</th>
                    <th className="p-3.5">المورد / البائع</th>
                    <th className="p-3.5">حالة المخزون</th>
                    <th className="p-3.5">الكمية المتبقية</th>
                    <th className="p-3.5">سعر التكلفة</th>
                    <th className="p-3.5">سعر البيع المقترح</th>
                    <th className="p-3.5 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-200">
                  {filteredStock.length > 0 ? (
                    filteredStock.map((item, idx) => {
                      const qty = Number(item.quantity || 0);
                      const isSoldOut = qty <= 0;

                      return (
                        <tr 
                          key={item.id || idx} 
                          className={`transition-colors ${isSoldOut ? 'bg-blue-500/[0.02] hover:bg-blue-500/[0.05]' : 'hover:bg-white/[0.02]'}`}
                        >
                          <td className="p-3.5 font-mono text-gray-500">{idx + 1}</td>
                          <td className="p-3.5 font-bold text-white">
                            <div className="flex items-center gap-2">
                              <Tag size={14} className={isSoldOut ? 'text-blue-400' : 'text-emerald-400'} />
                              <span>{item.name || 'صنف بدون اسم'}</span>
                            </div>
                          </td>
                          <td className="p-3.5">
                            {item.isDisassemblyBatch ? (
                              <span className="px-2.5 py-1 bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded-lg text-[11px] font-bold flex items-center gap-1.5 w-fit">
                                <Layers size={12} />
                                <span>تفكيك: {item.batchName || 'دفعة'}</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-white/5 text-gray-300 rounded-lg text-[11px]">
                                شراء مباشر
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-gray-300">
                            {item.supplierName || 'غير محدد'}
                          </td>
                          <td className="p-3.5">
                            {isSoldOut ? (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/25 flex items-center gap-1 w-fit">
                                <CheckCircle size={12} className="text-blue-400" />
                                <span>تم بيعها بالكامل</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1 w-fit">
                                <Boxes size={12} className="text-emerald-400" />
                                <span>متاح بالمخزن</span>
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 font-mono font-black">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold ${
                              isSoldOut 
                                ? 'bg-white/5 text-gray-400 border border-white/10' 
                                : qty > 5 
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {qty > 0 ? `${qty} قطعة` : '0 قطعة (منصرفة)'}
                            </span>
                          </td>
                          <td className="p-3.5 font-mono font-bold text-amber-400">
                            {formatMoney(item.unitCost ?? 0, item.currency || 'USD')}
                          </td>
                          <td className="p-3.5 font-mono font-bold text-emerald-400">
                            {formatMoney(item.salePrice ?? 0, item.currency || 'USD')}
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              onClick={() => setDeleteModal({
                                isOpen: true,
                                type: 'item',
                                id: item.id!,
                                name: item.name || 'الصنف المحدد',
                                isDeleting: false
                              })}
                              className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-all border border-red-500/20 cursor-pointer"
                              title="حذف هذا الصنف من المخزون"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="p-10 text-center text-gray-500">
                        {stockFilter === 'sold'
                          ? 'لا توجد قطع مباعة بالكامل حالياً.'
                          : stockFilter === 'available'
                            ? 'لا توجد قطع غيار متاحة بالمخزون حالياً. يمكنك إضافة مشتريات من تبويب "شراء قطع وملحقات".'
                            : 'لا توجد أي قطع مسجلة.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DISASSEMBLY BATCHES (دفعة أجهزة التفكيك/التشليح والأرباح) */}
      {activeTab === 'batches' && (
        <div className="space-y-5">
          {/* Batches Overall Financial KPI Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-400 block font-bold">إجمالي تكلفة شراء الأجهزة</span>
                <span className="text-xl font-mono font-black text-amber-400">{formatMoney(totalBatchesCost, 'USD')}</span>
                <span className="text-[10px] text-gray-500 block mt-0.5">{batches.length} جهاز/دفعة مفككة</span>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl">
                <Layers size={22} />
              </div>
            </div>

            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-400 block font-bold">إجمالي المبالغ المستردة (مبيعات القطع)</span>
                <span className="text-xl font-mono font-black text-cyan-400">{formatMoney(totalBatchesRecovered, 'USD')}</span>
                <span className="text-[10px] text-cyan-400/80 block mt-0.5">من واقع فواتير البيع المسجلة</span>
              </div>
              <div className="p-3 bg-cyan-500/10 text-cyan-400 rounded-2xl">
                <CircleDollarSign size={22} />
              </div>
            </div>

            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-400 block font-bold">صافي الأرباح المحققة الكلية</span>
                <span className="text-xl font-mono font-black text-emerald-400">
                  +{formatMoney(totalBatchesNetProfit, 'USD')}
                </span>
                <span className="text-[10px] text-emerald-400/80 block mt-0.5">بعد تغطية تكلفة شراء الأجهزة بالكامل</span>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl">
                <TrendingUp size={22} />
              </div>
            </div>
          </div>

          {/* Batches Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredBatches.length > 0 ? (
              filteredBatches.map((batch, idx) => {
                const fin = getBatchFinancials(batch);
                const isExpanded = !!expandedBatches[batch.id!];

                return (
                  <div 
                    key={batch.id ? `batch-${batch.id}-${idx}` : `batch-idx-${idx}`} 
                    className="bg-[#121212] border border-white/5 rounded-3xl p-5 space-y-4 shadow-xl hover:border-purple-500/20 transition-all"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between border-b border-white/5 pb-3.5">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-2xl border border-purple-500/20">
                          <Layers size={22} />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-white">{batch.batchName}</h4>
                          <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                            <span>رقم: {batch.batchNumber}</span>
                            <span>•</span>
                            <span>المورد: {batch.supplierName || 'غير محدد'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
                          fin.isCostCovered 
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {fin.isCostCovered ? 'تم استرداد رأس المال بالكامل' : 'جاري استرداد رأس المال'}
                        </span>

                        <button
                          onClick={() => setDeleteModal({
                            isOpen: true,
                            type: 'batch',
                            id: batch.id!,
                            name: batch.batchName || 'دفعة التفكيك',
                            isDeleting: false
                          })}
                          className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-all border border-red-500/20 cursor-pointer"
                          title="حذف هذه الدفعة"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Financial Dashboard Metrics for this Device */}
                    <div className="grid grid-cols-3 gap-2 bg-[#181818] p-3 rounded-2xl border border-white/5 text-center">
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-gray-400 block font-bold">سعر شراء الجهاز</span>
                        <span className="text-xs font-mono font-bold text-amber-400">
                          {formatMoney(fin.totalCost, batch.currency || 'USD')}
                        </span>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] text-gray-400 block font-bold">المسترد من بيع القطع</span>
                        <span className="text-xs font-mono font-bold text-cyan-400">
                          {formatMoney(fin.recovered, batch.currency || 'USD')}
                        </span>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] text-gray-400 block font-bold">صافي الربح المحقق</span>
                        <span className={`text-xs font-mono font-black ${fin.netProfit > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                          {fin.netProfit > 0 ? `+${formatMoney(fin.netProfit, batch.currency || 'USD')}` : formatMoney(0, batch.currency || 'USD')}
                        </span>
                      </div>
                    </div>

                    {/* Secondary Financial Indicators: Remaining to break-even & Projected value of unsold parts */}
                    <div className="grid grid-cols-2 gap-2 bg-[#161616] p-2.5 rounded-xl border border-white/5 text-xs">
                      <div className="flex items-center justify-between px-2">
                        <span className="text-gray-400 text-[11px]">
                          {fin.isCostCovered ? 'تجاوز رأس المال بـ:' : 'المتبقي لتغطية التكلفة:'}
                        </span>
                        <span className={`font-mono font-bold ${fin.isCostCovered ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {fin.isCostCovered 
                            ? `+${formatMoney(fin.recovered - fin.totalCost, batch.currency || 'USD')}` 
                            : formatMoney(fin.remainingToBreakEven, batch.currency || 'USD')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between px-2 border-r border-white/5">
                        <span className="text-gray-400 text-[11px]">قيمة القطع المتبقية بالرف:</span>
                        <span className="font-mono font-bold text-purple-400" title={`${fin.remainingPartsCount} قطعة لا زالت بالمخزن`}>
                          {formatMoney(fin.projectedRemainingValue, batch.currency || 'USD')}
                        </span>
                      </div>
                    </div>

                    {/* Recovery Progress Bar */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex justify-between text-[11px] font-bold">
                        <span className="text-gray-400">نسبة تغطية تكلفة الشراء:</span>
                        <span className={fin.percent >= 100 ? 'text-emerald-400' : 'text-amber-400'}>
                          {fin.percent}%
                          {fin.netProfit > 0 && <span className="text-emerald-400 font-normal mr-1">(تم تحقيق أرباح)</span>}
                        </span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden border border-white/5">
                        <div
                          className={`h-full transition-all duration-500 ${fin.percent >= 100 ? 'bg-gradient-to-l from-emerald-500 to-teal-400' : 'bg-gradient-to-l from-amber-500 to-orange-400'}`}
                          style={{ width: `${fin.percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Expandable Breakdown Button */}
                    <button
                      onClick={() => toggleBatchExpand(batch.id!)}
                      className="w-full py-2 px-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl text-xs font-bold text-gray-300 hover:text-white flex items-center justify-between transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Package size={14} className="text-purple-400" />
                        <span>عرض تفاصيل قطع ومبيعات هذا الجهاز ({fin.matchedParts.length} قطعة مفرزة، {fin.matchedSales.length} حركة بيع)</span>
                      </div>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {/* Detailed Accordion Content */}
                    {isExpanded && (
                      <div className="space-y-4 pt-2 border-t border-white/5">
                        {/* Section 1: Extracted Parts List */}
                        <div className="space-y-2">
                          <h5 className="text-xs font-black text-white flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <Tag size={13} className="text-emerald-400" />
                              <span>القطع المستخرجة من الجهاز وحالتها بالمخزن:</span>
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">
                              متبقي {fin.remainingPartsCount} قطعة بالرف
                            </span>
                          </h5>

                          <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-black/40 rounded-xl border border-white/5 text-xs">
                            {fin.matchedParts.length > 0 ? (
                              fin.matchedParts.map((part, pIdx) => {
                                const pQty = Number(part.quantity || 0);
                                const isSold = pQty <= 0;

                                return (
                                  <div 
                                    key={part.id || pIdx} 
                                    className={`flex items-center justify-between p-2 rounded-lg border ${
                                      isSold 
                                        ? 'bg-blue-500/5 border-blue-500/10 text-gray-400' 
                                        : 'bg-white/[0.02] border-white/5 text-white'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={`w-2 h-2 rounded-full ${isSold ? 'bg-blue-400' : 'bg-emerald-400'}`} />
                                      <span className="font-bold">{part.name}</span>
                                    </div>

                                    <div className="flex items-center gap-3">
                                      <span className="font-mono text-[11px] text-gray-400">
                                        سعر البيع: <strong className="text-emerald-400">{formatMoney(part.salePrice || 0, batch.currency || 'USD')}</strong>
                                      </span>

                                      <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                                        isSold ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-400'
                                      }`}>
                                        {isSold ? 'بيعت بالكامل' : `متاح: ${pQty} ق`}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-center py-4 text-gray-500 text-xs">
                                لا توجد قطع مفرزة مسجلة في المخزن لهذه الدفعة.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Section 2: Sales History from this Batch */}
                        <div className="space-y-2">
                          <h5 className="text-xs font-black text-white flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <ShoppingCart size={13} className="text-cyan-400" />
                              <span>المبيعات المحققة من قطع هذا الجهاز ({fin.matchedSales.length}):</span>
                            </span>
                            <span className="text-[10px] font-mono font-bold text-cyan-400">
                              إجمالي المحقق: {formatMoney(fin.recovered, batch.currency || 'USD')}
                            </span>
                          </h5>

                          <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-black/40 rounded-xl border border-white/5 text-xs">
                            {fin.matchedSales.length > 0 ? (
                              fin.matchedSales.map((sale, sIdx) => {
                                const salePrice = Number(sale.cost || (Number(sale.quantity || 1) * Number(sale.unitCost || 0)));
                                return (
                                  <div key={sale.id || sIdx} className="flex items-center justify-between p-2 bg-cyan-500/5 rounded-lg border border-cyan-500/10">
                                    <div>
                                      <div className="font-bold text-white flex items-center gap-1.5">
                                        <span>{sale.deviceName || sale.deviceType || 'قطعة مباعة'}</span>
                                        <span className="text-cyan-400 font-mono text-[10px]">({sale.quantity || 1} قطعة)</span>
                                      </div>
                                      <div className="text-[10px] text-gray-400 flex items-center gap-2 mt-0.5">
                                        <span>فاتورة #{sale.invoiceNumber}</span>
                                        <span>•</span>
                                        <span>العميل: {sale.customerName || 'عميل نقدي'}</span>
                                      </div>
                                    </div>

                                    <div className="font-mono font-black text-emerald-400 text-xs">
                                      +{formatMoney(salePrice, batch.currency || 'USD')}
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-center py-4 text-gray-500 text-xs">
                                لم يتم بيع أي قطعة من هذا الجهاز حتى الآن. عند بيع أي قطعة تابعة له ستظهر هنا وتُخصم من تكلفة الجهاز تلقائياً.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Summary Projected Profit Footer */}
                        <div className="p-3 bg-gradient-to-r from-purple-900/20 to-emerald-950/30 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
                          <div>
                            <span className="text-[11px] text-gray-300 block font-bold">إجمالي الربح المتوقع بعد بيع كامل قطع الجهاز:</span>
                            <span className="text-[10px] text-gray-500">يشمل المبيعات المحققة + القيمة التقديرية للقطع المتبقية في المخزن</span>
                          </div>
                          <span className={`text-sm font-mono font-black ${fin.totalProjectedProfit > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                            {fin.totalProjectedProfit > 0 ? `+${formatMoney(fin.totalProjectedProfit, batch.currency || 'USD')}` : formatMoney(0, batch.currency || 'USD')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="col-span-2 p-12 text-center text-gray-500 bg-[#121212] rounded-3xl border border-white/5 space-y-2">
                <Layers size={36} className="mx-auto text-gray-600 opacity-50" />
                <p className="text-sm font-bold text-gray-400">لا توجد دفعات أجهزة تفكيك مسجلة حالياً.</p>
                <p className="text-xs text-gray-600">يمكنك شراء جهاز تالف وتفكيكه إلى قطع وفرزها من صفحة "شراء قطع وملحقات".</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 100% BULLETPROOF CUSTOM IN-APP DELETE MODAL */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#1c1c1c] border border-red-500/30 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 text-right font-cairo animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3 text-red-400 border-b border-white/5 pb-4">
              <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-base font-black text-white">تأكيد عملية الحذف</h3>
                <p className="text-xs text-gray-400">
                  {deleteModal.type === 'item' ? 'حذف صنف من مخزون المحل' : 'حذف دفعة تفكيك أجهزة'}
                </p>
              </div>
            </div>

            <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-2">
              <p className="text-xs text-gray-300 leading-relaxed">
                هل أنت متأكد من رغبتك في حذف{' '}
                <strong className="text-white underline">{deleteModal.name}</strong>{' '}
                نهائياً؟
              </p>
              <p className="text-[11px] text-red-400/80">
                * هذا الإجراء سيقوم بإزالة السجل فورياً من قاعدة البيانات والمخزون.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deleteModal.isDeleting}
                onClick={() => setDeleteModal(null)}
                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={deleteModal.isDeleting}
                onClick={handleConfirmDelete}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black shadow-lg shadow-red-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {deleteModal.isDeleting ? (
                  <>
                    <RefreshCw className="animate-spin" size={14} />
                    <span>جاري الحذف...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>نعم، حذف نهائي</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orphaned Stock Audit Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#1e1e1e] border border-amber-500/30 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-5 text-right font-cairo">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="p-3 bg-amber-500/10 rounded-2xl">
                  <ShieldAlert size={28} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">تدقيق المخزون المعلق</h3>
                  <p className="text-xs text-amber-400/80 font-bold">فحص قطع الغيار والدفعات المرتبطة بفواتير شراء محذوفة سابقاً</p>
                </div>
              </div>
              <button
                onClick={() => setShowAuditModal(false)}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {auditMessage && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold text-center">
                {auditMessage}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 text-center">
                  <span className="text-xs text-gray-400 block mb-1">قطع غيار معلقة بلا فاتورة</span>
                  <span className={`text-2xl font-black font-mono ${orphanedItems.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {orphanedItems.length}
                  </span>
                </div>

                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 text-center">
                  <span className="text-xs text-gray-400 block mb-1">دفعات تفكيك بلا فاتورة</span>
                  <span className={`text-2xl font-black font-mono ${orphanedBatches.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {orphanedBatches.length}
                  </span>
                </div>
              </div>

              {orphanedItems.length === 0 && orphanedBatches.length === 0 ? (
                <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl text-center space-y-1">
                  <p className="text-sm font-bold text-emerald-400">المخزون سليم ومتطابق بالكامل!</p>
                  <p className="text-xs text-gray-400">لا توجد أي قطع غيار أو دفعات مسجلة تابعة لفواتير شراء محذوفة.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-300">
                    تم العثور على عناصر مخزون أو دفعات كانت مضافة من فواتير شراء حُذفت سابقاً دون تصفية عناصرها:
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-2 p-2 bg-black/40 rounded-xl border border-white/5 text-xs">
                    {orphanedItems.map((item, i) => (
                      <div key={item.id || i} className="flex justify-between items-center p-2 bg-white/[0.02] rounded-lg border border-white/5">
                        <span className="font-bold text-white">{item.name}</span>
                        <span className="text-amber-400 font-mono">الكمية: {item.quantity}</span>
                      </div>
                    ))}
                    {orphanedBatches.map((b, i) => (
                      <div key={b.id || i} className="flex justify-between items-center p-2 bg-purple-500/5 rounded-lg border border-purple-500/10">
                        <span className="font-bold text-purple-300">دفعة: {b.batchName}</span>
                        <span className="text-gray-400 font-mono">#{b.batchNumber}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl text-xs font-bold transition-all border border-white/5 cursor-pointer"
              >
                إغلاق
              </button>

              {(orphanedItems.length > 0 || orphanedBatches.length > 0) && (
                <button
                  type="button"
                  disabled={isCleaning}
                  onClick={handleCleanOrphans}
                  className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-black shadow-lg shadow-amber-600/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isCleaning ? (
                    <>
                      <RefreshCw className="animate-spin" size={14} />
                      <span>جاري التنظيف...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>تنظيف وحذف العناصر المعلقة</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
