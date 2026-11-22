import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ShoppingCart,
  Tag,
  Wrench,
  Cpu,
  ChevronDown,
  Layers,
  FileText,
  ArrowLeft
} from 'lucide-react';
import { User, ShopConfig } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import Invoices from './Invoices';

export type OtherServiceInvoiceTarget = 'purchase' | 'parts' | 'maintenance' | 'software';

interface InvoicesHubProps {
  user: User;
  shopConfig: ShopConfig | null;
  onBack: () => void;
  onOpenDeviceIntake: () => void;
  onOpenDeviceExit: () => void;
  onOpenOtherService: (
    serviceType: OtherServiceInvoiceTarget,
    currentState: { showOtherServices: boolean; showManagement: boolean }
  ) => void;
  initialState?: { showOtherServices: boolean; showManagement: boolean } | null;
}

export default function InvoicesHub({
  user,
  shopConfig,
  onBack,
  onOpenDeviceIntake,
  onOpenDeviceExit,
  onOpenOtherService,
  initialState = null
}: InvoicesHubProps) {
  const { hasPermission } = usePermissions(user);

  const canViewInvoices = user?.role === 'admin' || user?.isPrimary || hasPermission('invoices', 'view');
  const canViewInventory = user?.role === 'admin' || user?.isPrimary || hasPermission('inventory', 'view');
  const canAccessOtherServices = canViewInvoices || canViewInventory;

  // Lightweight toggles: OFF by default so opening the page executes zero DB queries
  const [showOtherServices, setShowOtherServices] = useState<boolean>(Boolean(initialState?.showOtherServices));
  const [showManagement, setShowManagement] = useState<boolean>(Boolean(initialState?.showManagement && canViewInvoices));

  // Compact dropdown states used only when showManagement === true
  const [openDropdown, setOpenDropdown] = useState<'devices' | 'other' | null>(null);
  const dropdownsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canViewInvoices && showManagement) {
      setShowManagement(false);
    }
  }, [canViewInvoices, showManagement]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (dropdownsContainerRef.current && !dropdownsContainerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    if (openDropdown) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('touchstart', handleOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [openDropdown]);

  // Close compact dropdowns whenever management mode is toggled off
  useEffect(() => {
    if (!showManagement) {
      setOpenDropdown(null);
    }
  }, [showManagement]);

  const otherServicesList: Array<{
    key: OtherServiceInvoiceTarget;
    label: string;
    subtitle: string;
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
  }> = [
    {
      key: 'purchase',
      label: 'فاتورة شراء قطع وملحقات',
      subtitle: 'إدخال مشتريات وتحديث المخزون',
      icon: <ShoppingCart size={18} />,
      iconBg: 'bg-purple-500/10',
      iconColor: 'text-purple-500 dark:text-purple-400'
    },
    {
      key: 'parts',
      label: 'فاتورة بيع قطع وملحقات',
      subtitle: 'بيع قطع غيار وإكسسوارات',
      icon: <Tag size={18} />,
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-600 dark:text-emerald-400'
    },
    {
      key: 'maintenance',
      label: 'فاتورة صيانة خارجية',
      subtitle: 'خدمات صيانة فورية خارج الورشة',
      icon: <Wrench size={18} />,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-600 dark:text-amber-400'
    },
    {
      key: 'software',
      label: 'فاتورة خدمات برمجية',
      subtitle: 'سوفت وير وبرمجة أنظمة',
      icon: <Cpu size={18} />,
      iconBg: 'bg-cyan-500/10',
      iconColor: 'text-cyan-600 dark:text-cyan-400'
    }
  ];

  // Divider 1 label adjusts dynamically: shows actual section rendered directly beneath it
  const firstDividerLabel = showOtherServices
    ? 'خدمات أخرى'
    : showManagement
      ? 'إدارة الفواتير'
      : '';

  return (
    <div className="w-full max-w-6xl mx-auto p-3 sm:p-5 md:p-6 pb-10 space-y-5 font-cairo text-right" dir="rtl">
      {/* Main Tree Container (matches Vault tree aesthetic cleanly in Light & Dark modes) */}
      <div className="w-full bg-white dark:bg-[#101010] border border-slate-200 dark:border-white/5 rounded-[2rem] p-5 sm:p-7 shadow-xl dark:shadow-2xl space-y-4">
        {/* Top Header Row: Title on Right, Vertical Control Buttons on Left */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-white/5">
          <div className="pt-0.5">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white tracking-wide">
              إجراءات وإدارة الفواتير
            </h2>
            <p className="text-[11px] font-bold text-slate-500 dark:text-gray-400 mt-0.5">
              إصدار فواتير الصيانة والخدمات أو فتح سجل الإدارة
            </p>
          </div>

          {/* Vertical Control Toggles (Top-Left) */}
          <div className="flex flex-col gap-1.5 shrink-0 min-w-[138px]">
            {canAccessOtherServices && (
              <button
                type="button"
                onClick={() => setShowOtherServices(prev => !prev)}
                aria-pressed={showOtherServices}
                className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl border transition-all text-xs font-bold whitespace-nowrap cursor-pointer ${
                  showOtherServices
                    ? 'bg-indigo-500/12 dark:bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className={showOtherServices ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-gray-400'} />
                  <span>خدمات أخرى</span>
                </span>
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                    showOtherServices
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-[#1c1c1c]'
                  }`}
                >
                  {showOtherServices && (
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 fill-none stroke-current stroke-[2.2]">
                      <path d="M2.5 6.2L5 8.7L9.5 3.5" />
                    </svg>
                  )}
                </span>
              </button>
            )}

            {canViewInvoices && (
              <button
                type="button"
                onClick={() => setShowManagement(prev => !prev)}
                aria-pressed={showManagement}
                className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl border transition-all text-xs font-bold whitespace-nowrap cursor-pointer ${
                  showManagement
                    ? 'bg-emerald-500/12 dark:bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <FileText size={14} className={showManagement ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-gray-400'} />
                  <span>إدارة الفواتير</span>
                </span>
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                    showManagement
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-[#1c1c1c]'
                  }`}
                >
                  {showManagement && (
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 fill-none stroke-current stroke-[2.2]">
                      <path d="M2.5 6.2L5 8.7L9.5 3.5" />
                    </svg>
                  )}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* COMPACT HORIZONTAL MODE when Section 3 (إدارة الفواتير) is active: collapses Sections 1 & 2 into 2 compact buttons */}
        {showManagement ? (
          <div ref={dropdownsContainerRef} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Compact Button 1: Section 1 (دخول / خروج أجهزة) */}
              {canViewInventory && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(prev => (prev === 'devices' ? null : 'devices'))}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                      openDropdown === 'devices'
                        ? 'bg-orange-600 text-white border-orange-500 shadow-md theme-preserve-white'
                        : 'bg-orange-600/10 hover:bg-orange-600/15 text-orange-700 dark:text-orange-400 border-orange-500/25'
                    }`}
                  >
                    <ArrowDownToLine size={15} />
                    <span>فواتير الصيانة (دخول / خروج)</span>
                    <ChevronDown size={14} className={`transition-transform ${openDropdown === 'devices' ? 'rotate-180' : ''}`} />
                  </button>

                  {openDropdown === 'devices' && (
                    <div className="absolute right-0 top-full mt-2 w-60 bg-white dark:bg-[#181818] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-1.5 z-50 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenDropdown(null);
                          onOpenDeviceIntake();
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-orange-500/10 text-slate-800 dark:text-white transition-colors text-xs font-bold cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <ArrowDownToLine size={15} className="text-orange-500" />
                          <span>دخول أجهزة</span>
                        </span>
                        <ArrowLeft size={14} className="text-slate-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenDropdown(null);
                          onOpenDeviceExit();
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-emerald-500/10 text-slate-800 dark:text-white transition-colors text-xs font-bold cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <ArrowUpFromLine size={15} className="text-emerald-500" />
                          <span>خروج أجهزة</span>
                        </span>
                        <ArrowLeft size={14} className="text-slate-400" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Compact Button 2: Section 2 (خدمات أخرى) when showOtherServices is enabled */}
              {showOtherServices && canAccessOtherServices && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(prev => (prev === 'other' ? null : 'other'))}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                      openDropdown === 'other'
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-md theme-preserve-white'
                        : 'bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/25'
                    }`}
                  >
                    <Layers size={15} />
                    <span>خدمات أخرى</span>
                    <ChevronDown size={14} className={`transition-transform ${openDropdown === 'other' ? 'rotate-180' : ''}`} />
                  </button>

                  {openDropdown === 'other' && (
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#181818] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-1.5 z-50 space-y-1">
                      {otherServicesList.map(item => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            setOpenDropdown(null);
                            onOpenOtherService(item.key, { showOtherServices, showManagement });
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-800 dark:text-white transition-colors text-xs font-bold cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <span className={item.iconColor}>{item.icon}</span>
                            <span>{item.label}</span>
                          </span>
                          <ArrowLeft size={14} className="text-slate-400" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Divider announcing Management section */}
            <div className="flex items-center gap-3 pt-1">
              <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 tracking-wide whitespace-nowrap">
                إدارة الفواتير
              </span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
            </div>
          </div>
        ) : (
          /* TREE MODE (Default Light Open + Optional Section 2): Zero DB data loaded */
          <div className="space-y-3">
            {/* Section 1: Automatic Workshop Entry & Exit */}
            {canViewInventory && (
              <div className="space-y-3">
                <div className="px-1 text-[11px] font-bold text-slate-400 dark:text-gray-400 text-right">
                  فواتير الصيانة والإجراءات الأساسية
                </div>

                {/* 1. دخول أجهزة (Primary Accent Row like Receipt in Vault) */}
                <button
                  type="button"
                  onClick={onOpenDeviceIntake}
                  className="w-full flex items-center justify-between p-3.5 px-5 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl shadow-lg shadow-orange-950/20 transition-all active:scale-[0.99] cursor-pointer theme-preserve-white"
                >
                  <div className="flex items-center gap-3">
                    <ArrowDownToLine size={19} className="text-white" />
                    <span className="text-xs sm:text-sm font-black leading-none">دخول أجهزة</span>
                  </div>
                  <span className="text-[10px] font-bold text-white/90">استلام</span>
                </button>

                {/* 2. خروج أجهزة */}
                <button
                  type="button"
                  onClick={onOpenDeviceExit}
                  className="w-full flex items-center justify-between p-3.5 px-5 bg-slate-50 hover:bg-slate-100 dark:bg-[#181818] dark:hover:bg-[#202020] border border-slate-200 dark:border-white/5 rounded-2xl transition-all active:scale-[0.99] cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <ArrowUpFromLine size={19} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-gray-200 leading-none">خروج أجهزة</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-gray-500">تسليم</span>
                </button>
              </div>
            )}

            {/* Divider 1: marks end of Section 1 and dynamically titles Section 2 when opened */}
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              {firstDividerLabel && (
                <>
                  <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 tracking-wide whitespace-nowrap">
                    {firstDividerLabel}
                  </span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                </>
              )}
            </div>

            {/* Section 2: Other Services Invoices (External opening to keep page ultra-light) */}
            {showOtherServices && canAccessOtherServices && (
              <div className="space-y-2.5">
                {otherServicesList.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onOpenOtherService(item.key, { showOtherServices, showManagement })}
                    className="w-full flex items-center justify-between p-3.5 px-5 bg-slate-50 hover:bg-slate-100 dark:bg-[#181818] dark:hover:bg-[#202020] border border-slate-200 dark:border-white/5 rounded-2xl transition-all active:scale-[0.99] cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${item.iconBg} ${item.iconColor}`}>
                        {item.icon}
                      </div>
                      <div className="text-right">
                        <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-gray-200 block leading-tight">
                          {item.label}
                        </span>
                        <span className="text-[10px] font-medium text-slate-500 dark:text-gray-500 block mt-0.5">
                          {item.subtitle}
                        </span>
                      </div>
                    </div>
                    <ArrowLeft size={16} className="text-slate-400 dark:text-gray-500 shrink-0" />
                  </button>
                ))}

                {/* Divider 2: marks end of Section 2 */}
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 3: Lazy-mounted Invoices Management (ONLY loads data when showManagement === true) */}
      {showManagement && canViewInvoices && (
        <div className="animate-in fade-in duration-150">
          <Invoices user={user} onBack={onBack} shopConfig={shopConfig} />
        </div>
      )}
    </div>
  );
}
