import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Device } from '@capacitor/device';
import { localDb } from './local-db';
import { parseDate } from './dateUtils';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { LocalProviderInstance } from '../data/LocalProvider';
import { ProviderFactory } from '../data/ProviderFactory';
import { normalizePartsUsedList } from './partsNormalization';

export type RestorePointType =
  | 'manual'
  | 'auto_before_reset'
  | 'auto_before_precise_reset'
  | 'auto_before_transfer'
  | 'auto_before_restore';

export type RestorePointSource = 'AUTO' | 'CLOUD' | 'LOCAL';

export interface SystemRestorePointMeta {
  id: string;
  docKind: 'POINT_META';
  title: string;
  notes?: string;
  type: RestorePointType;
  status: 'CREATING' | 'READY' | 'FAILED';
  createdAt: string;
  createdBy: string;
  createdById: string;
  sourceScope: RestorePointSource;
  includeSavedPdfs: boolean;
  isPinned: boolean;
  totalRecords: number;
  totalSizeBytes: number;
  chunkCount: number;
  skippedOversizedCount?: number;
  tablesSummary: Record<string, number>;
  includedTables: string[];
}

export interface RestoreProgressUpdate {
  percent: number;
  label: string;
}

export const CORE_RESTORE_TABLES: string[] = [
  'company_details',
  'settings',
  'users',
  'engineers',
  'user_devices',
  'device_categories',
  'device_models',
  'parts_catalog',
  'electronic_part_groups',
  'fin_transaction_types',
  'fin_funds',
  'fin_currencies',
  'fin_payment_methods',
  'job_titles',
  'customers',
  'invoices',
  'invoice_items',
  'vault_transactions',
  'maintenance_actions',
  'approval_actions',
  'inventory_items',
  'shop_parts_inventory',
  'disassembly_batches',
  'document_outputs'
];

export const OPTIONAL_RESTORE_TABLES: string[] = ['saved_pdfs'];

export const ALL_RESTORE_TABLES: string[] = [
  ...CORE_RESTORE_TABLES,
  ...OPTIONAL_RESTORE_TABLES
];

export const RESTORE_TABLE_LABELS: Record<string, string> = {
  company_details: 'بيانات المحل والشركات',
  settings: 'إعدادات الضبط والعدادات',
  users: 'مستخدمو النظام والصلاحيات',
  engineers: 'المهندسون والفنيون',
  user_devices: 'أجهزة مستخدمي النظام',
  device_categories: 'أنواع وتصنيفات الأجهزة',
  device_models: 'موديلات الأجهزة',
  parts_catalog: 'دليل قطع الغيار',
  electronic_part_groups: 'مجموعات القطع الإلكترونية',
  fin_transaction_types: 'أنواع الحركات المالية',
  fin_funds: 'الخزائن والحسابات البنكية',
  fin_currencies: 'العملات وأسعار الصرف',
  fin_payment_methods: 'طرق ووسائل الدفع',
  job_titles: 'المسميات الوظيفية',
  customers: 'العملاء',
  invoices: 'الفواتير',
  invoice_items: 'بنود وأجهزة الفواتير',
  vault_transactions: 'سندات وحركات الخزينة',
  maintenance_actions: 'إجراءات الصيانة',
  approval_actions: 'موافقات الصيانة',
  inventory_items: 'عناصر المخزون الأولي',
  shop_parts_inventory: 'مخزون قطع المحل',
  disassembly_batches: 'دفعات التفكيك والتشليح',
  document_outputs: 'سجل المستندات المخرجة',
  saved_pdfs: 'ملفات PDF المحفوظة'
};

const COLLECTION_NAME = 'system_restore_points';
const MAX_UNPINNED_POINTS = 10;
const CHUNK_TARGET_BYTES = 480_000; // Safe margin well below Firestore 1MB doc limit
const SINGLE_ROW_MAX_BYTES = 850_000;

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function utf8ByteLength(str: string): number {
  if (textEncoder) return textEncoder.encode(str).length;
  return str.length * 2;
}

