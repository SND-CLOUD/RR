import { IDataProvider } from './IDataProvider';
import { parseDate } from '../lib/dateUtils';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  collection,
  doc,
  getDoc as fsGetDoc,
  getDocs as fsGetDocs,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  onSnapshot as fsOnSnapshot,
  query,
  where,
  orderBy,
  limit,
  writeBatch as fsWriteBatch,
  runTransaction as fsRunTransaction,
  Timestamp,
  Firestore,
  increment
} from 'firebase/firestore';
import { generateUUID } from './utils';
import firebaseConfig from '../../firebase-applet-config.json';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

try {
  setLogLevel('error');
} catch (e) {}

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const dbId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== 'default'
    ? firebaseConfig.firestoreDatabaseId
    : undefined;

  try {
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    }, dbId);
  } catch {
    db = dbId ? getFirestore(app, dbId) : getFirestore(app);
  }
} catch (err) {
  console.error('Failed to initialize Firebase Firestore SDK', err);
}

export class FirebaseProvider implements IDataProvider {
  private getDb(): Firestore {
    if (!db) {
      throw new Error('Firebase Firestore is not initialized correctly.');
    }
    return db;
  }

  async getDoc(collectionName: string, id: string): Promise<any> {
    const docRef = doc(this.getDb(), collectionName, id);
    const snap = await fsGetDoc(docRef);
    if (snap.exists()) {
      const data = this.formatFirestoreData(snap.data()) || {};
      if (typeof data === 'object' && !data.id) {
        data.id = snap.id || id;
      }
      return {
        exists: () => true,
        id: snap.id || id,
        data: () => data
      };
    }
    return { id, exists: () => false, data: () => undefined };
  }

