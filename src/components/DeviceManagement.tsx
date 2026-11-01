import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Cpu, Activity, CheckCircle, PackageCheck, 
  ArrowRight, Eye, Info, Search as SearchIcon, Wrench, ClipboardCheck, Sparkles
} from 'lucide-react';
import { collection, onSnapshot } from '../firebase';
import { db } from '../firebase';
import { Invoice, InvoiceItem, User, Customer, ShopConfig, isPurchaseInvoice, isSaleInvoice } from '../types';
import PrintPreviewOverlay from './PrintPreviewOverlay';
import DeviceExit from './entry-exit/DeviceExit';
import Inspection from './movement/Inspection';
import ApprovalAndParts from './movement/ApprovalAndParts';
import Maintenance from './movement/Maintenance';
import { useBackHandler } from '../hooks/useBackHandler';

export default function DeviceManagement({ user, onBack, shopConfig }: { user: User; onBack: () => void; shopConfig: ShopConfig | null }) {
  // Navigation State
  const [subview, setSubview] = useState<'hub' | 'active_devices' | 'ready_exit' | 'delivered' | 'inspection_form' | 'approval_form' | 'maintenance_form'>('hub');

  useBackHandler(subview !== 'hub', () => {
    if (['inspection_form', 'approval_form', 'maintenance_form'].includes(subview)) {
      setSubview('active_devices');
    } else {
      setSubview('hub');
    }
  });

  // DB State
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // Active Devices State
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [activeSearch, setActiveSearch] = useState('');

  // Delivered Invoice Preview Modal
  const [activePreviewInvoice, setActivePreviewInvoice] = useState<Invoice | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Real-time Listeners
  useEffect(() => {
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (s) => {
      setInvoices(s.docs.map(d => ({ ...d.data(), id: d.id } as Invoice)));
    });
    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (s) => {
      setItems(s.docs.map(d => ({ ...d.data(), id: d.id } as InvoiceItem)));
    });
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (s) => {
      setCustomers(s.docs.map(d => ({ ...d.data(), id: d.id } as Customer)));
    });

    return () => {
      unsubInvoices();
      unsubItems();
      unsubCustomers();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 1. Filter Active Devices (new/10, inspected/20, approval/30, parts/35, maintenance/40)
  const ACTIVE_STATUSES = ['10', 'new', '20', 'inspected', 'testing', '30', 'awaiting_approval', '35', 'awaiting_parts', '40', 'repairing'];
  const activeInvoicesFiltered = invoices
    .filter(inv => {
      if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) return false;
      const isStatusActive = ACTIVE_STATUSES.includes(inv.status);
      const isSearchMatch = 
        (inv.customerName || '').toLowerCase().includes((activeSearch || '').toLowerCase()) ||
        String(inv.invoiceNumber || '').includes(activeSearch || '');
      return isStatusActive && isSearchMatch;
    })
    .sort((a, b) => Number(b.invoiceNumber) - Number(a.invoiceNumber));

  // 2. Filter Delivered Devices (60)
  const deliveredInvoicesFiltered = invoices
    .filter(inv => {
      if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) return false;
      const isDelivered = inv.status === '60';
      const isSearchMatch = 
        (inv.customerName || '').toLowerCase().includes((activeSearch || '').toLowerCase()) ||
        String(inv.invoiceNumber || '').includes(activeSearch || '');
      return isDelivered && isSearchMatch;
    })
    .sort((a, b) => Number(b.invoiceNumber) - Number(a.invoiceNumber));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            <Cpu className="text-orange-500" size={28} />
            إدارة وحوكمة الأجهزة
          </h2>
          <p className="text-sm text-gray-400 mt-1 font-bold">إدارة مسارات الفحص، الصيانة، والتسليم</p>
        </div>
        {subview !== 'hub' && (
          <button
            onClick={() => setSubview('hub')}
            className="w-full md:w-auto px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 border border-white/5 cursor-pointer"
          >
            <ArrowRight size={18} />
            العودة للقائمة الرئيسية
          </button>
        )}
      </div>

      {/* SUBVIEW: Hub */}
      {subview === 'hub' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button onClick={() => setSubview('active_devices')} className="bg-[#1a1a1a] p-6 rounded-[2rem] border border-white/5 text-right hover:bg-white/5 transition-all group cursor-pointer">
            <div className="bg-blue-500/10 text-blue-500 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Activity size={24} />
            </div>
            <h3 className="text-lg font-black text-white mb-2">الأجهزة النشطة</h3>
            <p className="text-xs text-gray-400 font-bold leading-relaxed">إدارة أجهزة قيد الفحص والصيانة والتشخيص</p>
          </button>
          <button onClick={() => setSubview('ready_exit')} className="bg-[#1a1a1a] p-6 rounded-[2rem] border border-white/5 text-right hover:bg-white/5 transition-all group cursor-pointer">
            <div className="bg-emerald-500/10 text-emerald-500 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <CheckCircle size={24} />
            </div>
            <h3 className="text-lg font-black text-white mb-2">أجهزة جاهزة للتسليم</h3>
            <p className="text-xs text-gray-400 font-bold leading-relaxed">تسليم الأجهزة للعملاء وإنهاء الفواتير وسندات القبض</p>
          </button>
          <button onClick={() => setSubview('delivered')} className="bg-[#1a1a1a] p-6 rounded-[2rem] border border-white/5 text-right hover:bg-white/5 transition-all group cursor-pointer">
            <div className="bg-purple-500/10 text-purple-500 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <PackageCheck size={24} />
            </div>
            <h3 className="text-lg font-black text-white mb-2">الأجهزة المسلمة</h3>
            <p className="text-xs text-gray-400 font-bold leading-relaxed">سجل وتفاصيل الأجهزة التي تم تسليمها ومغادرتها</p>
          </button>
        </div>
      )}

      {/* SUBVIEW: Active Devices */}
      {subview === 'active_devices' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="bg-[#1a1a1a] rounded-3xl p-6 border border-white/5 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-white">الأجهزة النشطة</h3>
                <p className="text-xs text-gray-400 font-bold mt-1">قائمة الأجهزة قيد المعاينة والفحص والصيانة</p>
              </div>
              <div className="relative w-full md:w-72">
                <input
                  type="text"
                  value={activeSearch}
                  onChange={(e) => setActiveSearch(e.target.value)}
                  placeholder="بحث برقم الفاتورة أو العميل..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl pr-10 pl-4 py-2.5 text-xs font-bold text-white focus:border-blue-500 outline-none transition-all placeholder:text-gray-500"
                />
                <SearchIcon className="absolute right-3 top-3 text-gray-500" size={16} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {activeInvoicesFiltered.map((inv, idx) => (
                <div key={inv.id ? `act-${inv.id}-${idx}` : `act-idx-${idx}`} className="bg-black/40 p-4 rounded-2xl border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-white/10 transition-all">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white font-mono">#{inv.invoiceNumber}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-bold">
                        {inv.status === '10' ? 'دخول جديد' : inv.status === '20' ? 'قيد الفحص' : inv.status === '30' ? 'انتظار الموافقة' : inv.status === '35' ? 'انتظار قطع' : 'قيد الصيانة'}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-gray-300 mt-1">{inv.customerName}</h4>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button 
                      onClick={() => { setSelectedInvoice(inv); setSubview('inspection_form'); }} 
                      className="px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <ClipboardCheck size={14} />
                      فحص
                    </button>
                    <button 
                      onClick={() => { setSelectedInvoice(inv); setSubview('approval_form'); }} 
                      className="px-4 py-2 bg-amber-500/10 text-amber-400 hover:bg-amber-500 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles size={14} />
                      موافقة وقطع
                    </button>
                    <button 
                      onClick={() => { setSelectedInvoice(inv); setSubview('maintenance_form'); }} 
                      className="px-4 py-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Wrench size={14} />
                      صيانة
                    </button>
                  </div>
                </div>
              ))}
              {activeInvoicesFiltered.length === 0 && (
                <div className="text-center py-12 text-gray-500 font-bold bg-black/20 rounded-2xl border border-dashed border-white/5">
                  لا توجد أجهزة نشطة مطابقة حالياً
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* SUBVIEW: Ready Exit */}
      {subview === 'ready_exit' && (
        <DeviceExit user={user} onBack={() => setSubview('hub')} />
      )}

      {/* SUBVIEW: Delivered */}
      {subview === 'delivered' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="bg-[#1a1a1a] rounded-3xl p-6 border border-white/5 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-white">الأجهزة المسلمة</h3>
                <p className="text-xs text-gray-400 font-bold mt-1">سجل الأجهزة التي تم تسليمها ومغادرتها</p>
              </div>
              <div className="relative w-full md:w-72">
                <input
                  type="text"
                  value={activeSearch}
                  onChange={(e) => setActiveSearch(e.target.value)}
                  placeholder="بحث برقم الفاتورة أو العميل..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl pr-10 pl-4 py-2.5 text-xs font-bold text-white focus:border-purple-500 outline-none transition-all placeholder:text-gray-500"
                />
                <SearchIcon className="absolute right-3 top-3 text-gray-500" size={16} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {deliveredInvoicesFiltered.map((inv, idx) => (
                <div key={inv.id ? `del-${inv.id}-${idx}` : `del-idx-${idx}`} className="bg-black/40 p-4 rounded-2xl border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-white/10 transition-all">
                  <div>
                    <span className="text-sm font-bold text-white font-mono">#{inv.invoiceNumber}</span>
                    <h4 className="text-sm font-bold text-gray-300 mt-1">{inv.customerName}</h4>
                  </div>
                  <button onClick={() => setActivePreviewInvoice(inv)} className="px-4 py-2 bg-white/5 text-white rounded-xl text-xs font-bold hover:bg-white/10 transition-all flex items-center gap-2 cursor-pointer">
                    <Eye size={16} />
                    عرض التفاصيل
                  </button>
                </div>
              ))}
              {deliveredInvoicesFiltered.length === 0 && (
                <div className="text-center py-12 text-gray-500 font-bold bg-black/20 rounded-2xl border border-dashed border-white/5">
                  لا توجد أجهزة مسلمة مطابقة حالياً
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* SUBVIEW: Forms */}
      {subview === 'inspection_form' && selectedInvoice && (
        <Inspection initialInvoice={selectedInvoice} onBack={() => setSubview('active_devices')} user={user} />
      )}
      {subview === 'approval_form' && selectedInvoice && (
        <ApprovalAndParts initialInvoice={selectedInvoice} onBack={() => setSubview('active_devices')} user={user} />
      )}
      {subview === 'maintenance_form' && selectedInvoice && (
        <Maintenance initialInvoice={selectedInvoice} onBack={() => setSubview('active_devices')} user={user} />
      )}

      {/* Overlays */}
      {activePreviewInvoice && (
        <PrintPreviewOverlay
          type="invoice"
          data={{
            invoice: activePreviewInvoice,
            items: items.filter(it => it.invoiceNumber === activePreviewInvoice.invoiceNumber),
            customer: customers.find(c => c.id === activePreviewInvoice.customerId)
          }}
          onClose={() => setActivePreviewInvoice(null)}
          shopConfig={shopConfig}
          user={user}
        />
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-6 z-50 bg-black/90 border border-white/20 text-white px-5 py-3 rounded-2xl text-xs font-bold shadow-2xl flex items-center gap-2">
          <Info size={16} className="text-orange-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