function normalizeRowDates(row: any): any {
  if (row === null || row === undefined) return row;
  if (Array.isArray(row)) return row.map(normalizeRowDates);
  if (typeof row !== 'object') return row;

  if (typeof row.toISOString === 'function') {
    try { return row.toISOString(); } catch (_) {}
  }
  if (typeof row.toDate === 'function') {
    try { return row.toDate().toISOString(); } catch (_) {}
  }

  const cleaned: Record<string, any> = { ...row };
  const knownDateFields = new Set([
    'createdAt', 'updatedAt', 'timestamp', 'actionDate', 'deliveredAt',
    'output_datetime', 'date', 'blockDate', 'lastLogin', 'lastLogout',
    'created_at', 'updated_at', 'last_login', 'last_logout',
    'exitDate', 'entryDate', 'issueDate', 'deliveryDate'
  ]);

  for (const key of Object.keys(cleaned)) {
    const val = cleaned[key];
    if (val === null || val === undefined) continue;

    if (key === 'partsUsed') {
      cleaned[key] = normalizePartsUsedList(val);
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isDateField =
      knownDateFields.has(key) ||
      lowerKey.includes('date') ||
      lowerKey.includes('time') ||
      lowerKey.includes('timestamp') ||
      lowerKey.includes('created') ||
      lowerKey.includes('updated') ||
      lowerKey.endsWith('at');

    if (isDateField) {
      const parsed = parseDate(val);
      if (parsed && !isNaN(parsed.getTime())) {
        cleaned[key] = parsed.toISOString();
      }
    } else if (typeof val === 'object') {
      const parsed = parseDate(val);
      if (parsed && !isNaN(parsed.getTime())) {
        cleaned[key] = parsed.toISOString();
      } else {
        cleaned[key] = normalizeRowDates(val);
      }
    }
  }
  return cleaned;
}

function ensureOnlineAvailable() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('يتطلب هذا الإجراء اتصالاً بالإنترنت للتواصل مع السحابة.');
  }
}

async function readRowsFromSource(
  table: string,
  sourceScope: RestorePointSource
): Promise<any[]> {
  if (sourceScope === 'CLOUD') {
    const snap = await FirebaseProviderInstance.getDocs(table);
    return snap.docs.map((d: any) => normalizeRowDates({ ...d.data(), id: d.id }));
  }

  if (sourceScope === 'LOCAL') {
    const snap = await LocalProviderInstance.getDocs(table);
    return snap.docs.map((d: any) => normalizeRowDates({ ...d.data(), id: d.id }));
  }

  // AUTO (Hybrid): Prefer Local SQLite (contains latest offline + synced records),
  // fallback to Cloud if a table is empty locally while cloud has data
  try {
    const localSnap = await LocalProviderInstance.getDocs(table);
    if (localSnap.docs.length > 0) {
      return localSnap.docs.map((d: any) => normalizeRowDates({ ...d.data(), id: d.id }));
    }
  } catch (_) {}

  try {
    const cloudSnap = await FirebaseProviderInstance.getDocs(table);
    return cloudSnap.docs.map((d: any) => normalizeRowDates({ ...d.data(), id: d.id }));
  } catch (_) {
    return [];
  }
}

interface ChunkEntry {
  table: string;
  rows: any[];
}

function packTablesIntoChunks(tablesData: Record<string, any[]>): {
  chunks: Array<{ entries: ChunkEntry[]; payloadJson: string; byteSize: number }>;
  skippedOversizedCount: number;
  totalSizeBytes: number;
} {
  const chunks: Array<{ entries: ChunkEntry[]; payloadJson: string; byteSize: number }> = [];
  let currentEntries: ChunkEntry[] = [];
  let currentBytes = 32; // overhead for JSON array structure
  let skippedOversizedCount = 0;
  let totalSizeBytes = 0;

  const flushChunk = () => {
    if (currentEntries.length === 0) return;
    const payloadJson = JSON.stringify(currentEntries);
    const byteSize = utf8ByteLength(payloadJson);
    chunks.push({ entries: currentEntries, payloadJson, byteSize });
    totalSizeBytes += byteSize;
    currentEntries = [];
    currentBytes = 32;
  };

  for (const table of Object.keys(tablesData)) {
    const rows = tablesData[table] || [];
    if (rows.length === 0) continue;

    let currentTableRows: any[] = [];

    const pushTableSlice = () => {
      if (currentTableRows.length > 0) {
        currentEntries.push({ table, rows: currentTableRows });
        currentTableRows = [];
      }
    };

    for (const row of rows) {
      const rowJson = JSON.stringify(row);
      const rowBytes = utf8ByteLength(rowJson) + 2;

      if (rowBytes > SINGLE_ROW_MAX_BYTES) {
        skippedOversizedCount++;
        continue;
      }

      if (currentBytes + rowBytes > CHUNK_TARGET_BYTES && (currentTableRows.length > 0 || currentEntries.length > 0)) {
        pushTableSlice();
        flushChunk();
      }

      currentTableRows.push(row);
      currentBytes += rowBytes;
    }

    pushTableSlice();
  }

  flushChunk();

  return { chunks, skippedOversizedCount, totalSizeBytes };
}

