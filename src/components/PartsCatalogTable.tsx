import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, writeBatch } from '../firebase';
import { PartCatalogItem, ElectronicPartGroup, ShopPartItem } from '../types';
import { 
  Tag, Plus, Search, Edit2, Trash2, X, Check, Package, FolderPlus, DollarSign, 
  ArrowUp, ArrowDown, Cpu, Layers, FileSpreadsheet, RotateCcw, AlertTriangle, 
  Sparkles, ChevronRight, CheckCircle2, Bookmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useBackHandler } from '../hooks/useBackHandler';

// Initial pre-loaded dataset from the user's manual spreadsheet screenshot
const INITIAL_SPREADSHEET_DATA: { group: string; parts: { code: string; cost: number; sale: number }[] }[] = [
  {
    group: 'Ubiquiti Power',
    parts: [
      { code: 'Z1212A', cost: 2.5, sale: 10 },
      { code: 'cb=ef', cost: 2.5, sale: 10 },
      { code: 'TPS54294', cost: 5, sale: 20 },
      { code: 'SMCJ24A', cost: 0.5, sale: 3 },
      { code: 'SMBJ24A', cost: 0.5, sale: 3 },
      { code: 'SMBJ24CA', cost: 0.5, sale: 3 },
      { code: 'SMBJ26CA', cost: 0.5, sale: 3 },
      { code: 'SMCJ24CA', cost: 0.5, sale: 3 },
    ]
  },
  {
    group: 'Ubiquiti Lan + CPU',
    parts: [
      { code: 'AR7241', cost: 7, sale: 12 },
      { code: 'AR9342', cost: 5, sale: 12 },
      { code: 'AR8236', cost: 5, sale: 12 },
      { code: 'KSZ8721', cost: 7, sale: 12 },
      { code: 'AR8032', cost: 5, sale: 12 },
      { code: 'AR8035', cost: 5, sale: 12 },
      { code: 'AR8033', cost: 5, sale: 25 },
      { code: 'qca8334el3c', cost: 3, sale: 12 },
      { code: 'AR7240', cost: 7, sale: 12 },
    ]
  },
  {
    group: 'Ubiquiti Wireless',
    parts: [
      { code: 'AR9283', cost: 3, sale: 16 },
      { code: 'AR9285', cost: 3, sale: 16 },
      { code: 'ALW5910', cost: 3.3, sale: 10 },
      { code: 'ALW5905', cost: 3.3, sale: 10 },
      { code: 'SE5023L', cost: 3.3, sale: 10 },
      { code: '3Q(5219-tr13)', cost: 3, sale: 5 },
      { code: 'Z34', cost: 2, sale: 5 },
    ]
  },
  {
    group: 'Ubiquiti منافذ وملفات',
    parts: [
      { code: 'H16125SCGS', cost: 2.5, sale: 5 },
      { code: 'G24102SKG', cost: 2.5, sale: 5 },
      { code: 'G24103SKG', cost: 2.5, sale: 5 },
      { code: 'NANO IN', cost: 2, sale: 5 },
      { code: 'P.BEAM IN', cost: 2.5, sale: 5 },
    ]
  },
  {
    group: 'مايكروتيك باور',
    parts: [
      { code: 'Z4484', cost: 2, sale: 16 },
      { code: 'cp=cc', cost: 2.5, sale: 16 },
      { code: 'GZ617', cost: 2.5, sale: 10 },
      { code: 'LSP5523', cost: 2.5, sale: 10 },
      { code: 'LSP5526', cost: 2.5, sale: 10 },
      { code: 'ZT2046Q', cost: 3.5, sale: 10 },
      { code: 'LMV614MT', cost: 2, sale: 10 },
      { code: 'BLw73', cost: 5, sale: 10 },
      { code: '9987GH', cost: 5, sale: 10 },
      { code: 'SW RS', cost: 0.5, sale: 8 },
    ]
  },
  {
    group: 'مايكروتيك لان',
    parts: [
      { code: 'RTL8367', cost: 7, sale: 27 },
      { code: 'AR8327', cost: 7, sale: 27 },
      { code: 'AR8151', cost: 6, sale: 10 },
      { code: 'AR9531', cost: 6, sale: 15 },
      { code: 'AR9533', cost: 6, sale: 15 },
      { code: '88e1545', cost: 6, sale: 30 },
    ]
  },
  {
    group: 'كومفاست باور + لان',
    parts: [
      { code: 'wj5116f', cost: 5, sale: 10 },
      { code: 'mp24943', cost: 5, sale: 10 },
      { code: 'mp8001ds', cost: 5, sale: 10 },
      { code: 'SMCJ60CA', cost: 0.5, sale: 3 },
      { code: 'qca8337el3c', cost: 1.11, sale: 16 },
    ]
  },
  {
    group: 'سويتش',
    parts: [
      { code: 'AR9331', cost: 3, sale: 16 },
      { code: 'RTL8196', cost: 3.5, sale: 10 },
      { code: 'RTL8370', cost: 3.5, sale: 10 },
      { code: 'IP178G', cost: 2, sale: 5 },
    ]
  },
  {
    group: 'تبلنك باور + منافذ',
    parts: [
      { code: 'SMBJ14CA', cost: 0.5, sale: 3 },
      { code: 'SS310A', cost: 0.5, sale: 3 },
      { code: 'SS310B', cost: 0.5, sale: 3 },
      { code: 'tp-link in', cost: 2.5, sale: 8 },
    ]
  },
  {
    group: 'مكثفات باور',
    parts: [
      { code: 'capacitor 16/1000', cost: 0.5, sale: 5 },
      { code: 'capacitor 25/1000', cost: 0.5, sale: 5 },
      { code: 'capacitor 35/1000', cost: 0.5, sale: 5 },
      { code: 'capacitor 35/100', cost: 0.5, sale: 5 },
    ]
  }
];

