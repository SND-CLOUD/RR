import React, { useState, useEffect, useRef } from 'react';
import { db, collection, onSnapshot, doc, setDoc, serverTimestamp } from '../firebase';
import { ElectronicPartGroup, PartCatalogItem, ShopPartItem, DevicePartUsageItem } from '../types';
import { Cpu, X, Plus, Edit2, Trash2, Check, ArrowRight, AlertCircle, Wrench, Package } from 'lucide-react';

interface ElectronicPartsSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (parts: DevicePartUsageItem[]) => void;
  initialParts?: DevicePartUsageItem[];
  deviceName?: string;
  deviceType?: string;
  mode: 'inspection' | 'maintenance';
}

export const ElectronicPartsSelectionModal: React.FC<ElectronicPartsSelectionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialParts = [],
  deviceName,
  deviceType,
  mode
}) => {
  // Datasets from DB
  const [groups, setGroups] = useState<ElectronicPartGroup[]>([]);
  const [catalogItems, setCatalogItems] = useState<PartCatalogItem[]>([]);
  const [shopParts, setShopParts] = useState<ShopPartItem[]>([]);

  // Temporary list of parts for this device in the modal
  const [tempPartsList, setTempPartsList] = useState<DevicePartUsageItem[]>([]);

  // Current editing / adding item state
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupNameInput, setGroupNameInput] = useState('');
  const [partNameInput, setPartNameInput] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [isScrap, setIsScrap] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Smart click-to-hide-keyboard behavior
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  const [isGroupReadOnly, setIsGroupReadOnly] = useState(true);
  const groupWrapperRef = useRef<HTMLDivElement>(null);

  const [isPartMenuOpen, setIsPartMenuOpen] = useState(false);
  const [isPartReadOnly, setIsPartReadOnly] = useState(true);
  const partWrapperRef = useRef<HTMLDivElement>(null);

  // Helper to safely parse parts
  const resolvePartsArray = (raw: any): DevicePartUsageItem[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error("Failed to parse initialParts string:", e);
      }
    }
    return [];
  };

  // Sync initial parts whenever modal opens
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (isOpen) {
      if (!hasInitialized.current) {
        const parts = resolvePartsArray(initialParts);
        setTempPartsList(parts.length > 0 ? [...parts] : []);
        resetForm();
        hasInitialized.current = true;
      }
    } else {
      hasInitialized.current = false;
    }
  }, [isOpen, initialParts]);

  // Load groups & catalog items
  useEffect(() => {
    const unsubGroups = onSnapshot(collection(db, 'electronic_part_groups'), (snap) => {
      const gList = snap.docs.map(d => ({ id: d.id, ...d.data() } as ElectronicPartGroup));
      gList.sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
      setGroups(gList);
    });

    const unsubCatalog = onSnapshot(collection(db, 'parts_catalog'), (snap) => {
      const cList = snap.docs.map(d => ({ id: d.id, ...d.data() } as PartCatalogItem));
      setCatalogItems(cList);
    });

    const unsubStock = onSnapshot(collection(db, 'shop_parts_inventory'), (snap) => {
      const sList = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShopPartItem));
      setShopParts(sList);
    });

    return () => {
      unsubGroups();
      unsubCatalog();
      unsubStock();
    };
  }, []);

  // Handle outside click for menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupWrapperRef.current && !groupWrapperRef.current.contains(e.target as Node)) {
        setIsGroupMenuOpen(false);
        setIsGroupReadOnly(true);
      }
      if (partWrapperRef.current && !partWrapperRef.current.contains(e.target as Node)) {
        setIsPartMenuOpen(false);
        setIsPartReadOnly(true);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const resetForm = () => {
    setSelectedGroupId('');
    setGroupNameInput('');
    setPartNameInput('');
    setQuantity(1);
    setNotes('');
    setIsScrap(false);
    setEditingIndex(null);
    setIsGroupMenuOpen(false);
    setIsPartMenuOpen(false);
    setIsGroupReadOnly(true);
    setIsPartReadOnly(true);
  };

  const filteredGroups = groups.filter(g => 
    !groupNameInput.trim() || g.name.toLowerCase().includes(groupNameInput.trim().toLowerCase())
  );

  const filteredParts = catalogItems.filter(item => {
    if (item.itemType && item.itemType !== 'electronic_part') return false;
    if (selectedGroupId) {
      const matchGroup = item.groupId === selectedGroupId || item.groupName === groupNameInput;
      if (!matchGroup) return false;
    }
    if (!partNameInput.trim()) return true;
    return item.name.toLowerCase().includes(partNameInput.trim().toLowerCase());
  });

  const handleSelectGroup = (g: ElectronicPartGroup) => {
    setSelectedGroupId(g.id);
    setGroupNameInput(g.name);
    setIsGroupMenuOpen(false);
    setIsGroupReadOnly(true);
    setPartNameInput('');
  };

  const handleSelectPart = (p: PartCatalogItem) => {
    setPartNameInput(p.name);
    if (!selectedGroupId && p.groupId) {
      setSelectedGroupId(p.groupId);
      setGroupNameInput(p.groupName || '');
    }
    setIsPartMenuOpen(false);
    setIsPartReadOnly(true);
  };

  const handleAddOrUpdateItem = async () => {
    const cleanGroup = groupNameInput.trim();
    const cleanPart = partNameInput.trim();

    if (!cleanGroup) {
      alert('الرجاء اختيار أو كتابة اسم المجموعة الإلكترونية أولاً');
      return;
    }
    if (!cleanPart) {
      alert('الرجاء اختيار أو كتابة كود أو اسم القطعة الإلكترونية');
      return;
    }
    if (quantity < 1) {
      alert('الرجاء تحديد كمية صحيحة (1 على الأقل)');
      return;
    }

    let resolvedGroupId = selectedGroupId;
    let existingGroup = groups.find(g => g.name.trim().toLowerCase() === cleanGroup.toLowerCase() || g.id === selectedGroupId);

    if (!existingGroup) {
      const newGroupId = `epg_${Date.now()}`;
      resolvedGroupId = newGroupId;
      const newGroupData: ElectronicPartGroup = {
        id: newGroupId,
        name: cleanGroup,
        orderIndex: groups.length + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      try {
        await setDoc(doc(db, 'electronic_part_groups', newGroupId), newGroupData, { merge: true });
      } catch (err) {
        console.error("Error creating new group on the fly:", err);
      }
    } else {
      resolvedGroupId = existingGroup.id;
    }

    let existingCatalog = catalogItems.find(c => c.name.trim().toLowerCase() === cleanPart.toLowerCase());
    let unitCost = existingCatalog?.defaultCost || 0;
    let unitSalePrice = existingCatalog?.defaultSalePrice || 0;

    const existingStock = shopParts.find(s => s.name.trim().toLowerCase() === cleanPart.toLowerCase());
    if (existingStock) {
      if (!unitCost && existingStock.unitCost) unitCost = existingStock.unitCost;
      if (!unitSalePrice && existingStock.salePrice) unitSalePrice = existingStock.salePrice;
    }

    if (!existingCatalog) {
      const docId = cleanPart.replace(/[\/\\]/g, '_');
      const newPartData: PartCatalogItem = {
        id: docId,
        name: cleanPart,
        itemType: 'electronic_part',
        groupId: resolvedGroupId,
        groupName: cleanGroup,
        category: cleanGroup,
        orderIndex: catalogItems.length + 1,
        defaultCost: unitCost,
        defaultSalePrice: unitSalePrice,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      try {
        await setDoc(doc(db, 'parts_catalog', docId), newPartData, { merge: true });
      } catch (err) {
        console.error("Error creating new part on the fly:", err);
      }
    }

    const newItem: DevicePartUsageItem = {
      id: editingIndex !== null ? tempPartsList[editingIndex]?.id || `dpu_${Date.now()}` : `dpu_${Date.now()}`,
      partId: existingCatalog?.id || cleanPart.replace(/[\/\\]/g, '_'),
      partName: cleanPart,
      groupId: resolvedGroupId,
      groupName: cleanGroup,
      quantity: Number(quantity),
      unitCost: isScrap ? 0 : unitCost,
      unitSalePrice: isScrap ? 0 : unitSalePrice,
      isScrap: Boolean(isScrap),
      notes: notes.trim(),
      addedInStage: mode
    };

    if (editingIndex !== null) {
      const updated = [...tempPartsList];
      updated[editingIndex] = newItem;
      setTempPartsList(updated);
    } else {
      setTempPartsList(prev => [...prev, newItem]);
    }
    resetForm();
  };

  const handleEditRow = (idx: number) => {
    const item = tempPartsList[idx];
    if (!item) return;
    setEditingIndex(idx);
    setSelectedGroupId(item.groupId || '');
    setGroupNameInput(item.groupName || (item as any).category || (item as any).group || '');
    setPartNameInput(item.partName || (item as any).name || (item as any).part || '');
    setQuantity(item.quantity || (item as any).count || (item as any).qty || 1);
    setNotes(item.notes || '');
    setIsScrap(Boolean(item.isScrap));
  };

  const handleDeleteRow = (idx: number) => {
    setTempPartsList(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) resetForm();
  };

  const handleToggleScrapInRow = (idx: number) => {
    setTempPartsList(prev => prev.map((item, i) => {
      if (i === idx) {
        const nextScrap = !item.isScrap;
        return { ...item, isScrap: nextScrap, unitCost: nextScrap ? 0 : item.unitCost };
      }
      return item;
    }));
  };

  const handleConfirmAll = () => {
    onConfirm(tempPartsList);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md font-cairo" dir="rtl">
      <div className="relative w-full max-w-2xl bg-[#141414] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-[#181818]/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Cpu size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <span>تحديد قطع الغيار الإلكترونية للجهاز</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {deviceName ? `الجهاز: ${deviceName}` : ''} {deviceType ? `(${deviceType})` : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-all cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="bg-[#1a1a1a] p-4 rounded-2xl border border-white/5 space-y-3.5 shadow-inner">
            <div className="text-xs font-black text-purple-300 flex items-center justify-between">
              <span>{editingIndex !== null ? 'تعديل بيانات القطعة المحددة:' : 'إضافة قطعة إلكترونية للجهاز:'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div ref={groupWrapperRef} className="relative space-y-1">
                <label className="text-[11px] font-bold text-gray-300 block">اسم المجموعة <span className="text-purple-400">*</span></label>
                <div className="relative">
                  {!isGroupMenuOpen && (
                    <div className="absolute inset-0 z-10 cursor-pointer" onClick={() => { setIsGroupMenuOpen(true); setIsGroupReadOnly(true); }} />
                  )}
                  <input
                    type="text"
                    value={groupNameInput}
                    readOnly={isGroupReadOnly}
                    inputMode={isGroupReadOnly ? 'none' : 'text'}
                    onChange={(e) => {
                      setGroupNameInput(e.target.value);
                      setIsGroupMenuOpen(true);
                      const matched = groups.find(g => g.name.toLowerCase() === e.target.value.toLowerCase());
                      setSelectedGroupId(matched ? matched.id : '');
                    }}
                    onClick={() => { if (isGroupMenuOpen && isGroupReadOnly) setIsGroupReadOnly(false); }}
                    placeholder="اختر مجموعة أو اكتب جديدة..."
                    className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                {isGroupMenuOpen && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-[#181818] border border-white/10 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                    {filteredGroups.length > 0 ? (
                      filteredGroups.map(g => (
                        <button key={g.id} type="button" onClick={() => handleSelectGroup(g)} className={`w-full text-right px-3 py-2 text-xs font-bold hover:bg-purple-600/20 hover:text-purple-300 border-b border-white/5 transition-all flex items-center justify-between ${selectedGroupId === g.id ? 'bg-purple-600/30 text-purple-200' : 'text-gray-200'}`}>
                          <span>{g.name}</span>
                          {selectedGroupId === g.id && <Check size={14} className="text-purple-400" />}
                        </button>
                      ))
                    ) : (
                      <div className="p-2.5 text-center text-xs text-gray-400 font-bold">سيتم حفظ المجموعة &quot;{groupNameInput}&quot; كـ جديدة فوراً</div>
                    )}
                  </div>
                )}
              </div>
              <div ref={partWrapperRef} className="relative space-y-1">
                <label className="text-[11px] font-bold text-gray-300 block">كود / اسم القطعة <span className="text-purple-400">*</span></label>
                <div className="relative">
                  {!isPartMenuOpen && (
                    <div className="absolute inset-0 z-10 cursor-pointer" onClick={() => { setIsPartMenuOpen(true); setIsPartReadOnly(true); }} />
                  )}
                  <input
                    type="text"
                    value={partNameInput}
                    readOnly={isPartReadOnly}
                    inputMode={isPartReadOnly ? 'none' : 'text'}
                    onChange={(e) => { setPartNameInput(e.target.value); setIsPartMenuOpen(true); }}
                    onClick={() => { if (isPartMenuOpen && isPartReadOnly) setIsPartReadOnly(false); }}
                    placeholder={!groupNameInput.trim() ? 'اختر المجموعة أولاً...' : 'اختر كود القطعة أو اكتب جديداً...'}
                    className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
                {isPartMenuOpen && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-[#181818] border border-white/10 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                    {filteredParts.length > 0 ? (
                      filteredParts.map(p => (
                        <button key={p.id || p.name} type="button" onClick={() => handleSelectPart(p)} className={`w-full text-right px-3 py-2 text-xs font-mono font-bold hover:bg-purple-600/20 hover:text-purple-300 border-b border-white/5 transition-all flex items-center justify-between ${partNameInput === p.name ? 'bg-purple-600/30 text-purple-200' : 'text-gray-200'}`}>
                          <div className="flex items-center gap-2"><span>{p.name}</span>{p.groupName && (<span className="text-[10px] text-gray-500 font-cairo">({p.groupName})</span>)}</div>
                          {p.defaultCost ? (<span className="text-[10px] text-amber-400 font-mono">{p.defaultCost}$</span>) : null}
                        </button>
                      ))
                    ) : (
                      <div className="p-2.5 text-center text-xs text-gray-400 font-bold">{partNameInput.trim() ? `سيتم حفظ القطعة "${partNameInput}" كـ جديدة` : 'لا توجد قطع مسبقة'}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-300 block">العدد / الكمية</label>
                <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-black text-amber-400 focus:outline-none focus:border-purple-500 text-center" />
              </div>
              <div className={`space-y-1 ${mode === 'maintenance' ? 'sm:col-span-1' : 'sm:col-span-2'}`}>
                <label className="text-[11px] font-bold text-gray-300 block">ملاحظات المهندس</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات..." className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500" />
              </div>
              {mode === 'maintenance' && (
                <div className="space-y-1 flex flex-col justify-end">
                  <label className="flex items-center gap-2 p-2 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/10 transition-all select-none">
                    <input type="checkbox" checked={isScrap} onChange={(e) => setIsScrap(e.target.checked)} className="w-4 h-4 rounded text-orange-600 focus:ring-0 cursor-pointer" />
                    <div className="text-right"><span className="text-xs font-bold text-orange-300 block">قطعة تشليح</span></div>
                  </label>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
              {editingIndex !== null && (<button type="button" onClick={resetForm} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all">إلغاء</button>)}
              <button type="button" onClick={handleAddOrUpdateItem} className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-purple-600/30 cursor-pointer">
                {editingIndex !== null ? <Check size={14} /> : <Plus size={14} />}
                <span>{editingIndex !== null ? 'حفظ تعديل' : 'إضافة للجدول'}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-gray-300 px-1">
              <span>القطع المحددة لهذا الجهاز ({tempPartsList.length} قطعة):</span>
            </div>
            {tempPartsList.length > 0 ? (
              <div className="overflow-x-auto border border-white/10 rounded-2xl bg-[#121212]">
                <table className="w-full text-right text-xs">
                  <thead className="bg-white/5 text-gray-400 border-b border-white/10">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">المجموعة</th>
                      <th className="p-3">كود / اسم القطعة</th>
                      <th className="p-3 text-center">الكمية</th>
                      {mode === 'maintenance' && (<th className="p-3 text-center">تشليح</th>)}
                      <th className="p-3">ملاحظات</th>
                      <th className="p-3 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {tempPartsList.map((part, idx) => (
                      <tr key={idx} className={`hover:bg-white/5 transition-colors ${editingIndex === idx ? 'bg-purple-500/10' : ''}`}>
                        <td className="p-3 font-mono text-gray-500">{idx + 1}</td>
                        <td className="p-3 font-bold text-purple-300">{part.groupName || (part as any).category || (part as any).group || 'عام'}</td>
                        <td className="p-3 font-mono font-bold text-white">{part.partName || (part as any).name || (part as any).part || '---'}</td>
                        <td className="p-3 text-center font-mono font-bold text-amber-400">{part.quantity ?? (part as any).count ?? (part as any).qty ?? 0}</td>
                        {mode === 'maintenance' && (
                          <td className="p-3 text-center">
                            <input type="checkbox" checked={Boolean(part.isScrap)} onChange={() => handleToggleScrapInRow(idx)} className="w-3.5 h-3.5 rounded text-orange-600 cursor-pointer" />
                          </td>
                        )}
                        <td className="p-3 text-gray-400 max-w-[150px] truncate">{part.notes || '---'}</td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleEditRow(idx)} className="p-1.5 text-blue-400 hover:text-white hover:bg-blue-600/20 rounded-lg transition-colors cursor-pointer"><Edit2 size={13} /></button>
                            <button onClick={() => handleDeleteRow(idx)} className="p-1.5 text-red-400 hover:text-white hover:bg-red-600/20 rounded-lg transition-colors cursor-pointer"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
                <Package size={28} className="mx-auto text-gray-600 mb-2" />
                <p className="text-xs text-gray-400 font-bold">لم يتم تحديد أي قطع إلكترونية لهذا الجهاز بعد</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5 border-t border-white/10 flex items-center justify-between bg-[#181818]/80">
          <button type="button" onClick={onClose} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold cursor-pointer">إلغاء الأمر</button>
          <button type="button" onClick={handleConfirmAll} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer">
            <Check size={16} />
            <span>اعتماد القطع والترحيل ({tempPartsList.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