async function enforceRetentionPolicy(): Promise<void> {
  try {
    const points = await listCloudRestorePoints();
    const unpinned = points.filter(p => !p.isPinned);
    if (unpinned.length <= MAX_UNPINNED_POINTS) return;

    const toRemove = unpinned.slice(MAX_UNPINNED_POINTS);
    for (const oldPoint of toRemove) {
      await deleteCloudRestorePoint(oldPoint.id).catch(err =>
        console.warn('[RestorePoints] Retention cleanup warning:', err)
      );
    }
  } catch (e) {
    console.warn('[RestorePoints] Retention policy skipped:', e);
  }
}

function toSafeMetaText(val: any, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val.toISOString === 'function') {
    try { return val.toISOString(); } catch (_) {}
  }
  return fallback;
}

function normalizeRestorePointMeta(raw: any, docId: string): SystemRestorePointMeta {
  const parsedDate = parseDate(raw?.createdAt);
  const createdAtIso = parsedDate
    ? parsedDate.toISOString()
    : toSafeMetaText(raw?.createdAt, new Date(0).toISOString());

  return {
    ...(raw || {}),
    id: docId || raw?.id || '',
    docKind: raw?.docKind || 'POINT_META',
    title: toSafeMetaText(raw?.title, 'نقطة استعادة'),
    notes: toSafeMetaText(raw?.notes, ''),
    createdAt: createdAtIso,
    createdBy: toSafeMetaText(raw?.createdBy, 'النظام'),
    createdById: toSafeMetaText(raw?.createdById, 'system'),
    totalRecords: Number(raw?.totalRecords) || 0,
    totalSizeBytes: Number(raw?.totalSizeBytes) || 0,
    chunkCount: Number(raw?.chunkCount) || 0,
    isPinned: Boolean(raw?.isPinned),
    includeSavedPdfs: Boolean(raw?.includeSavedPdfs),
    tablesSummary: raw?.tablesSummary && typeof raw.tablesSummary === 'object' ? raw.tablesSummary : {},
    includedTables: Array.isArray(raw?.includedTables) ? raw.includedTables : []
  } as SystemRestorePointMeta;
}

export async function listCloudRestorePoints(): Promise<SystemRestorePointMeta[]> {
  ensureOnlineAvailable();
  const snap = await FirebaseProviderInstance.getDocs(COLLECTION_NAME, [
    { type: 'where', field: 'docKind', op: '==', value: 'POINT_META' }
  ]);

  const points: SystemRestorePointMeta[] = snap.docs
    .filter((d: any) => d.data()?.docKind === 'POINT_META')
    .map((d: any) => normalizeRestorePointMeta(d.data(), d.id));

  points.sort((a, b) => {
    const ta = parseDate(a.createdAt)?.getTime() || 0;
    const tb = parseDate(b.createdAt)?.getTime() || 0;
    return tb - ta;
  });

  return points;
}