export default function PartsCatalogTable() {
  const [activeTab, setActiveTab] = useState<'electronics' | 'groups' | 'accessories'>('electronics');

  // Datasets
  const [items, setItems] = useState<PartCatalogItem[]>([]);
  const [groups, setGroups] = useState<ElectronicPartGroup[]>([]);
  const [shopParts, setShopParts] = useState<ShopPartItem[]>([]);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Modals state
  const [showPartModal, setShowPartModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'part' | 'group'; id: string; name: string } | null>(null);

  // Form State for Part
  const [partName, setPartName] = useState('');
  const [partCategory, setPartCategory] = useState('');
  const [partGroupId, setPartGroupId] = useState('');
  const [partGroupName, setPartGroupName] = useState('');
  const [partDefaultCost, setPartDefaultCost] = useState<number | ''>('');
  const [partDefaultSalePrice, setPartDefaultSalePrice] = useState<number | ''>('');
  const [partNotes, setPartNotes] = useState('');
  const [partItemType, setPartItemType] = useState<'electronic_part' | 'accessory_part'>('electronic_part');

  // Form State for Group
  const [groupNameInput, setGroupNameInput] = useState('');
  const [groupDescInput, setGroupDescInput] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Close modals on hardware back button
  useBackHandler(Boolean(showPartModal || showGroupModal || showImportModal || deleteConfirm), () => {
    if (showPartModal) setShowPartModal(false);
    else if (showGroupModal) setShowGroupModal(false);
    else if (showImportModal) setShowImportModal(false);
    else if (deleteConfirm) setDeleteConfirm(null);
  });

  // Load Catalog Items & Electronic Groups from Firestore
  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'parts_catalog'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PartCatalogItem));
      setItems(list);
    });

    const unsubGroups = onSnapshot(collection(db, 'electronic_part_groups'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ElectronicPartGroup));
      list.sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
      setGroups(list);
    });

    const unsubStock = onSnapshot(collection(db, 'shop_parts_inventory'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ShopPartItem));
      setShopParts(list);
    });

    return () => {
      unsubItems();
      unsubGroups();
      unsubStock();
    };
  }, []);

  // Filter electronics vs accessories
  const electronicParts = items.filter(i => {
    if (i.itemType === 'accessory_part') return false;
    // Considered electronic if explicitly tagged or has groupId/groupName or is in groups list
    return i.itemType === 'electronic_part' || i.groupId || i.groupName || groups.some(g => g.name === i.category);
  });

  const accessoryParts = items.filter(i => {
    return i.itemType === 'accessory_part' || (!i.groupId && !i.groupName && !groups.some(g => g.name === i.category));
  });

  // Reorder Groups (Move Up / Down)
  const handleMoveGroup = async (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === groups.length - 1) return;

    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const newGroups = [...groups];
    const temp = newGroups[index];
    newGroups[index] = newGroups[targetIdx];
    newGroups[targetIdx] = temp;

    try {
      const batch = writeBatch(db);
      newGroups.forEach((g, idx) => {
        const ref = doc(db, 'electronic_part_groups', g.id);
        batch.update(ref, { orderIndex: idx, updatedAt: serverTimestamp() });
      });
      await batch.commit();
    } catch (err) {
      console.error("Error reordering groups:", err);
    }
  };

  // Reorder Parts (Move Up / Down within group)
  const handleMovePart = async (currentFilteredIndex: number, direction: 'up' | 'down', list: PartCatalogItem[]) => {
    if (direction === 'up' && currentFilteredIndex === 0) return;
    if (direction === 'down' && currentFilteredIndex === list.length - 1) return;

    const targetIdx = direction === 'up' ? currentFilteredIndex - 1 : currentFilteredIndex + 1;
    const itemA = list[currentFilteredIndex];
    const itemB = list[targetIdx];

    try {
      const batch = writeBatch(db);
      const refA = doc(db, 'parts_catalog', itemA.id!);
      const refB = doc(db, 'parts_catalog', itemB.id!);

      const orderA = Number(itemA.orderIndex) || currentFilteredIndex;
      const orderB = Number(itemB.orderIndex) || targetIdx;

      batch.update(refA, { orderIndex: orderB, updatedAt: serverTimestamp() });
      batch.update(refB, { orderIndex: orderA, updatedAt: serverTimestamp() });
      await batch.commit();
    } catch (err) {
      console.error("Error reordering parts:", err);
    }
  };

  // Open Add Group Modal
  const handleOpenAddGroup = () => {
    setEditingGroupId(null);
    setGroupNameInput('');
    setGroupDescInput('');
    setShowGroupModal(true);
  };

  // Open Edit Group Modal
  const handleOpenEditGroup = (g: ElectronicPartGroup) => {
    setEditingGroupId(g.id);
    setGroupNameInput(g.name);
    setGroupDescInput(g.description || '');
    setShowGroupModal(true);
  };

  // Save Group (Add or Edit)
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupNameInput.trim()) return;

    setIsSaving(true);
    try {
      const cleanName = groupNameInput.trim();
      const docId = editingGroupId || cleanName.replace(/[\/\\]/g, '_');
      const order = editingGroupId ? (groups.find(g => g.id === editingGroupId)?.orderIndex ?? groups.length) : groups.length;

      const payload: ElectronicPartGroup = {
        id: docId,
        name: cleanName,
        orderIndex: order,
        description: groupDescInput.trim(),
        updatedAt: serverTimestamp()
      };

      if (!editingGroupId) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, 'electronic_part_groups', docId), payload, { merge: true });

      // If renamed, update linked parts in parts_catalog
      if (editingGroupId && editingGroupId !== cleanName) {
        const linkedParts = items.filter(p => p.groupId === editingGroupId || p.groupName === editingGroupId);
        if (linkedParts.length > 0) {
          const batch = writeBatch(db);
          linkedParts.forEach(p => {
            const ref = doc(db, 'parts_catalog', p.id!);
            batch.update(ref, { groupId: docId, groupName: cleanName, category: cleanName });
          });
          await batch.commit();
        }
      }

      setShowGroupModal(false);
      setNotification({ text: `تم حفظ المجموعة "${cleanName}" بنجاح`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      console.error("Error saving group:", err);
      setNotification({ text: "حدث خطأ أثناء حفظ المجموعة", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Open Add Part Modal
  const handleOpenAddPart = (type: 'electronic_part' | 'accessory_part' = 'electronic_part') => {
    setEditingPartId(null);
    setPartItemType(type);
    setPartName('');
    setPartGroupId('');
    setPartGroupName('');
    setPartCategory(type === 'electronic_part' ? '' : 'ملحقات وقطع عامة');
    setPartDefaultCost('');
    setPartDefaultSalePrice('');
    setPartNotes('');
    setShowPartModal(true);
  };

  // Open Edit Part Modal
  const handleOpenEditPart = (item: PartCatalogItem) => {
    setEditingPartId(item.id || null);
    setPartItemType((item.itemType as any) || (item.groupId || item.groupName ? 'electronic_part' : 'accessory_part'));
    setPartName(item.name);
    setPartGroupId(item.groupId || '');
    setPartGroupName(item.groupName || item.category || '');
    setPartCategory(item.category || item.groupName || '');
    setPartDefaultCost(item.defaultCost ?? '');
    setPartDefaultSalePrice(item.defaultSalePrice ?? '');
    setPartNotes(item.notes || '');
    setShowPartModal(true);
  };

  // Save Part (Add or Edit)
  const handleSavePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partName.trim()) return;

    if (partItemType === 'electronic_part' && (!partGroupId || !partGroupId.trim())) {
      setNotification({ text: 'الرجاء اختيار مجموعة محددة أولاً', type: 'error' });
      return;
    }

    setIsSaving(true);
    try {
      const cleanName = partName.trim();
      const docId = editingPartId || cleanName.replace(/[\/\\]/g, '_');
      const order = editingPartId ? (items.find(i => i.id === editingPartId)?.orderIndex ?? items.length) : items.length;

      const payload: PartCatalogItem = {
        id: docId,
        name: cleanName,
        itemType: partItemType,
        category: partGroupName || partCategory || 'عام',
        groupId: partGroupId || partGroupName || '',
        groupName: partGroupName || partCategory || '',
        orderIndex: order,
        defaultCost: partDefaultCost === '' ? 0 : Number(partDefaultCost),
        defaultSalePrice: partDefaultSalePrice === '' ? 0 : Number(partDefaultSalePrice),
        notes: partNotes.trim(),
        updatedAt: serverTimestamp()
      };

      if (!editingPartId) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, 'parts_catalog', docId), payload, { merge: true });
      setShowPartModal(false);
      setNotification({ text: `تم حفظ الصنف "${cleanName}" بنجاح`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error("Error saving part catalog item:", err);
      setNotification({ text: "حدث خطأ أثناء حفظ بيانات القطعة", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Action Confirm Execution
  const handleExecuteDelete = async () => {
    if (!deleteConfirm) return;
    const { type, id, name } = deleteConfirm;

    try {
      if (type === 'group') {
        await deleteDoc(doc(db, 'electronic_part_groups', id));
        // Clear groupId on linked items
        const linked = items.filter(p => p.groupId === id);
        if (linked.length > 0) {
          const batch = writeBatch(db);
          linked.forEach(p => {
            const ref = doc(db, 'parts_catalog', p.id!);
            batch.update(ref, { groupId: '', groupName: 'عام' });
          });
          await batch.commit();
        }
        setNotification({ text: `تم حذف المجموعة "${name}" بنجاح`, type: 'success' });
      } else {
        await deleteDoc(doc(db, 'parts_catalog', id));
        setNotification({ text: `تم حذف الصنف "${name}" بنجاح`, type: 'success' });
      }
    } catch (err) {
      console.error("Error deleting:", err);
      setNotification({ text: "فشل الحذف، يرجى المحاولة لاحقاً", type: 'error' });
    } finally {
      setDeleteConfirm(null);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // 1-Click Import of the User's Excel Sheet Data
  const handleImportPredefinedSpreadsheet = async () => {
    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      // 1. Save Groups
      INITIAL_SPREADSHEET_DATA.forEach((gData, gIdx) => {
        const gDocId = gData.group.replace(/[\/\\]/g, '_');
        const gRef = doc(db, 'electronic_part_groups', gDocId);
        batch.set(gRef, {
          id: gDocId,
          name: gData.group,
          orderIndex: gIdx,
          description: `مجموعة ${gData.group}`,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        // 2. Save Parts within Group
        gData.parts.forEach((p, pIdx) => {
          const pDocId = p.code.replace(/[\/\\]/g, '_');
          const pRef = doc(db, 'parts_catalog', pDocId);
          batch.set(pRef, {
            id: pDocId,
            name: p.code,
            itemType: 'electronic_part',
            category: gData.group,
            groupId: gDocId,
            groupName: gData.group,
            orderIndex: pIdx,
            defaultCost: p.cost,
            defaultSalePrice: p.sale,
            notes: `مدرجة من كشف الورشة (${gData.group})`,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }, { merge: true });
        });
      });

      await batch.commit();
      setShowImportModal(false);
      setNotification({ text: "تم استيراد كافة المجموعات وأكواد القطع من كشف الإكسل بنجاح! يمكنك تعديل أو حذف أي بيان بحرية تامة.", type: 'success' });
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      console.error("Error importing spreadsheet:", err);
      setNotification({ text: "حدث خطأ أثناء استيراد البيانات", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter parts according to search and selected group
  const filteredElectronics = electronicParts
    .filter(i => {
      if (selectedGroupFilter !== 'all') {
        const matchesGroup = (i.groupId && (i.groupId === selectedGroupFilter || i.groupName === selectedGroupFilter)) ||
                             (i.category && i.category === selectedGroupFilter);
        if (!matchesGroup) return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        (i.name || '').toLowerCase().includes(q) ||
        (i.groupName || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));

  const filteredAccessories = accessoryParts.filter(i => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return (
      (i.name || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.notes || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 font-cairo text-right pb-32 md:pb-16" dir="rtl">
      {/* Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-4 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-bold border ${
              notification.type === 'success' 
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40 backdrop-blur-md'
                : 'bg-rose-950/90 text-rose-300 border-rose-500/40 backdrop-blur-md'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{notification.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-[#141414] p-5 rounded-2xl border border-white/5 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
            <Cpu size={26} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <span>دليل وسجل قطع الغيار والملحقات</span>
              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                {items.length} صنف مسجل
              </span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              إدارة مرنة للمجموعات والقطع الإلكترونية والملحقات مع حرية كاملة في الترتيب والإضافة والتعديل والحذف
            </p>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
          <button
            onClick={() => handleOpenAddPart('electronic_part')}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20 active:scale-95 whitespace-nowrap"
            title="إضافة قطعة أو شريحة إلكترونية جديدة"
          >
            <Plus size={15} />
            <span>+ قطعة إلكترونية</span>
          </button>

          <button
            onClick={handleOpenAddGroup}
            className="px-3.5 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white border border-blue-500/30 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer active:scale-95 whitespace-nowrap"
            title="إضافة مجموعة جديدة (مثل: يوبيكويتي باور، مايكروتيك لان...)"
          >
            <FolderPlus size={15} />
            <span>+ مجموعة جديدة</span>
          </button>

          <button
            onClick={() => setShowImportModal(true)}
            className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 hover:text-white border border-purple-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap"
            title="استيراد كشف الورشة الجاهز في ثوانٍ مع إمكانية التعديل الكامل"
          >
            <FileSpreadsheet size={15} />
            <span>استيراد كشف الورشة</span>
          </button>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-2 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab('electronics')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'electronics'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
              : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Cpu size={15} />
          <span>القطع الإلكترونية</span>
          <span className="text-[10px] bg-black/30 px-2 py-0.5 rounded-full font-mono font-bold">
            {electronicParts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('groups')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'groups'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
              : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Layers size={15} />
          <span>مجموعات وتصنيفات القطع</span>
          <span className="text-[10px] bg-black/30 px-2 py-0.5 rounded-full font-mono font-bold">
            {groups.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('accessories')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'accessories'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/30'
              : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Package size={15} />
          <span>الملحقات والقطع التجارية</span>
          <span className="text-[10px] bg-black/30 px-2 py-0.5 rounded-full font-mono font-bold">
            {accessoryParts.length}
          </span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: ELECTRONIC PARTS LIST (جدول القطع الإلكترونية) */}
      {/* ============================================================== */}
      {activeTab === 'electronics' && (
        <div className="space-y-4">
          {/* Sub-toolbar: Search & Group Pills Filter */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Box */}
            <div className="relative flex-1 md:max-w-md">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بكود القطعة أو اسم المجموعة أو الملاحظات..."
                className="w-full bg-[#181818] border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
              />
              <Search size={14} className="absolute right-3 top-2.5 text-gray-400" />
            </div>

            {/* Quick Count Badge */}
            <span className="text-xs text-gray-400 font-bold self-center">
              المعروض: <strong className="text-white font-mono">{filteredElectronics.length}</strong> صنف
            </span>
          </div>

          {/* Group Filter Pills */}
          {groups.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
              <button
                onClick={() => setSelectedGroupFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  selectedGroupFilter === 'all'
                    ? 'bg-white text-black shadow-md'
                    : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                }`}
              >
                جميع المجموعات ({electronicParts.length})
              </button>
              {groups.map((g) => {
                const count = electronicParts.filter(p => p.groupId === g.id || p.groupName === g.name || p.category === g.name).length;
                const isSelected = selectedGroupFilter === g.name || selectedGroupFilter === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupFilter(g.name)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                        : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/5'
                    }`}
                  >
                    <span>{g.name}</span>
                    <span className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded-md font-mono">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Electronic Parts Table */}
          <div className="bg-[#121212] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
                  <tr>
                    <th className="p-3 text-center w-16">ترتيب</th>
                    <th className="p-3">كود / اسم القطعة الإلكترونية</th>
                    <th className="p-3">المجموعة التابعة لها</th>
                    <th className="p-3 text-left">سعر التكلفة الافتراضي ($)</th>
                    <th className="p-3 text-left">سعر البيع المقترح ($)</th>
                    <th className="p-3">الملاحظات</th>
                    <th className="p-3 text-center">الإجراءات والتحكم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-200">
                  {filteredElectronics.length > 0 ? (
                    filteredElectronics.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-white/[0.02] transition-colors group">
                        {/* Order & Reorder Arrows */}
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="font-mono text-gray-500 text-[11px] min-w-[20px]">{idx + 1}</span>
                            <div className="flex flex-col">
                              <button
                                onClick={() => handleMovePart(idx, 'up', filteredElectronics)}
                                disabled={idx === 0}
                                className="p-0.5 text-gray-500 hover:text-emerald-400 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                                title="تحريك لأعلى"
                              >
                                <ArrowUp size={11} />
                              </button>
                              <button
                                onClick={() => handleMovePart(idx, 'down', filteredElectronics)}
                                disabled={idx === filteredElectronics.length - 1}
                                className="p-0.5 text-gray-500 hover:text-emerald-400 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                                title="تحريك لأسفل"
                              >
                                <ArrowDown size={11} />
                              </button>
                            </div>
                          </div>
                        </td>

                        {/* Part Code */}
                        <td className="p-3 font-bold text-white">
                          <div className="flex items-center gap-2">
                            <Cpu size={14} className="text-emerald-400 shrink-0" />
                            <span className="font-mono text-sm tracking-wide text-emerald-300 font-bold">{item.name}</span>
                          </div>
                          {(() => {
                            const stock = shopParts.find(s => 
                              (s.partId && s.partId === item.id) ||
                              s.name.trim().toLowerCase() === item.name.trim().toLowerCase() ||
                              s.id === item.id
                            );
                            const qty = stock ? Number(stock.quantity ?? 0) : null;
                            if (qty !== null && qty < 0) {
                              return (
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono">
                                    الرصيد: {qty}
                                  </span>
                                  <span className="text-[10px] text-rose-400 font-bold">
                                    يجب إدخال القطع السالبة
                                  </span>
                                </div>
                              );
                            }
                            if (qty !== null && qty > 0) {
                              return (
                                <div className="mt-1">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                                    متوفر بالمخزن: {qty}
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </td>

                        {/* Group Name */}
                        <td className="p-3">
                          <span className="px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg text-[11px] font-bold">
                            {item.groupName || item.category || 'عام'}
                          </span>
                        </td>

                        {/* Cost */}
                        <td className="p-3 font-mono font-bold text-amber-400 text-left">
                          ${Number(item.defaultCost || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 3 })}
                        </td>

                        {/* Sale Price */}
                        <td className="p-3 font-mono font-bold text-emerald-400 text-left">
                          ${Number(item.defaultSalePrice || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
                        </td>

                        {/* Notes */}
                        <td className="p-3 text-gray-400 max-w-xs truncate text-[11px]">
                          {item.notes || '-'}
                        </td>

                        {/* Actions (Edit / Delete) */}
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleOpenEditPart(item)}
                              className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-all border border-blue-500/20 cursor-pointer"
                              title="تعديل بيانات وسعر القطعة"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm({ type: 'part', id: item.id!, name: item.name })}
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-all border border-rose-500/20 cursor-pointer"
                              title="حذف القطعة من الدليل"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-500">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Cpu size={28} className="text-gray-600 opacity-40" />
                          <span>لا توجد قطع إلكترونية مطابقة للبحث أو المجموعة المحددة.</span>
                          <button
                            onClick={() => handleOpenAddPart('electronic_part')}
                            className="mt-2 text-emerald-400 hover:underline text-xs font-bold"
                          >
                            + إضافة قطعة جديدة الآن
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: ELECTRONIC GROUPS LIST (جدول المجموعات والتصنيفات) */}
      {/* ============================================================== */}
      {activeTab === 'groups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-white">مجموعات وتصنيفات القطع الإلكترونية</h4>
              <p className="text-xs text-gray-400">تحكم كامل في ترتيب المجموعات، تعديل الأسماء، أو إضافة مجموعات جديدة بحرية</p>
            </div>
            <button
              onClick={handleOpenAddGroup}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-blue-900/20 active:scale-95"
            >
              <Plus size={15} />
              <span>+ إضافة مجموعة جديدة</span>
            </button>
          </div>

          <div className="bg-[#121212] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
                  <tr>
                    <th className="p-3.5 text-center w-20">ترتيب الظهور</th>
                    <th className="p-3.5">اسم المجموعة الفنية</th>
                    <th className="p-3.5">الوصف والملاحظات</th>
                    <th className="p-3.5 text-center">عدد القطع المرتبطة</th>
                    <th className="p-3.5 text-center">الإجراءات والتحكم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-200">
                  {groups.length > 0 ? (
                    groups.map((g, idx) => {
                      const count = electronicParts.filter(p => p.groupId === g.id || p.groupName === g.name || p.category === g.name).length;
                      return (
                        <tr key={g.id || idx} className="hover:bg-white/[0.02] transition-colors">
                          {/* Reorder Arrows */}
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="font-mono text-gray-500 text-xs min-w-[16px]">{idx + 1}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleMoveGroup(idx, 'up')}
                                  disabled={idx === 0}
                                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed transition-all"
                                  title="تحريك المجموعة لأعلى لتظهر أولاً"
                                >
                                  <ArrowUp size={13} />
                                </button>
                                <button
                                  onClick={() => handleMoveGroup(idx, 'down')}
                                  disabled={idx === groups.length - 1}
                                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed transition-all"
                                  title="تحريك المجموعة لأسفل"
                                >
                                  <ArrowDown size={13} />
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* Group Name */}
                          <td className="p-3.5 font-bold text-white text-sm flex items-center gap-2">
                            <Layers size={16} className="text-blue-400 shrink-0" />
                            <span>{g.name}</span>
                          </td>

                          {/* Description */}
                          <td className="p-3.5 text-gray-400 text-xs">
                            {g.description || '-'}
                          </td>

                          {/* Parts Count Badge */}
                          <td className="p-3.5 text-center">
                            <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-mono font-bold">
                              {count} صنف
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleOpenEditGroup(g)}
                                className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-all border border-blue-500/20 cursor-pointer"
                                title="تعديل اسم المجموعة"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm({ type: 'group', id: g.id, name: g.name })}
                                className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-all border border-rose-500/20 cursor-pointer"
                                title="حذف المجموعة"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-gray-500">
                        لم يتم تسجيل أي مجموعات بعد. انقر على زر "إضافة مجموعة جديدة" أو "استيراد كشف الورشة".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: ACCESSORIES & GENERAL COMMERCIAL (الملحقات والقطع التجارية) */}
      {/* ============================================================== */}
      {activeTab === 'accessories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-white">الملحقات والقطع التجارية والإكسسوارات</h4>
              <p className="text-xs text-gray-400">شواحن، كيبلات، محولات PoE، كروت، أجهزة جاهزة للبيع للزبائن</p>
            </div>
            <button
              onClick={() => handleOpenAddPart('accessory_part')}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-amber-900/20 active:scale-95"
            >
              <Plus size={15} />
              <span>+ إضافة ملحق تجاري</span>
            </button>
          </div>

          <div className="bg-[#121212] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
                  <tr>
                    <th className="p-3.5">#</th>
                    <th className="p-3.5">اسم الملحق / الصنف</th>
                    <th className="p-3.5">التصنيف</th>
                    <th className="p-3.5 text-left">التكلفة الافتراضية ($)</th>
                    <th className="p-3.5 text-left">سعر البيع الافتراضي ($)</th>
                    <th className="p-3.5">الملاحظات</th>
                    <th className="p-3.5 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-200">
                  {filteredAccessories.length > 0 ? (
                    filteredAccessories.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-white/[0.02] transition-colors">
                        <td className="p-3.5 font-mono text-gray-500">{idx + 1}</td>
                        <td className="p-3.5 font-bold text-white flex items-center gap-2">
                          <Package size={14} className="text-amber-400" />
                          <span>{item.name}</span>
                        </td>
                        <td className="p-3.5">
                          <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-gray-300">
                            {item.category || 'ملحقات عامة'}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono font-bold text-amber-400 text-left">
                          ${item.defaultCost ?? 0}
                        </td>
                        <td className="p-3.5 font-mono font-bold text-emerald-400 text-left">
                          ${item.defaultSalePrice ?? 0}
                        </td>
                        <td className="p-3.5 text-gray-400 max-w-xs truncate text-[11px]">
                          {item.notes || '-'}
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleOpenEditPart(item)}
                              className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-all border border-blue-500/20 cursor-pointer"
                              title="تعديل"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm({ type: 'part', id: item.id!, name: item.name })}
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-all border border-rose-500/20 cursor-pointer"
                              title="حذف"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-500">
                        لا توجد ملحقات تجارية مسجلة حالياً.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: ADD / EDIT PART MODAL */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showPartModal && (
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
                  <div className={`p-2 rounded-xl ${partItemType === 'electronic_part' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {partItemType === 'electronic_part' ? <Cpu size={20} /> : <Package size={20} />}
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">
                      {editingPartId 
                        ? `تعديل صنف: ${partName}` 
                        : (partItemType === 'electronic_part' ? 'تسجيل قطعة إلكترونية جديدة' : 'تسجيل ملحق تجاري جديد')}
                    </h3>
                    <p className="text-[11px] text-gray-400">يمكنك تعديل كافة الحقول والأسعار بحرية تامة في أي وقت</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPartModal(false)}
                  className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePart} className="space-y-4">
                {/* Part Name / Code */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">
                    كود / اسم القطعة <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={partName}
                    onChange={(e) => setPartName(e.target.value)}
                    required
                    placeholder={partItemType === 'electronic_part' ? 'مثال: AR7241, TPS54294, SMBJ24A' : 'مثال: محول PoE أصلي 24V، كيبل انترنت'}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                {/* Group Selection for Electronics */}
                {partItemType === 'electronic_part' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 block">المجموعة التابعة لها</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={partGroupName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPartGroupName(val);
                          const matched = groups.find(g => g.name === val || g.id === val);
                          setPartGroupId(matched?.id || val);
                        }}
                        className="flex-1 bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-bold"
                      >
                        <option value="">-- قم باختيار مجموعة محددة --</option>
                        {groups.map(g => (
                          <option key={g.id} value={g.name}>{g.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPartModal(false);
                          handleOpenAddGroup();
                        }}
                        className="p-2.5 bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white rounded-xl text-xs font-bold transition-all border border-blue-500/30 cursor-pointer whitespace-nowrap"
                        title="إنشاء مجموعة جديدة"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Category for Accessories */}
                {partItemType === 'accessory_part' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 block">التصنيف</label>
                    <input
                      type="text"
                      value={partCategory}
                      onChange={(e) => setPartCategory(e.target.value)}
                      placeholder="مثال: شواحن، كيبلات، محولات..."
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                {/* Default Cost & Sale Price */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 block">تكلفة الشراء الافتراضية ($)</label>
                    <input
                      type="number"
                      step="any"
                      value={partDefaultCost}
                      onChange={(e) => setPartDefaultCost(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.00"
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-amber-400 placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-left"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 block">سعر البيع / التركيب المقترح ($)</label>
                    <input
                      type="number"
                      step="any"
                      value={partDefaultSalePrice}
                      onChange={(e) => setPartDefaultSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.00"
                      className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-left"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">ملاحظات فنية</label>
                  <textarea
                    value={partNotes}
                    onChange={(e) => setPartNotes(e.target.value)}
                    rows={2}
                    placeholder="ملاحظات أو مواصفات أو بدائل القطعة..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-none"
                  />
                </div>

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setShowPartModal(false)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20 active:scale-95"
                  >
                    <Check size={16} />
                    <span>{editingPartId ? 'حفظ التعديلات' : 'إضافة القطعة'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* MODAL 2: ADD / EDIT GROUP MODAL */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showGroupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-[#141414] border border-white/10 rounded-3xl shadow-2xl overflow-hidden p-6 text-right font-cairo space-y-4"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
                    <FolderPlus size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">
                      {editingGroupId ? 'تعديل اسم المجموعة' : 'إضافة مجموعة قطع إلكترونية جديدة'}
                    </h3>
                    <p className="text-[11px] text-gray-400">يمكنك تعديل اسم المجموعة أو إعادة ترتيبها في أي وقت</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowGroupModal(false)}
                  className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveGroup} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">
                    اسم المجموعة <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={groupNameInput}
                    onChange={(e) => setGroupNameInput(e.target.value)}
                    required
                    placeholder="مثال: Ubiquiti Power, مايكروتيك لان, سويتش..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">وصف / ملاحظات المجموعة</label>
                  <input
                    type="text"
                    value={groupDescInput}
                    onChange={(e) => setGroupDescInput(e.target.value)}
                    placeholder="مثال: دوائر الباور والآيسيهات لأجهزة يوبيكويتي..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setShowGroupModal(false)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-blue-900/20 active:scale-95"
                  >
                    <Check size={16} />
                    <span>{editingGroupId ? 'حفظ التعديل' : 'حفظ المجموعة'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* MODAL 3: IMPORT PREDEFINED SPREADSHEET (استيراد كشف الورشة) */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl bg-[#141414] border border-white/10 rounded-3xl shadow-2xl overflow-hidden p-6 text-right font-cairo space-y-4 max-h-[90vh] flex flex-col"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b border-white/5 pb-4 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
                    <FileSpreadsheet size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">استيراد كشف قطع الغيار اليدوي للورشة</h3>
                    <p className="text-[11px] text-gray-400">تعبئة فورية لجميع المجموعات والقطع المدرجة في كشفك مع حرية التعديل الكاملة</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-y-auto space-y-3 pr-1 text-xs text-gray-300 scrollbar-thin">
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-200 text-xs">
                  سيتم إنشاء <strong className="text-white font-mono">{INITIAL_SPREADSHEET_DATA.length} مجموعات</strong> و <strong className="text-white font-mono">46 كود قطعة</strong> تشمل:
                  (Ubiquiti Power, Ubiquiti LAN, Wireless, منافذ وملفات, مايكروتيك باور ولان, كومفاست, سويتشات, تبلنك, مكثفات باور).
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-gray-400 block">معاينة المجموعات التي سيتم استيرادها:</span>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {INITIAL_SPREADSHEET_DATA.map((g, idx) => (
                      <div key={idx} className="bg-white/5 border border-white/5 p-2 rounded-xl flex items-center justify-between">
                        <span className="font-bold text-white">{g.group}</span>
                        <span className="font-mono text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded">
                          {g.parts.length} صنف
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-white/5 border border-white/5 rounded-xl space-y-1 text-gray-400 text-[11px]">
                  <p className="font-bold text-amber-400 flex items-center gap-1.5">
                    <CheckCircle2 size={13} />
                    <span>تأكيد حرية التعديل الكاملة:</span>
                  </p>
                  <p>
                    بعد الاستيراد، ستكون جميع الأصناف والمجموعات متاحة أمامك لتعديل الأسعار، تغيير الأسماء، إعادة الترتيب (▲ ▼)، أو حذف ما تشاء في أي وقت.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleImportPredefinedSpreadsheet}
                  disabled={isSaving}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-purple-900/30 active:scale-95"
                >
                  <Check size={16} />
                  <span>تأكيد الاستيراد الآن</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================== */}
      {/* MODAL 4: DELETE CONFIRMATION MODAL (بدون confirm) */}
      {/* ============================================================== */}
      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-[#161616] border border-rose-500/30 rounded-3xl shadow-2xl p-6 text-center font-cairo space-y-4"
              dir="rtl"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center mx-auto">
                <AlertTriangle size={24} />
              </div>

              <div>
                <h3 className="text-base font-black text-white">تأكيد الحذف</h3>
                <p className="text-xs text-gray-400 mt-1">
                  هل أنت متأكد من حذف {deleteConfirm.type === 'group' ? 'المجموعة' : 'الصنف'}:
                </p>
                <p className="text-sm font-bold text-rose-400 mt-1 font-mono">
                  "{deleteConfirm.name}"
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  تراجع
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDelete}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-lg shadow-rose-900/30 active:scale-95"
                >
                  تأكيد الحذف
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
