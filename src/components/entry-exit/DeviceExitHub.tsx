import React, { useState, useEffect, useMemo } from 'react';
import { ArrowUpFromLine, CheckCircle2 } from 'lucide-react';
import { collection, onSnapshot } from '../../firebase';
import { db } from '../../firebase';
import { Invoice, InvoiceItem, User, isShopMaintenanceItem, isInShopMaintenanceDevice, isPurchaseInvoice, isSaleInvoice } from '../../types';
import { parseDate } from '../../lib/dateUtils';
import DeviceExit from './DeviceExit';

interface DeviceExitHubProps {
  user: User;
  onBack: () => void;
}

export default function DeviceExitHub({ user, onBack }: DeviceExitHubProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);

  useEffect(() => {
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (s) => 
      setInvoices(s.docs.map(d => ({ ...d.data(), id: d.id } as Invoice)))
    );
    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (s) => 
      setItems(s.docs.map(d => ({ ...d.data(), id: d.id } as InvoiceItem)))
    );
    return () => { 
      unsubInvoices(); 
      unsubItems(); 
    };
  }, []);

  const invoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    invoices.forEach(inv => {
      if (inv.id) map.set(String(inv.id), inv);
      if (inv.invoiceNumber) {
        const rawNo = String(inv.invoiceNumber);
        const cleanNo = rawNo.replace('#', '').trim();
        map.set(rawNo, inv);
        map.set(cleanNo, inv);
      }
    });
    return map;
  }, [invoices]);

  const getItemResolvedDeliveryDate = (item: any): Date | null => {
    const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber))) ||
                null;

    const candidates = [
      item.deliveredAt,
      item.deliveryDate,
      inv?.deliveredAt,
      inv?.deliveryDate,
      item.updatedAt,
      inv?.updatedAt,
      item.createdAt,
      inv?.createdAt
    ];

    for (const cand of candidates) {
      if (cand !== undefined && cand !== null && cand !== '') {
        const parsed = parseDate(cand);
        if (parsed && !isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    return null;
  };

  const now = new Date();
  const isToday = (date: Date | null): boolean => {
    if (!date) return false;
    return date.getFullYear() === now.getFullYear() &&
           date.getMonth() === now.getMonth() &&
           date.getDate() === now.getDate();
  };

  // 1. Total devices ready for exit (إجمالي الأجهزة الجاهزة للخروج)
  const exitReadyCount = useMemo(() => {
    return items.filter(item => {
      const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                  (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                  null;
      if (inv && (isPurchaseInvoice(inv) || isSaleInvoice(inv))) return false;
      if (!isShopMaintenanceItem(item, inv)) return false;
      
      const st = String(item.status || '').toLowerCase().trim();
      return ['ready', 'unrepairable', 'intact', 'refused', '50', '70', 'cancelled'].includes(st);
    }).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  }, [items, invoiceMap]);

  // 2. Devices exited today (عدد الأجهزة الخارجة اليوم)
  const todayExitCount = useMemo(() => {
    return items.filter(item => {
      const inv = (item.invoiceId && invoiceMap.get(String(item.invoiceId))) ||
                  (item.invoiceNumber && invoiceMap.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                  null;
      if (inv && (isPurchaseInvoice(inv) || isSaleInvoice(inv))) return false;
      if (!isShopMaintenanceItem(item, inv)) return false;

      const st = String(item.status || '').toLowerCase().trim();
      if (st === '60' || st === 'delivered') {
        const exitDate = getItemResolvedDeliveryDate(item);
        return isToday(exitDate);
      }
      return false;
    }).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  }, [items, invoiceMap]);

  return (
    <div className="w-full min-h-0 flex-1 px-2 sm:px-4 py-2 sm:py-3 space-y-3 sm:space-y-4 max-w-7xl mx-auto overflow-y-visible" dir="rtl">
      {/* 1. Header Card: إحصائية الأجهزة الخارجة (Compact Height - Counters at opposite ends) */}
      <div className="w-full bg-gradient-to-r from-emerald-600 via-teal-700 to-emerald-800 text-white p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-md relative overflow-hidden">
        {/* Subtle decorative background glow */}
        <div className="absolute -left-10 -top-10 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
        <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-black/10 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 w-full">
          {/* Mobile View (< md): Centered title on top, and counters at opposite edges below */}
          <div className="flex flex-col gap-2 md:hidden">
            <div className="flex items-center justify-center gap-2">
              <div className="p-1 bg-white/15 rounded-lg shadow-inner shrink-0">
                <ArrowUpFromLine size={16} className="text-white" />
              </div>
              <h1 className="text-xs sm:text-sm font-black font-cairo leading-tight">
                إحصائية الأجهزة الخارجة
              </h1>
            </div>

            <div className="flex items-center justify-between w-full pt-0.5">
              {/* Counter 1: الطرف الأول (اليمين) - جاهزة للخروج */}
              <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-inner relative">
                {exitReadyCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-300 rounded-full animate-ping" />
                )}
                <span className="text-lg font-black font-mono tracking-wider text-emerald-300">
                  {exitReadyCount}
                </span>
                <div className="flex flex-col text-right leading-tight">
                  <span className="text-[10px] font-bold font-cairo text-emerald-100">
                    جاهزة للخروج
                  </span>
                  <span className="text-[8px] text-emerald-200/70">
                    بانتظار التسليم
                  </span>
                </div>
              </div>

              {/* Counter 2: الطرف الثاني (اليسار) - الخارجة اليوم */}
              <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-inner">
                <span className="text-lg font-black font-mono tracking-wider text-white">
                  {todayExitCount}
                </span>
                <div className="flex flex-col text-right leading-tight">
                  <span className="text-[10px] font-bold font-cairo text-white">
                    الخارجة اليوم
                  </span>
                  <span className="text-[8px] text-emerald-200/70">
                    تم تسليمها اليوم
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop & Tablet View (>= md): Single line with Counter 1 on far right, Title in center, Counter 2 on far left */}
          <div className="hidden md:flex items-center justify-between w-full">
            {/* الطرف الأول (اليمين): العداد الأول - جاهزة للخروج */}
            <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-4 py-1.5 flex items-center gap-3 shadow-inner relative">
              {exitReadyCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-300 rounded-full animate-ping" />
              )}
              <span className="text-2xl font-black font-mono tracking-wider text-emerald-300">
                {exitReadyCount}
              </span>
              <div className="flex flex-col text-right leading-tight">
                <span className="text-xs font-bold font-cairo text-emerald-100">
                  جاهزة للخروج
                </span>
                <span className="text-[10px] text-emerald-200/70">
                  بانتظار التسليم للعملاء
                </span>
              </div>
            </div>

            {/* الوسط: عنوان البطاقة والأيقونة */}
            <div className="flex items-center gap-2.5 text-center">
              <div className="p-2 bg-white/15 rounded-xl shadow-inner shrink-0">
                <ArrowUpFromLine size={20} className="text-white" />
              </div>
              <div className="text-right">
                <h1 className="text-base font-black font-cairo leading-tight">
                  إحصائية الأجهزة الخارجة
                </h1>
                <p className="text-xs text-emerald-100/80 mt-0.5">
                  متابعة الأجهزة الجاهزة للتسليم للعملاء والأجهزة التي تم تسليمها اليوم
                </p>
              </div>
            </div>

            {/* الطرف الثاني (اليسار): العداد الثاني - الخارجة اليوم */}
            <div className="bg-black/25 backdrop-blur-sm border border-white/15 rounded-xl px-4 py-1.5 flex items-center gap-3 shadow-inner">
              <span className="text-2xl font-black font-mono tracking-wider text-white">
                {todayExitCount}
              </span>
              <div className="flex flex-col text-right leading-tight">
                <span className="text-xs font-bold font-cairo text-white">
                  الخارجة اليوم
                </span>
                <span className="text-[10px] text-emerald-200/70">
                  تم تسليمها اليوم
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. DeviceExit screen */}
      <DeviceExit user={user} onBack={onBack} />
    </div>
  );
}