export async function createCloudRestorePoint(options: {
  title?: string;
  notes?: string;
  type?: RestorePointType;
  createdBy?: string;
  createdById?: string;
  sourceScope?: RestorePointSource;
  includeSavedPdfs?: boolean;
  isPinned?: boolean;
  tablesOverride?: string[];
  onProgress?: (update: RestoreProgressUpdate) => void;
}): Promise<SystemRestorePointMeta> {
  ensureOnlineAvailable();

  const {
    title,
    notes = '',
    type = 'manual',
    createdBy = 'النظام',
    createdById = 'system',
    sourceScope = ProviderFactory.getMode() as RestorePointSource,
    includeSavedPdfs = false,
    isPinned = false,
    tablesOverride,
    onProgress
  } = options;

  const tablesToCapture = tablesOverride && tablesOverride.length > 0
    ? tablesOverride.filter(t => ALL_RESTORE_TABLES.includes(t))
    : includeSavedPdfs
      ? ALL_RESTORE_TABLES
      : CORE_RESTORE_TABLES;

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).substring(2, 7);
  const pointId = `rp_${stamp}_${rand}`;

  const defaultTitleMap: Record<RestorePointType, string> = {
    manual: `نقطة استعادة يدوية (${now.toLocaleString('ar-EG')})`,
    auto_before_reset: 'نقطة أمان تلقائية قبل ضبط المصنع',
    auto_before_precise_reset: 'نقطة أمان تلقائية قبل التهيئة الدقيقة',
    auto_before_transfer: 'نقطة أمان تلقائية قبل نقل البيانات',
    auto_before_restore: 'نقطة أمان تلقائية قبل الاستعادة'
  };

  onProgress?.({ percent: 5, label: 'جاري تجميع بيانات الجداول...' });

  const tablesData: Record<string, any[]> = {};
  const tablesSummary: Record<string, number> = {};
  let totalRecords = 0;

  for (let i = 0; i < tablesToCapture.length; i++) {
    const table = tablesToCapture[i];
    const pct = Math.round(5 + ((i + 1) / tablesToCapture.length) * 40);
    onProgress?.({
      percent: pct,
      label: `جاري قراءة جدول: ${RESTORE_TABLE_LABELS[table] || table}...`
    });

    try {
      const rows = await readRowsFromSource(table, sourceScope);
      tablesData[table] = rows;
      tablesSummary[table] = rows.length;
      totalRecords += rows.length;
    } catch (err) {
      console.warn(`[RestorePoints] Failed reading table ${table}:`, err);
      tablesData[table] = [];
      tablesSummary[table] = 0;
    }
  }

  onProgress?.({ percent: 50, label: 'جاري ضغط وتقسيم البيانات للرفع السحابي...' });
  const { chunks, skippedOversizedCount, totalSizeBytes } = packTablesIntoChunks(tablesData);

  const initialMeta: SystemRestorePointMeta = {
    id: pointId,
    docKind: 'POINT_META',
    title: (title || '').trim() || defaultTitleMap[type],
    notes: notes.trim(),
    type,
    status: 'CREATING',
    createdAt: now.toISOString(),
    createdBy,
    createdById,
    sourceScope,
    includeSavedPdfs,
    isPinned,
    totalRecords,
    totalSizeBytes,
    chunkCount: chunks.length,
    skippedOversizedCount,
    tablesSummary,
    includedTables: tablesToCapture
  };

  // Write initial meta with BYPASS_OUTBOX so deleted_records is never touched
  await FirebaseProviderInstance.setDoc(COLLECTION_NAME, pointId, initialMeta, undefined, 'BYPASS_OUTBOX');

  try {
    // Upload chunks in sequential small batches to stay well below Firestore 10MB batch payload cap
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkDocId = `${pointId}__chunk_${i}`;
      const pct = Math.round(55 + ((i + 1) / Math.max(1, chunks.length)) * 38);
      onProgress?.({
        percent: pct,
        label: `جاري رفع الجزء ${i + 1} من ${chunks.length} إلى السحابة...`
      });

      await FirebaseProviderInstance.setDoc(
        COLLECTION_NAME,
        chunkDocId,
        {
          id: chunkDocId,
          docKind: 'POINT_CHUNK',
          pointId,
          chunkIndex: i,
          byteSize: chunk.byteSize,
          payloadJson: chunk.payloadJson
        },
        undefined,
        'BYPASS_OUTBOX'
      );
    }

    const finalMeta: SystemRestorePointMeta = {
      ...initialMeta,
      status: 'READY'
    };

    await FirebaseProviderInstance.setDoc(COLLECTION_NAME, pointId, finalMeta, undefined, 'BYPASS_OUTBOX');

    onProgress?.({ percent: 96, label: 'جاري تنظيف النقاط القديمة غير المثبتة...' });
    await enforceRetentionPolicy();

    onProgress?.({ percent: 100, label: 'تم حفظ نقطة الاستعادة السحابية بنجاح!' });
    return finalMeta;
  } catch (err) {
    // Rollback partial chunks on failure
    await FirebaseProviderInstance.setDoc(
      COLLECTION_NAME,
      pointId,
      { ...initialMeta, status: 'FAILED' },
      undefined,
      'BYPASS_OUTBOX'
    ).catch(() => {});
    throw err;
  }
}

