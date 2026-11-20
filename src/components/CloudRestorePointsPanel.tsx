import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  RefreshCw,
  Plus,
  RotateCcw,
  Pin,
  PinOff,
  Trash2,
  Download,
  CheckCircle,
  AlertTriangle,
  X,
  ShieldCheck,
  Database,
  Clock,
  User as UserIcon,
  Layers,
  Check
} from 'lucide-react';
import { User } from '../types';
import { ProviderFactory } from '../data/ProviderFactory';
import { parseDate } from '../lib/dateUtils';
import { usePermissions } from '../hooks/usePermissions';
import {
  SystemRestorePointMeta,
  RestorePointType,
  RESTORE_TABLE_LABELS,
  listCloudRestorePoints,
  createCloudRestorePoint,
  toggleRestorePointPin,
  deleteCloudRestorePoint,
  exportRestorePointAsJson,
  restoreFromCloudPoint
} from '../lib/restorePoints';

interface CloudRestorePointsPanelProps {
  user: User;
}

const TYPE_LABELS: Record<RestorePointType, { text: string; badgeClass: string }> = {
  manual: {
    text: 'يدوية',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  },
  auto_before_reset: {
    text: 'أمان قبل ضبط المصنع',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30'
  },
  auto_before_precise_reset: {
    text: 'أمان قبل التهيئة الدقيقة',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30'
  },
  auto_before_transfer: {
    text: 'أمان قبل النقل',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  },
  auto_before_restore: {
    text: 'أمان قبل الاستعادة',
    badgeClass: 'bg-purple-500/15 text-purple-400 border-purple-500/30'
  }
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateAr(val: any): string {
  try {
    const d = parseDate(val) || (val ? new Date(val) : null);
    if (!d || isNaN(d.getTime())) {
      return typeof val === 'string' ? val : '---';
    }
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return typeof val === 'string' ? val : '---';
  }
}

function safeText(val: any, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (typeof val.toISOString === 'function') {
    try { return val.toISOString(); } catch (_) {}
  }
  return fallback;
}

export default function CloudRestorePointsPanel({ user }: CloudRestorePointsPanelProps) {
  const {
    canView,
    canAdd,
    canEdit,
    canDelete,
    canPrint: canDownload,
    canAdvanced
  } = usePermissions(user, 'settings_restore_points');

  const [points, setPoints] = useState<SystemRestorePointMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [progress, setProgress] = useState<{ active: boolean; percent: number; label: string }>({
    active: false,
    percent: 0,
    label: ''
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create new restore point form state
  const [customTitle, setCustomTitle] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [includePdfs, setIncludePdfs] = useState(false);
  const [pinOnCreate, setPinOnCreate] = useState(false);

  // Restore modal state
  const [restoreTarget, setRestoreTarget] = useState<SystemRestorePointMeta | null>(null);
  const [restoreMode, setRestoreMode] = useState<'full' | 'selective'>('full');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [createSafetyBeforeRestore, setCreateSafetyBeforeRestore] = useState(true);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<SystemRestorePointMeta | null>(null);

  const loadPoints = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFeedback({ type: 'error', message: 'أنت غير متصل بالإنترنت. نقاط الاستعادة السحابية تتطلب اتصالاً بالإنترنت.' });
      return;
    }
    setLoading(true);
    try {
      const list = await listCloudRestorePoints();
      setPoints(list);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تحميل نقاط الاستعادة السحابية.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) {
      loadPoints();
    }
  }, [canView, loadPoints]);

  const handleCreatePoint = async () => {
    if (!canAdd) return;
    setFeedback(null);
    setBusyAction(true);
    setProgress({ active: true, percent: 2, label: 'جاري بدء إنشاء نقطة الاستعادة السحابية...' });
    try {
      await createCloudRestorePoint({
        title: customTitle.trim() || undefined,
        notes: customNotes.trim(),
        type: 'manual',
        createdBy: user.name || user.username || 'مدير النظام',
        createdById: user.id || 'system',
        sourceScope: ProviderFactory.getMode(),
        includeSavedPdfs: canAdvanced ? includePdfs : false,
        isPinned: canAdvanced ? pinOnCreate : false,
        onProgress: ({ percent, label }) => setProgress({ active: true, percent, label })
      });
      setCustomTitle('');
      setCustomNotes('');
      setPinOnCreate(false);
      setIncludePdfs(false);
      setFeedback({ type: 'success', message: 'تم إنشاء وحفظ نقطة الاستعادة السحابية بنجاح.' });
      await loadPoints();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشل إنشاء نقطة الاستعادة السحابية.' });
    } finally {
      setBusyAction(false);
      setProgress({ active: false, percent: 0, label: '' });
    }
  };

  const handleTogglePin = async (point: SystemRestorePointMeta) => {
    if (!canEdit) return;
    setFeedback(null);
    setBusyAction(true);
    try {
      await toggleRestorePointPin(point.id, !point.isPinned);
      setPoints(prev => prev.map(p => (p.id === point.id ? { ...p, isPinned: !p.isPinned } : p)));
      setFeedback({
        type: 'success',
        message: !point.isPinned ? 'تم تثبيت نقطة الاستعادة لحمايتها من الحذف التلقائي.' : 'تم إلغاء تثبيت نقطة الاستعادة.'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشل تحديث حالة التثبيت.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleExportJson = async (point: SystemRestorePointMeta) => {
    if (!canDownload) return;
    setFeedback(null);
    setBusyAction(true);
    try {
      const res = await exportRestorePointAsJson(point.id);
      setFeedback({ type: res.success ? 'success' : 'error', message: res.message });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشل تنزيل نقطة الاستعادة.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canDelete) return;
    setFeedback(null);
    setBusyAction(true);
    try {
      await deleteCloudRestorePoint(deleteTarget.id);
      setPoints(prev => prev.filter(p => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      setFeedback({ type: 'success', message: 'تم حذف نقطة الاستعادة السحابية بنجاح.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشل حذف نقطة الاستعادة.' });
    } finally {
      setBusyAction(false);
    }
  };

  const openRestoreModal = (point: SystemRestorePointMeta) => {
    setRestoreTarget(point);
    setRestoreMode('full');
    setSelectedTables([...(point.includedTables || [])]);
    setCreateSafetyBeforeRestore(true);
  };

  const handleExecuteRestore = async () => {
    if (!restoreTarget) return;
    if (restoreMode === 'selective' && selectedTables.length === 0) {
      setFeedback({ type: 'error', message: 'يرجى تحديد جدول واحد على الأقل للاستعادة الانتقائية.' });
      return;
    }

    const pointToRestore = restoreTarget;
    setRestoreTarget(null);
    setFeedback(null);
    setBusyAction(true);
    setProgress({ active: true, percent: 3, label: 'جاري تهيئة عملية استعادة النظام...' });

    try {
      const result = await restoreFromCloudPoint({
        pointId: pointToRestore.id,
        selectedTables: restoreMode === 'selective' ? selectedTables : undefined,
        createSafetyBackup: createSafetyBeforeRestore,
        currentUserName: user.name || user.username || 'مدير النظام',
        currentUserId: user.id || 'system',
        onProgress: ({ percent, label }) => setProgress({ active: true, percent, label })
      });

      setFeedback({
        type: 'success',
        message: `تمت استعادة ${result.restoredTablesCount} جدولاً (${result.restoredCount} سجل) بنجاح! سيتم إعادة تحميل النظام خلال ثانيتين...`
      });

      setTimeout(() => {
        window.location.reload();
      }, 2200);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشلت عملية الاستعادة من نقطة الاستعادة السحابية.' });
      setBusyAction(false);
      setProgress({ active: false, percent: 0, label: '' });
    }
  };

  if (!canView) {
    return (
      <section className="bg-white/5 rounded-[1.5rem] border border-white/10 p-6 text-center text-xs text-gray-400 space-y-2" dir="rtl">
        <AlertTriangle size={24} className="mx-auto text-amber-400 opacity-80" />
        <p className="font-bold text-white">ليس لديك صلاحية لعرض نقاط استعادة النظام السحابية.</p>
      </section>
    );
  }

  return (
    <section className="bg-white/5 rounded-[1.5rem] border border-white/10 overflow-hidden shadow-2xl space-y-5 p-4 md:p-6 text-right" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-2xl border border-indigo-500/30">
            <Cloud size={24} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white font-cairo">نقاط استعادة النظام السحابية</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              لقطات زمنية محفوظة في السحابة (system_restore_points) تتيح الرجوع الكامل أو الجزئي دون تعارض مع شواهد الحذف
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadPoints}
          disabled={loading || busyAction}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 rounded-xl text-xs font-bold flex items-center gap-2 self-start sm:self-auto cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>تحديث القائمة</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            <span>{feedback.message}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Progress Bar */}
      {progress.active && (
        <div className="p-4 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-300">
            <span className="flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              {progress.label}
            </span>
            <span className="font-mono">{progress.percent}%</span>
          </div>
          <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(2, progress.percent))}%` }}
            />
          </div>
        </div>
      )}

      {/* Create New Restore Point Card */}
      {canAdd && (
        <div className="p-4 md:p-5 bg-black/40 rounded-2xl border border-white/10 space-y-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Plus size={16} className="text-indigo-400" />
            <span>إنشاء نقطة استعادة جديدة</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">اسم النقطة (اختياري)</label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                disabled={busyAction}
                placeholder="مثال: قبل جرد نهاية الشهر"
                className="w-full bg-black/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">ملاحظات (اختياري)</label>
              <input
                type="text"
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                disabled={busyAction}
                placeholder="وصف مختصر لسبب الحفظ..."
                className="w-full bg-black/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {canAdvanced ? (
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pinOnCreate}
                    onChange={(e) => setPinOnCreate(e.target.checked)}
                    disabled={busyAction}
                    className="w-4 h-4 rounded text-indigo-500 bg-black/50 border-white/20"
                  />
                  <span>تثبيت النقطة (حماية من الحذف التلقائي)</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includePdfs}
                    onChange={(e) => setIncludePdfs(e.target.checked)}
                    disabled={busyAction}
                    className="w-4 h-4 rounded text-indigo-500 bg-black/50 border-white/20"
                  />
                  <span>تضمين أرشيف PDF المحفوظة</span>
                </label>
              </div>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={handleCreatePoint}
              disabled={busyAction}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {busyAction ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
              <span>حفظ نقطة استعادة الآن</span>
            </button>
          </div>
        </div>
      )}

      {/* Points List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-gray-400 font-bold">
          <span>النقاط المحفوظة في السحابة ({points.length})</span>
          <span className="text-[10px]">يحتفظ النظام تلقائياً بآخر 10 نقاط غير مثبتة</span>
        </div>

        {loading && points.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs flex flex-col items-center gap-2">
            <RefreshCw size={22} className="animate-spin text-indigo-400" />
            <span>جاري جلب نقاط الاستعادة السحابية...</span>
          </div>
        ) : points.length === 0 ? (
          <div className="p-8 bg-black/30 rounded-2xl border border-white/5 text-center text-gray-500 text-xs space-y-2">
            <Database size={28} className="mx-auto opacity-40" />
            <p>لا توجد نقاط استعادة سحابية محفوظة حالياً.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {points.map((point, pIdx) => {
              const typeBadge = TYPE_LABELS[point.type] || TYPE_LABELS.manual;
              const isReady = point.status === 'READY';
              return (
                <div
                  key={`rp-${point.id ?? 'noid'}-${pIdx}`}
                  className={`p-4 rounded-2xl border transition-all space-y-3 ${
                    point.isPinned
                      ? 'bg-indigo-950/20 border-indigo-500/35'
                      : 'bg-black/35 border-white/10'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {point.isPinned && (
                          <span className="px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[10px] font-bold flex items-center gap-1">
                            <Pin size={10} />
                            مثبتة
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${typeBadge.badgeClass}`}>
                          {typeBadge.text}
                        </span>
                        {!isReady && (
                          <span className="px-2 py-0.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] font-bold">
                            {point.status === 'CREATING' ? 'غير مكتملة' : 'فشل الرفع'}
                          </span>
                        )}
                        <h4 className="text-sm font-black text-white font-cairo">{safeText(point.title, 'نقطة استعادة')}</h4>
                      </div>

                      {point.notes && <p className="text-[11px] text-gray-400">{safeText(point.notes)}</p>}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-400 pt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock size={11} className="text-gray-500" />
                          {formatDateAr(point.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <UserIcon size={11} className="text-gray-500" />
                          {safeText(point.createdBy, 'النظام')}
                        </span>
                        <span className="flex items-center gap-1 font-mono">
                          <Layers size={11} className="text-gray-500" />
                          {point.totalRecords} سجل • {point.includedTables?.length || 0} جدول
                        </span>
                        <span className="font-mono text-indigo-300">{formatBytes(point.totalSizeBytes)}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {isReady && (
                        <>
                          <button
                            type="button"
                            onClick={() => openRestoreModal(point)}
                            disabled={busyAction}
                            className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw size={13} />
                            <span>استعادة</span>
                          </button>

                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleTogglePin(point)}
                              disabled={busyAction}
                              title={point.isPinned ? 'إلغاء التثبيت' : 'تثبيت النقطة'}
                              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 text-indigo-300 rounded-xl cursor-pointer disabled:opacity-50"
                            >
                              {point.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                            </button>
                          )}

                          {canDownload && (
                            <button
                              type="button"
                              onClick={() => handleExportJson(point)}
                              disabled={busyAction}
                              title="تنزيل كملف JSON"
                              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-xl cursor-pointer disabled:opacity-50"
                            >
                              <Download size={14} />
                            </button>
                          )}
                        </>
                      )}

                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(point)}
                          disabled={busyAction}
                          title="حذف النقطة"
                          className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Restore Options Modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-[180] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-[#161616] border border-white/15 rounded-3xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-[#1c1c1c]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/15 text-emerald-400 rounded-xl">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-white">استعادة النظام من نقطة سحابية</h4>
                  <p className="text-[11px] text-gray-400">{safeText(restoreTarget.title, 'نقطة استعادة')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Mode selector */}
              <div className="grid grid-cols-2 gap-2 bg-black/40 p-1 rounded-2xl border border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setRestoreMode('full');
                    setSelectedTables([...(restoreTarget.includedTables || [])]);
                  }}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    restoreMode === 'full' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  استعادة كاملة ({restoreTarget.includedTables?.length || 0} جدول)
                </button>
                <button
                  type="button"
                  onClick={() => setRestoreMode('selective')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    restoreMode === 'selective' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  استعادة انتقائية (جداول محددة)
                </button>
              </div>

              {restoreMode === 'selective' && (
                <div className="space-y-2 bg-black/30 p-3.5 rounded-2xl border border-white/10">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-300 pb-2 border-b border-white/5">
                    <span>اختر الجداول المطلوب استعادتها ({selectedTables.length})</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTables([...(restoreTarget.includedTables || [])])}
                        className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTables([])}
                        className="text-[10px] text-gray-400 hover:underline cursor-pointer"
                      >
                        إلغاء الكل
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pt-1">
                    {(restoreTarget.includedTables || []).map((tbl, tIdx) => {
                      const checked = selectedTables.includes(tbl);
                      const count = restoreTarget.tablesSummary?.[tbl] ?? 0;
                      return (
                        <label
                          key={`rtbl-${tbl}-${tIdx}`}
                          className={`flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                            checked
                              ? 'bg-indigo-500/15 border-indigo-500/40 text-white'
                              : 'bg-white/5 border-white/5 text-gray-400'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTables(prev => [...prev, tbl]);
                                } else {
                                  setSelectedTables(prev => prev.filter(x => x !== tbl));
                                }
                              }}
                              className="w-3.5 h-3.5 rounded text-indigo-500"
                            />
                            <span className="font-bold text-[11px]">{RESTORE_TABLE_LABELS[tbl] || tbl}</span>
                          </div>
                          <span className="font-mono text-[10px] opacity-75">{count}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Safety backup option */}
              <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createSafetyBeforeRestore}
                  onChange={(e) => setCreateSafetyBeforeRestore(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-emerald-500"
                />
                <div className="text-xs">
                  <span className="font-black text-emerald-300 block">إنشاء نقطة أمان للوضع الحالي قبل الاستعادة</span>
                  <span className="text-[11px] text-gray-400 block mt-0.5">
                    يسمح لك بالتراجع عن عملية الاستعادة نفسها في حال أردت العودة للوضع الحالي لاحقاً.
                  </span>
                </div>
              </label>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200 leading-relaxed">
                سيتم تفعيل قفل المزامنة مؤقتاً وتنظيف شواهد الحذف وصندوق التحديثات للجداول المسترجعة فقط دون المساس ببقية الجداول، ثم إعادة تحميل النظام تلقائياً بعد الحفظ.
              </div>
            </div>

            <div className="p-4 border-t border-white/10 flex gap-3 bg-[#1c1c1c]">
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={restoreMode === 'selective' && selectedTables.length === 0}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check size={15} />
                <span>تأكيد وبدء الاستعادة</span>
              </button>
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                className="flex-1 py-2.5 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                إلغاء الأمر
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[180] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-[#161616] border border-red-500/30 rounded-3xl w-full max-w-md p-6 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-500/15 text-red-400 flex items-center justify-center border border-red-500/30">
              <Trash2 size={24} />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-base font-black text-white">حذف نقطة الاستعادة السحابية؟</h4>
              <p className="text-xs text-gray-400">
                سيتم حذف النقطة "{safeText(deleteTarget.title, 'نقطة استعادة')}" وجميع أجزائها من السحابة نهائياً دون التأثير على بيانات النظام الحالية.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={busyAction}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
              >
                نعم، احذف النقطة
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
