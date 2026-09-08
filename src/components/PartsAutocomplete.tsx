import React, { useState, useEffect, useRef } from 'react';
import { db, collection, onSnapshot } from '../firebase';
import { PartCatalogItem, ShopPartItem } from '../types';
import { Tag, Plus, Search, Check, ChevronDown, Wrench } from 'lucide-react';

interface PartsAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onSelectPart?: (part: PartCatalogItem | ShopPartItem) => void;
  placeholder?: string;
  className?: string;
  showStockStatus?: boolean;
}

export const PartsAutocomplete: React.FC<PartsAutocompleteProps> = ({
  value,
  onChange,
  onSelectPart,
  placeholder = 'ابحث عن قطعة أو ادخل اسماً جديداً...',
  className = '',
  showStockStatus = false
}) => {
  const [catalogItems, setCatalogItems] = useState<PartCatalogItem[]>([]);
  const [shopParts, setShopParts] = useState<ShopPartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen to parts catalog
    const unsubCat = onSnapshot(collection(db, 'parts_catalog'), (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PartCatalogItem));
      setCatalogItems(items);
    });

    // Listen to shop parts inventory
    const unsubStock = onSnapshot(collection(db, 'shop_parts_inventory'), (snapshot) => {
      const parts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ShopPartItem));
      setShopParts(parts);
    });

    return () => {
      unsubCat();
      unsubStock();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Build selectable items list
  let allList: any[] = [];

  if (showStockStatus) {
    // In sales mode: shop_parts_inventory is primary.
    // Every distinct stock entry (e.g. from a specific disassembly batch or direct purchase) is a separate selectable choice.
    const stockNames = new Set<string>();

    shopParts.forEach(s => {
      if (!s || !s.name) return;
      stockNames.add(s.name.trim().toLowerCase());
      allList.push({
        id: s.id || '',
        name: s.name,
        category: s.category || 'قطع غيار وملحقات',
        defaultCost: s.unitCost || 0,
        defaultSalePrice: s.salePrice || 0,
        inStockQty: Number(s.quantity || 0),
        isBatch: Boolean(s.isDisassemblyBatch),
        batchId: s.batchId || '',
        batchName: s.batchName || '',
        batchTotalCost: s.batchTotalCost || 0,
        supplierName: s.supplierName || '',
        currency: s.currency || 'USD',
        isCatalogOnly: false,
        raw: {
          ...s,
          partInventoryId: s.id || '',
          batchId: s.batchId || '',
          batchName: s.batchName || '',
          batchTotalCost: s.batchTotalCost || 0,
          salePrice: s.salePrice || 0,
          unitCost: s.unitCost || 0
        }
      });
    });

    // Add catalog items that don't exist in stock as catalog-only references
    catalogItems.forEach(c => {
      if (!c || !c.name) return;
      const key = c.name.trim().toLowerCase();
      if (!stockNames.has(key)) {
        allList.push({
          id: '',
          name: c.name,
          category: c.category || 'عام',
          defaultCost: c.defaultCost || 0,
          defaultSalePrice: c.defaultSalePrice || 0,
          inStockQty: 0,
          isBatch: false,
          batchId: '',
          batchName: '',
          batchTotalCost: 0,
          supplierName: '',
          isCatalogOnly: true,
          raw: {
            ...c,
            id: '',
            partInventoryId: '',
            batchId: '',
            batchName: '',
            salePrice: c.defaultSalePrice || 0,
            unitCost: c.defaultCost || 0
          }
        });
      }
    });
  } else {
    // In purchase mode: suggest from catalog first, supplement with existing shop parts
    const combinedItemsMap = new Map<string, any>();

    catalogItems.forEach(c => {
      if (!c || !c.name) return;
      combinedItemsMap.set(String(c.name).trim().toLowerCase(), {
        name: c.name,
        category: c.category || 'عام',
        defaultCost: c.defaultCost || 0,
        defaultSalePrice: c.defaultSalePrice || 0,
        inStockQty: 0,
        isBatch: false,
        raw: c
      });
    });

    shopParts.forEach(s => {
      if (!s || !s.name) return;
      const key = String(s.name).trim().toLowerCase();
      const existing = combinedItemsMap.get(key);
      if (existing) {
        existing.inStockQty = (existing.inStockQty || 0) + (s.quantity || 0);
        if (s.salePrice && !existing.defaultSalePrice) existing.defaultSalePrice = s.salePrice;
        if (s.unitCost && !existing.defaultCost) existing.defaultCost = s.unitCost;
        if (s.isDisassemblyBatch) existing.isBatch = true;
      } else {
        combinedItemsMap.set(key, {
          name: s.name,
          category: s.category || 'عام',
          defaultCost: s.unitCost || 0,
          defaultSalePrice: s.salePrice || 0,
          inStockQty: s.quantity || 0,
          isBatch: Boolean(s.isDisassemblyBatch),
          raw: s
        });
      }
    });

    allList = Array.from(combinedItemsMap.values());
  }

  const filtered = allList.filter(item =>
    item.name.toLowerCase().includes((value || '').toLowerCase()) ||
    (item.category && item.category.toLowerCase().includes((value || '').toLowerCase())) ||
    (item.batchName && item.batchName.toLowerCase().includes((value || '').toLowerCase()))
  );

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2.5 pl-9 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 font-cairo transition-all"
        />
        <ChevronDown size={14} className="absolute left-3 text-gray-400 pointer-events-none" />
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-[#181818] border border-white/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto font-cairo text-right" dir="rtl">
          {filtered.length > 0 ? (
            <div className="p-1 space-y-0.5">
              {filtered.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onChange(item.name);
                    if (onSelectPart) onSelectPart(item.raw || item);
                    setIsOpen(false);
                  }}
                  className="w-full text-right p-2.5 hover:bg-emerald-500/10 hover:border-emerald-500/20 border border-transparent rounded-xl transition-all flex items-center justify-between group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg group-hover:bg-emerald-500 group-hover:text-black transition-all">
                      <Tag size={13} />
                    </div>
                    <div>
                      <div className="text-xs font-black text-white group-hover:text-emerald-400 flex items-center gap-1.5 flex-wrap">
                        <span>{item.name}</span>
                        {item.isBatch && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded font-normal border border-purple-500/30">
                            دفعة تفكيك: {item.batchName || 'جهاز تالف'}
                          </span>
                        )}
                        {item.isCatalogOnly && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded font-normal">
                            كتالوج (غير مسجل بالمخزون)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span>{item.category}</span>
                        {item.supplierName && <span>• المورد: {item.supplierName}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="text-left text-[11px] font-mono flex flex-col items-end gap-0.5 shrink-0">
                    {showStockStatus && !item.isCatalogOnly && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.inStockQty > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/10 text-red-400'}`}>
                        المخزون: {item.inStockQty}
                      </span>
                    )}
                    {item.defaultSalePrice > 0 && (
                      <div className="text-emerald-400 font-bold font-mono">${item.defaultSalePrice}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">لم يتم العثور على صنف مطابق بهذا الاسم</p>
              <p className="text-[10px] text-emerald-400 font-bold">يمكنك الاستمرار بكتابة الاسم الجديد وسيتم اعتماده مباشرة</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