  async getDocs(collectionName: string, constraints?: any[]): Promise<any> {
    const q = this.buildFirestoreQuery(collectionName, constraints);
    const snap = await fsGetDocs(q);
    const docs = snap.docs.map(fsDoc => {
      const docData = this.formatFirestoreData(fsDoc.data()) || {};
      if (typeof docData === 'object' && !docData.id) {
        docData.id = fsDoc.id;
      }
      return {
        id: fsDoc.id,
        ref: { name: collectionName, id: fsDoc.id, path: `${collectionName}/${fsDoc.id}` },
        data: () => docData
      };
    });

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach: (cb: any) => docs.forEach(cb)
    };
  }

  async setDoc(collectionName: string, id: string, data: any, options?: any, txGroupId?: string): Promise<void> {
    if (collectionName === "company_details") { id = "main_details"; data.id = "main_details"; }
    const docRef = doc(this.getDb(), collectionName, id);
    const cleaned = this.prepareDataForFirestore(data);
    if (!cleaned.id && id) {
      cleaned.id = id;
    }
    await fsSetDoc(docRef, cleaned, options || {});
  }

  async addDoc(collectionName: string, data: any): Promise<{ id: string }> {
    const id = data.id || generateUUID();
    await this.setDoc(collectionName, id, { ...data, id });
    return { id };
  }

  async updateDoc(collectionName: string, id: string, data: any, txGroupId?: string): Promise<void> {
    const docRef = doc(this.getDb(), collectionName, id);
    const cleaned = this.prepareDataForFirestore(data);
    
    // Parse increments
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] && typeof cleaned[key] === 'object' && cleaned[key].type === 'increment') {
        cleaned[key] = increment(cleaned[key].value);
      }
    });

    await fsSetDoc(docRef, cleaned, { merge: true });
  }

  async deleteDoc(collectionName: string, id: string, txGroupId?: string): Promise<void> {
    const docRef = doc(this.getDb(), collectionName, id);
    await fsDeleteDoc(docRef);
  }

  onSnapshot(
    collectionName: string,
    constraints: any[] | undefined,
    callback: (snapshot: any) => void,
    errorCallback?: any
  ): () => void {
    try {
      const q = this.buildFirestoreQuery(collectionName, constraints);
      return fsOnSnapshot(
        q,
        (snap) => {
          const docs = snap.docs.map(fsDoc => {
            const docData = this.formatFirestoreData(fsDoc.data()) || {};
            if (typeof docData === 'object' && !docData.id) {
              docData.id = fsDoc.id;
            }
            return {
              id: fsDoc.id,
              ref: { name: collectionName, id: fsDoc.id, path: `${collectionName}/${fsDoc.id}` },
              data: () => docData
            };
          });
          
          const docChanges = () => snap.docChanges().map(change => {
            const fsDoc = change.doc;
            const docData = this.formatFirestoreData(fsDoc.data()) || {};
            if (typeof docData === 'object' && !docData.id) {
              docData.id = fsDoc.id;
            }
            return {
              type: change.type,
              doc: {
                id: fsDoc.id,
                ref: { name: collectionName, id: fsDoc.id, path: `${collectionName}/${fsDoc.id}` },
                data: () => docData
              }
            };
          });

          callback({
            docs,
            empty: docs.length === 0,
            size: docs.length,
            forEach: (cb: any) => docs.forEach(cb),
            docChanges
          });
        },
        errorCallback || ((err: any) => {
          console.warn(`[FirebaseProvider] onSnapshot error on "${collectionName}":`, err);
        })
      );
    } catch (err) {
      if (errorCallback) {
        errorCallback(err);
      } else {
        console.warn(`[FirebaseProvider] onSnapshot setup exception on "${collectionName}":`, err);
      }
      return () => {};
    }
  }

  onSnapshotDoc(
    collectionName: string,
    id: string,
    callback: (snapshot: any) => void,
    errorCallback?: any
  ): () => void {
    try {
      const docRef = doc(this.getDb(), collectionName, id);
      return fsOnSnapshot(
        docRef,
        (snap) => {
          if (snap.exists()) {
            const docData = this.formatFirestoreData(snap.data()) || {};
            if (typeof docData === 'object' && !docData.id) {
              docData.id = snap.id || id;
            }
            callback({
              exists: () => true,
              id: snap.id || id,
              data: () => docData
            });
          } else {
            callback({
              exists: () => false,
              id,
              data: () => undefined
            });
          }
        },
        errorCallback || ((err: any) => {
          console.warn(`[FirebaseProvider] onSnapshotDoc error on "${collectionName}/${id}":`, err);
        })
      );
    } catch (err) {
      if (errorCallback) {
        errorCallback(err);
      } else {
        console.warn(`[FirebaseProvider] onSnapshotDoc setup exception on "${collectionName}/${id}":`, err);
      }
      return () => {};
    }
  }

  async runTransaction(updateFunction: any): Promise<any> {
    return await fsRunTransaction(this.getDb(), async (fsTransaction) => {
      const transactionBridge = {
        get: async (docRef: any) => {
          const ref = doc(this.getDb(), docRef.name, docRef.id);
          const snap = await fsTransaction.get(ref);
          const data = snap.exists() ? (this.formatFirestoreData(snap.data()) || {}) : undefined;
          if (data && typeof data === 'object' && !data.id) {
            data.id = docRef.id;
          }
          return {
            exists: () => snap.exists(),
            id: docRef.id,
            data: () => data
          };
        },
        set: async (docRef: any, data: any) => {
          const ref = doc(this.getDb(), docRef.name, docRef.id);
          fsTransaction.set(ref, this.prepareDataForFirestore(data));
        },
        update: async (docRef: any, data: any) => {
          const ref = doc(this.getDb(), docRef.name, docRef.id);
          fsTransaction.update(ref, this.prepareDataForFirestore(data));
        },
        delete: async (docRef: any) => {
          const ref = doc(this.getDb(), docRef.name, docRef.id);
          fsTransaction.delete(ref);
        }
      };
      return await updateFunction(transactionBridge);
    });
  }

  writeBatch(): any {
    const batch = fsWriteBatch(this.getDb());
    return {
      set: (docRef: any, data: any, options?: any) => {
        const ref = doc(this.getDb(), docRef.name, docRef.id);
        batch.set(ref, this.prepareDataForFirestore(data), options || {});
      },
      update: (docRef: any, data: any) => {
        const ref = doc(this.getDb(), docRef.name, docRef.id);
        batch.set(ref, this.prepareDataForFirestore(data), { merge: true });
      },
      delete: (docRef: any) => {
        const ref = doc(this.getDb(), docRef.name, docRef.id);
        batch.delete(ref);
      },
      commit: async () => {
        await batch.commit();
      }
    };
  }

  // --- Specific Domain Methods ---
  async addInvoice(invoice: any): Promise<{ id: string }> {
    const id = invoice.id || generateUUID();
    const finalInvoice = { ...invoice, id };
    await this.setDoc('invoices', id, finalInvoice);
    return { id };
  }

  async getInvoices(): Promise<any[]> {
    const result = await this.getDocs('invoices');
    return result.docs.map((doc: any) => doc.data());
  }

  async getCustomer(id: string): Promise<any> {
    const result = await this.getDoc('customers', id);
    return result.exists() ? result.data() : null;
  }

  async savePayment(payment: any): Promise<void> {
    const id = payment.id || generateUUID();
    const finalPayment = { ...payment, id };
    await this.setDoc('vault_transactions', id, finalPayment);
  }

  // --- Helper Methods ---
  private buildFirestoreQuery(collectionName: string, constraints?: any[]) {
    const colRef = collection(this.getDb(), collectionName);
    if (!constraints || constraints.length === 0) {
      return colRef;
    }
    const fsConstraints: any[] = [];
    for (const c of constraints) {
      if (c.type === 'where') {
        let op = c.op;
        if (op === '=') op = '==';
        fsConstraints.push(where(c.field, op, c.value));
      } else if (c.type === 'orderBy') {
        fsConstraints.push(orderBy(c.field, c.dir || 'asc'));
      } else if (c.type === 'limit') {
        fsConstraints.push(limit(c.value));
      }
    }
    return query(colRef, ...fsConstraints);
  }

  private formatFirestoreValue(val: any): any {
    if (val === null || val === undefined) return val;
    if (val instanceof Timestamp) {
      const d = val.toDate();
      return {
        toDate: () => d,
        toMillis: () => d.getTime(),
        toISOString: () => d.toISOString(),
        _isTimestamp: true
      };
    }
    if (typeof val === 'object') {
      if (typeof val.toDate === 'function') {
        const d = val.toDate();
        return {
          toDate: () => d,
          toMillis: () => d.getTime(),
          toISOString: () => d.toISOString(),
          _isTimestamp: true
        };
      }
      const secs = typeof val.seconds === 'number' ? val.seconds : (typeof val._seconds === 'number' ? val._seconds : null);
      if (secs !== null && !isNaN(secs)) {
        const nanos = typeof val.nanoseconds === 'number' ? val.nanoseconds : (typeof val._nanoseconds === 'number' ? val._nanoseconds : 0);
        const d = new Date(secs * 1000 + nanos / 1000000);
        if (!isNaN(d.getTime())) {
          return {
            toDate: () => d,
            toMillis: () => d.getTime(),
            toISOString: () => d.toISOString(),
            _isTimestamp: true
          };
        }
      }
      if (val._isTimestamp) {
        return val;
      }
      const formatted: any = Array.isArray(val) ? [] : {};
      Object.keys(val).forEach(key => {
        formatted[key] = this.formatFirestoreValue(val[key]);
      });
      return formatted;
    }
    return val;
  }

  private formatFirestoreData(data: any): any {
    if (!data) return data;
    const formatted = this.formatFirestoreValue(data);

    const knownFields = [
      'createdAt', 'updatedAt', 'timestamp', 'actionDate', 'deliveredAt',
      'output_datetime', 'date', 'blockDate', 'lastLogin', 'lastLogout',
      'created_at', 'updated_at', 'last_login', 'last_logout',
      'exitDate', 'entryDate', 'issueDate', 'deliveryDate'
    ];

    const wrapRecursively = (obj: any) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(wrapRecursively);
        return;
      }
      if (typeof obj !== 'object') return;

      Object.keys(obj).forEach(field => {
        const val = obj[field];
        if (val === null || val === undefined) return;

        const lower = field.toLowerCase();
        const isDateField = knownFields.includes(field) || lower.includes('date') || lower.includes('time') || lower.includes('timestamp') || lower.includes('created') || lower.includes('updated') || lower.endsWith('at');

        if (isDateField) {
          const d = parseDate(val);
          if (d && !isNaN(d.getTime())) {
            obj[field] = {
              toDate: () => d,
              toMillis: () => d.getTime(),
              toISOString: () => d.toISOString(),
              _isTimestamp: true
            };
          }
        } else if (typeof val === 'object') {
          const d = parseDate(val);
          if (d && !isNaN(d.getTime())) {
            obj[field] = {
              toDate: () => d,
              toMillis: () => d.getTime(),
              toISOString: () => d.toISOString(),
              _isTimestamp: true
            };
          } else {
            wrapRecursively(val);
          }
        }
      });
    };

    wrapRecursively(formatted);
    return formatted;
  }

  async auditMissingIds(collectionsList?: string[]): Promise<Array<{ collection: string; id: string; name?: string }>> {
    const list = collectionsList || [
      'customers',
      'invoices',
      'invoice_items',
      'vault_transactions',
      'inventory_items',
      'device_categories',
      'device_models',
      'engineers',
      'fin_funds',
      'fin_transaction_types',
      'maintenance_actions',
      'approval_actions',
      'parts_catalog',
      'shop_parts_inventory',
      'disassembly_batches'
    ];
    const missing: Array<{ collection: string; id: string; name?: string }> = [];
    const database = this.getDb();

    for (const col of list) {
      try {
        const snap = await fsGetDocs(collection(database, col));
        for (const docSnap of snap.docs) {
          const raw = docSnap.data();
          if (!raw || !raw.id || raw.id !== docSnap.id) {
            missing.push({
              collection: col,
              id: docSnap.id,
              name: raw?.name || raw?.customerName || raw?.itemName || raw?.invoiceNumber || docSnap.id
            });
          }
        }
      } catch (err) {
        console.warn(`Could not audit collection ${col} for missing IDs:`, err);
      }
    }
    return missing;
  }

  async fixMissingIds(itemsToFix?: Array<{ collection: string; id: string }>): Promise<number> {
    const database = this.getDb();
    const items = itemsToFix || (await this.auditMissingIds());
    let fixedCount = 0;

    // Use batches of up to 400 writes for speed and safety
    const batchSize = 400;
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const batch = fsWriteBatch(database);
      for (const it of chunk) {
        const docRef = doc(database, it.collection, it.id);
        batch.set(docRef, { id: it.id }, { merge: true });
      }
      await batch.commit();
      fixedCount += chunk.length;
    }

    return fixedCount;
  }

  async auditMissingItemEntryDates(
    preloadedCloudItems?: any[],
    preloadedCloudInvoices?: any[]
  ): Promise<Array<{
    id: string;
    invoiceId: string;
    invoiceNumber: string;
    deviceName: string;
    deviceType: string;
    resolvedInvoiceDate: string;
    currentEntryDate?: string;
  }>> {
    const missing: Array<{
      id: string;
      invoiceId: string;
      invoiceNumber: string;
      deviceName: string;
      deviceType: string;
      resolvedInvoiceDate: string;
      currentEntryDate?: string;
    }> = [];

    const database = this.getDb();

    let items = preloadedCloudItems;
    if (!items) {
      try {
        const snap = await fsGetDocs(collection(database, 'invoice_items'));
        items = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch (err) {
        console.warn('Could not query invoice_items for missing entry dates:', err);
        return [];
      }
    }

    let invoices = preloadedCloudInvoices;
    if (!invoices) {
      try {
        const snap = await fsGetDocs(collection(database, 'invoices'));
        invoices = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch (err) {
        console.warn('Could not query invoices for missing entry dates:', err);
        invoices = [];
      }
    }

    const invoicesById = new Map<string, any>();
    const invoicesByNumber = new Map<string, any>();

    (invoices || []).forEach((inv: any) => {
      if (inv.id) invoicesById.set(String(inv.id), inv);
      if (inv.invoiceNumber) {
        const rawNo = String(inv.invoiceNumber);
        const cleanNo = rawNo.replace('#', '').trim();
        invoicesByNumber.set(rawNo, inv);
        invoicesByNumber.set(cleanNo, inv);
      }
    });

    for (const item of (items || [])) {
      const entryDateVal = item.entryDate;
      const parsedEntryDate = parseDate(entryDateVal);
      const isMissingEntryDate = !entryDateVal || parsedEntryDate === null || isNaN(parsedEntryDate.getTime());

      if (isMissingEntryDate) {
        const inv = (item.invoiceId && invoicesById.get(String(item.invoiceId))) ||
                    (item.invoiceNumber && invoicesByNumber.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                    (item.invoiceNumber && invoicesByNumber.get(String(item.invoiceNumber))) ||
                    null;

        const dateCandidates = [
          inv?.createdAt,
          inv?.date,
          inv?.issueDate,
          inv?.entryDate,
          item.createdAt,
          item.date,
          inv?.updatedAt,
          item.updatedAt
        ];

        let resolvedDateStr = new Date().toISOString();
        for (const cand of dateCandidates) {
          if (cand !== undefined && cand !== null && cand !== '') {
            const parsed = parseDate(cand);
            if (parsed && !isNaN(parsed.getTime())) {
              resolvedDateStr = parsed.toISOString();
              break;
            }
          }
        }

        missing.push({
          id: item.id,
          invoiceId: item.invoiceId || inv?.id || '',
          invoiceNumber: item.invoiceNumber || inv?.invoiceNumber || '---',
          deviceName: item.deviceName || item.deviceType || 'جهاز بدون اسم',
          deviceType: item.deviceType || 'عام',
          resolvedInvoiceDate: resolvedDateStr,
          currentEntryDate: item.entryDate || undefined
        });
      }
    }

    return missing;
  }

  async fixMissingItemEntryDates(
    itemsToFix?: Array<{ id: string; resolvedInvoiceDate: string; invoiceId?: string }>
  ): Promise<number> {
    const database = this.getDb();
    const items = itemsToFix || (await this.auditMissingItemEntryDates());
    let fixedCount = 0;

    const batchSize = 400;
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const batch = fsWriteBatch(database);
      for (const it of chunk) {
        if (!it.id) continue;
        const docRef = doc(database, 'invoice_items', it.id);
        batch.set(
          docRef,
          {
            entryDate: it.resolvedInvoiceDate,
            createdAt: it.resolvedInvoiceDate
          },
          { merge: true }
        );
      }
      await batch.commit();
      fixedCount += chunk.length;
    }

    return fixedCount;
  }

  private prepareDataForFirestore(data: any): any {
    if (!data) return data;
    const cleaned = { ...data };
    Object.keys(cleaned).forEach(key => {
      const val = cleaned[key];
      if (val && typeof val === 'object') {
        if (typeof val.toISOString === 'function') {
          try {
            cleaned[key] = val.toISOString();
          } catch (e) {}
        } else if (typeof val.toDate === 'function') {
          try {
            cleaned[key] = val.toDate().toISOString();
          } catch (e) {}
        } else if (val.type === 'increment') {
          cleaned[key] = increment(Number(val.value) || 0);
        } else {
          cleaned[key] = this.prepareDataForFirestore(val);
        }
      }
    });
    return cleaned;
  }
}

export const FirebaseProviderInstance = new FirebaseProvider();