export async function toggleRestorePointPin(pointId: string, isPinned: boolean): Promise<void> {
  ensureOnlineAvailable();
  await FirebaseProviderInstance.updateDoc(
    COLLECTION_NAME,
    pointId,
    { isPinned },
    'BYPASS_OUTBOX'
  );
}

export async function deleteCloudRestorePoint(pointId: string): Promise<void> {
  ensureOnlineAvailable();
  const chunkSnap = await FirebaseProviderInstance.getDocs(COLLECTION_NAME, [
    { type: 'where', field: 'pointId', op: '==', value: pointId }
  ]);

  const docIds = new Set<string>([pointId]);
  chunkSnap.docs.forEach((d: any) => docIds.add(d.id));

  const allIds = Array.from(docIds);
  const batchSize = 350;
  for (let i = 0; i < allIds.length; i += batchSize) {
    const slice = allIds.slice(i, i + batchSize);
    const batch = FirebaseProviderInstance.writeBatch();
    for (const id of slice) {
      batch.delete({ name: COLLECTION_NAME, id });
    }
    await batch.commit();
  }
}

export async function fetchRestorePointPayload(pointId: string): Promise<{
  meta: SystemRestorePointMeta;
  tablesData: Record<string, any[]>;
}> {
  ensureOnlineAvailable();
  const metaSnap = await FirebaseProviderInstance.getDoc(COLLECTION_NAME, pointId);
  if (!metaSnap.exists()) {
    throw new Error('لم يتم العثور على نقطة الاستعادة المطلوبة في السحابة.');
  }
  const meta = normalizeRestorePointMeta(metaSnap.data(), metaSnap.id);

  if (meta.status !== 'READY') {
    throw new Error('نقطة الاستعادة غير مكتملة أو تالفة ولا يمكن استرجاعها.');
  }

  const chunkSnap = await FirebaseProviderInstance.getDocs(COLLECTION_NAME, [
    { type: 'where', field: 'pointId', op: '==', value: pointId }
  ]);

  const chunkDocs = chunkSnap.docs
    .map((d: any) => d.data())
    .sort((a: any, b: any) => (Number(a.chunkIndex) || 0) - (Number(b.chunkIndex) || 0));

  if (meta.chunkCount > 0 && chunkDocs.length < meta.chunkCount) {
    throw new Error(`بعض أجزاء نقطة الاستعادة مفقودة (${chunkDocs.length}/${meta.chunkCount}).`);
  }

  const tablesData: Record<string, any[]> = {};
  for (const t of meta.includedTables || []) {
    tablesData[t] = [];
  }

  for (const c of chunkDocs) {
    if (!c?.payloadJson) continue;
    const entries: ChunkEntry[] = JSON.parse(c.payloadJson);
    for (const entry of entries) {
      if (!tablesData[entry.table]) tablesData[entry.table] = [];
      tablesData[entry.table].push(...(entry.rows || []));
    }
  }

  return { meta, tablesData };
}

