import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from '../firebase';
import { PartCatalogItem } from '../types';
import { Tag, Plus, Search, Edit2, Trash2, X, Check, Package, FolderPlus, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function PartsCatalogTable() {
  const [items, setItems] = useState<PartCatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState('قطع غيار ملحقات');
  const [defaultCost, setDefaultCost] = useState<number | ''>('');
  const [defaultSalePrice, setDefaultSalePrice] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'parts_catalog'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PartCatalogItem));
      setItems(list);
    });
    return () => unsub();
  }, []);

  const handleOpenAdd = () => {
    setEditingId(null);
    setName('');
    setCategory('قطع غيار ملحقات');
    setDefaultCost('');
    setDefaultSalePrice('');
    setNotes('');
    setShowModal(true);
  };

  const handleOpenEdit = (item: PartCatalogItem) => {
    setEditingId(item.id || null);
    setName(item.name);
    setCategory(item.category || 'قطع غيار ملحقات');
    setDefaultCost(item.defaultCost ?? '');
    setDefaultSalePrice(item.defaultSalePrice ?? '');
    setNotes(item.notes || '');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const docId = editingId || name.trim().replace(/\//g, '_') + '_' + Date.now();
      const payload: PartCatalogItem = {
        name: name.trim(),
        category: category.trim() || 'قطع غيار ملحقات',
        defaultCost: defaultCost === '' ? 0 : Number(defaultCost),
        defaultSalePrice: defaultSalePrice === '' ? 0 : Number(defaultSalePrice),
        notes: notes.trim(),
        updatedAt: serverTimestamp()
      };

      if (!editingId) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, 'parts_catalog', docId), payload, { merge: true });
      setShowModal(false);
    } catch (err) {
      console.error("Error saving part catalog item:", err);
      alert("حدث خطأ أثناء حفظ بيانات القطعة");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, itemName: string) => {
    if (confirm(`هل أنت متأكد من حذف الصنف "${itemName}" من دليل قطع الغيار؟`)) {
      try {
        await deleteDoc(doc(db, 'parts_catalog', id));
      } catch (err) {
        console.error("Error deleting catalog item:", err);
      }
    }
  };

  const filteredItems = items.filter(i =>
    (i.name || '').toLowerCase().includes((search || '').toLowerCase()) ||
    (i.category && (i.category || '').toLowerCase().includes((search || '').toLowerCase())) ||
    (i.notes && (i.notes || '').toLowerCase().includes((search || '').toLowerCase()))
  );

  return (
    <div className="space-y-6 font-cairo text-right" dir="rtl">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#141414] p-4 rounded-2xl border border-white/5 shadow-xl">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Tag size={22} />
          </div>
          <div>
            <h3 className="text-base font-black text-white">دليل وسجل قطع الغيار والملحقات</h3>
            <p className="text-xs text-gray-400">إضافة وتعديل بيانات قطع الغيار والملحقات المعتمدة في النظام</p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم القطعة أو التصنيف..."
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            <Search size={14} className="absolute right-3 top-2.5 text-gray-400" />
          </div>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20 active:scale-95 whitespace-nowrap"
          >
            <Plus size={16} />
            <span>إضافة قطعة جديدة</span>
          </button>
        </div>
      </div>

      {/* Catalog Items Table */}
      <div className="bg-[#121212] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
              <tr>
                <th className="p-3.5">#</th>
                <th className="p-3.5">اسم القطعة / الملحق</th>
                <th className="p-3.5">التصنيف</th>
                <th className="p-3.5">التكلفة الافتراضية ($)</th>
                <th className="p-3.5">سعر البيع الافتراضي ($)</th>
                <th className="p-3.5">ملاحظات</th>
                <th className="p-3.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-200">
              {filteredItems.length > 0 ? (
                filteredItems.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-3.5 font-mono text-gray-500">{idx + 1}</td>
                    <td className="p-3.5 font-bold text-white flex items-center gap-2">
                      <Tag size={14} className="text-emerald-400" />
                      <span>{item.name}</span>
                    </td>
                    <td className="p-3.5">
                      <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-gray-300">
                        {item.category || 'عام'}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-amber-400">
                      ${item.defaultCost ?? 0}
                    </td>
                    <td className="p-3.5 font-mono font-bold text-emerald-400">
                      ${item.defaultSalePrice ?? 0}
                    </td>
                    <td className="p-3.5 text-gray-400 max-w-xs truncate">
                      {item.notes || '-'}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenEdit(item)}
                          className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-all border border-blue-500/20"
                          title="تعديل"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id!, item.name)}
                          className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-all border border-red-500/20"
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">
                    لا توجد قطع غيار أو ملحقات مسجلة حالياً في الدليل. انقر على زر "إضافة قطعة جديدة" للبدء.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-[#141414] border border-white/10 rounded-3xl shadow-2xl overflow-hidden p-6 text-right font-cairo space-y-4"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
                    <Tag size={18} />
                  </div>
                  <h3 className="text-base font-black text-white">
                    {editingId ? 'تعديل قطعة غيار/ملحق' : 'تسجيل قطعة غيار/ملحق جديدة'}
                  </h3>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">اسم القطعة / الملحق <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="مثال: راوتر ستارلينك V2، شاحن أيفون 20 واط، كيبل انترنت"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">التصنيف / الفئة</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="مثال: ستارلينك، شواحن، كابلات، بوردات"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 block">تكلفة الشراء الافتراضية ($)</label>
                    <input
                      type="number"
                      step="any"
                      value={defaultCost}
                      onChange={(e) => setDefaultCost(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.00"
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-amber-400 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 block">سعر البيع الافتراضي ($)</label>
                    <input
                      type="number"
                      step="any"
                      value={defaultSalePrice}
                      onChange={(e) => setDefaultSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.00"
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">ملاحظات / وصف مختصر</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="ملاحظات إضافية عن مواصفات الصنف..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20"
                  >
                    <Check size={16} />
                    <span>{editingId ? 'حفظ التعديلات' : 'إضافة الصنف'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
