import { sharePdfFile, openWhatsApp } from '../../lib/shareHelper';
import { parseDate, resolveEntryDateString } from '../../lib/dateUtils';
import { calculateInvoiceBillableTotal, getItemBillableCost, isItemRefusedOrFailed } from '../../lib/billableService';
import { localDb } from '../../lib/local-db';
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, getDoc, updateDoc } from '../../firebase';
import { db } from '../../firebase';
import { Invoice, InvoiceItem, User, Customer, isShopMaintenanceItem, isPurchaseInvoice, isSaleInvoice } from '../../types';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Clock, Check, RefreshCw, ArrowUpRight, Save, Plus, Printer, Share2, FileText, Phone, Smartphone, Building, ArrowLeft, ArrowRight, MessageCircle, MapPin, Facebook, Edit2, Trash2, ZoomIn, ZoomOut, User as UserIcon } from 'lucide-react';
import BankAccountsFooter from '../BankAccountsFooter';
import PrintPreviewOverlay from '../PrintPreviewOverlay';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { sanitizeDocumentStyles, sanitizeElementInlineStyles, cleanOklchInStyleText } from '../../lib/html2canvasHelper';
import { ProviderFactory } from '../../data/ProviderFactory';
import { generateOptimizedPdfFromElement, downloadPdfBlob } from '../../lib/pdfHelper';

const WhatsAppIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" {...props}>
    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.501-5.734-1.451L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.42 9.864-9.858.002-2.634-1.018-5.11-2.871-6.968C16.592 1.96 14.118.94 11.482.94c-5.438 0-9.863 4.42-9.866 9.861-.001 1.761.468 3.481 1.357 5.02L1.97 21.03l5.311-1.392c.312.163.626.326.96.48zm11.365-7.6c-.302-.151-1.78-.879-2.057-.98-.277-.101-.48-.151-.68.151-.2.3-.777.979-.952 1.18-.176.201-.351.226-.654.076-.302-.151-1.277-.47-2.434-1.502-.9-.803-1.507-1.795-1.683-2.096-.176-.301-.019-.464.132-.614.136-.135.302-.35.453-.526.151-.176.201-.301.302-.503.101-.201.05-.377-.025-.527-.076-.151-.68-1.637-.932-2.247-.246-.59-.497-.51-.68-.52-.176-.01-.377-.01-.579-.01-.201 0-.528.075-.804.377-.277.301-1.057 1.031-1.057 2.515 0 1.485 1.082 2.918 1.232 3.119.15.2 2.13 3.25 5.16 4.561.721.311 1.284.498 1.72.639.724.23 1.382.197 1.902.12.58-.088 1.78-.728 2.031-.1.431.25.1.48.1.68.01.2.148z"/>
  </svg>
);

function parseEngineerReport(reportStr: string) {
  const s = reportStr || '';
  const idx = s.indexOf(' | ');
  if (idx !== -1) {
    return {
      technical: s.substring(0, idx).trim(),
      outcome: s.substring(idx + 3).trim()
    };
  }
  const pipeIdx = s.indexOf('|');
  if (pipeIdx !== -1) {
    return {
      technical: s.substring(0, pipeIdx).trim(),
      outcome: s.substring(pipeIdx + 1).trim()
    };
  }
  return {
    technical: s.trim(),
    outcome: ''
  };
}

function getItemStatus(it: any) {
  const statusVal = String(it.status || '').trim().toLowerCase();
  const subStatus = String(it.subStatus || '').trim().toLowerCase();
  const decision = String(it.decision || it.technicalDecision || '').trim().toLowerCase();
  const outcome = String(it.outcome || it.approvalStatus || '').trim().toLowerCase();

  // 1. If actively repairing, status is صيانة
  if (decision === 'repairing' || decision === 'صيانة') {
    if (['refused', 'cancelled', '70'].includes(outcome) || ['refused', 'cancelled', '70'].includes(subStatus)) {
      return 'لم يوافق';
    }
    if (['unrepairable', 'failed', '55'].includes(outcome) || ['unrepairable', 'failed', '55'].includes(subStatus)) {
      return 'لا يصلح';
    }
    return 'صيانة';
  }

  // 2. Explicit terminal unrepairable
  if (
    ['55', '45', 'unrepairable', 'failed'].includes(statusVal) || 
    ['unrepairable', 'failed', 'no_parts', 'parts_unavailable'].includes(subStatus) || 
    ['unrepairable', 'failed', 'no_parts', 'parts_unavailable', 'لا يصلح'].includes(decision) ||
    ['unrepairable', 'failed', 'no_parts', 'parts_unavailable', 'لا يصلح'].includes(outcome)
  ) {
    return 'لا يصلح';
  }

  // 3. Intact
  if (
    statusVal === 'intact' || 
    subStatus === 'intact' || 
    decision === 'intact' ||
    outcome === 'intact'
  ) {
    return 'سليم';
  }

  // 4. Refused / Cancelled
  if (
    ['70', 'cancelled', 'refused'].includes(statusVal) ||
    ['cancelled', 'refused'].includes(subStatus) ||
    ['cancelled', 'refused', 'لم يوافق'].includes(decision) ||
    ['cancelled', 'refused', 'لم يوافق'].includes(outcome)
  ) {
    return 'لم يوافق';
  }

  return 'صيانة';
}