export async function exportRestorePointAsJson(pointId: string): Promise<{ success: boolean; message: string }> {
  const { meta, tablesData } = await fetchRestorePointPayload(pointId);
  const exportPayload = {
    version: 1,
    timestamp: meta.createdAt,
    restorePointId: meta.id,
    restorePointTitle: meta.title,
    data: tablesData
  };

  const jsonData = JSON.stringify(exportPayload);
  const safeName = (meta.id || 'restore_point').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `snd_${safeName}.json`;

  let isNative = Capacitor.isNativePlatform();
  if (!isNative) {
    try {
      const info = await Device.getInfo();
      isNative = info.platform !== 'web';
    } catch {
      isNative = false;
    }
  }

  if (!isNative) {
    const blob = new Blob([jsonData], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (_) {}
    }, 1500);
    return { success: true, message: `تم تنزيل نقطة الاستعادة باسم (${fileName})` };
  }

  // Native Android / iOS path: write to Cache first (guaranteed FileProvider access without storage permission),
  // share via `files`, and best-effort save a copy to Documents/SND_Backups.
  let sharedUri = '';
  try {
    const cacheResult = await Filesystem.writeFile({
      path: fileName,
      data: jsonData,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true
    });
    sharedUri = cacheResult.uri;
  } catch (cacheErr) {
    console.warn('[RestorePoints] Cache write fallback to Data directory:', cacheErr);
    const dataResult = await Filesystem.writeFile({
      path: fileName,
      data: jsonData,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true
    });
    sharedUri = dataResult.uri;
  }

  // Best-effort copy in Documents/SND_Backups (may be restricted on some Android 11+ configs, non-fatal)
  try {
    await Filesystem.writeFile({
      path: `SND_Backups/${fileName}`,
      data: jsonData,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true
    });
  } catch (docErr) {
    console.warn('[RestorePoints] Backup copy to Documents skipped:', docErr);
  }

  await Share.share({
    title: meta.title || 'نقطة استعادة النظام',
    text: 'نسخة مستخرجة من نقطة استعادة النظام السحابية',
    files: [sharedUri],
    dialogTitle: 'حفظ أو مشاركة نقطة الاستعادة'
  });

  return { success: true, message: `تم تجهيز ومشاركة نقطة الاستعادة باسم (${fileName})` };
}

