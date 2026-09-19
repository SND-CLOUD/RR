import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp } from '../firebase';
import { ShieldCheck, RefreshCw, X, AlertTriangle, CheckCircle2, FileText, Users, DollarSign, Database, Sparkles, CheckCircle, Wrench, Layers, Calendar, ShoppingBag } from 'lucide-react';
import { localDb } from '../lib/local-db';
import { FirebaseProviderInstance } from '../data/FirebaseProvider';
import { LocalProviderInstance } from '../data/LocalProvider';
import { parseDate } from '../lib/dateUtils';
import { User, isPurchaseInvoice, isSaleInvoice, isShopMaintenanceItem, isInShopMaintenanceDevice } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { auditOrphanedPartsStock, cleanOrphanedPartsStock } from '../lib/invoiceCascadeService';
import { repairAllFundBalances } from '../lib/fundRepairService';

interface DataAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export default function DataAuditModal({ isOpen, onClose, user }: DataAuditModalProps) {
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResults, setAuditResults] = useState<any | null>(null);
  const [repairProgress, setRepairProgress] = useState<{ status: 'idle' | 'running' | 'completed' | 'error'; message: string }>({
    status: 'idle',
    message: ''
  });

  const getAuditStatusText = (status: string) => {
    const s = String(status || '').toLowerCase().trim();
    if (['10', 'new'].includes(s)) return 'دخول جديد (10)';
    if (['20', 'testing', 'inspected'].includes(s)) return 'قيد الفحص والتشخيص (20)';
    if (s === '21') return 'فحص مرحلي 1 (21)';
    if (s === '22') return 'فحص مرحلي 2 (22)';
    if (['30', 'awaiting_approval'].includes(s)) return 'انتظار الموافقة والقطع (30)';
    if (['35', 'awaiting_parts'].includes(s)) return 'انتظار قطع الغيار (35)';
    if (['40', 'repairing'].includes(s)) return 'قيد الصيانة (40)';
    if (['50', 'ready', 'intact', 'unrepairable', 'refused'].includes(s)) return 'جاهز للتسليم (50)';
    if (['60', 'delivered'].includes(s)) return 'تم التسليم (60)';
    if (['70', 'cancelled'].includes(s)) return 'إلغاء العملية (70)';
    return status || 'غير محدد';
  };

  const normalizeStatusCode = (status: any): string => {
    const s = String(status || '').toLowerCase().trim();
    if (['60', 'delivered'].includes(s)) return '60';
    if (['50', 'ready', 'intact', 'unrepairable', 'refused'].includes(s)) return '50';
    if (['40', 'repairing'].includes(s)) return '40';
    if (['35', 'awaiting_parts'].includes(s)) return '35';
    if (['30', 'awaiting_approval'].includes(s)) return '30';
    if (s === '22') return '22';
    if (s === '21') return '21';
    if (['20', 'testing', 'inspected'].includes(s)) return '20';
    if (['70', 'cancelled'].includes(s)) return '70';
    if (['10', 'new'].includes(s)) return '10';
    return s || '10';
  };

  const deriveExpectedInvoiceStatus = (items: any[], currentInvStatus: string): string => {
    if (!items || items.length === 0) return currentInvStatus || '10';

    const normalizedItems = items.map(it => normalizeStatusCode(it.status));

    if (normalizedItems.every(st => st === '60')) {
      return currentInvStatus === 'delivered' ? 'delivered' : '60';
    }

    if (normalizedItems.every(st => st === '70')) {
      return '70';
    }

    const activeItems = normalizedItems.filter(st => st !== '70');
    const itemsToEvaluate = activeItems.length > 0 ? activeItems : normalizedItems;

    if (itemsToEvaluate.every(st => st === '50' || st === '60')) {
      return currentInvStatus === 'ready' ? 'ready' : '50';
    }

    const numericRanks: Record<string, number> = {
      '10': 10,
      '20': 20,
      '21': 21,
      '22': 22,
      '30': 30,
      '35': 35,
      '40': 40
    };

    let maxRank = 0;
    let maxCode = '10';

    itemsToEvaluate.forEach(st => {
      const rank = numericRanks[st] || 10;
      if (rank > maxRank) {
        maxRank = rank;
        maxCode = st;
      }
    });

    if (maxCode === '40' && currentInvStatus === 'repairing') return 'repairing';
    if (maxCode === '20' && (currentInvStatus === 'testing' || currentInvStatus === 'inspected')) return currentInvStatus;
    if (maxCode === '10' && currentInvStatus === 'new') return 'new';

    return maxCode;
  };

  const runDatabaseAudit = async () => {
    setIsAuditing(true);
    setRepairProgress({ status: 'idle', message: '' });

    try {
      const invoicesRes = await localDb.query('SELECT * FROM invoices');
      const dbInvoices = invoicesRes.values || [];
      
      const itemsRes = await localDb.query('SELECT * FROM invoice_items');
      const dbItems = itemsRes.values || [];
      
      const txRes = await localDb.query('SELECT * FROM vault_transactions');
      const dbTransactions = txRes.values || [];
      
      const customersRes = await localDb.query('SELECT * FROM customers');
      const dbCustomers = customersRes.values || [];

      // Query Cloud DB records for cross-database alignment check if connected
      let cloudItems: any[] = [];
      let cloudInvoices: any[] = [];
      let cloudTransactions: any[] = [];
      let missingCloudIds: any[] = [];
  
      try {
        const cloudItemsSnap = await FirebaseProviderInstance.getDocs('invoice_items');
        cloudItems = cloudItemsSnap.docs ? cloudItemsSnap.docs.map((d: any) => d.data()) : (cloudItemsSnap || []);
        
        const cloudInvoicesSnap = await FirebaseProviderInstance.getDocs('invoices');
        cloudInvoices = cloudInvoicesSnap.docs ? cloudInvoicesSnap.docs.map((d: any) => d.data()) : (cloudInvoicesSnap || []);

        const cloudTxsSnap = await FirebaseProviderInstance.getDocs('vault_transactions');
        cloudTransactions = cloudTxsSnap.docs ? cloudTxsSnap.docs.map((d: any) => d.data()) : (cloudTxsSnap || []);

        missingCloudIds = await FirebaseProviderInstance.auditMissingIds();
      } catch (cErr) {
        console.warn('Cloud database unreachable or offline during audit:', cErr);
      }

      // Check missing / mismatched invoice_items between Cloud & Local
      const itemSyncDiscrepancies: any[] = [];
      const missingInCloudItems: any[] = [];
      const missingInLocalItems: any[] = [];

      if (cloudItems.length > 0 || cloudInvoices.length > 0) {
        const localItemsById = new Map(dbItems.map((it: any) => [it.id, it]));
        const cloudItemsById = new Map(cloudItems.map((it: any) => [it.id, it]));

        dbItems.forEach((it: any) => {
          if (!cloudItemsById.has(it.id)) {
            missingInCloudItems.push(it);
          }
        });

        cloudItems.forEach((it: any) => {
          if (!localItemsById.has(it.id)) {
            missingInLocalItems.push(it);
          }
        });

        const localItemsByInv: Record<string, any[]> = {};
        dbItems.forEach((it: any) => {
          if (!localItemsByInv[it.invoiceId]) localItemsByInv[it.invoiceId] = [];
          localItemsByInv[it.invoiceId].push(it);
        });

        const cloudItemsByInv: Record<string, any[]> = {};
        cloudItems.forEach((it: any) => {
          if (!cloudItemsByInv[it.invoiceId]) cloudItemsByInv[it.invoiceId] = [];
          cloudItemsByInv[it.invoiceId].push(it);
        });

        const allInvIds = new Set([...Object.keys(localItemsByInv), ...Object.keys(cloudItemsByInv)]);
        allInvIds.forEach((invId) => {
          const lCount = (localItemsByInv[invId] || []).length;
          const cCount = (cloudItemsByInv[invId] || []).length;
          if (lCount !== cCount) {
            const parentInv = dbInvoices.find((i: any) => i.id === invId) || cloudInvoices.find((i: any) => i.id === invId);
            itemSyncDiscrepancies.push({
              id: invId,
              invoiceNumber: parentInv?.invoiceNumber || 'غير معروف',
              localCount: lCount,
              cloudCount: cCount
            });
          }
        });
      }

      // Reconcile vault_transactions between Cloud & Local
      const missingInCloudTransactions: any[] = [];
      const missingInLocalTransactions: any[] = [];
      const localTxIds = new Set(dbTransactions.map((t: any) => t.id).filter(Boolean));
      const cloudTxIds = new Set(cloudTransactions.map((t: any) => t.id).filter(Boolean));

      cloudTransactions.forEach((tx: any) => {
        if (tx.id && !localTxIds.has(tx.id)) {
          missingInLocalTransactions.push(tx);
        }
      });
      dbTransactions.forEach((tx: any) => {
        if (tx.id && !cloudTxIds.has(tx.id)) {
          missingInCloudTransactions.push(tx);
        }
      });

      // Unified transactions pool for financial matching
      const allTxMap = new Map<string, any>();
      dbTransactions.forEach((tx: any) => {
        if (tx.id) allTxMap.set(tx.id, tx);
      });
      cloudTransactions.forEach((tx: any) => {
        if (tx.id) {
          if (!allTxMap.has(tx.id)) {
            allTxMap.set(tx.id, tx);
          } else {
            allTxMap.set(tx.id, { ...allTxMap.get(tx.id), ...tx });
          }
        }
      });
      const allTransactions = Array.from(allTxMap.values());

      const settingsDoc = await getDoc(doc(db, 'settings', 'app'));
      const settingsData = settingsDoc.data();
      const registeredLastInvoice = Number(settingsData?.lastInvoiceNumber) || 0;
      const registeredLastOtherInvoice = Number(settingsData?.lastOtherInvoiceNumber) || 0;
      const registeredLastCustomer = Number(settingsData?.lastCustomerNumber) || 0;

      const normalizeInvNum = (num: any) => String(num || '').replace(/^[#\s]+/, '').replace(/\s+/g, '').trim().toUpperCase();

      let maxInvoiceNum = 0;
      const missingInvoiceNumbers: any[] = [];
      let maxOtherInvoiceNum = 0;
      const missingOtherInvoiceNumbers: any[] = [];
      dbInvoices.forEach((inv: any) => {
        const invNumStr = String(inv.invoiceNumber || '').trim();
        const isMissingOrInvalid = !invNumStr || invNumStr === '0' || invNumStr === 'NaN' || invNumStr === 'undefined';
        const isPurchase = isPurchaseInvoice(inv);
        
        if (isMissingOrInvalid) {
          const t = inv.invoiceType || inv.templateType || inv.type || '';
          if (isPurchase || t === 'sale_software' || t === 'sale_parts' || t === 'sale_maintenance' || t.startsWith('sale_') || t === 'software' || t === 'parts' || t === 'maintenance') {
            missingOtherInvoiceNumbers.push(inv);
          } else {
            missingInvoiceNumbers.push(inv);
          }
        } else {
          if (invNumStr.startsWith('O-')) {
            const num = parseInt(invNumStr.replace(/^O-/, ''), 10);
            if (!isNaN(num) && num > maxOtherInvoiceNum) {
              maxOtherInvoiceNum = num;
            }
          } else if (!invNumStr.startsWith('PUR-') && !invNumStr.startsWith('DIS-')) {
            const num = parseInt(invNumStr, 10);
            if (!isNaN(num) && num > maxInvoiceNum) {
              maxInvoiceNum = num;
            }
          }
        }
      });

      let maxCustomerNum = 0;
      const missingCustomerNumbers: any[] = [];
      dbCustomers.forEach((cust: any) => {
        const custNumStr = String(cust.customerNumber || '').trim();
        const isMissingOrInvalid = !custNumStr || custNumStr === '0' || custNumStr === 'NaN' || custNumStr === 'undefined';
        
        if (isMissingOrInvalid) {
          missingCustomerNumbers.push(cust);
        } else {
          const num = parseInt(custNumStr, 10);
          if (!isNaN(num) && num > maxCustomerNum) {
            maxCustomerNum = num;
          }
        }
      });

      const invoiceCounterConflict = registeredLastInvoice !== maxInvoiceNum || missingInvoiceNumbers.length > 0;
      const otherInvoiceCounterConflict = registeredLastOtherInvoice !== maxOtherInvoiceNum || missingOtherInvoiceNumbers.length > 0;
      const customerCounterConflict = registeredLastCustomer !== maxCustomerNum || missingCustomerNumbers.length > 0;

      const totalDiscrepancies: any[] = [];
      const statusDiscrepancies: any[] = [];

      const invoiceItemGroups: Record<string, any[]> = {};
      dbItems.forEach((item: any) => {
        if (!invoiceItemGroups[item.invoiceId]) {
          invoiceItemGroups[item.invoiceId] = [];
        }
        invoiceItemGroups[item.invoiceId].push(item);
      });

      dbInvoices.forEach((inv: any) => {
        const isPurchase = isPurchaseInvoice(inv);
        const isSale = isSaleInvoice(inv);
        const isOtherService = isPurchase || isSale;

        if (isOtherService) return;

        const allItems = invoiceItemGroups[inv.id] || [];
        const items = allItems.filter((it: any) => isShopMaintenanceItem(it, inv));
        const computedTotal = allItems.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
        
        // Do NOT flag or recompute total cost for purchase or other service invoices based on items
        if (allItems.length > 0 && Math.abs(computedTotal - Number(inv.totalCost || 0)) > 0.01) {
          totalDiscrepancies.push({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            currentTotal: inv.totalCost,
            computedTotal
          });
        }

        // Only derive maintenance workflow status for actual shop maintenance invoices with maintenance items
        if (items.length > 0) {
          const expectedStatus = deriveExpectedInvoiceStatus(items, inv.status);

          if (inv.status !== expectedStatus) {
            statusDiscrepancies.push({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              currentStatus: inv.status,
              expectedStatus
            });
          }
        }
      });

      const paymentImbalances: any[] = [];
      const txGroupsByInvoiceNum: Record<string, any[]> = {};
      const txGroupsByInvoiceId: Record<string, any[]> = {};

      allTransactions.forEach((tx: any) => {
        if (tx.isReversed || tx.isReversal || tx.status === 'reversed' || tx.status === 'reversal') return;
        if (tx.type === 'receipt' || tx.type === 'payment' || tx.type === 'invoice_payment') {
          if (tx.invoiceNumber) {
            const invNum = normalizeInvNum(tx.invoiceNumber);
            if (invNum) {
              if (!txGroupsByInvoiceNum[invNum]) {
                txGroupsByInvoiceNum[invNum] = [];
              }
              txGroupsByInvoiceNum[invNum].push(tx);
            }
          }
          if (tx.invoiceId) {
            if (!txGroupsByInvoiceId[tx.invoiceId]) {
              txGroupsByInvoiceId[tx.invoiceId] = [];
            }
            txGroupsByInvoiceId[tx.invoiceId].push(tx);
          }
        }
      });

      dbInvoices.forEach((inv: any) => {
        const invNumNorm = normalizeInvNum(inv.invoiceNumber);
        const txsByNum = (invNumNorm ? txGroupsByInvoiceNum[invNumNorm] : []) || [];
        const txsById = (inv.id ? txGroupsByInvoiceId[inv.id] : []) || [];
        
        // Merge unique transactions linked to this invoice
        const uniqueTxMap = new Map<string, any>();
        [...txsByNum, ...txsById].forEach((tx: any) => {
          if (tx.id) uniqueTxMap.set(tx.id, tx);
        });
        const txs = Array.from(uniqueTxMap.values());

        const computedPaid = txs.reduce((sum, tx) => {
          const val = (tx.liabilityAmount !== undefined && tx.liabilityAmount !== null && !isNaN(Number(tx.liabilityAmount)))
            ? Number(tx.liabilityAmount)
            : Math.abs(Number(tx.amount || 0));
          return sum + val;
        }, 0);

        if (Math.abs(computedPaid - Number(inv.amountPaid || 0)) > 0.01) {
          const isPurchase = isPurchaseInvoice(inv);

          paymentImbalances.push({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            customerName: inv.customerName || inv.supplierName,
            customerId: inv.customerId || inv.supplierId,
            currency: inv.currency,
            amountPaidOnInvoice: Number(inv.amountPaid || 0),
            amountInLedger: computedPaid,
            status: inv.status,
            totalCost: Number(inv.totalCost || 0),
            isPurchase: !!isPurchase,
            notes: inv.notes
          });
        }
      });

      // Detect purchase invoices where totalCost was inadvertently zeroed out
      const corruptedPurchaseInvoices: any[] = [];
      dbInvoices.forEach((inv: any) => {
        const isPurchase = isPurchaseInvoice(inv);
        if (isPurchase) {
          const totalCostNum = Number(inv.totalCost || 0);
          const amountPaidNum = Number(inv.amountPaid || 0);
          const batchCostNum = Number(inv.batchTotalCost || 0);
          if (totalCostNum === 0 && (amountPaidNum > 0 || batchCostNum > 0)) {
            corruptedPurchaseInvoices.push({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              customerName: inv.customerName || inv.supplierName,
              suggestedTotal: batchCostNum > 0 ? batchCostNum : amountPaidNum
            });
          }
        }
      });

      const orphanedItems: any[] = [];
      const invoiceIdsSet = new Set(dbInvoices.map((inv: any) => inv.id));
      const invoiceNumsSet = new Set(dbInvoices.map((inv: any) => normalizeInvNum(inv.invoiceNumber)).filter(Boolean));
      const cloudInvoiceIdsSet = new Set((cloudInvoices || []).map((inv: any) => inv.id));
      const cloudInvoiceNumsSet = new Set((cloudInvoices || []).map((inv: any) => normalizeInvNum(inv.invoiceNumber)).filter(Boolean));

      dbItems.forEach((item: any) => {
        if (!isShopMaintenanceItem(item)) return; // Exclude non-maintenance items (purchases, sales, software, parts)
        const itemInvNumNorm = normalizeInvNum(item.invoiceNumber);
        const hasInvoiceId = invoiceIdsSet.has(item.invoiceId) || cloudInvoiceIdsSet.has(item.invoiceId);
        const hasInvoiceNum = itemInvNumNorm && (invoiceNumsSet.has(itemInvNumNorm) || cloudInvoiceNumsSet.has(itemInvNumNorm));
        
        if (!hasInvoiceId && !hasInvoiceNum) {
          orphanedItems.push(item);
        }
      });

      const emptyInvoices: any[] = [];
      dbInvoices.forEach((inv: any) => {
        const isPurchase = isPurchaseInvoice(inv);
        const isSale = isSaleInvoice(inv);
        if (isPurchase || isSale) return; // NEVER delete purchase or sales/service invoices as empty!
        const items = invoiceItemGroups[inv.id] || [];
        const itemsByNum = inv.invoiceNumber ? dbItems.filter((it: any) => normalizeInvNum(it.invoiceNumber) === normalizeInvNum(inv.invoiceNumber)) : [];
        if (items.length === 0 && itemsByNum.length === 0 && Number(inv.totalCost || 0) === 0) {
          emptyInvoices.push(inv);
        }
      });

      // Audit missing device entry dates across Cloud and Local
      const allInvoicesMap = new Map<string, any>();
      const allInvoicesByNum = new Map<string, any>();
      [...dbInvoices, ...cloudInvoices].forEach((inv: any) => {
        if (inv.id) allInvoicesMap.set(String(inv.id), inv);
        if (inv.invoiceNumber) {
          const rawNo = String(inv.invoiceNumber);
          const cleanNo = rawNo.replace('#', '').trim();
          allInvoicesByNum.set(rawNo, inv);
          allInvoicesByNum.set(cleanNo, inv);
        }
      });

      const combinedItemsMap = new Map<string, any>();
      dbItems.forEach((it: any) => combinedItemsMap.set(it.id, { ...it, _source: 'local' }));
      cloudItems.forEach((it: any) => {
        if (!combinedItemsMap.has(it.id)) {
          combinedItemsMap.set(it.id, { ...it, _source: 'cloud' });
        } else {
          const existing = combinedItemsMap.get(it.id);
          combinedItemsMap.set(it.id, { ...existing, ...it });
        }
      });

      const itemsWithoutEntryDate: any[] = [];
      combinedItemsMap.forEach((item: any) => {
        const inv = (item.invoiceId && allInvoicesMap.get(String(item.invoiceId))) ||
                    (item.invoiceNumber && allInvoicesByNum.get(String(item.invoiceNumber).replace('#', '').trim())) ||
                    (item.invoiceNumber && allInvoicesByNum.get(String(item.invoiceNumber))) ||
                    null;

        // Only evaluate shop maintenance items for missing workshop entry dates
        if (!isShopMaintenanceItem(item, inv)) return;

        const parsed = parseDate(item.entryDate);
        const isMissing = !item.entryDate || parsed === null || isNaN(parsed.getTime());

        if (isMissing) {
          const candidates = [
            inv?.createdAt,
            inv?.date,
            inv?.issueDate,
            inv?.entryDate,
            item?.createdAt,
            item?.date,
            inv?.updatedAt,
            item?.updatedAt
          ];

          let resolvedDate: Date | null = null;
          for (const cand of candidates) {
            if (cand !== undefined && cand !== null && cand !== '') {
              const d = parseDate(cand);
              if (d && !isNaN(d.getTime())) {
                resolvedDate = d;
                break;
              }
            }
          }

          const resolvedIso = resolvedDate ? resolvedDate.toISOString() : new Date().toISOString();
          const formattedDate = resolvedDate ? resolvedDate.toLocaleDateString('ar-YE') : new Date().toLocaleDateString('ar-YE');

          itemsWithoutEntryDate.push({
            id: item.id,
            invoiceId: item.invoiceId || inv?.id || '',
            invoiceNumber: item.invoiceNumber || inv?.invoiceNumber || '---',
            deviceName: item.deviceName || item.deviceType || 'جهاز بدون اسم',
            deviceType: item.deviceType || 'عام',
            resolvedInvoiceDate: resolvedIso,
            displayDate: formattedDate,
            source: item._source || 'both'
          });
        }
      });

      let orphanedStockParts: any[] = [];
      let orphanedBatches: any[] = [];
      try {
        const orphanRes = await auditOrphanedPartsStock();
        orphanedStockParts = orphanRes.orphanedItems;
        orphanedBatches = orphanRes.orphanedBatches;
      } catch (e) {
        console.warn('auditOrphanedPartsStock warning:', e);
      }

      setAuditResults({
        lastChecked: new Date(),
        invoiceCounter: {
          registered: registeredLastInvoice,
          actualMax: maxInvoiceNum,
          conflict: invoiceCounterConflict
        },
        otherInvoiceCounter: {
          registered: registeredLastOtherInvoice,
          actualMax: maxOtherInvoiceNum,
          conflict: otherInvoiceCounterConflict
        },
        customerCounter: {
          registered: registeredLastCustomer,
          actualMax: maxCustomerNum,
          conflict: customerCounterConflict
        },
        missingInvoiceNumbers,
        missingOtherInvoiceNumbers,
        missingCustomerNumbers,
        totalDiscrepancies,
        statusDiscrepancies,
        paymentImbalances,
        orphanedItems,
        orphanedStockParts,
        orphanedBatches,
        emptyInvoices,
        itemSyncDiscrepancies,
        missingInCloudItems,
        missingInLocalItems,
        missingInCloudTransactions,
        missingInLocalTransactions,
        corruptedPurchaseInvoices,
        missingCloudIds,
        itemsWithoutEntryDate
      });
    } catch (e: any) {
      console.error('Audit calculations failed:', e);
    } finally {
      setIsAuditing(false);
    }
  };

  const repairMaintenanceInvoiceCounter = async () => {
    if (!auditResults) return;
    setRepairProgress({ status: 'running', message: 'جاري ترقيم وتصحيح عدّاد فواتير الصيانة...' });
    try {
      const itemsRes = await localDb.query('SELECT * FROM invoice_items');
      const dbItems = itemsRes.values || [];
      let currentMax = auditResults.invoiceCounter.actualMax;
      if (auditResults.missingInvoiceNumbers && auditResults.missingInvoiceNumbers.length > 0) {
        for (const inv of auditResults.missingInvoiceNumbers) {
          currentMax++;
          try {
            await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: String(currentMax) });
          } catch (e) {}
          try {
            await localDb.run("UPDATE invoices SET invoiceNumber = ? WHERE id = ?", [String(currentMax), inv.id]);
            await LocalProviderInstance.updateDoc('invoices', inv.id, { invoiceNumber: String(currentMax) });
          } catch (e) {}
          const matchingItems = dbItems.filter((it: any) => it.invoiceId === inv.id);
          for (const item of matchingItems) {
            try {
              await updateDoc(doc(db, 'invoice_items', item.id), { invoiceNumber: String(currentMax) });
            } catch (e) {}
            try {
              await localDb.run("UPDATE invoice_items SET invoiceNumber = ? WHERE id = ?", [String(currentMax), item.id]);
              await LocalProviderInstance.updateDoc('invoice_items', item.id, { invoiceNumber: String(currentMax) });
            } catch (e) {}
          }
        }
      }
      try {
        await setDoc(doc(db, 'settings', 'app'), { lastInvoiceNumber: currentMax }, { merge: true });
      } catch (e) {}
      try {
        await localDb.run("UPDATE system_settings SET value = ? WHERE key = 'lastInvoiceNumber'", [String(currentMax)]);
      } catch (e) {}
      setRepairProgress({ status: 'completed', message: `تم تصحيح عدّاد فواتير الصيانة إلى (${currentMax}) بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل تصحيح عداد فواتير الصيانة: ${err?.message || err}` });
    }
  };

  const repairOtherInvoiceCounter = async () => {
    if (!auditResults) return;
    setRepairProgress({ status: 'running', message: 'جاري ترقيم وتصحيح عدّاد فواتير المبيعات والخدمات...' });
    try {
      const itemsRes = await localDb.query('SELECT * FROM invoice_items');
      const dbItems = itemsRes.values || [];
      let currentMax = auditResults.otherInvoiceCounter?.actualMax || 0;
      if (auditResults.missingOtherInvoiceNumbers && auditResults.missingOtherInvoiceNumbers.length > 0) {
        for (const inv of auditResults.missingOtherInvoiceNumbers) {
          currentMax++;
          const newNum = `O-${currentMax}`;
          try {
            await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: newNum });
          } catch (e) {}
          try {
            await localDb.run("UPDATE invoices SET invoiceNumber = ? WHERE id = ?", [newNum, inv.id]);
            await LocalProviderInstance.updateDoc('invoices', inv.id, { invoiceNumber: newNum });
          } catch (e) {}
          const matchingItems = dbItems.filter((it: any) => it.invoiceId === inv.id);
          for (const item of matchingItems) {
            try {
              await updateDoc(doc(db, 'invoice_items', item.id), { invoiceNumber: newNum });
            } catch (e) {}
            try {
              await localDb.run("UPDATE invoice_items SET invoiceNumber = ? WHERE id = ?", [newNum, item.id]);
              await LocalProviderInstance.updateDoc('invoice_items', item.id, { invoiceNumber: newNum });
            } catch (e) {}
          }
        }
      }
      try {
        await setDoc(doc(db, 'settings', 'app'), { lastOtherInvoiceNumber: currentMax }, { merge: true });
      } catch (e) {}
      try {
        await localDb.run("UPDATE system_settings SET value = ? WHERE key = 'lastOtherInvoiceNumber'", [String(currentMax)]);
      } catch (e) {}
      setRepairProgress({ status: 'completed', message: `تم تصحيح عدّاد فواتير المبيعات إلى (${currentMax}) بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل تصحيح عداد فواتير المبيعات: ${err?.message || err}` });
    }
  };

  const repairCustomerCounter = async () => {
    if (!auditResults) return;
    setRepairProgress({ status: 'running', message: 'جاري ترقيم وتصحيح عدّاد العملاء...' });
    try {
      let currentMax = auditResults.customerCounter.actualMax;
      if (auditResults.missingCustomerNumbers && auditResults.missingCustomerNumbers.length > 0) {
        for (const cust of auditResults.missingCustomerNumbers) {
          currentMax++;
          try {
            await updateDoc(doc(db, 'customers', cust.id), { customerNumber: currentMax });
          } catch (e) {}
          try {
            await localDb.run("UPDATE customers SET customerNumber = ? WHERE id = ?", [currentMax, cust.id]);
            await LocalProviderInstance.updateDoc('customers', cust.id, { customerNumber: currentMax });
          } catch (e) {}
        }
      }
      try {
        await setDoc(doc(db, 'settings', 'app'), { lastCustomerNumber: currentMax }, { merge: true });
      } catch (e) {}
      try {
        await localDb.run("UPDATE system_settings SET value = ? WHERE key = 'lastCustomerNumber'", [String(currentMax)]);
      } catch (e) {}
      setRepairProgress({ status: 'completed', message: `تم تصحيح عدّاد العملاء إلى (${currentMax}) بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل تصحيح عداد العملاء: ${err?.message || err}` });
    }
  };

  const repairInvoiceTotals = async (targetInvoiceId?: string) => {
    if (!auditResults) return;
    setRepairProgress({ 
      status: 'running', 
      message: targetInvoiceId 
        ? 'جاري تصحيح إجمالي الفاتورة المحددة...' 
        : `جاري إعادة احتساب ومطابقة مجاميع ${auditResults.totalDiscrepancies.length} فواتير...` 
    });
    try {
      const localItemsSnap = await LocalProviderInstance.getDocs('invoice_items');
      const localItems = localItemsSnap.docs ? localItemsSnap.docs.map((d: any) => d.data()) : (localItemsSnap || []);
      
      const localInvoicesSnap = await LocalProviderInstance.getDocs('invoices');
      const localInvoices = localInvoicesSnap.docs ? localInvoicesSnap.docs.map((d: any) => d.data()) : (localInvoicesSnap || []);

      let count = 0;
      for (const inv of localInvoices) {
        if (targetInvoiceId && inv.id !== targetInvoiceId) continue;
        if (!targetInvoiceId && !auditResults.totalDiscrepancies.some((d: any) => d.id === inv.id)) continue;

        const isPurchase = isPurchaseInvoice(inv);
        const explicitType = String(inv.invoiceType || inv.templateType || inv.type || '').toLowerCase();
        const isOtherService = explicitType.startsWith('sale_') || isPurchase;
        if (isOtherService) continue;

        const invItems = localItems.filter((it: any) => it.invoiceId === inv.id);
        if (invItems.length > 0) {
          const sumCost = invItems.reduce((sum: number, it: any) => sum + (Number(it.cost) || 0), 0);

          if (Math.abs(Number(inv.totalCost) - sumCost) > 0.01) {
            await LocalProviderInstance.updateDoc('invoices', inv.id, { totalCost: sumCost });
            try {
              await localDb.run("UPDATE invoices SET totalCost = ? WHERE id = ?", [sumCost, inv.id]);
            } catch (e) {}
            try {
              await FirebaseProviderInstance.updateDoc('invoices', inv.id, { totalCost: sumCost });
            } catch (e) {}
            count++;
          }
        }
      }

      setRepairProgress({ status: 'completed', message: `تمت تسوية وتحديث إجمالي ${count > 0 ? count : 1} فاتورة صيانة بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل تصحيح مجاميع الفواتير: ${err?.message || err}` });
    }
  };

  const repairCloudLocalSync = async () => {
    if (!auditResults) return;
    setRepairProgress({ status: 'running', message: 'جاري توحيد ومزامنة السجلات والقيود المالية بين السحابي والمحلي...' });
    try {
      for (const item of (auditResults.missingInCloudItems || [])) {
        await FirebaseProviderInstance.setDoc('invoice_items', item.id, item);
        const localInvRes = await LocalProviderInstance.getDoc('invoices', item.invoiceId);
        if (localInvRes.exists()) {
          await FirebaseProviderInstance.setDoc('invoices', item.invoiceId, localInvRes.data(), { merge: true });
        }
      }

      for (const item of (auditResults.missingInLocalItems || [])) {
        await LocalProviderInstance.setDoc('invoice_items', item.id, item, undefined, 'BYPASS_OUTBOX');
        const cloudInvRes = await FirebaseProviderInstance.getDoc('invoices', item.invoiceId);
        if (cloudInvRes.exists()) {
          await LocalProviderInstance.setDoc('invoices', item.invoiceId, cloudInvRes.data(), undefined, 'BYPASS_OUTBOX');
        }
      }

      for (const tx of (auditResults.missingInCloudTransactions || [])) {
        try {
          await FirebaseProviderInstance.setDoc('vault_transactions', tx.id, tx, { merge: true });
        } catch (e) {}
      }

      for (const tx of (auditResults.missingInLocalTransactions || [])) {
        try {
          await LocalProviderInstance.setDoc('vault_transactions', tx.id, tx, undefined, 'BYPASS_OUTBOX');
        } catch (e) {}
      }

      setRepairProgress({ status: 'completed', message: 'تمت مزامنة وتوحيد السجلات بين السحابي والمحلي بنجاح!' });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل توحيد المزامنة: ${err?.message || err}` });
    }
  };

  const repairCorruptedPurchaseInvoices = async () => {
    if (!auditResults?.corruptedPurchaseInvoices || auditResults.corruptedPurchaseInvoices.length === 0) return;
    setRepairProgress({ status: 'running', message: `جاري استعادة وتثبيت قيم ${auditResults.corruptedPurchaseInvoices.length} فواتير شراء وموردين...` });
    try {
      for (const cInv of auditResults.corruptedPurchaseInvoices) {
        await LocalProviderInstance.updateDoc('invoices', cInv.id, { totalCost: cInv.suggestedTotal });
        try {
          await localDb.run("UPDATE invoices SET totalCost = ? WHERE id = ?", [cInv.suggestedTotal, cInv.id]);
        } catch (e) {}
        try {
          await FirebaseProviderInstance.updateDoc('invoices', cInv.id, { totalCost: cInv.suggestedTotal });
        } catch (e) {}
      }
      setRepairProgress({ status: 'completed', message: `تم استعادة قيم فواتير الشراء لـ ${auditResults.corruptedPurchaseInvoices.length} فاتورة بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل استعادة فواتير الشراء: ${err?.message || err}` });
    }
  };

  const repairStatusDiscrepancies = async (targetInvoiceId?: string) => {
    if (!auditResults?.statusDiscrepancies || auditResults.statusDiscrepancies.length === 0) return;
    setRepairProgress({ 
      status: 'running', 
      message: targetInvoiceId 
        ? 'جاري تحديث الحالة الفنية للفاتورة المحددة...' 
        : `جاري مزامنة الحالة الفنية لـ ${auditResults.statusDiscrepancies.length} فواتير...` 
    });
    try {
      const itemsToFix = targetInvoiceId 
        ? auditResults.statusDiscrepancies.filter((x: any) => x.id === targetInvoiceId)
        : auditResults.statusDiscrepancies;

      for (const item of itemsToFix) {
        try {
          await updateDoc(doc(db, 'invoices', item.id), { status: item.expectedStatus });
        } catch (e) {}
        try {
          await localDb.run("UPDATE invoices SET status = ? WHERE id = ?", [item.expectedStatus, item.id]);
          await LocalProviderInstance.updateDoc('invoices', item.id, { status: item.expectedStatus });
        } catch (e) {}
      }
      setRepairProgress({ status: 'completed', message: `تم تحديث وتصحيح الحالة الفنية لـ ${itemsToFix.length} فاتورة بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل تصحيح الحالة الفنية: ${err?.message || err}` });
    }
  };

  const repairPaymentImbalances = async (targetInvoiceNumber?: string) => {
    if (!auditResults?.paymentImbalances || auditResults.paymentImbalances.length === 0) return;
    setRepairProgress({ 
      status: 'running', 
      message: targetInvoiceNumber 
        ? `جاري موازنة القيود المالية للفاتورة #${targetInvoiceNumber}...` 
        : `جاري موازنة وتسجيل القيود المالية لـ ${auditResults.paymentImbalances.length} حالة...` 
    });
    try {
      let currentVoucherNum = 1000;
      let availableFunds: any[] = [];
      try {
        const vRes = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
        currentVoucherNum = Number(vRes.values?.[0]?.maxNum || 1000);
        const fRes = await localDb.query("SELECT * FROM fin_funds");
        availableFunds = fRes.values || [];
      } catch (err) {}

      const normalizeCurr = (c: string) => {
        const u = (c || '').toUpperCase().trim();
        if (u === 'SAR' || u === 'ر.س' || u === 'سعودي') return 'SAR';
        if (u === 'YER' || u === 'ر.ي' || u === 'يمني') return 'YER';
        if (u === 'USD' || u === '$' || u === 'دولار') return 'USD';
        return u;
      };

      const itemsToFix = targetInvoiceNumber 
        ? auditResults.paymentImbalances.filter((x: any) => String(x.invoiceNumber).trim() === String(targetInvoiceNumber).trim())
        : auditResults.paymentImbalances;

      for (const item of itemsToFix) {
        if (item.amountInLedger === 0 && item.amountPaidOnInvoice > 0) {
          currentVoucherNum++;
          const txId = `tx_audit_${item.invoiceNumber}_${Math.random().toString(36).substring(2, 6)}`;
          const isPurchase = !!item.isPurchase;
          let categoryName = 'إيراد صيانة';
          if (isPurchase) {
            categoryName = 'مشتريات قطع وملحقات';
          } else if (String(item.invoiceNumber).startsWith('O-') || String(item.invoiceNumber).startsWith('S-')) {
            categoryName = 'مبيعات قطع وخدمات';
          }

          const noteText = isPurchase 
            ? `سند صرف مسجل لتسوية ومطابقة المدفوع بفاتورة شراء رقم #${item.invoiceNumber}`
            : (categoryName === 'إيراد صيانة' 
                ? `سند قبض إيراد صيانة لتسوية ومطابقة المدفوع بفاتورة الأجهزة رقم #${item.invoiceNumber}`
                : `سند قبض مبيعات لتسوية ومطابقة المدفوع بالفاتورة رقم #${item.invoiceNumber}`);

          const matchedFund = availableFunds.find((f: any) => f.type === 'cash' && normalizeCurr(f.currency) === normalizeCurr(item.currency)) || availableFunds[0];

          const txData: any = {
            id: txId,
            voucherNumber: currentVoucherNum,
            currency: matchedFund?.currency || item.currency,
            amount: Number(item.amountPaidOnInvoice),
            liabilityCurrency: item.currency,
            liabilityAmount: Number(item.amountPaidOnInvoice),
            receiptCurrency: matchedFund?.currency || item.currency,
            receiptAmount: Number(item.amountPaidOnInvoice),
            fundId: matchedFund ? matchedFund.id : '',
            fundName: matchedFund ? matchedFund.name : 'الصندوق الرئيسي',
            customerName: item.customerName || (isPurchase ? 'مورد نقدي' : 'عميل نقدي'),
            invoiceNumber: String(item.invoiceNumber).trim(),
            invoiceId: item.invoiceId || '',
            type: isPurchase ? 'payment' : 'receipt',
            category: categoryName,
            notes: noteText,
            source: 'audit_repair',
            createdAt: item.createdAt || new Date().toISOString()
          };

          try {
            await FirebaseProviderInstance.setDoc('vault_transactions', txId, txData);
          } catch (e) {}

          try {
            await LocalProviderInstance.setDoc('vault_transactions', txId, txData, undefined, 'BYPASS_OUTBOX');
          } catch (e) {}
        }
      }

      setRepairProgress({ status: 'completed', message: `تمت موازنة القيود المالية لـ ${itemsToFix.length} حالة بنجاح!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل موازنة الصندوق والمدفوعات: ${err?.message || err}` });
    }
  };

  const repairOrphanedAndEmpty = async () => {
    if (!auditResults) return;
    setRepairProgress({ status: 'running', message: 'جاري تنظيف وحذف الفواتير الفارغة والمخزون المعلق...' });
    try {
      if (auditResults.emptyInvoices && auditResults.emptyInvoices.length > 0) {
        for (const inv of auditResults.emptyInvoices) {
          if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) continue;
          try {
            await deleteDoc(doc(db, 'invoices', inv.id));
          } catch (e) {}
          try {
            await LocalProviderInstance.deleteDoc('invoices', inv.id);
          } catch (e) {}
        }
      }

      if ((auditResults.orphanedStockParts && auditResults.orphanedStockParts.length > 0) || (auditResults.orphanedBatches && auditResults.orphanedBatches.length > 0)) {
        await cleanOrphanedPartsStock(
          (auditResults.orphanedStockParts || []).map((x: any) => x.id),
          (auditResults.orphanedBatches || []).map((x: any) => x.id)
        );
      }

      setRepairProgress({ status: 'completed', message: 'تم تنظيف السجلات اليتيمة والفواتير الفارغة بنجاح!' });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      setRepairProgress({ status: 'error', message: `فشل تنظيف السجلات اليتيمة: ${err?.message || err}` });
    }
  };

  const repairCloudDocumentIds = async () => {
    if (!auditResults?.missingCloudIds || auditResults.missingCloudIds.length === 0) return;
    setRepairProgress({ status: 'running', message: `جاري تزويد وتحديث معرّفات ${auditResults.missingCloudIds.length} مستند في السحابة (Firestore)...` });
    try {
      const fixed = await FirebaseProviderInstance.fixMissingIds(auditResults.missingCloudIds);
      setRepairProgress({ status: 'completed', message: `تم تزويد وتحديث معرّف (id) لـ ${fixed} مستند سحابي بنجاح تام!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      console.error('Failed to fix cloud IDs:', err);
      setRepairProgress({ status: 'error', message: `فشل تحديث المعرفات السحابية: ${err?.message || err}` });
    }
  };

  const repairItemsWithoutEntryDate = async () => {
    if (!auditResults?.itemsWithoutEntryDate || auditResults.itemsWithoutEntryDate.length === 0) return;
    setRepairProgress({ status: 'running', message: `جاري إدخال وتحديث تواريخ الدخول لـ ${auditResults.itemsWithoutEntryDate.length} جهاز بناءً على تاريخ الفاتورة...` });
    try {
      const fixed = await FirebaseProviderInstance.fixMissingItemEntryDates(auditResults.itemsWithoutEntryDate);

      // Also update SQLite locally
      for (const it of auditResults.itemsWithoutEntryDate) {
        try {
          await localDb.run(
            "UPDATE invoice_items SET entryDate = ?, createdAt = COALESCE(createdAt, ?) WHERE id = ?",
            [it.resolvedInvoiceDate, it.resolvedInvoiceDate, it.id]
          );
          await LocalProviderInstance.updateDoc('invoice_items', it.id, {
            entryDate: it.resolvedInvoiceDate,
            createdAt: it.resolvedInvoiceDate
          });
        } catch (e) {
          console.warn('Failed local item date update:', e);
        }
      }

      setRepairProgress({ status: 'completed', message: `تم إدخال وتحديث تاريخ الدخول لـ ${auditResults.itemsWithoutEntryDate.length} جهاز بنجاح تام وفقاً لتاريخ الفاتورة!` });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (err: any) {
      console.error('Failed to fix item entry dates:', err);
      setRepairProgress({ status: 'error', message: `فشل تحديث تواريخ الأجهزة: ${err?.message || err}` });
    }
  };

  const repairAllDiscrepancies = async () => {
    if (!auditResults) return;
    setRepairProgress({ status: 'running', message: 'جاري تسوية البيانات وتحديث قواعد الفحص التلقائي...' });

    try {
      const itemsRes = await localDb.query('SELECT * FROM invoice_items');
      const dbItems = itemsRes.values || [];

      let step = 1;
      const totalSteps = 10;

      // Step 1: Fix missing cloud document IDs
      if (auditResults.missingCloudIds && auditResults.missingCloudIds.length > 0) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] تزويد وتحديث معرّفات (id) لـ ${auditResults.missingCloudIds.length} مستند في Firestore بالسحابة...` });
        await FirebaseProviderInstance.fixMissingIds(auditResults.missingCloudIds);
      }
      step++;

      // Step 2: Fix missing device entry dates
      if (auditResults.itemsWithoutEntryDate && auditResults.itemsWithoutEntryDate.length > 0) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] إدخال وتحديث تاريخ الفاتورة لـ ${auditResults.itemsWithoutEntryDate.length} جهاز بدون تاريخ دخول...` });
        await FirebaseProviderInstance.fixMissingItemEntryDates(auditResults.itemsWithoutEntryDate);
        for (const it of auditResults.itemsWithoutEntryDate) {
          try {
            await localDb.run(
              "UPDATE invoice_items SET entryDate = ?, createdAt = COALESCE(createdAt, ?) WHERE id = ?",
              [it.resolvedInvoiceDate, it.resolvedInvoiceDate, it.id]
            );
            await LocalProviderInstance.updateDoc('invoice_items', it.id, {
              entryDate: it.resolvedInvoiceDate,
              createdAt: it.resolvedInvoiceDate
            });
          } catch (e) {}
        }
      }
      step++;

      // Delete empty invoices first so they don't affect max counters (purchase invoices are protected)
      if (auditResults.emptyInvoices && auditResults.emptyInvoices.length > 0) {
        setRepairProgress({ status: 'running', message: `جاري تنظيف وحذف ${auditResults.emptyInvoices.length} فواتير فارغة...` });
        for (const inv of auditResults.emptyInvoices) {
          if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) continue; // Double protection
          await deleteDoc(doc(db, 'invoices', inv.id));
          try {
            await LocalProviderInstance.deleteDoc('invoices', inv.id);
          } catch (e) {}
        }
      }

      // Clean orphaned stock items and batches from deleted purchase invoices
      if ((auditResults.orphanedStockParts && auditResults.orphanedStockParts.length > 0) || (auditResults.orphanedBatches && auditResults.orphanedBatches.length > 0)) {
        setRepairProgress({ status: 'running', message: `جاري تنظيف ${auditResults.orphanedStockParts?.length || 0} قطع مخزون معلقة و ${auditResults.orphanedBatches?.length || 0} دفعات تفكيك...` });
        try {
          await cleanOrphanedPartsStock(
            (auditResults.orphanedStockParts || []).map((x: any) => x.id),
            (auditResults.orphanedBatches || []).map((x: any) => x.id)
          );
        } catch (e) {
          console.warn('cleanOrphanedPartsStock error:', e);
        }
      }

      if (auditResults.invoiceCounter.conflict || (auditResults.missingInvoiceNumbers && auditResults.missingInvoiceNumbers.length > 0)) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] جاري ترقيم وتصحيح عدّاد الفواتير...` });
        let currentMax = auditResults.invoiceCounter.actualMax;
        if (auditResults.missingInvoiceNumbers && auditResults.missingInvoiceNumbers.length > 0) {
          for (const inv of auditResults.missingInvoiceNumbers) {
            currentMax++;
            await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: String(currentMax) });
            const matchingItems = dbItems.filter((it: any) => it.invoiceId === inv.id);
            for (const item of matchingItems) {
              await updateDoc(doc(db, 'invoice_items', item.id), { invoiceNumber: String(currentMax) });
            }
          }
        }
        await setDoc(doc(db, 'settings', 'app'), { lastInvoiceNumber: currentMax }, { merge: true });
      }
      
      if (auditResults.otherInvoiceCounter?.conflict || (auditResults.missingOtherInvoiceNumbers && auditResults.missingOtherInvoiceNumbers.length > 0)) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] جاري ترقيم وتصحيح عدّاد فواتير المبيعات...` });
        let currentMax = auditResults.otherInvoiceCounter.actualMax;
        if (auditResults.missingOtherInvoiceNumbers && auditResults.missingOtherInvoiceNumbers.length > 0) {
          for (const inv of auditResults.missingOtherInvoiceNumbers) {
            currentMax++;
            const newNum = `O-${currentMax}`;
            await updateDoc(doc(db, 'invoices', inv.id), { invoiceNumber: newNum });
            const matchingItems = dbItems.filter((it: any) => it.invoiceId === inv.id);
            for (const item of matchingItems) {
              await updateDoc(doc(db, 'invoice_items', item.id), { invoiceNumber: newNum });
            }
          }
        }
        await setDoc(doc(db, 'settings', 'app'), { lastOtherInvoiceNumber: currentMax }, { merge: true });
      }
      step++;

      if (auditResults.customerCounter.conflict || (auditResults.missingCustomerNumbers && auditResults.missingCustomerNumbers.length > 0)) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] جاري ترقيم وتصحيح عدّاد العملاء...` });
        let currentMax = auditResults.customerCounter.actualMax;
        if (auditResults.missingCustomerNumbers && auditResults.missingCustomerNumbers.length > 0) {
          for (const cust of auditResults.missingCustomerNumbers) {
            currentMax++;
            await updateDoc(doc(db, 'customers', cust.id), { customerNumber: currentMax });
          }
        }
        await setDoc(doc(db, 'settings', 'app'), { lastCustomerNumber: currentMax }, { merge: true });
      }
      step++;

      // Step 5: Sync invoice_items and transactions between Cloud & Local
      if (
        (auditResults.itemSyncDiscrepancies && auditResults.itemSyncDiscrepancies.length > 0) ||
        (auditResults.missingInCloudItems && auditResults.missingInCloudItems.length > 0) ||
        (auditResults.missingInLocalItems && auditResults.missingInLocalItems.length > 0) ||
        (auditResults.missingInCloudTransactions && auditResults.missingInCloudTransactions.length > 0) ||
        (auditResults.missingInLocalTransactions && auditResults.missingInLocalTransactions.length > 0)
      ) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] جاري توحيد ومزامنة السجلات والقيود المالية بين السحابي والمحلي...` });
        
        for (const item of (auditResults.missingInCloudItems || [])) {
          await FirebaseProviderInstance.setDoc('invoice_items', item.id, item);
          const localInvRes = await LocalProviderInstance.getDoc('invoices', item.invoiceId);
          if (localInvRes.exists()) {
            await FirebaseProviderInstance.setDoc('invoices', item.invoiceId, localInvRes.data(), { merge: true });
          }
        }

        for (const item of (auditResults.missingInLocalItems || [])) {
          await LocalProviderInstance.setDoc('invoice_items', item.id, item, undefined, 'BYPASS_OUTBOX');
          const cloudInvRes = await FirebaseProviderInstance.getDoc('invoices', item.invoiceId);
          if (cloudInvRes.exists()) {
            await LocalProviderInstance.setDoc('invoices', item.invoiceId, cloudInvRes.data(), undefined, 'BYPASS_OUTBOX');
          }
        }

        // Sync missing transactions to Cloud Firestore
        for (const tx of (auditResults.missingInCloudTransactions || [])) {
          try {
            await FirebaseProviderInstance.setDoc('vault_transactions', tx.id, tx, { merge: true });
          } catch (e) {}
        }

        // Sync missing transactions to local SQLite
        for (const tx of (auditResults.missingInLocalTransactions || [])) {
          try {
            await LocalProviderInstance.setDoc('vault_transactions', tx.id, tx, undefined, 'BYPASS_OUTBOX');
          } catch (e) {}
        }
      }
      step++;

      // Step 6: Recalculate totals for standard maintenance invoices ONLY (never touch purchase or other service totals!)
      if (auditResults.totalDiscrepancies.length > 0 || (auditResults.itemSyncDiscrepancies && auditResults.itemSyncDiscrepancies.length > 0)) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] إعادة احتساب ومطابقة مجاميع فواتير الصيانة بناءً على أجهزتها الحقيقية...` });
        
        const localItemsSnap = await LocalProviderInstance.getDocs('invoice_items');
        const localItems = localItemsSnap.docs ? localItemsSnap.docs.map((d: any) => d.data()) : (localItemsSnap || []);
        
        const localInvoicesSnap = await LocalProviderInstance.getDocs('invoices');
        const localInvoices = localInvoicesSnap.docs ? localInvoicesSnap.docs.map((d: any) => d.data()) : (localInvoicesSnap || []);

        for (const inv of localInvoices) {
          const isPurchase = isPurchaseInvoice(inv);
          const explicitType = String(inv.invoiceType || inv.templateType || inv.type || '').toLowerCase();
          const isOtherService = explicitType.startsWith('sale_') || isPurchase;
          if (isOtherService) continue; // CRITICAL: NEVER overwrite totalCost on purchase or other service invoices!

          const invItems = localItems.filter((it: any) => it.invoiceId === inv.id);
          if (invItems.length > 0) {
            const sumCost = invItems.reduce((sum: number, it: any) => sum + (Number(it.cost) || 0), 0);
            if (Math.abs(Number(inv.totalCost) - sumCost) > 0.01) {
              await LocalProviderInstance.updateDoc('invoices', inv.id, { totalCost: sumCost });
          
              try {
                await FirebaseProviderInstance.updateDoc('invoices', inv.id, { totalCost: sumCost });
              } catch (e) {}
            }
          }
        }
      }

      // Step 6b: Auto-heal any corrupted purchase invoices where totalCost was zeroed out
      if (auditResults.corruptedPurchaseInvoices && auditResults.corruptedPurchaseInvoices.length > 0) {
        for (const cInv of auditResults.corruptedPurchaseInvoices) {
          try {
            await LocalProviderInstance.updateDoc('invoices', cInv.id, { totalCost: cInv.suggestedTotal });
            await FirebaseProviderInstance.updateDoc('invoices', cInv.id, { totalCost: cInv.suggestedTotal });
          } catch (e) {
            console.warn("Failed restoring purchase invoice totalCost:", e);
          }
        }
      }
      step++;

      if (auditResults.statusDiscrepancies.length > 0) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] مزامنة الحالة الفنية لـ ${auditResults.statusDiscrepancies.length} فواتير...` });
        for (const item of auditResults.statusDiscrepancies) {
          try {
            await updateDoc(doc(db, 'invoices', item.id), { status: item.expectedStatus });
          } catch (e) {
            console.warn("Failed updating cloud invoice status", e);
          }
      
          try {
            await localDb.run("UPDATE invoices SET status = ? WHERE id = ?", [item.expectedStatus, item.id]);
            await LocalProviderInstance.updateDoc('invoices', item.id, { status: item.expectedStatus });
          } catch (e) {
            console.warn("Failed updating local invoice status", e);
          }
        }
      }
      step++;

      if (auditResults.paymentImbalances.length > 0) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] موازنة وتسجيل المعاملات المالية المفقودة لـ ${auditResults.paymentImbalances.length} حالة...` });
        
        let currentVoucherNum = 1000;
        let availableFunds: any[] = [];
        try {
          const vRes = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
          currentVoucherNum = Number(vRes.values?.[0]?.maxNum || 1000);
          const fRes = await localDb.query("SELECT * FROM fin_funds");
          availableFunds = fRes.values || [];
        } catch (err) {
          console.warn("Could not query max voucherNumber or funds, defaulting:", err);
        }

        const normalizeCurr = (c: string) => {
          const u = (c || '').toUpperCase().trim();
          if (u === 'SAR' || u === 'ر.س' || u === 'سعودي') return 'SAR';
          if (u === 'YER' || u === 'ر.ي' || u === 'يمني') return 'YER';
          if (u === 'USD' || u === '$' || u === 'دولار') return 'USD';
          return u;
        };

        for (const item of auditResults.paymentImbalances) {
          if (item.amountInLedger === 0 && item.amountPaidOnInvoice > 0) {
            currentVoucherNum++;
            const txId = `tx_audit_${item.invoiceNumber}_${Math.random().toString(36).substring(2, 6)}`;
            const isPurchase = !!item.isPurchase;
            const txType = isPurchase ? 'payment' : 'receipt';
            
            // Distinguish Maintenance device exit vs Other Sales/Services vs Purchases
            let categoryName = 'إيراد صيانة';
            if (isPurchase) {
              categoryName = 'مشتريات قطع وملحقات';
            } else if (String(item.invoiceNumber).startsWith('O-') || String(item.invoiceNumber).startsWith('S-')) {
              categoryName = 'مبيعات قطع وخدمات';
            }

            const noteText = isPurchase 
              ? `سند صرف مسجل لتسوية ومطابقة المدفوع بفاتورة شراء رقم #${item.invoiceNumber}`
              : (categoryName === 'إيراد صيانة' 
                  ? `سند قبض إيراد صيانة لتسوية ومطابقة المدفوع بفاتورة الأجهزة رقم #${item.invoiceNumber}`
                  : `سند قبض مبيعات لتسوية ومطابقة المدفوع بالفاتورة رقم #${item.invoiceNumber}`);

            const matchedFund = availableFunds.find((f: any) => f.type === 'cash' && normalizeCurr(f.currency) === normalizeCurr(item.currency)) || availableFunds[0];

            const txData: any = {
              id: txId,
              voucherNumber: currentVoucherNum,
              currency: matchedFund?.currency || item.currency,
              amount: Number(item.amountPaidOnInvoice),
              liabilityCurrency: item.currency,
              liabilityAmount: Number(item.amountPaidOnInvoice),
              receiptCurrency: matchedFund?.currency || item.currency,
              receiptAmount: Number(item.amountPaidOnInvoice),
              fundId: matchedFund ? matchedFund.id : '',
              fundName: matchedFund ? matchedFund.name : 'الصندوق الرئيسي',
              customerName: item.customerName || (isPurchase ? 'مورد نقدي' : 'عميل نقدي'),
              customerId: item.customerId || null,
              invoiceNumber: String(item.invoiceNumber),
              userName: user.name || 'المدير العام',
              userNumber: 1,
              userId: user.id || 'primary-admin',
              timestamp: serverTimestamp(),
              type: txType,
              transactionCategory: categoryName,
              notes: noteText,
              statementNote: noteText
            };
            await addDoc(collection(db, 'vault_transactions'), txData);
        
            try {
              await LocalProviderInstance.setDoc('vault_transactions', txId, {
                ...txData,
                timestamp: new Date().toISOString()
              }, undefined, 'BYPASS_OUTBOX');
            } catch (e) {}
          } else if (item.amountInLedger > 0 && item.amountPaidOnInvoice !== item.amountInLedger) {
            let newStatus = item.status;
            if (!item.isPurchase && item.amountInLedger >= item.totalCost) {
              newStatus = 'delivered';
            }
            await updateDoc(doc(db, 'invoices', item.id), { 
              amountPaid: item.amountInLedger,
              status: newStatus
            });
        
            try {
              await localDb.run("UPDATE invoices SET amountPaid = ?, status = ? WHERE id = ?", [item.amountInLedger, newStatus, item.id]);
            } catch (e) {}
          }
        }
      }
      step++;

      if (auditResults.orphanedItems.length > 0) {
        setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] حذف وإزالة ${auditResults.orphanedItems.length} قطعة غيار يتيمة...` });
        for (const item of auditResults.orphanedItems) {
          await deleteDoc(doc(db, 'invoice_items', item.id));
        }
      }
      step++;

      // Recalculate fund balances
      setRepairProgress({ status: 'running', message: `[${step}/${totalSteps}] إعادة احتساب أرصدة الصناديق وتسوية مبالغ سندات الصرف والقبض...` });
  
      try {
        await repairAllFundBalances();
      } catch (e) {
        console.error('Failed to recalculate funds:', e);
      }
      step++;

      setRepairProgress({ status: 'completed', message: 'تم التحديث وتسوية وتوحيد أجهزة الفواتير وقواعد الاختلافات بنجاح! جميع أرقام العدادات والمعاملات والأجهزة تتوافق 100% بين القاعدة المحلية والمخدم السحابي.' });
      await runDatabaseAudit();
      window.dispatchEvent(new CustomEvent('snd_data_synced'));
    } catch (e: any) {
      console.error('Auto repair failed:', e);
      setRepairProgress({ status: 'error', message: `حدث خطأ أثناء الإصلاح: ${e.message || e}` });
    }
  };

  useEffect(() => {
    if (isOpen) {
      runDatabaseAudit();
    } else {
      setRepairProgress({ status: 'idle', message: '' });
    }
  }, [isOpen]);

  const hasConflicts = auditResults && (
    auditResults.invoiceCounter.conflict ||
    auditResults.otherInvoiceCounter?.conflict ||
    auditResults.customerCounter.conflict ||
    auditResults.totalDiscrepancies.length > 0 ||
    auditResults.statusDiscrepancies.length > 0 ||
    auditResults.paymentImbalances.length > 0 ||
    auditResults.orphanedItems.length > 0 ||
    (auditResults.orphanedStockParts && auditResults.orphanedStockParts.length > 0) ||
    (auditResults.orphanedBatches && auditResults.orphanedBatches.length > 0) ||
    auditResults.emptyInvoices.length > 0 ||
    (auditResults.missingCloudIds && auditResults.missingCloudIds.length > 0) ||
    (auditResults.itemSyncDiscrepancies && auditResults.itemSyncDiscrepancies.length > 0) ||
    (auditResults.missingInCloudItems && auditResults.missingInCloudItems.length > 0) ||
    (auditResults.missingInLocalItems && auditResults.missingInLocalItems.length > 0) ||
    (auditResults.itemsWithoutEntryDate && auditResults.itemsWithoutEntryDate.length > 0) ||
    (auditResults.corruptedPurchaseInvoices && auditResults.corruptedPurchaseInvoices.length > 0) ||
    (auditResults.missingInCloudTransactions && auditResults.missingInCloudTransactions.length > 0) ||
    (auditResults.missingInLocalTransactions && auditResults.missingInLocalTransactions.length > 0)
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md font-cairo text-right" dir="rtl">
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 15 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-4xl bg-[#111111] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 md:p-6 border-b border-white/10 bg-[#161616]">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-orange-500/10 text-orange-500 flex items-center justify-center border border-orange-500/20">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    تدقيق ومطابقة السجلات الفعلية
                  </h3>
                  <p className="text-xs text-gray-400">
                    فحص سلامة العدادات، تطابق الأجهزة والفواتير، وموازنة القيود المالية وسجلات المزامنة
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runDatabaseAudit}
                  disabled={isAuditing}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  title="تحديث الفحص"
                >
                  <RefreshCw size={14} className={isAuditing ? "animate-spin text-orange-500" : ""} />
                  <span className="hidden sm:inline">تحديث الفحص</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer"
                  title="إغلاق"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
              {/* Top Action & Alert Card */}
              {hasConflicts ? (
                <div className="p-4 md:p-5 bg-gradient-to-r from-orange-950/40 via-amber-950/20 to-transparent border border-orange-500/30 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-orange-400 font-bold text-sm">
                      <AlertTriangle size={18} />
                      <span>تم اكتشاف تباينات أو تضارب في السجلات</span>
                    </div>
                    <p className="text-xs text-gray-300">
                      يوجد عدم تطابق بين العدادات أو مجاميع الأجهزة أو القيود المالية. يمكنك تصحيحها بضغطة زر واحدة تلقائياً.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={repairAllDiscrepancies}
                    disabled={repairProgress.status === 'running' || isAuditing}
                    className="w-full md:w-auto px-5 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-orange-900/30 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    {repairProgress.status === 'running' ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    <span>تسوية وتصحيح التضاربات تلقائياً</span>
                  </button>
                </div>
              ) : auditResults ? (
                <div className="p-4 bg-emerald-950/30 border border-emerald-500/30 rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                      <CheckCircle2 size={22} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-emerald-400">جميع السجلات والبيانات متطابقة وسليمة 100%</h4>
                      <p className="text-xs text-gray-400">لا توجد أي تضاربات بين العدادات، الفواتير، الأجهزة، أو السجلات المالية.</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Progress message banner */}
              {repairProgress.status !== 'idle' && (
                <div className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-3 ${
                  repairProgress.status === 'running' ? 'bg-blue-500/10 border-blue-500/30 text-blue-300' :
                  repairProgress.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                  'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  {repairProgress.status === 'running' && <RefreshCw size={16} className="animate-spin flex-shrink-0" />}
                  {repairProgress.status === 'completed' && <CheckCircle size={16} className="flex-shrink-0 text-emerald-400" />}
                  {repairProgress.status === 'error' && <AlertTriangle size={16} className="flex-shrink-0 text-red-400" />}
                  <span>{repairProgress.message}</span>
                </div>
              )}

              {/* Audit Content Grid */}
              {isAuditing ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-gray-400">
                  <RefreshCw size={32} className="animate-spin text-orange-500" />
                  <p className="text-sm font-bold">جاري تدقيق وفحص كافة السجلات والعدادات وقواعد البيانات...</p>
                </div>
              ) : auditResults ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 1. Maintenance Invoices Counter */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-blue-400" />
                        <span className="font-bold text-sm text-white">ترقيم عداد فواتير الصيانة</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.invoiceCounter.conflict || (auditResults.missingInvoiceNumbers?.length > 0) ? (
                          <>
                            <span className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-black">يوجد تضارب</span>
                            <button
                              type="button"
                              onClick={repairMaintenanceInvoiceCounter}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              تصحيح العداد
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">متطابق</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs space-y-1 text-gray-400">
                      <p>العداد المسجل بالنظام: <strong className="text-white font-mono">{auditResults.invoiceCounter.registered}</strong></p>
                      <p>أعلى رقم فعلي في الفواتير: <strong className="text-white font-mono">{auditResults.invoiceCounter.actualMax}</strong></p>
                      {auditResults.missingInvoiceNumbers?.length > 0 && (
                        <p className="text-amber-400 font-bold">فواتير بلا رقم تسلسلي: {auditResults.missingInvoiceNumbers.length}</p>
                      )}
                    </div>
                  </div>

                  {/* 2. Other Invoices Counter */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers size={16} className="text-purple-400" />
                        <span className="font-bold text-sm text-white">ترقيم فواتير الخدمات والمبيعات</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.otherInvoiceCounter?.conflict || (auditResults.missingOtherInvoiceNumbers?.length > 0) ? (
                          <>
                            <span className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-black">يوجد تضارب</span>
                            <button
                              type="button"
                              onClick={repairOtherInvoiceCounter}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              تصحيح العداد
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">متطابق</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs space-y-1 text-gray-400">
                      <p>العداد المسجل بالنظام: <strong className="text-white font-mono">{auditResults.otherInvoiceCounter?.registered || 0}</strong></p>
                      <p>أعلى رقم فعلي باللائحة: <strong className="text-white font-mono">O-{auditResults.otherInvoiceCounter?.actualMax || 0}</strong></p>
                      {auditResults.missingOtherInvoiceNumbers?.length > 0 && (
                        <p className="text-amber-400 font-bold">فواتير مبيعات بلا ترقيم: {auditResults.missingOtherInvoiceNumbers.length}</p>
                      )}
                    </div>
                  </div>

                  {/* 3. Customers Counter */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users size={16} className="text-amber-400" />
                        <span className="font-bold text-sm text-white">ترقيم عداد العملاء</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.customerCounter.conflict || (auditResults.missingCustomerNumbers?.length > 0) ? (
                          <>
                            <span className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-black">يوجد تضارب</span>
                            <button
                              type="button"
                              onClick={repairCustomerCounter}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              تصحيح العداد
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">متطابق</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs space-y-1 text-gray-400">
                      <p>العداد المسجل بالإعدادات: <strong className="text-white font-mono">{auditResults.customerCounter.registered}</strong></p>
                      <p>أعلى رقم تسلسلي للعملاء باللائحة: <strong className="text-white font-mono">{auditResults.customerCounter.actualMax}</strong></p>
                      {auditResults.missingCustomerNumbers?.length > 0 && (
                        <p className="text-amber-400 font-bold">عملاء بلا رقم تسلسلي: {auditResults.missingCustomerNumbers.length}</p>
                      )}
                    </div>
                  </div>

                  {/* 4. Total Cost Matching */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DollarSign size={16} className="text-emerald-400" />
                        <span className="font-bold text-sm text-white">مطابقة قيمة الفواتير وأجهزتها</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.totalDiscrepancies.length > 0 ? (
                          <>
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-500 rounded-lg text-[10px] font-black">{auditResults.totalDiscrepancies.length} تباينات</span>
                            <button
                              type="button"
                              onClick={() => repairInvoiceTotals()}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              إصلاح الكل ({auditResults.totalDiscrepancies.length})
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">سليم</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">التحقق من مطابقة إجمالي الفاتورة لمجموع تكلفة الأجهزة الملحقة بها.</p>
                    {auditResults.totalDiscrepancies.length > 0 && (
                      <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-black/40 rounded-xl font-mono text-[10px] text-red-300">
                        {auditResults.totalDiscrepancies.map((d: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between gap-2 p-1 rounded bg-white/5">
                            <span>فاتورة #{d.invoiceNumber}: الفاتورة ({d.currentTotal}) ↔ المجموع الحقيقي ({d.computedTotal})</span>
                            <button
                              type="button"
                              onClick={() => repairInvoiceTotals(d.id)}
                              disabled={repairProgress.status === 'running'}
                              className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[9px] font-sans font-bold cursor-pointer disabled:opacity-50"
                            >
                              إصلاح الفاتورة
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 5. Cloud & Local Sync Matching */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database size={16} className="text-cyan-400" />
                        <span className="font-bold text-sm text-white">تطابق المزامنة السحابية والمحلية</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {((auditResults.itemSyncDiscrepancies && auditResults.itemSyncDiscrepancies.length > 0) || (auditResults.missingInCloudItems?.length > 0) || (auditResults.missingInLocalItems?.length > 0) || (auditResults.missingInCloudTransactions?.length > 0) || (auditResults.missingInLocalTransactions?.length > 0)) ? (
                          <>
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black">فروقات مزامنة</span>
                            <button
                              type="button"
                              onClick={repairCloudLocalSync}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              مزامنة وتوحيد الآن
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">متطابق</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs space-y-1 text-gray-400">
                      <p>أجهزة ناقصة في السحابة: <strong className="text-white font-mono">{auditResults.missingInCloudItems?.length || 0}</strong></p>
                      <p>أجهزة ناقصة في المحلي: <strong className="text-white font-mono">{auditResults.missingInLocalItems?.length || 0}</strong></p>
                      <p>سندات وحركات ناقصة بالسحابة: <strong className="text-white font-mono">{auditResults.missingInCloudTransactions?.length || 0}</strong></p>
                      <p>سندات وحركات ناقصة بالمحلي: <strong className="text-white font-mono">{auditResults.missingInLocalTransactions?.length || 0}</strong></p>
                    </div>
                  </div>

                  {/* 5b. Purchase & Supplier Invoices Health */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShoppingBag size={16} className="text-amber-400" />
                        <span className="font-bold text-sm text-white">سلامة فواتير الشراء والموردين</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.corruptedPurchaseInvoices?.length > 0 ? (
                          <>
                            <span className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-black">{auditResults.corruptedPurchaseInvoices.length} بحاجة استعادة</span>
                            <button
                              type="button"
                              onClick={repairCorruptedPurchaseInvoices}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              استعادة القيم
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">سليمة ومحمية</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">حماية وتثبيت قيم فواتير الشراء والتوريد ومنع تصفيرها أو مسحها أثناء التدقيق.</p>
                    {auditResults.corruptedPurchaseInvoices?.length > 0 && (
                      <div className="max-h-24 overflow-y-auto space-y-1.5 p-2 bg-black/40 rounded-xl font-mono text-[10px] text-amber-300">
                        {auditResults.corruptedPurchaseInvoices.map((c: any, idx: number) => (
                          <p key={idx}>فاتورة شراء #{c.invoiceNumber}: المورد ({c.customerName || 'غير محدد'}) ↔ القيمة المستعادة ({c.suggestedTotal})</p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 6. Status Discrepancies */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wrench size={16} className="text-indigo-400" />
                        <span className="font-bold text-sm text-white">مطابقة الحالات والوضع الفني</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.statusDiscrepancies.length > 0 ? (
                          <>
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black">{auditResults.statusDiscrepancies.length} اختلافات</span>
                            <button
                              type="button"
                              onClick={() => repairStatusDiscrepancies()}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              تحديث الحالات
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">سليم</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">مراجعة الحالة الخارجية للفاتورة ومطابقتها بمراحل الصيانة الفنية الفردية.</p>
                    {auditResults.statusDiscrepancies.length > 0 && (
                      <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-black/30 rounded-xl font-mono text-[10px] text-amber-300">
                        {auditResults.statusDiscrepancies.map((d: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between gap-2 p-1 rounded bg-white/5">
                            <span>فاتورة #{d.invoiceNumber}: مسجل [{getAuditStatusText(d.currentStatus)}] ↔ الفعلي [{getAuditStatusText(d.expectedStatus)}]</span>
                            <button
                              type="button"
                              onClick={() => repairStatusDiscrepancies(d.id)}
                              disabled={repairProgress.status === 'running'}
                              className="px-2 py-0.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-[9px] font-sans font-bold cursor-pointer disabled:opacity-50"
                            >
                              تحديث الحالة
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 7. Vault & Payment Imbalances */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DollarSign size={16} className="text-green-400" />
                        <span className="font-bold text-sm text-white">تطابق الصندوق والمدفوعات</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {auditResults.paymentImbalances.length > 0 ? (
                          <>
                            <span className="px-2.5 py-1 bg-red-500/10 text-red-500 rounded-lg text-[10px] font-black">{auditResults.paymentImbalances.length} عدم تطابق</span>
                            <button
                              type="button"
                              onClick={() => repairPaymentImbalances()}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              موازنة الكل
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">سليم</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">مقارنة المقبوض الفعلي في الصندوق مع إجمالي المدفوعات بالفاتورة.</p>
                    {auditResults.paymentImbalances.length > 0 && (
                      <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-black/30 rounded-xl font-mono text-[10px] text-red-300">
                        {auditResults.paymentImbalances.map((d: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between gap-2 p-1 rounded bg-white/5">
                            <span>فاتورة #{d.invoiceNumber}: الفاتورة ({d.amountPaidOnInvoice}) ↔ المقبوض ({d.amountInLedger})</span>
                            <button
                              type="button"
                              onClick={() => repairPaymentImbalances(d.invoiceNumber)}
                              disabled={repairProgress.status === 'running'}
                              className="px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded text-[9px] font-sans font-bold cursor-pointer disabled:opacity-50"
                            >
                              تسجيل السند
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 8. Orphaned Items & Empty Invoices */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={16} className="text-yellow-400" />
                        <span className="font-bold text-sm text-white">السجلات اليتيمة وتدقيق المخزون المعلق</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {(auditResults.orphanedItems.length > 0 || auditResults.emptyInvoices.length > 0 || (auditResults.orphanedStockParts?.length > 0) || (auditResults.orphanedBatches?.length > 0)) ? (
                          <>
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black">تباينات مكتشفة</span>
                            <button
                              type="button"
                              onClick={repairOrphanedAndEmpty}
                              disabled={repairProgress.status === 'running'}
                              className="px-2.5 py-1 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            >
                              تنظيف الآن
                            </button>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">سليم</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs space-y-1 text-gray-400">
                      <p>أجهزة/عناصر يتيمة بلا فواتير رئيسية: <strong className="text-white font-mono">{auditResults.orphanedItems.length}</strong></p>
                      <p>فواتير فارغة كلياً بلا أجهزة مسجلة: <strong className="text-white font-mono">{auditResults.emptyInvoices.length}</strong></p>
                      {(auditResults.orphanedStockParts?.length > 0) && (
                        <p>قطع غيار مخزون تابعة لفواتير شراء محذوفة: <strong className="text-amber-400 font-mono">{auditResults.orphanedStockParts.length}</strong></p>
                      )}
                      {(auditResults.orphanedBatches?.length > 0) && (
                        <p>دفعات تفكيك تابعة لفواتير شراء محذوفة: <strong className="text-purple-400 font-mono">{auditResults.orphanedBatches.length}</strong></p>
                      )}
                    </div>
                  </div>

                  {/* 9. Cloud Document IDs (Missing id field in Firestore) */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database size={16} className="text-teal-400" />
                        <span className="font-bold text-sm text-white">معرّفات مستندات السحابة (Firestore IDs)</span>
                      </div>
                      {auditResults.missingCloudIds?.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-black">
                            {auditResults.missingCloudIds.length} مستند بدون حقل id
                          </span>
                          <button
                            type="button"
                            onClick={repairCloudDocumentIds}
                            disabled={repairProgress.status === 'running'}
                            className="px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
                          >
                            تزويد المعرّفات بالسحابة الآن
                          </button>
                        </div>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">سليم 100%</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      فحص كافة المستندات في قاعدة بيانات Firestore والتأكد من احتوائها على حقل المعرّف (id) الداخلي لضمان تنزيل ومزامنة العملاء وباقي الجداول تلقائياً في الخلفية بدون أي توقف.
                    </p>
                    {auditResults.missingCloudIds?.length > 0 && (
                      <div className="max-h-28 overflow-y-auto space-y-1.5 p-2 bg-black/40 rounded-xl font-mono text-[10px] text-teal-300">
                        {auditResults.missingCloudIds.map((item: any, idx: number) => (
                          <p key={idx}>جدول [{item.collection}] - معرّف Document ID: ({item.id}) - الاسم: {item.name || 'بدون اسم'}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 10. Device Entry Dates (Missing entryDate in Cloud/Local invoice_items) */}
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-sky-400" />
                        <span className="font-bold text-sm text-white">تواريخ دخول أجهزة الفواتير (تاريخ الدخول)</span>
                      </div>
                      {auditResults.itemsWithoutEntryDate?.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black">
                            {auditResults.itemsWithoutEntryDate.length} جهاز بدون تاريخ دخول
                          </span>
                          <button
                            type="button"
                            onClick={repairItemsWithoutEntryDate}
                            disabled={repairProgress.status === 'running'}
                            className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                          >
                            <Calendar size={13} />
                            إدخال تاريخ الفاتورة للأجهزة الآن
                          </button>
                        </div>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black">مكتمل ومتطابق 100%</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      التحقق من توفر تاريخ دخول رسمي (entryDate) لكل جهاز مسجل في الفواتير بالسحابة والقاعدة المحلية، وتعبئته تلقائياً من تاريخ الفاتورة الأم لحساب فترات بقاء الأجهزة بدقة تامة.
                    </p>
                    {auditResults.itemsWithoutEntryDate?.length > 0 && (
                      <div className="max-h-36 overflow-y-auto space-y-1.5 p-2.5 bg-black/40 rounded-xl font-mono text-[10px] text-sky-200 border border-sky-500/10">
                        {auditResults.itemsWithoutEntryDate.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                            <span>جهاز: <strong className="text-white">{item.deviceName}</strong> ({item.deviceType}) — فاتورة #{item.invoiceNumber}</span>
                            <span className="text-sky-300 font-bold bg-sky-500/10 px-2 py-0.5 rounded">التاريخ المقترح: {item.displayDate}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 bg-[#161616] flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {auditResults?.lastChecked ? `آخر فحص: ${new Date(auditResults.lastChecked).toLocaleTimeString('ar-SA')}` : ''}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