export default function ApprovalAndParts({ user, onBack, initialInvoice }: { user: User, onBack: () => void, initialInvoice?: Invoice | null }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [engineersList, setEngineersList] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  
  // Outer double tabs state: 'approval' (انتظار الموافقة من العميل) vs 'parts' (انتظار قطع الغيار)
  const [subTab, setSubTab] = useState<'approval' | 'parts'>('approval');

  // Selection for detailed form (صفحة إجراء انتظار الموافقة والقطع)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [engineerName, setEngineerName] = useState('');
  const [actionItems, setActionItems] = useState<{ id: string, count: number, outcome: 'approved' | 'waiting_parts' | 'refused', reason: string }[]>([]);
  const [currentFormRow, setCurrentFormRow] = useState<{ id: string, count: number | '', outcome: 'approved' | 'waiting_parts' | 'refused', reason: string }>({ id: '', count: 1, outcome: 'approved', reason: 'تمت الموافقة' });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  
  // List-page state for cumulative row choices: record of invoiceId -> 'approved' or 'refused' or null
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'refused' | null>>({});
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [loadingForm, setLoadingForm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Print-Report states and helpers
  const [showPreviewReport, setShowPreviewReport] = useState(false);
  const [activePrintReportInvoice, setActivePrintReportInvoice] = useState<Invoice | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [shopConfig, setShopConfig] = useState<any>(null);
  const [currentOutput, setCurrentOutput] = useState<any>(null);

  const [userZoom, setUserZoom] = useState(1);
  const [scaleFactor, setScaleFactor] = useState(1);
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      // Calculate available width and height for the sheet inside the modal.
      // We reserve ~40px of width padding and ~140px of height padding for the top actions bar.
      const availableWidth = width - 40;
      const availableHeight = height - 140;
      
      const scaleW = availableWidth / 794;
      const scaleH = availableHeight / 1123;
      
      const bestScale = Math.min(scaleW, scaleH);
      // Clamp scale factor between 0.3 and 1
      setScaleFactor(Math.min(1, Math.max(0.3, bestScale)));
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch shop config
  useEffect(() => {
    getDoc(doc(db, 'company_details', 'main_details')).then((snap) => {
      if (snap.exists()) {
        setShopConfig(snap.data());
      }
    }).catch(err => {
      console.warn("Could not fetch shop settings:", err);
    });
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [subTab, search]);

  const getCustomerPhone = (customerId: string) => {
    const c = customers.find(c => c.id === customerId);
    return c ? (c.phone1 || c.phone2 || '') : '';
  };

  const getCustomerCompany = (customerId: string) => {
    const c = customers.find(c => c.id === customerId);
    return c ? (c.companyName || '---') : '---';
  };

  const incrementPrintCount = async (inv: Invoice, outputType: 'PRINT' | 'SHARE' = 'PRINT') => {
    if (!inv || !inv.id) return;
    const currentCount = Number(inv.printCount || 0);
    const newCount = currentCount + 1;
    try {
      const docRef = doc(db, 'invoices', inv.id);
      await updateDoc(docRef, { printCount: newCount });
      
      // Update local states
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, printCount: newCount } : i));
      if (selectedInvoice && selectedInvoice.id === inv.id) {
        setSelectedInvoice(prev => prev ? { ...prev, printCount: newCount } : null);
      }
      if (activePrintReportInvoice && activePrintReportInvoice.id === inv.id) {
        setActivePrintReportInvoice(prev => prev ? { ...prev, printCount: newCount } : null);
      }
    } catch (e) {
      console.error("Error updating print count in Firestore:", e);
      // Fallback: update local state only
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, printCount: newCount } : i));
      if (selectedInvoice && selectedInvoice.id === inv.id) {
        setSelectedInvoice(prev => prev ? { ...prev, printCount: newCount } : null);
      }
      if (activePrintReportInvoice && activePrintReportInvoice.id === inv.id) {
        setActivePrintReportInvoice(prev => prev ? { ...prev, printCount: newCount } : null);
      }
    }

    // Record in document_outputs (both SQLite and Cloud via ProviderFactory)
    try {
      const docName = activePrintReportInvoice ? 'عرض سعر' : 'تقرير الحالة والإسناد';
      const resolvedUserId = String(user?.userNumber || user?.name || user?.username || (inv as any).userNumber || (inv as any).createdBy || '1');
      const outputRecord = {
        id: 'out_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now(),
        document_id: inv.id,
        document_number: String(inv.invoiceNumber || '').replace('#', '').trim(),
        document_name: docName,
        output_type: outputType,
        output_datetime: new Date().toISOString(),
        user_id: resolvedUserId
      };
      await ProviderFactory.getProvider().setDoc('document_outputs', outputRecord.id, outputRecord);
    } catch (err) {
      console.warn("Failed recording document_outputs in ApprovalAndParts:", err);
    }
  };

  const handlePrintDirect = async () => {
    const inv = activePrintReportInvoice || selectedInvoice;
    if (inv) {
      await incrementPrintCount(inv, 'PRINT');
    }
    
    setTimeout(() => {
      const originalStyle = document.createElement('style');
      originalStyle.innerHTML = `
        @media print {
          @page { size: auto; margin: 0; }
          body * {
            visibility: hidden !important;
          }
          #print-report-area, #print-report-area * {
            visibility: visible !important;
          }
          #print-report-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            margin: 0 !important;
            padding: 10mm !important;
            color: #000000 !important;
            background-color: #ffffff !important;
          }
        }
      `;
      document.head.appendChild(originalStyle);
      window.print();
      document.head.removeChild(originalStyle);
    }, 150);
  };

  const handleExportPDFAndWhatsApp = async (invoice: Invoice) => {
    await incrementPrintCount(invoice, 'SHARE');
    const getConditionRank = (item: any) => {
      const statusLabel = getItemStatus(item);
      if (statusLabel === 'لا يصلح') return 3;
      if (statusLabel === 'سليم') return 2;
      return 1; // صيانة
    };
    const invoiceSpecItems = items
      .filter(it => it.invoiceNumber === invoice.invoiceNumber)
      .sort((a, b) => {
        const typeA = a.deviceType || '';
        const typeB = b.deviceType || '';
        const typeCompare = typeA.localeCompare(typeB, 'ar');
        if (typeCompare !== 0) return typeCompare;

        const nameA = a.deviceName || '';
        const nameB = b.deviceName || '';
        const nameCompare = nameA.localeCompare(nameB, 'ar');
        if (nameCompare !== 0) return nameCompare;

        return getConditionRank(a) - getConditionRank(b);
      });
    const totalInvoiceCost = invoiceSpecItems.reduce((sum, item) => sum + (Number(item.unitCost || item.cost || 0) * (item.quantity || 1)), 0);
    const currency = invoice.currency || 'USD';

    setIsGeneratingPDF(true);
    let restore: (() => void) | null = null;

    try {
      const element = document.getElementById('print-report-area');
      if (!element) {
        setIsGeneratingPDF(false);
        return;
      }

      // Sanitize Tailwind CSS styles for html-to-image compatibility
      restore = await sanitizeDocumentStyles();
      sanitizeElementInlineStyles(element);

      const formattedDate = new Date().toISOString().split('T')[0];
      const filename = activePrintReportInvoice 
        ? `عرض سعر أجهزة_${invoice.customerName}_${formattedDate}.pdf`
        : `تقرير الحالة والإسناد_${invoice.customerName}_${formattedDate}.pdf`;

      // Ultra-optimized compressed PDF generation (< 100KB) matching Quick Search pipeline
      const pdfResult = await generateOptimizedPdfFromElement(element, {
        filename,
        pixelRatio: 1.25,
        quality: 0.74,
        backgroundColor: '#ffffff'
      });

      downloadPdfBlob(pdfResult.blob, filename);

      // WhatsApp text composition
      let message = `*عرض سعر صيانة أجهزة فني* 📄\n\n`;
      message += `عزيزي العميل *${invoice.customerName}* المحترم،\n`;
      message += `تجد أدناه ملخص تقرير الفحص وعرض الأسعار صيانة أجهزتكم في الفاتورة رقم *${invoice.invoiceNumber}*:\n\n`;
      message += `- *رقم التقرير:* ${invoice.invoiceNumber}\n`;
      message += `- *القيمة الإجمالية المقدرة:* ${totalInvoiceCost.toLocaleString('en-US')} ${currency}\n\n`;
      message += `*جدول الأجهزة المسجلة بالفحص:*\n`;
      invoiceSpecItems.forEach((item, index) => {
        const statusLabel = getItemStatus(item);
        const reportVal = item.engineerReport || item.technicalNotes || item.faultType || '';
        const parsed = parseEngineerReport(reportVal);
        let displayReport = '-';
        if (statusLabel === 'صيانة') {
          displayReport = parsed.outcome || '-';
        } else {
          displayReport = parsed.technical || statusLabel;
        }
        
        message += `\n_${index + 1}. *${item.deviceType} - ${item.deviceName || ''}*_\n`;
        message += `   • تقرير الفحص: ${displayReport}\n`;
        message += `   • التكلفة: ${(item.cost || item.unitCost || 0).toLocaleString('en-US')} ${currency}\n`;
      });
      message += `\nيسعدنا مراجعتكم وبانتظار الموافقة لبدء الصيانة فورًا. شكرًا لتعاملكم الراقي معنا!`;

      let sharedNatively = false;
      try {
        sharedNatively = await sharePdfFile(pdfResult.blob, filename, message, 'invoice');
      } catch (shareErr) {
        console.warn('Native share was skipped:', shareErr);
      }

      if (!sharedNatively) {
        const targetPhone = (invoice as any).customerPhone || getCustomerPhone(invoice.customerId);
        openWhatsApp(message, targetPhone);
      }

    } catch (e) {
      console.error('Failed to export PDF & share:', e);
    } finally {
      if (restore) {
        try {
          restore();
        } catch (restoreErr) {
          console.warn('Failed to restore document styles:', restoreErr);
        }
      }
      setIsGeneratingPDF(false);
    }
  };

  useEffect(() => {
    if (initialInvoice && items.length > 0 && !selectedInvoice) {
      const APPROVAL_STATUSES = ['30', 'awaiting_approval'];
      const PARTS_STATUSES = ['35', 'awaiting_parts'];
      const isParts = initialInvoice.status === '35' || items.some(item => item.invoiceNumber === initialInvoice.invoiceNumber && item.status === '35');
      
      if (isParts) {
        setSubTab('parts');
        const invoiceSpecItems = items.filter(i => i.invoiceNumber === initialInvoice.invoiceNumber && PARTS_STATUSES.includes(i.status));
        setInvoiceItems(invoiceSpecItems);
        const existingTech = invoiceSpecItems.find(i => i.technician)?.technician || '';
        setEngineerName(existingTech);
        if (invoiceSpecItems.length > 0) {
          setActionItems([{ id: invoiceSpecItems[0].id!, count: 1, outcome: 'approved', reason: '' }]);
        }
        setSelectedInvoice(initialInvoice);
      } else {
        setSubTab('approval');
        const invoiceSpecItems = items.filter(i => i.invoiceNumber === initialInvoice.invoiceNumber && APPROVAL_STATUSES.includes(i.status));
        setInvoiceItems(invoiceSpecItems);
        const existingTech = invoiceSpecItems.find(i => i.technician)?.technician || '';
        setEngineerName(existingTech);
        if (invoiceSpecItems.length > 0) {
          setActionItems([{ id: invoiceSpecItems[0].id!, count: 1, outcome: 'approved', reason: '' }]);
        }
        setSelectedInvoice(initialInvoice);
      }
    }
  }, [initialInvoice, items, selectedInvoice]);

  useEffect(() => {
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (s) => setInvoices(s.docs.map(d => ({ ...d.data(), id: d.id } as Invoice))));
    const unsubItems = onSnapshot(collection(db, 'invoice_items'), (s) => setItems(s.docs.map(d => ({ ...d.data(), id: d.id } as InvoiceItem))));
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (s) => setCustomers(s.docs.map(d => ({ ...d.data(), id: d.id } as Customer))));
    const unsubEngineers = onSnapshot(collection(db, 'engineers'), (s) => setEngineersList(s.docs.map(d => d.data().name).filter(Boolean)));
    return () => { unsubInvoices(); unsubItems(); unsubCustomers(); unsubEngineers(); };
  }, []);

  const getCustomerNumber = (customerId: string) => {
    const c = customers.find(c => c.id === customerId);
    return c ? c.customerNumber : '---';
  };

  // Separate current active statuses based on the sub-tab selected
  const APPROVAL_STATUSES = ['30', 'awaiting_approval'];
  const PARTS_STATUSES = ['35', 'awaiting_parts'];
  const activeStatuses = subTab === 'approval' ? APPROVAL_STATUSES : PARTS_STATUSES;

  const pendingInvoices = invoices.filter(inv => {
    if (isPurchaseInvoice(inv) || isSaleInvoice(inv)) return false;
    return items.some(item => item.invoiceNumber === inv.invoiceNumber && isShopMaintenanceItem(item, inv) && activeStatuses.includes(item.status) && item.quantity > 0);
  }).filter(inv => {
    const customer = customers.find(c => c.id === inv.customerId);
    const customerName = String(inv.customerName || '').toLowerCase();
    const customerPhone = customer ? (customer.phone1 || customer.phone2 || '') : '';
    const searchTerm = String(search || '').toLowerCase();
    
    return customerName.includes(searchTerm) || 
           customerPhone.includes(search || '') ||
           String(inv.invoiceNumber || '').includes(search || '');
  }).sort((a, b) => Number(b.invoiceNumber) - Number(a.invoiceNumber));

  useEffect(() => {
    setDecisions(prev => {
      let changed = false;
      const next = { ...prev };
      pendingInvoices.forEach(inv => {
        if (inv.id && next[inv.id] === undefined) {
          next[inv.id] = 'approved';
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [pendingInvoices]);

  const totalPages = Math.max(1, Math.ceil(pendingInvoices.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const currentInvoices = pendingInvoices.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);

  const totalAwaitingDevices = items.filter(i => isShopMaintenanceItem(i) && activeStatuses.includes(i.status)).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const countEligibleDevices = (invoiceNumber: string) => {
    return items.filter(i => i.invoiceNumber === invoiceNumber && isShopMaintenanceItem(i) && activeStatuses.includes(i.status) && i.quantity > 0).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  };

  // Handles toggling a decision on the list page
  const handleToggleDecision = (invoiceId: string, choice: 'approved' | 'refused') => {
    setDecisions(prev => {
      const current = prev[invoiceId];
      return {
        ...prev,
        [invoiceId]: current === choice ? null : choice
      };
    });
  };

  // Click on the action button on the list row (Approval SubTab)
  const handleProcessActionBtn = async (invoice: Invoice) => {
    const listDecision = decisions[invoice.id || ''];
    if (listDecision) {
      // Direct fast action path (either approved or fused completely)
      setRowLoading(prev => ({ ...prev, [invoice.id || '']: true }));
      try {
        const batch = writeBatch(db);
        const invoiceItemsToUpdate = items.filter(i => i.invoiceNumber === invoice.invoiceNumber && APPROVAL_STATUSES.includes(i.status));
        
        invoiceItemsToUpdate.forEach(item => {
          const itemRef = doc(db, 'invoice_items', item.id!);
          const resolvedEntryDate = resolveEntryDateString(item, invoice);
          if (listDecision === 'approved') {
            // Move device fully to maintenance status '40'
            batch.update(itemRef, {
              status: '40',
              subStatus: 'repairing',
              source: 'approval_approved_bulk',
              entryDate: resolvedEntryDate,
              updatedAt: serverTimestamp()
            });
          } else if (listDecision === 'refused') {
            // Move device directly to exit status '50' with zeroed cost and preserved estimatedCost
            const currentItemCost = Number(item.cost || 0);
            const preservedCost = (item.estimatedCost && Number(item.estimatedCost) > 0)
              ? Number(item.estimatedCost)
              : currentItemCost;
            batch.update(itemRef, {
              status: '50',
              subStatus: 'refused',
              failureReason: 'لم يوافق العميل',
              source: 'approval_refused_bulk',
              cost: 0,
              unitCost: 0,
              estimatedCost: preservedCost,
              entryDate: resolvedEntryDate,
              updatedAt: serverTimestamp()
            });
          }
        });

        // Calculate final statuses of all items in this invoice for bulk updates
        let finalBulkInvoiceStatus = '50';
        const finalStatuses: string[] = [];
        items.filter(it => it.invoiceNumber === invoice.invoiceNumber).forEach(it => {
          if (APPROVAL_STATUSES.includes(it.status)) {
            finalStatuses.push(listDecision === 'approved' ? '40' : '50');
          } else {
            finalStatuses.push(it.status);
          }
        });
        
        if (finalStatuses.some(s => s === '70' || s === 'cancelled')) finalBulkInvoiceStatus = '70';
        else if (finalStatuses.some(s => s === '10' || s === 'new')) finalBulkInvoiceStatus = '10';
        else if (finalStatuses.some(s => s === '20')) finalBulkInvoiceStatus = '20';
        else if (finalStatuses.some(s => s === '30' || s === '35' || s === 'awaiting_approval' || s === 'awaiting_parts')) finalBulkInvoiceStatus = '30';
        else if (finalStatuses.some(s => s === '40' || s === 'repairing')) finalBulkInvoiceStatus = '40';

        // Prepare updated item snapshot for calculating new totalCost
        const invoiceAllItems = items.filter(it => it.invoiceNumber === invoice.invoiceNumber).map(it => {
          if (APPROVAL_STATUSES.includes(it.status)) {
            if (listDecision === 'refused') {
              const currentItemCost = Number(it.cost || 0);
              const preservedCost = (it.estimatedCost && Number(it.estimatedCost) > 0)
                ? Number(it.estimatedCost)
                : currentItemCost;
              return {
                ...it,
                status: '50',
                subStatus: 'refused',
                failureReason: 'لم يوافق العميل',
                cost: 0,
                unitCost: 0,
                estimatedCost: preservedCost
              };
            } else if (listDecision === 'approved') {
              return {
                ...it,
                status: '40',
                subStatus: 'repairing'
              };
            }
          }
          return it;
        });

        const newInvoiceTotalCost = calculateInvoiceBillableTotal(invoice, invoiceAllItems);

        batch.update(doc(db, 'invoices', invoice.id!), {
          status: finalBulkInvoiceStatus,
          totalCost: newInvoiceTotalCost,
          updatedAt: serverTimestamp()
        });

        // Register the activity
        const actionRef = doc(collection(db, 'approval_actions'));
        batch.set(actionRef, {
          id: actionRef.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          decision: listDecision,
          date: new Date().getTime(),
          userId: user.id || 'unknown',
          userName: user.name || 'System',
          createdAt: serverTimestamp()
        });

        await batch.commit();

        // Also update localDb if present
        try {
          if (localDb) {
            if (listDecision === 'refused') {
              for (const it of invoiceItemsToUpdate) {
                const currentItemCost = Number(it.cost || 0);
                const preservedCost = (it.estimatedCost && Number(it.estimatedCost) > 0) ? Number(it.estimatedCost) : currentItemCost;
                try {
                  await (localDb as any).invoice_items?.update(it.id, {
                    status: '50',
                    subStatus: 'refused',
                    cost: 0,
                    unitCost: 0,
                    estimatedCost: preservedCost
                  });
                } catch (e) {}
              }
            }
            try {
              await (localDb as any).invoices?.update(invoice.id, {
                status: finalBulkInvoiceStatus,
                totalCost: newInvoiceTotalCost
              });
            } catch (e) {}
            try {
              await localDb.run?.("UPDATE invoices SET status = ?, totalCost = ? WHERE id = ?", [finalBulkInvoiceStatus, newInvoiceTotalCost, invoice.id]);
            } catch (e) {}
          }
        } catch (e) {}

        setDecisions(prev => {
          const copy = { ...prev };
          delete copy[invoice.id || ''];
          return copy;
        });
      } catch (err) {
        console.error("Error committing bulk approval decision:", err);
      } finally {
        setRowLoading(prev => ({ ...prev, [invoice.id || '']: false }));
      }
    } else {
      // The Third Way: Open detailed cloning page because no option is chosen
      setSelectedInvoice(invoice);
      const invoiceSpecItems = items.filter(i => i.invoiceNumber === invoice.invoiceNumber && APPROVAL_STATUSES.includes(i.status));
      setInvoiceItems(invoiceSpecItems);
      // Try to pre-fill the name of first items technician if any
      const existingTech = invoiceSpecItems.find(i => i.technician)?.technician || '';
      setEngineerName(existingTech || user.name || '');

      // Initialize actionItems as an empty table and prefill the form
      setActionItems([]);
      setEditingIndex(null);
      if (invoiceSpecItems.length > 0) {
        setCurrentFormRow({ id: invoiceSpecItems[0].id!, count: invoiceSpecItems[0].quantity, outcome: 'approved', reason: 'تمت الموافقة' });
      }
    }
  };

  // Click on the action button on the list row (Parts SubTab)
  const handleProcessPartsAction = async (invoice: Invoice) => {
    const listDecision = decisions[invoice.id || ''];
    if (!listDecision) {
      // Detailed action form for Parts tab
      setSelectedInvoice(invoice);
      const invoiceSpecItems = items.filter(i => i.invoiceNumber === invoice.invoiceNumber && PARTS_STATUSES.includes(i.status));
      setInvoiceItems(invoiceSpecItems);
      // Try to pre-fill the name of first items technician if any
      const existingTech = invoiceSpecItems.find(i => i.technician)?.technician || '';
      setEngineerName(existingTech || user.name || '');

      // Initialize actionItems as an empty table and prefill the form
      setActionItems([]);
      setEditingIndex(null);
      if (invoiceSpecItems.length > 0) {
        setCurrentFormRow({ id: invoiceSpecItems[0].id!, count: invoiceSpecItems[0].quantity, outcome: 'approved', reason: 'توفرت قطع الغيار' });
      }
      return;
    }

    setRowLoading(prev => ({ ...prev, [invoice.id || '']: true }));
    try {
      const batch = writeBatch(db);
      const invoiceItemsToUpdate = items.filter(
        i => i.invoiceNumber === invoice.invoiceNumber && PARTS_STATUSES.includes(i.status)
      );

      invoiceItemsToUpdate.forEach(item => {
        const itemRef = doc(db, 'invoice_items', item.id!);
        const resolvedEntryDate = resolveEntryDateString(item, invoice);
        if (listDecision === 'approved') {
          // Parts arrived -> Move to maintenance status '40', subStatus 'repairing'
          batch.update(itemRef, {
            status: '40',
            subStatus: 'repairing',
            source: 'parts_available',
            entryDate: resolvedEntryDate,
            updatedAt: serverTimestamp()
          });
        } else if (listDecision === 'refused') {
          // Parts did not arrive -> Move to exit status '50' with failureReason and zeroed cost
          const currentItemCost = Number(item.cost || 0);
          const preservedCost = (item.estimatedCost && Number(item.estimatedCost) > 0)
            ? Number(item.estimatedCost)
            : currentItemCost;
          batch.update(itemRef, {
            status: '50',
            subStatus: 'no_parts',
            failureReason: 'لم تتوفر قطع الغيار',
            source: 'parts_not_available',
            cost: 0,
            unitCost: 0,
            estimatedCost: preservedCost,
            entryDate: resolvedEntryDate,
            updatedAt: serverTimestamp()
          });
        }
      });

      // Calculate final statuses of all items in this invoice for bulk updates
      let finalBulkInvoiceStatus = '50';
      const finalStatuses: string[] = [];
      items.filter(it => it.invoiceNumber === invoice.invoiceNumber).forEach(it => {
        if (PARTS_STATUSES.includes(it.status)) {
          finalStatuses.push(listDecision === 'approved' ? '40' : '50');
        } else {
          finalStatuses.push(it.status);
        }
      });
      
      if (finalStatuses.some(s => s === '70' || s === 'cancelled')) finalBulkInvoiceStatus = '70';
      else if (finalStatuses.some(s => s === '10' || s === 'new')) finalBulkInvoiceStatus = '10';
      else if (finalStatuses.some(s => s === '20')) finalBulkInvoiceStatus = '20';
      else if (finalStatuses.some(s => s === '30' || s === '35' || s === 'awaiting_approval' || s === 'awaiting_parts')) finalBulkInvoiceStatus = '30';
      else if (finalStatuses.some(s => s === '40' || s === 'repairing')) finalBulkInvoiceStatus = '40';

      // Prepare updated item snapshot for calculating new totalCost
      const invoiceAllItems = items.filter(it => it.invoiceNumber === invoice.invoiceNumber).map(it => {
        if (PARTS_STATUSES.includes(it.status)) {
          if (listDecision === 'refused') {
            const currentItemCost = Number(it.cost || 0);
            const preservedCost = (it.estimatedCost && Number(it.estimatedCost) > 0)
              ? Number(it.estimatedCost)
              : currentItemCost;
            return {
              ...it,
              status: '50',
              subStatus: 'no_parts',
              failureReason: 'لم تتوفر قطع الغيار',
              cost: 0,
              unitCost: 0,
              estimatedCost: preservedCost
            };
          } else if (listDecision === 'approved') {
            return {
              ...it,
              status: '40',
              subStatus: 'repairing'
            };
          }
        }
        return it;
      });

      const newInvoiceTotalCost = calculateInvoiceBillableTotal(invoice, invoiceAllItems);

      batch.update(doc(db, 'invoices', invoice.id!), {
        status: finalBulkInvoiceStatus,
        totalCost: newInvoiceTotalCost,
        updatedAt: serverTimestamp()
      });

      // Register the activity
      const actionRef = doc(collection(db, 'approval_actions'));
      batch.set(actionRef, {
        id: actionRef.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        decision: listDecision === 'approved' ? 'parts_available' : 'parts_unavailable',
        date: new Date().getTime(),
        userId: user.id || 'unknown',
        userName: user.name || 'System',
        createdAt: serverTimestamp()
      });

      await batch.commit();

      // Also update localDb if present
      try {
        if (localDb) {
          if (listDecision === 'refused') {
            for (const it of invoiceItemsToUpdate) {
              const currentItemCost = Number(it.cost || 0);
              const preservedCost = (it.estimatedCost && Number(it.estimatedCost) > 0) ? Number(it.estimatedCost) : currentItemCost;
              try {
                await (localDb as any).invoice_items?.update(it.id, {
                  status: '50',
                  subStatus: 'no_parts',
                  cost: 0,
                  unitCost: 0,
                  estimatedCost: preservedCost
                });
              } catch (e) {}
            }
          }
          try {
            await (localDb as any).invoices?.update(invoice.id, {
              status: finalBulkInvoiceStatus,
              totalCost: newInvoiceTotalCost
            });
          } catch (e) {}
          try {
            await localDb.run?.("UPDATE invoices SET status = ?, totalCost = ? WHERE id = ?", [finalBulkInvoiceStatus, newInvoiceTotalCost, invoice.id]);
          } catch (e) {}
        }
      } catch (e) {}

      setDecisions(prev => {
        const copy = { ...prev };
        delete copy[invoice.id || ''];
        return copy;
      });
    } catch (err) {
      console.error("Error committing bulk parts decision:", err);
    } finally {
      setRowLoading(prev => ({ ...prev, [invoice.id || '']: false }));
    }
  };

  // Cloned Details Form Navigation helpers (Only applicable for Approval Tab)
  const getAvailableQuantity = (itemId: string, excludeIndex: number = -1) => {
    const originalItem = invoiceItems.find(i => i.id === itemId);
    if (!originalItem) return 0;
    
    // Check how many have been applied to the table
    let usedQuantity = actionItems.reduce((acc, row, idx) => {
      if (idx !== excludeIndex && row.id === itemId) return acc + row.count;
      return acc;
    }, 0);
    
    // Also consider what's currently in the form (if we are NOT editing a row)
    if (excludeIndex === -1 && currentFormRow.id === itemId) {
       // We don't deduct it from available quantity so the user sees proper Max when adding
    }

    return originalItem.quantity - usedQuantity;
  };

  const handleUpdateCurrentForm = (field: string, value: any) => {
    const row = { ...currentFormRow, [field]: value };
    if (field === 'id') {
      const maxCount = getAvailableQuantity(value, -1);
      row.count = maxCount;
    }
    if (field === 'outcome') {
      if (value === 'approved') {
        row.reason = subTab === 'parts' ? 'توفرت قطع الغيار' : 'تمت الموافقة';
      } else if (value === 'waiting_parts') {
        row.reason = subTab === 'parts' ? 'ما زال ينتظر قطع الغيار' : 'انتظار قطع الغيار';
      } else if (value === 'refused') {
        row.reason = subTab === 'parts' ? 'لم تتوفر قطع الغيار' : 'لم يوافق العميل';
      }
    }
    setCurrentFormRow(row);
  };

  const handleApplyFormToTable = () => {
    if (!currentFormRow.id || !currentFormRow.count || isNaN(Number(currentFormRow.count)) || Number(currentFormRow.count) < 1) return;
    const maxAllowed = getAvailableQuantity(currentFormRow.id, editingIndex !== null ? editingIndex : -1);
    if (Number(currentFormRow.count) > maxAllowed) return; // Disallow going over available count

    if (editingIndex !== null) {
      const newItems = [...actionItems];
      newItems[editingIndex] = currentFormRow as any;
      setActionItems(newItems);
      setEditingIndex(null);
    } else {
      setActionItems([...actionItems, currentFormRow as any]);
    }
    
    const newActionItems = editingIndex !== null 
        ? actionItems.map((r, i) => i === editingIndex ? currentFormRow : r)
        : [...actionItems, currentFormRow as any];
        
    // reset form to next available item if any
    const availableItem = invoiceItems.find(it => {
        const used = newActionItems.reduce((acc, row) => row.id === it.id ? acc + row.count : acc, 0);
        return (it.quantity - used) > 0;
    });

    if (availableItem) {
        const used = newActionItems.reduce((acc, row) => row.id === availableItem.id ? acc + row.count : acc, 0);
        const remQty = Math.max(0, availableItem.quantity - used);
        setCurrentFormRow({ id: availableItem.id!, count: remQty, outcome: 'approved', reason: subTab === 'parts' ? 'توفرت قطع الغيار' : 'تمت الموافقة' });
    } else {
        setCurrentFormRow({ id: '', count: '', outcome: 'approved', reason: subTab === 'parts' ? 'توفرت قطع الغيار' : 'تمت الموافقة' });
    }
  };

  const handleCancelForm = () => {
      setEditingIndex(null);
      const availableItem = invoiceItems.find(it => getAvailableQuantity(it.id!, -1) > 0);
      if (availableItem) {
        const remQty = getAvailableQuantity(availableItem.id!, -1);
        setCurrentFormRow({ id: availableItem.id!, count: remQty, outcome: 'approved', reason: subTab === 'parts' ? 'توفرت قطع الغيار' : 'تمت الموافقة' });
      } else {
        setCurrentFormRow({ id: '', count: '', outcome: 'approved', reason: subTab === 'parts' ? 'توفرت قطع الغيار' : 'تمت الموافقة' });
      }
  };

  const handleEditTableRow = (index: number) => {
      setCurrentFormRow(actionItems[index]);
      setEditingIndex(index);
  };

  const handleRemoveFormRow = (index: number) => {
      const updated = actionItems.filter((_, i) => i !== index);
      setActionItems(updated);
      if (editingIndex === index) {
          handleCancelForm();
      }
  };

  // Cloned Form Submission Logic
  const saveApprovalData = async (actionType: 'none' | 'print' | 'whatsapp') => {
    if (!selectedInvoice || actionItems.length === 0 || !engineerName.trim()) return;
    setLoadingForm(true);

    try {
      const batch = writeBatch(db);
      let deductedCost = 0;

      // Track remaining quantities
      const itemRemaining = new Map<string, number>();
      for (const row of actionItems) {
        if (!row.id || Number(row.count) <= 0) continue;
        const oItem = invoiceItems.find(i => i.id === row.id);
        if (!oItem) continue;
        if (!itemRemaining.has(oItem.id!)) {
          itemRemaining.set(oItem.id!, Number(oItem.quantity) || 0);
        }
      }

      for (const row of actionItems) {
        if (!row.id || Number(row.count) <= 0) continue;
        const originalItem = invoiceItems.find(i => i.id === row.id);
        if (!originalItem) continue;

        const rowCount = Number(row.count) || 1;
        let rem = itemRemaining.get(originalItem.id!) || 0;
        let unitCost = originalItem.quantity > 0 ? (Number(originalItem.cost || 0) / originalItem.quantity) : 0;

        let updatedStatus = '40'; // approved -> maintenance
        let subStatus = 'repairing';
        let failureReason: string | null = null;
        let finalEngineerReport = originalItem.engineerReport || '';

        if (row.outcome === 'approved') {
          updatedStatus = '40';
          subStatus = 'repairing';
          // Keep existing inspection engineer report intact
          finalEngineerReport = originalItem.engineerReport || '';
        } else if (row.outcome === 'waiting_parts') {
          updatedStatus = '35'; // remains on this page
          subStatus = 'awaiting_parts';
          // Keep the original diagnostic report intact so it's not lost when parts arrive!
          finalEngineerReport = originalItem.engineerReport || '';
          failureReason = row.reason || 'انتظار قطع الغيار';
        } else if (row.outcome === 'refused') {
          updatedStatus = '50'; // goes directly to exit
          subStatus = subTab === 'parts' ? 'no_parts' : 'refused';
          failureReason = row.reason || (subTab === 'parts' ? 'لم تتوفر قطع الغيار' : 'لم يوافق العميل');
          finalEngineerReport = null;
        }

        const isRefused = row.outcome === 'refused';
        const rawItemCost = unitCost * rowCount;
        let splitItemCost = isRefused ? 0 : rawItemCost;
        let splitEstimatedCost = rawItemCost;

        const resolvedEntryDate = resolveEntryDateString(originalItem, selectedInvoice);

        if (rem > rowCount) {
          // split quantity
          const splitItemRef = doc(collection(db, 'invoice_items'));
          batch.set(splitItemRef, {
            ...originalItem,
            id: splitItemRef.id,
            entryDate: resolvedEntryDate,
            quantity: rowCount,
            status: updatedStatus,
            subStatus,
            source: 'approval_details_split',
            cost: splitItemCost,
            unitCost: isRefused ? 0 : unitCost,
            estimatedCost: splitEstimatedCost,
            failureReason,
            engineerReport: finalEngineerReport,
            technician: engineerName,
            createdAt: originalItem.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          rem -= rowCount;
          itemRemaining.set(originalItem.id!, rem);

          batch.update(doc(db, 'invoice_items', originalItem.id!), {
            quantity: rem,
            cost: (unitCost * rem),
            entryDate: resolvedEntryDate,
            updatedAt: serverTimestamp()
          });
        } else {
          // update fully
          batch.update(doc(db, 'invoice_items', originalItem.id!), {
            status: updatedStatus,
            subStatus,
            source: 'approval_details_update',
            quantity: rem,
            cost: splitItemCost,
            unitCost: isRefused ? 0 : unitCost,
            estimatedCost: splitEstimatedCost,
            failureReason,
            engineerReport: finalEngineerReport,
            technician: engineerName,
            entryDate: resolvedEntryDate,
            updatedAt: serverTimestamp()
          });
          itemRemaining.set(originalItem.id!, 0);
        }
      }

      // Calculate final statuses of all items in this invoice
      const finalItemStatuses: string[] = [];
      for (const row of actionItems) {
        if (!row.id || Number(row.count) <= 0) continue;
        const originalItem = invoiceItems.find(i => i.id === row.id);
        if (!originalItem) continue;

        let updatedStatus = '40';
        if (row.outcome === 'approved') {
          updatedStatus = '40';
        } else if (row.outcome === 'waiting_parts') {
          updatedStatus = '35';
        } else if (row.outcome === 'refused') {
          updatedStatus = '50';
        }
        finalItemStatuses.push(updatedStatus);
      }

      const processedItemIds = new Set(actionItems.map(row => row.id));
      const unmodifiedItems = items.filter(it => it.invoiceNumber === selectedInvoice.invoiceNumber && !processedItemIds.has(it.id!));
      unmodifiedItems.forEach(it => {
        finalItemStatuses.push(it.status);
      });

      // Determine overall invoice status
      let finalInvoiceStatus = '50';
      if (finalItemStatuses.some(s => s === '70' || s === 'cancelled')) {
        finalInvoiceStatus = '70';
      } else if (finalItemStatuses.some(s => s === '10' || s === 'new')) {
        finalInvoiceStatus = '10';
      } else if (finalItemStatuses.some(s => s === '20')) {
        finalInvoiceStatus = '20';
      } else if (finalItemStatuses.some(s => s === '30' || s === '35' || s === 'awaiting_approval' || s === 'awaiting_parts')) {
        finalInvoiceStatus = '30';
      } else if (finalItemStatuses.some(s => s === '40' || s === 'repairing')) {
        finalInvoiceStatus = '40';
      }

      // Recompute billable items snapshot for accurate invoice totalCost calculation
      const finalItemsSnapshot: any[] = [];
      const handledOrigIds = new Set<string>();

      for (const row of actionItems) {
        if (!row.id || Number(row.count) <= 0) continue;
        const origItem = invoiceItems.find(i => i.id === row.id);
        if (!origItem) continue;

        const isRef = row.outcome === 'refused';
        const rCount = Number(row.count) || 1;
        const uCost = origItem.quantity > 0 ? (Number(origItem.cost || 0) / origItem.quantity) : 0;
        const rRemaining = itemRemaining.get(origItem.id!) || 0;

        finalItemsSnapshot.push({
          ...origItem,
          cost: isRef ? 0 : (uCost * rCount),
          subStatus: isRef ? (subTab === 'parts' ? 'no_parts' : 'refused') : (row.outcome === 'waiting_parts' ? 'awaiting_parts' : 'repairing'),
          status: isRef ? '50' : (row.outcome === 'waiting_parts' ? '35' : '40'),
          failureReason: isRef ? (row.reason || (subTab === 'parts' ? 'لم تتوفر قطع الغيار' : 'لم يوافق العميل')) : null
        });

        if (!handledOrigIds.has(origItem.id!)) {
          handledOrigIds.add(origItem.id!);
          if (rRemaining > 0) {
            finalItemsSnapshot.push({
              ...origItem,
              quantity: rRemaining,
              cost: uCost * rRemaining
            });
          }
        }
      }

      unmodifiedItems.forEach(it => {
        finalItemsSnapshot.push(it);
      });

      const newInvoiceTotalCost = calculateInvoiceBillableTotal(selectedInvoice, finalItemsSnapshot);

      batch.update(doc(db, 'invoices', selectedInvoice.id!), {
        status: finalInvoiceStatus,
        totalCost: newInvoiceTotalCost,
        updatedAt: serverTimestamp()
      });

      // Record detailed approval action
      const actionRef = doc(collection(db, 'approval_actions'));
      batch.set(actionRef, {
        id: actionRef.id,
        engineerName,
        actionDate: new Date().getTime(),
        type: subTab === 'parts' ? 'parts_details_form' : 'approval_details_form',
        invoiceNumber: selectedInvoice.invoiceNumber,
        customerName: selectedInvoice.customerName,
        updates: actionItems.map(r => ({
          itemId: r.id,
          count: r.count,
          outcome: r.outcome,
          reason: r.reason
        })),
        userId: user.id || 'unknown',
        userName: user.name || 'System',
        createdAt: serverTimestamp()
      });

      // Save user as engineer/technician if we want to save them to the engineers list
      const sanitizedEngName = engineerName.trim().replace(/[\/]/g, '_');
      const engineerRef = doc(db, 'engineers', sanitizedEngName);
      batch.set(engineerRef, { name: engineerName.trim(), updatedAt: serverTimestamp() }, { merge: true });

      await batch.commit();
      
      if (actionType === 'print') {
        setTimeout(handlePrintDirect, 500);
      } else if (actionType === 'whatsapp') {
        await handleExportPDFAndWhatsApp(selectedInvoice);
      }

      setShowPreviewReport(false);
      setSelectedInvoice(null);
    } catch (err) {
      console.error("Error processing customized approval form save:", err);
    } finally {
      setLoadingForm(false);
    }
  };

  const renderPrintReportOverlay = () => {
    if (!activePrintReportInvoice) return null;
    return (
      <PrintPreviewOverlay
        type="invoice"
        data={{
          invoice: {
            ...activePrintReportInvoice,
            customerPhone: getCustomerPhone(activePrintReportInvoice.customerId) || (activePrintReportInvoice as any).customerPhone || ''
          },
          items: items.filter(it => it.invoiceNumber === activePrintReportInvoice.invoiceNumber),
          templateType: subTab === 'parts' ? 'assignment' : 'quotation'
        }}
        onClose={() => setActivePrintReportInvoice(null)}
        shopConfig={shopConfig}
        user={user}
      />
    );
  };

  // SHOW CLONED DETAILED FORM VIEW
  if (selectedInvoice) {
    if (showPreviewReport) {
      return (
        <PrintPreviewOverlay
          type="invoice"
          data={{
            invoice: {
              ...selectedInvoice,
              customerPhone: getCustomerPhone(selectedInvoice.customerId) || (selectedInvoice as any).customerPhone || ''
            },
            items: items.filter(it => it.invoiceNumber === selectedInvoice.invoiceNumber),
            templateType: subTab === 'parts' ? 'assignment' : 'quotation'
          }}
          onClose={() => setShowPreviewReport(false)}
          shopConfig={shopConfig}
          user={user}
          onPrint={() => saveApprovalData('print')}
          onWhatsApp={() => saveApprovalData('whatsapp')}
          onSave={() => saveApprovalData('none')}
          isSaving={loadingForm}
        />
      );
    }

    const isQuantityInvalid = !currentFormRow.count || 
                              isNaN(Number(currentFormRow.count)) || 
                              Number(currentFormRow.count) <= 0 || 
                              (currentFormRow.id ? Number(currentFormRow.count) > getAvailableQuantity(currentFormRow.id, editingIndex !== null ? editingIndex : -1) : true);

    const isApplyDisabled = !currentFormRow.id || isQuantityInvalid;

    return (
      <div className="w-full max-w-full overflow-x-hidden space-y-0 pb-32 md:pb-8 text-right font-sans" dir="rtl">
        {/* Navigation Header */}
        <div className="flex items-center px-4 py-3 border-b border-white/10 bg-[#0a0a0a]/40 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedInvoice(null)} className="p-1.5 bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white border border-amber-500/20 rounded-xl transition-all shadow-md cursor-pointer">
              <ArrowRight size={18} />
            </button>
            <h1 className="text-base font-black text-white m-0 p-0 flex items-center gap-2">
              <Clock size={16} className="text-amber-500" />
              <span>{subTab === 'parts' ? 'إجراء انتظار قطع الغيار' : 'إجراء انتظار الموافقة والقطع'} - #{selectedInvoice.invoiceNumber}</span>
            </h1>
          </div>
          <button 
            type="button"
            onClick={() => setActivePrintReportInvoice(selectedInvoice)}
            className="mr-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
          >
            <Printer size={13} />
            عرض وطباعة التقرير الفني
          </button>
        </div>

        {/* Customer and Engineer Info */}
        <div className="bg-[#1a1a1a] p-4 sm:p-5 border-b border-white/5 space-y-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl -translate-y-10 -translate-x-10"></div>
          
          <div className="flex items-center gap-3 relative z-10">
             <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-gray-400">
                <UserIcon size={20} />
             </div>
             <div>
               <h3 className="text-lg font-bold text-white">{selectedInvoice.customerName}</h3>
               <p className="text-xs text-gray-500 font-mono">{getCustomerPhone(selectedInvoice.customerId)}</p>
             </div>
          </div>

          <div className="pt-3 border-t border-white/5 relative z-10">
            <div className="flex flex-row items-center gap-3 w-full">
              <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">اسم المهندس</label>
              <input 
                type="text" 
                value={engineerName}
                list="engineers-list"
                onChange={e => setEngineerName(e.target.value)}
                onFocus={(e) => {
                  e.target.select();
                  e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:border-amber-500 outline-none transition-all text-xs text-right text-white box-border"
                placeholder="أدخل اسم المهندس المسؤول..."
              />
              <datalist id="engineers-list">
                {engineersList.map((eng, idx) => (
                  <option key={idx} value={eng} />
                ))}
              </datalist>
            </div>
          </div>
        </div>

        {/* Form input section & Temporary Table */}
        <div className="space-y-4 px-0 sm:px-4 py-3">
          {/* Form input section */}
          <div className="bg-[#1a1a1a] p-4 sm:p-5 border-y sm:border border-white/5 rounded-none sm:rounded-2xl relative shadow-md">
             <div className="flex flex-col gap-2.5">
               {/* الجهاز */}
               <div className="flex flex-row items-center gap-2.5 w-full">
                 <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">الجهاز</label>
                 <select 
                   value={currentFormRow.id}
                   onChange={e => handleUpdateCurrentForm('id', e.target.value)}
                   className="flex-1 bg-black/40 border border-white/10 px-3 py-2 focus:border-amber-500 outline-none transition-all rounded-lg text-xs text-right text-white box-border cursor-pointer"
                 >
                   <option value="" disabled>اختر الجهاز</option>
                   {invoiceItems.map((it, itIdx) => {
                     const available = getAvailableQuantity(it.id!, editingIndex !== null ? editingIndex : -1);
                     if (available <= 0 && currentFormRow.id !== it.id) return null;
                     return <option key={it.id ? `appr-opt-${it.id}-${itIdx}` : `appr-opt-idx-${itIdx}`} value={it.id}>{it.deviceType} - {it.deviceName} - متوفر: {available}</option>;
                   })}
                 </select>
               </div>

               {/* الكمية */}
               <div className="flex flex-row items-center gap-2.5 w-full">
                 <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">الكمية</label>
                 <div className="flex-1 flex items-center gap-2">
                   <input 
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      dir="ltr"
                      lang="en"
                      value={currentFormRow.count}
                      onFocus={e => {
                        e.target.select();
                      }}
                      onClick={e => {
                        (e.target as HTMLInputElement).select();
                      }}
                      onKeyDown={e => {
                        if (['-', '+', '.', 'e', 'E', ',', '`', ' ', '/', '*'].includes(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onChange={e => {
                        let cleanValStr = e.target.value.replace(/[^0-9]/g, '');
                        if (cleanValStr === '') {
                          handleUpdateCurrentForm('count', '');
                          return;
                        }
                        let val = parseInt(cleanValStr, 10);
                        if (isNaN(val)) {
                          handleUpdateCurrentForm('count', '');
                          return;
                        }
                        const max = currentFormRow.id ? getAvailableQuantity(currentFormRow.id, editingIndex !== null ? editingIndex : -1) : 1;
                        if (val > max) {
                          val = max;
                        }
                        if (val < 1) {
                          val = 1;
                        }
                        handleUpdateCurrentForm('count', val);
                      }}
                      onBlur={() => {
                        let val = currentFormRow.count;
                        const max = currentFormRow.id ? getAvailableQuantity(currentFormRow.id, editingIndex !== null ? editingIndex : -1) : 1;
                        if (val === '' || isNaN(Number(val)) || Number(val) < 1) {
                          val = Math.max(1, Math.min(1, max));
                        } else {
                          val = Math.floor(Number(val));
                          if (val > max) {
                            val = max;
                          }
                          if (val < 1) {
                            val = 1;
                          }
                        }
                        handleUpdateCurrentForm('count', val);
                      }}
                      className="w-24 bg-black/40 border border-white/10 px-3 py-2 focus:border-amber-500 outline-none transition-all rounded-lg text-xs text-center text-white box-border font-mono font-bold"
                    />
                    {currentFormRow.id && (
                      <span className="text-xs text-gray-400">
                        من إجمالي متاح: <span className="font-mono text-amber-400 font-bold">{getAvailableQuantity(currentFormRow.id, editingIndex !== null ? editingIndex : -1)}</span>
                      </span>
                    )}
                 </div>
               </div>

               {/* حالة الإجراء */}
               <div className="flex flex-row items-center gap-2.5 w-full">
                 <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">حالة الإجراء</label>
                 <div className="flex-1 flex bg-black/40 border border-white/5 p-1 rounded-xl gap-1 box-border">
                   <button 
                     type="button"
                     onClick={() => handleUpdateCurrentForm('outcome', 'approved')}
                     className={`flex-1 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${currentFormRow.outcome === 'approved' ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-400 hover:bg-white/5'}`}
                   >
                     {subTab === 'parts' ? 'وصول قطع الغيار' : 'تمت موافقة العميل'}
                   </button>
                   <button 
                     type="button"
                     onClick={() => handleUpdateCurrentForm('outcome', 'refused')}
                     className={`flex-1 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${currentFormRow.outcome === 'refused' ? 'bg-rose-600 text-white shadow-md' : 'text-gray-400 hover:bg-white/5'}`}
                   >
                     {subTab === 'parts' ? 'عدم توفر قطع' : 'لم يوافق العميل'}
                   </button>
                   <button 
                     type="button"
                     onClick={() => handleUpdateCurrentForm('outcome', 'waiting_parts')}
                     className={`flex-1 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${currentFormRow.outcome === 'waiting_parts' ? 'bg-amber-600 text-white shadow-md' : 'text-gray-400 hover:bg-white/5'}`}
                   >
                     {subTab === 'parts' ? 'ما زال ينتظر قطع الغيار' : 'انتظار قطع الغيار'}
                   </button>
                 </div>
               </div>

               {/* تفاصيل الرد */}
               <div className="flex flex-row items-center gap-2.5 w-full">
                 <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">تفاصيل الرد</label>
                 <input 
                   type="text"
                   value={currentFormRow.reason}
                   onChange={e => handleUpdateCurrentForm('reason', e.target.value)}
                   onFocus={(e) => {
                     e.target.select();
                     e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                   }}
                   onClick={(e) => {
                     (e.target as HTMLInputElement).select();
                   }}
                   className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:border-amber-500 outline-none transition-all text-xs text-right text-white box-border"
                   placeholder="أدخل تفاصيل الرد أو الملاحظات..."
                 />
               </div>

               {/* تقرير الفحص والشكوى للجهاز المختار */}
               {(() => {
                 const selectedItem = invoiceItems.find(i => i.id === currentFormRow.id);
                 if (!selectedItem) return null;
                 return (
                    <div className="flex flex-col gap-2 w-full pt-1">
                      {/* شكوى العميل */}
                      <div className="flex flex-row items-center gap-2.5 w-full">
                        <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">شكوى العميل</label>
                        <div className="flex-1 bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-xs font-medium text-white break-words text-right">
                          {selectedItem.customerProblem || selectedItem.faultType || 'لا يوجد'}
                        </div>
                      </div>
                      {/* تقرير الفحص */}
                      <div className="flex flex-row items-center gap-2.5 w-full">
                        <label className="text-xs text-gray-400 font-bold whitespace-nowrap w-24 shrink-0">تقرير الفحص</label>
                        <div className="flex-1 bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-xs font-medium text-amber-500 break-words text-right">
                          {(() => {
                            const val = selectedItem.engineerReport || '';
                            const splitIdx = val.indexOf(' | ');
                            if (splitIdx !== -1) {
                              return (
                                <div className="flex flex-col gap-1">
                                  <div><span className="text-gray-400">التقرير الفني: </span>{val.substring(0, splitIdx).trim()}</div>
                                  <div className="text-purple-400 font-bold"><span className="text-gray-400">نتيجة الصيانة: </span>{val.substring(splitIdx + 3).trim()}</div>
                                </div>
                              );
                            }
                            return val || 'لا يوجد تقرير فحص مسجل';
                          })()}
                        </div>
                      </div>
                    </div>
                 );
               })()}
             </div>

             <div className="flex justify-end gap-2 pt-3 border-t border-white/5 mt-3">
               <button
                 type="button"
                 onClick={handleCancelForm}
                 className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
               >
                 إلغاء
               </button>
               {editingIndex !== null ? (
                 <button
                   type="button"
                   onClick={handleApplyFormToTable}
                   disabled={isApplyDisabled}
                   className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-black rounded-lg text-xs font-bold shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
                 >
                   تعديل
                 </button>
               ) : (
                 <button
                   type="button"
                   onClick={handleApplyFormToTable}
                   disabled={isApplyDisabled}
                   className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-black rounded-lg text-xs font-bold shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                 >
                   <Plus size={14} />
                   إضافة الجهاز
                 </button>
               )}
             </div>
          </div>

          {/* Table display for actionItems (الجدول المؤقت) */}
          {actionItems.length > 0 && (
             <div className="bg-[#1a1a1a] border-y sm:border border-white/5 rounded-none sm:rounded-xl overflow-hidden mt-4 shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full text-right min-w-[500px]">
                  <thead className="bg-[#111111] border-b border-white/5">
                    <tr className="text-[10px] text-gray-400 whitespace-nowrap">
                      <th className="py-2 px-3 font-bold">النوع</th>
                      <th className="py-2 px-3 font-bold">الموديل / الجهاز</th>
                      <th className="py-2 px-3 font-bold text-center">العدد</th>
                      <th className="py-2 px-3 font-bold text-center">حالة الإجراء</th>
                      <th className="py-2 px-3 font-bold">تفاصيل الرد</th>
                      <th className="py-2 px-3 font-bold w-20 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-gray-300">
                    {actionItems.map((row, idx) => {
                      const it = invoiceItems.find(i => i.id === row.id);
                      return (
                        <tr key={idx} className={`hover:bg-white/[0.02] transition-colors ${editingIndex === idx ? 'bg-amber-500/10' : ''}`}>
                          <td className="py-2 px-3 font-bold text-[11px] whitespace-nowrap">
                            {it?.deviceType || '-'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-[11px]">
                            {it?.deviceName || '-'}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-[11px] whitespace-nowrap text-center">{row.count}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-[11px] text-center">
                            {row.outcome === 'approved' ? (
                              <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] font-bold">
                                {subTab === 'parts' ? 'وصول قطع' : 'تمت الموافقة'}
                              </span>
                            ) : row.outcome === 'refused' ? (
                              <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded text-[10px] font-bold">
                                {subTab === 'parts' ? 'عدم توفر قطع' : 'لم يوافق العميل'}
                              </span>
                            ) : (
                              <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-[10px] font-bold">
                                {subTab === 'parts' ? 'ينتظر قطع' : 'انتظار قطع'}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-[11px]">{row.reason || '-'}</td>
                          <td className="py-2 px-3 flex items-center justify-center gap-1.5 whitespace-nowrap">
                            <button onClick={() => handleEditTableRow(idx)} className="p-1.5 hover:bg-amber-500/20 text-amber-400 rounded-lg transition-colors cursor-pointer" title="تعديل">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => handleRemoveFormRow(idx)} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors cursor-pointer" title="حذف">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Bottom CTA Button */}
        <div className="px-4 sm:px-0 py-3 mb-4" dir="rtl">
           <button 
             type="button"
             onClick={() => {
               if (actionItems.length === 0) {
                 alert("الرجاء الضغط على زر 'إضافة الجهاز' أولاً لإدراج البند في قائمة الإجراءات قبل المعاينة.");
                 return;
               }
               if (!engineerName.trim()) {
                 alert("الرجاء إدخال اسم المهندس المسؤول عن الإجراء أولاً.");
                 return;
               }
               setShowPreviewReport(true);
             }}
             disabled={loadingForm || actionItems.length === 0 || !engineerName.trim() || actionItems.some((r, idx) => Number(r.count) <= 0 || Number(r.count) > getAvailableQuantity(r.id, idx))}
             className="w-full bg-amber-500 hover:bg-amber-600 text-black py-3 font-bold text-sm transition-all flex items-center justify-center gap-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-lg cursor-pointer"
           >
             {loadingForm ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
             معاينة للتعديل والترحيل
           </button>
        </div>
        {renderPrintReportOverlay()}
      </div>
    );
  }

  // STANDARD LIST VIEW: "صفحة انتظار الموافقة والقطع" (Dual View via subTabs)
  const countApprovalDevices = items.filter(i => ['30', 'awaiting_approval'].includes(i.status) && i.quantity > 0).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const countPartsDevices = items.filter(i => ['35', 'awaiting_parts'].includes(i.status) && i.quantity > 0).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  return (
    <div className="w-full space-y-6 pb-20 text-right font-sans pt-4" dir="rtl">
      {/* Large Orange/Amber Dual Stats Counter Card */}
      <div className="px-0">
        <div className="w-full bg-gradient-to-br from-amber-600 via-orange-600 to-amber-700 text-white p-6 rounded-none md:rounded-[2rem] shadow-lg relative overflow-hidden">
          {/* Faint Background Icon */}
          <div className="absolute top-1/2 left-6 -translate-y-1/2 opacity-10 pointer-events-none">
            <Clock size={160} />
          </div>

          <div className="relative z-10 grid grid-cols-2 divide-x divide-white/15 rtl:divide-x-reverse">
            {/* Clickable section 1: Waiting for Customer Approval */}
            <button
              onClick={() => {
                setSubTab('approval');
                setSearch('');
                setDecisions({});
              }}
              className={`flex flex-col items-center justify-center py-4 px-2 transition-all rounded-2xl relative cursor-pointer ${
                subTab === 'approval' 
                  ? 'bg-white/15 shadow-inner scale-[1.02]' 
                  : 'hover:bg-white/5 opacity-80 hover:opacity-100'
              }`}
            >
              {subTab === 'approval' && (
                <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
              )}
              <span className="text-3xl sm:text-5xl font-black font-mono tracking-wider drop-shadow-md">{countApprovalDevices}</span>
              <span className="text-xs sm:text-sm font-bold font-cairo mt-2 text-amber-100">بانتظار موافقة العميل</span>
              <span className="text-[10px] text-amber-200 mt-1 opacity-70">الموافقة على تكلفة الصيانة</span>
            </button>

            {/* Clickable section 2: Waiting for Spare Parts */}
            <button
              onClick={() => {
                setSubTab('parts');
                setSearch('');
                setDecisions({});
              }}
              className={`flex flex-col items-center justify-center py-4 px-2 transition-all rounded-2xl relative cursor-pointer ${
                subTab === 'parts' 
                  ? 'bg-white/15 shadow-inner scale-[1.02]' 
                  : 'hover:bg-white/5 opacity-80 hover:opacity-100'
              }`}
            >
              {subTab === 'parts' && (
                <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
              )}
              <span className="text-3xl sm:text-5xl font-black font-mono tracking-wider drop-shadow-md">{countPartsDevices}</span>
              <span className="text-xs sm:text-sm font-bold font-cairo mt-2 text-amber-100">بانتظار قطع الغيار</span>
              <span className="text-[10px] text-amber-200 mt-1 opacity-70">تأمين المواد اللازمة</span>
            </button>
          </div>
        </div>
      </div>



      {/* Search Input */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between px-4 md:px-8">
        <div className="relative w-full sm:w-80 font-sans">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input 
            type="text" 
            placeholder="البحث باسم العميل أو رقم الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-white/5 rounded-2xl pr-12 pl-4 py-3 focus:border-amber-500 outline-none transition-all text-sm text-right text-white"
          />
        </div>
      </div>

      {/* Main Table - Full Width with zero horizontal margins/borders */}
      <div className="bg-[#1a1a1a] border-y border-white/5 overflow-hidden shadow-2xl w-full">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-right border-collapse select-none">
            <thead className="bg-white/5 border-b border-white/10 text-gray-400 text-[10px] sm:text-xs">
              <tr>
                <th className="px-2 py-2 font-bold text-center whitespace-nowrap w-16 leading-tight">
                  <div>رقم</div>
                  <div className="text-[9px] text-gray-400 font-medium">الفاتورة</div>
                </th>
                <th className="px-3 py-2 font-bold text-right leading-tight">
                  <div>اسم</div>
                  <div className="text-[9px] text-gray-400 font-medium">العميل</div>
                </th>
                <th className="px-2 py-2 font-bold text-center whitespace-nowrap w-14 leading-tight">
                  <div>عدد</div>
                  <div className="text-[9px] text-gray-400 font-medium">الأجهزة</div>
                </th>
                <th className="px-1 py-2 font-bold text-center whitespace-nowrap w-12 sm:w-14 leading-tight">
                  <div>طباعة</div>
                  <div className="text-[8px] sm:text-[9px] text-purple-300 font-medium">التقرير</div>
                </th>
                <th className="px-1 py-2 font-bold text-center whitespace-nowrap w-12 sm:w-14 leading-tight">
                  <div className="text-rose-400">رفض</div>
                  <div className="text-[8px] sm:text-[9px] text-rose-400/80 font-medium">{subTab === 'approval' ? 'العميل' : 'القطع'}</div>
                </th>
                <th className="px-1 py-2 font-bold text-center whitespace-nowrap w-12 sm:w-14 leading-tight">
                  <div className="text-emerald-400">موافق</div>
                  <div className="text-[8px] sm:text-[9px] text-emerald-400/80 font-medium">{subTab === 'approval' ? 'العميل' : 'القطع'}</div>
                </th>
                <th className="px-2 py-2 font-bold text-center whitespace-nowrap w-20 sm:w-24 leading-tight">
                  <div>تنفيذ</div>
                  <div className="text-[9px] text-gray-400 font-medium">الإجراء</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[9px] sm:text-xs">
              {currentInvoices.map((invoice, idx) => {
                const currentDecision = decisions[invoice.id || ''];
                const isLoading = rowLoading[invoice.id || ''];
                
                return (
                  <tr key={invoice.id ? `appr-inv-${invoice.id}-${idx}` : `appr-inv-idx-${idx}`} className="hover:bg-white/5 transition-colors duration-150">
                    <td className="px-2 py-2 font-mono text-white font-bold text-center whitespace-nowrap">{invoice.invoiceNumber}</td>
                    <td className="px-3 py-2 font-bold text-white text-right whitespace-nowrap truncate" title={invoice.customerName}>
                      {invoice.customerName}
                    </td>
                    <td className="px-2 py-2 font-mono text-amber-400 font-bold text-center whitespace-nowrap">{countEligibleDevices(invoice.invoiceNumber)}</td>
                    
                    {/* 1. Print Report Button */}
                    <td className="px-1 py-2 text-center whitespace-nowrap">
                      <button 
                        type="button"
                        onClick={() => setActivePrintReportInvoice(invoice)}
                        title="عرض وطباعة تقرير الفحص الفني وعرض الأسعار"
                        className="p-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white transition-all cursor-pointer border border-purple-500/30 inline-flex items-center justify-center shadow-sm"
                      >
                        <Printer size={13} />
                      </button>
                    </td>

                    {/* 2. Circle choice column "رفض" */}
                    <td className="px-1 py-2 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleDecision(invoice.id!, 'refused')}
                        disabled={isLoading}
                        title={subTab === 'approval' ? 'رفض العميل' : 'عدم توفر القطع'}
                        className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 flex items-center justify-center mx-auto transition-all duration-200 cursor-pointer disabled:opacity-50 ${
                          currentDecision === 'refused'
                            ? 'border-red-500 bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                            : 'border-gray-500 dark:border-white/20 text-transparent hover:border-red-500/50 hover:bg-red-500/10'
                        }`}
                      >
                        <Check size={13} className={currentDecision === 'refused' ? 'opacity-100 text-white' : 'opacity-0'} />
                      </button>
                    </td>

                    {/* 3. Circle choice column "موافق" */}
                    <td className="px-1 py-2 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleDecision(invoice.id!, 'approved')}
                        disabled={isLoading}
                        title={subTab === 'approval' ? 'موافقة العميل' : 'توفرت القطع'}
                        className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 flex items-center justify-center mx-auto transition-all duration-200 cursor-pointer disabled:opacity-50 ${
                          currentDecision === 'approved'
                            ? 'border-emerald-500 bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                            : 'border-gray-500 dark:border-white/20 text-transparent hover:border-emerald-500/50 hover:bg-emerald-500/10'
                        }`}
                      >
                        <Check size={13} className={currentDecision === 'approved' ? 'opacity-100 text-white' : 'opacity-0'} />
                      </button>
                    </td>

                    {/* 4. Action button */}
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button 
                        onClick={() => subTab === 'approval' ? handleProcessActionBtn(invoice) : handleProcessPartsAction(invoice)}
                        disabled={isLoading}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all inline-flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-sm whitespace-nowrap ${
                          currentDecision === 'refused'
                            ? 'bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30'
                            : currentDecision === 'approved'
                            ? 'bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30'
                            : 'bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30'
                        } disabled:opacity-50`}
                      >
                        {isLoading ? (
                          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <span>تنفيذ</span>
                            <ArrowUpRight size={12} className="rtl:-scale-x-100" />
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {pendingInvoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    {subTab === 'approval' 
                      ? 'لا توجد فواتير أو أجهزة بانتظار الموافقة حالياً.' 
                      : 'لا توجد فواتير أو أجهزة بانتظار قطع الغيار حالياً.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-black/20">
            <span className="text-xs text-gray-500 font-bold font-cairo">
              عرض {((safeCurrentPage - 1) * itemsPerPage) + 1} إلى {Math.min(safeCurrentPage * itemsPerPage, pendingInvoices.length)} من أصل {pendingInvoices.length} فاتورة
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ArrowLeft size={16} className="rotate-180" />
              </button>
              
              <div className="flex items-center gap-1 px-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${
                      safeCurrentPage === page 
                        ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' 
                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ArrowLeft size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {renderPrintReportOverlay()}
    </div>
  );
}