async function clearCloudTombstonesForTables(targetTablesSet: Set<string>): Promise<void> {
  try {
    const delSnap = await FirebaseProviderInstance.getDocs('deleted_records');
    const matchingIds: string[] = [];
    for (const d of delSnap.docs) {
      const data = d.data();
      if (data?.tableName && targetTablesSet.has(String(data.tableName))) {
        matchingIds.push(d.id);
      }
    }
    const batchSize = 350;
    for (let i = 0; i < matchingIds.length; i += batchSize) {
      const slice = matchingIds.slice(i, i + batchSize);
      const batch = FirebaseProviderInstance.writeBatch();
      for (const id of slice) {
        batch.delete({ name: 'deleted_records', id });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[RestorePoints] Targeted cloud tombstone cleanup warning:', err);
  }
}

async function clearLocalTombstonesAndOutboxForTables(targetTables: string[]): Promise<void> {
  for (const table of targetTables) {
    await localDb.run('DELETE FROM deleted_records WHERE tableName = ?', [table]).catch(() => {});
    await localDb.run('DELETE FROM outbox WHERE tableName = ?', [table]).catch(() => {});
  }
}

export async function restoreFromCloudPoint(options: {
  pointId: string;
  selectedTables?: string[];
  createSafetyBackup?: boolean;
  currentUserName?: string;
  currentUserId?: string;
  onProgress?: (update: RestoreProgressUpdate) => void;
}): Promise<{
  success: boolean;
  restoredCount: number;
  restoredTablesCount: number;
  safetyPointId?: string;
}> {
  ensureOnlineAvailable();

  const {
    pointId,
    selectedTables,
    createSafetyBackup = true,
    currentUserName = 'النظام',
    currentUserId = 'system',
    onProgress
  } = options;

  const { SyncEngine } = await import('../data/SyncEngine');
  let shouldKeepPausedForReload = false;

  await SyncEngine.acquireGlobalLock('RESTORE_POINT').catch(() => {
    SyncEngine.pauseSync();
  });

  try {
    // 1. Download and validate the restore point payload BEFORE altering live databases
    onProgress?.({ percent: 8, label: 'جاري تحميل وفحص بيانات نقطة الاستعادة من السحابة...' });
    const { meta, tablesData } = await fetchRestorePointPayload(pointId);

    const availableTables = Object.keys(tablesData).filter(t => ALL_RESTORE_TABLES.includes(t));
    const targetTables = selectedTables && selectedTables.length > 0
      ? availableTables.filter(t => selectedTables.includes(t))
      : availableTables;

    if (targetTables.length === 0) {
      throw new Error('لم يتم تحديد أي جداول صالحة للاستعادة.');
    }

    // 2. Optionally capture a safety restore point of the current live state before applying changes
    let safetyPointId: string | undefined;
    if (createSafetyBackup) {
      onProgress?.({ percent: 15, label: 'جاري إنشاء نقطة أمان للوضع الحالي قبل الاسترجاع...' });
      try {
        const safetyMeta = await createCloudRestorePoint({
          title: `أمان تلقائي قبل استعادة (${meta.title})`,
          type: 'auto_before_restore',
          createdBy: currentUserName,
          createdById: currentUserId,
          sourceScope: ProviderFactory.getMode() as RestorePointSource,
          includeSavedPdfs: targetTables.includes('saved_pdfs')
        });
        safetyPointId = safetyMeta.id;
      } catch (safetyErr) {
        console.warn('[RestorePoints] Pre-restore safety snapshot failed (continuing restore):', safetyErr);
      }
    }

    const dbMode = ProviderFactory.getMode();
    const restoreCloud = dbMode === 'CLOUD' || dbMode === 'AUTO';
    const restoreLocal = dbMode === 'LOCAL' || dbMode === 'AUTO';
    const targetSet = new Set(targetTables);

    // 3. Targeted tombstone & outbox cleanup ONLY for restored tables (never disturbs unrelated tables!)
    onProgress?.({ percent: 25, label: 'جاري تنظيف شواهد الحذف وصندوق التحديثات للجداول المستهدفة فقط...' });
    if (restoreLocal) {
      await clearLocalTombstonesAndOutboxForTables(targetTables);
    }
    if (restoreCloud) {
      await clearCloudTombstonesForTables(targetSet);
    }

    let restoredCount = 0;

    // 4. Restore Cloud Firestore tables (clear & batch write without creating tombstones)
    if (restoreCloud) {
      for (let i = 0; i < targetTables.length; i++) {
        const table = targetTables[i];
        const pct = Math.round(28 + ((i + 1) / targetTables.length) * 32);
        onProgress?.({
          percent: pct,
          label: `جاري استعادة السحاب: ${RESTORE_TABLE_LABELS[table] || table}...`
        });

        await FirebaseProviderInstance.clearCollection(table);

        let rows = (tablesData[table] || []).map(r => normalizeRowDates(r));
        if (table === 'users' && rows.length === 0) {
          rows = [{
            id: 'primary-admin',
            username: 'admin',
            password: 'admin',
            name: 'المدير العام',
            role: 'admin',
            isPrimary: true,
            userNumber: 100,
            isActive: true
          }];
        }

        const batchSize = 300;
        for (let b = 0; b < rows.length; b += batchSize) {
          const slice = rows.slice(b, b + batchSize);
          const batch = FirebaseProviderInstance.writeBatch();
          for (const row of slice) {
            const id = row.id || row._id;
            if (!id) continue;
            const finalRow = { ...row, id };
            if (table === 'company_details') {
              batch.set({ name: 'company_details', id: 'main_details' }, { ...finalRow, id: 'main_details' });
            } else {
              batch.set({ name: table, id }, finalRow);
            }
            if (!restoreLocal) restoredCount++;
          }
          await batch.commit();
        }
      }
    }

    // 5. Restore Local SQLite tables (with BYPASS_OUTBOX and skipNotify until table end)
    if (restoreLocal) {
      for (let i = 0; i < targetTables.length; i++) {
        const table = targetTables[i];
        const pct = Math.round(62 + ((i + 1) / targetTables.length) * 28);
        onProgress?.({
          percent: pct,
          label: `جاري استعادة القاعدة المحلية: ${RESTORE_TABLE_LABELS[table] || table}...`
        });

        try {
          await localDb.run(`DELETE FROM ${table}`);
        } catch (e: any) {
          const msg = String(e?.message || e || '');
          if (!msg.includes('no such table')) throw e;
          continue;
        }

        let rows = (tablesData[table] || []).map(r => normalizeRowDates(r));
        if (table === 'users' && rows.length === 0) {
          rows = [{
            id: 'primary-admin',
            username: 'admin',
            password: 'admin',
            name: 'المدير العام',
            role: 'admin',
            isPrimary: true,
            userNumber: 100,
            isActive: true
          }];
        }

        for (const row of rows) {
          const id = row.id || row._id;
          if (!id) continue;
          await LocalProviderInstance.setDoc(table, id, { ...row, id }, undefined, 'BYPASS_OUTBOX', true);
          restoredCount++;
        }

        if (localDb.hasObservers(table)) {
          const fresh = await localDb.query(`SELECT * FROM ${table}`).catch(() => ({ values: [] }));
          localDb.notify(table, fresh.values || []);
        }
      }
    }

    // 6. Auto-calibrate counters cleanly (only when settings or counter-bearing tables were restored)
    const touchesCounters =
      targetSet.has('settings') ||
      targetSet.has('invoices') ||
      targetSet.has('customers') ||
      targetSet.has('vault_transactions');

    if (touchesCounters) {
      onProgress?.({ percent: 93, label: 'جاري معايرة العدادات والترقيم التلقائي...' });
      const counterProvider = restoreLocal ? LocalProviderInstance : FirebaseProviderInstance;

      const [invSnap, custSnap, txSnap] = await Promise.all([
        counterProvider.getDocs('invoices').catch(() => ({ docs: [] })),
        counterProvider.getDocs('customers').catch(() => ({ docs: [] })),
        counterProvider.getDocs('vault_transactions').catch(() => ({ docs: [] }))
      ]);

      let maxInvoice = 0;
      let maxOtherInvoice = 0;
      invSnap.docs.forEach((d: any) => {
        const raw = String(d.data()?.invoiceNumber || '').trim();
        if (raw.toUpperCase().startsWith('O-')) {
          const num = parseInt(raw.slice(2), 10);
          if (!isNaN(num) && num > maxOtherInvoice) maxOtherInvoice = num;
        } else {
          const num = parseInt(raw.replace('#', ''), 10);
          if (!isNaN(num) && num > maxInvoice) maxInvoice = num;
        }
      });

      let maxCustomer = 0;
      custSnap.docs.forEach((d: any) => {
        const num = parseInt(d.data()?.customerNumber, 10);
        if (!isNaN(num) && num > maxCustomer) maxCustomer = num;
      });

      let maxVoucher = 1000;
      txSnap.docs.forEach((d: any) => {
        const num = parseInt(d.data()?.voucherNumber, 10);
        if (!isNaN(num) && num > maxVoucher) maxVoucher = num;
      });

      const counterPatch = {
        lastInvoiceNumber: maxInvoice,
        lastOtherInvoiceNumber: maxOtherInvoice,
        lastCustomerNumber: maxCustomer,
        lastVoucherNumber: maxVoucher
      };

      if (restoreCloud) {
        await FirebaseProviderInstance.setDoc('settings', 'app', counterPatch, { merge: true }, 'BYPASS_OUTBOX').catch(() => {});
      }
      if (restoreLocal) {
        await LocalProviderInstance.setDoc('settings', 'app', counterPatch, { merge: true }, 'BYPASS_OUTBOX', true).catch(() => {});
        await localDb.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('lastInvoiceNumber', ?)", [String(maxInvoice)]).catch(() => {});
        await localDb.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('lastOtherInvoiceNumber', ?)", [String(maxOtherInvoice)]).catch(() => {});
        await localDb.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('lastCustomerNumber', ?)", [String(maxCustomer)]).catch(() => {});
        await localDb.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('lastVoucherNumber', ?)", [String(maxVoucher)]).catch(() => {});
      }
    }

    // 7. Persist local SQLite store cleanly on Browser before reload
    if (restoreLocal) {
      await localDb.flushSaveToStore().catch(() => {});
    }

    localStorage.setItem('snd_db_seeded', 'true');
    sessionStorage.removeItem('alertsClosed');
    shouldKeepPausedForReload = true;

    onProgress?.({ percent: 100, label: 'تمت الاستعادة بنجاح!' });

    return {
      success: true,
      restoredCount,
      restoredTablesCount: targetTables.length,
      safetyPointId
    };
  } finally {
    try {
      await SyncEngine.releaseGlobalLock();
      if (shouldKeepPausedForReload) {
        SyncEngine.pauseSync();
      }
    } catch (_) {}
  }
}
