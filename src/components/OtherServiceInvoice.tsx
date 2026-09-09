import React, { useState, useEffect, useCallback } from 'react';
import { CustomerAutocomplete } from './CustomerAutocomplete';
import AddCustomerModal from './AddCustomerModal';
import { PartsAutocomplete } from './PartsAutocomplete';
import PartsCatalogTable from './PartsCatalogTable';
import ShopPartsStockView from './ShopPartsStockView';
import { db, collection, doc, query, onSnapshot, serverTimestamp, writeBatch, runTransaction, getDocs, getDoc, increment, setDoc } from '../firebase';
import { Customer, ShopConfig, User, ShopPartItem, DisassemblyBatch } from '../types';
import { Tag, Wrench, Cpu, CheckCircle, Plus, Trash2, ArrowRight, ArrowLeft, Save, CircleDollarSign, AlertTriangle, Eye, ShoppingCart, Layers, Package, BookOpen, User as UserIcon, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PrintPreviewOverlay from './PrintPreviewOverlay';
import { formatMoney, parseFundBalance } from '../lib/fundUtils';
import { useBackHandler } from '../hooks/useBackHandler';

type ServiceType = 'hub' | 'software' | 'maintenance' | 'parts' | 'purchase' | 'catalog' | 'stock';

export default function OtherServiceInvoice({
  type: initialType = 'hub',
  onBack,
  shopConfig,
  user
}: {
  type: 'hub' | 'software' | 'maintenance' | 'parts' | 'purchase' | 'catalog' | 'stock';
  onBack: () => void;
  shopConfig: ShopConfig | null;
  user: User | null;
}) {
  const { t } = useTranslation();
  
  // Tab State
  const [activeTab, setActiveTab] = useState<ServiceType>(initialType);

  // General Customer & Currency State
  const [customer, setCustomer] = useState({ name: '', phone1: '', phone2: '', notes: '' });
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [existingCustomers, setExistingCustomers] = useState<Customer[]>([]);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [noPhone, setNoPhone] = useState(false);

  // Purchase Tab Supplier State
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  
  const [currency, setCurrency] = useState<'USD' | 'SAR' | 'YER'>(shopConfig?.liabilityCurrency as any || 'USD');

  // Items State for Sales
  const [items, setItems] = useState<{ id: string; name: string; quantity: number; unitCost: number; notes: string; partInventoryId?: string; batchId?: string; batchName?: string; batchTotalCost?: number }[]>([]);
  
  // Current Item State for Sales
  const initialItem = { id: '', name: '', quantity: 1, unitCost: 0, notes: '', partInventoryId: '', batchId: '', batchName: '', batchTotalCost: 0 };
  const [currentItem, setCurrentItem] = useState(initialItem);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [amountPaid, setAmountPaid] = useState<number | ''>('');
  const [amountPaidPurchase, setAmountPaidPurchase] = useState<number | ''>('');
  const [invoiceNotes, setInvoiceNotes] = useState('');

  // Multi-currency Payment Support
  const [paymentInvoiceRate, setPaymentInvoiceRate] = useState<string>('1');
  const [paymentFundRate, setPaymentFundRate] = useState<string>('1');

  // Purchase Tab Specific State
  const [purchaseType, setPurchaseType] = useState<'direct' | 'batch'>('direct');
  
  // Batch Purchase Fields
  const [batchName, setBatchName] = useState('');
  const [totalBatchCost, setTotalBatchCost] = useState<number | ''>('');
  const [purchaseItems, setPurchaseItems] = useState<{ id: string; name: string; category: string; quantity: number; unitCost: number; salePrice: number; notes: string }[]>([]);
  
  // Current Item for Purchase
  const initialPurchaseItem = { id: '', name: '', category: 'قطع غيار وملحقات', quantity: 1, unitCost: 0, salePrice: 0, notes: '' };
  const [currentPurchaseItem, setCurrentPurchaseItem] = useState(initialPurchaseItem);
  const [editingPurchaseIdx, setEditingPurchaseIdx] = useState<number | null>(null);

  // Payment Method & Vault Selection
  const [funds, setFunds] = useState<any[]>([]);
  const [selectedFundId, setSelectedFundId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<'cash' | 'bank'>('cash');
  const [depositorName, setDepositorName] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ invoiceNumber: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [currentOutput, setCurrentOutput] = useState<any>(null);

  // Reset all sales input fields to default
  const resetSalesForm = useCallback(() => {
    setCustomer({ name: '', phone1: '', phone2: '', notes: '' });
    setSelectedCustomerId(null);
    setNoPhone(false);
    setItems([]);
    setCurrentItem({ id: '', name: '', quantity: 1, unitCost: 0, notes: '', partInventoryId: '', batchId: '', batchName: '', batchTotalCost: 0 });
    setEditingIndex(null);
    setAmountPaid('');
    setInvoiceNotes('');
    setPaymentInvoiceRate('1');
    setPaymentFundRate('1');
    setPaymentType('cash');
    setDepositorName('');
    setReferenceNumber('');
    setError(null);
    setShowPreview(false);
    setCurrentOutput(null);
    setCurrency(shopConfig?.liabilityCurrency as any || 'USD');
  }, [shopConfig]);

  // Reset all purchase input fields to default
  const resetPurchaseForm = useCallback(() => {
    setSupplierName('');
    setSupplierPhone('');
    setSelectedCustomerId(null);
    setPurchaseType('direct');
    setBatchName('');
    setTotalBatchCost('');
    setPurchaseItems([]);
    setCurrentPurchaseItem({ id: '', name: '', category: 'قطع غيار وملحقات', quantity: 1, unitCost: 0, salePrice: 0, notes: '' });
    setEditingPurchaseIdx(null);
    setAmountPaidPurchase('');
    setInvoiceNotes('');
    setPaymentInvoiceRate('1');
    setPaymentFundRate('1');
    setPaymentType('cash');
    setDepositorName('');
    setReferenceNumber('');
    setError(null);
    setCurrency(shopConfig?.liabilityCurrency as any || 'USD');
  }, [shopConfig]);

  // Reset all forms completely
  const resetAllForms = useCallback(() => {
    resetSalesForm();
    resetPurchaseForm();
    setSuccessInfo(null);
    setError(null);
  }, [resetSalesForm, resetPurchaseForm]);

  // Navigation handlers that cleanly reset input fields
  const handleSwitchTab = useCallback((newTab: ServiceType) => {
    resetAllForms();
    setActiveTab(newTab);
    localStorage.setItem('otherServicesTab', newTab);
  }, [resetAllForms]);

  const handleGoBackToMain = useCallback(() => {
    resetAllForms();
    onBack();
  }, [resetAllForms, onBack]);

  useEffect(() => {
    resetAllForms();
    setActiveTab(initialType);
  }, [initialType, resetAllForms]);

  // Listen to custom tab change events (e.g. from global back button)
  useEffect(() => {
    const handleTabChange = (e: any) => {
      if (e.detail) {
        resetAllForms();
        setActiveTab(e.detail as ServiceType);
      }
    };
    window.addEventListener('changeOtherServicesTab', handleTabChange);
    return () => {
      window.removeEventListener('changeOtherServicesTab', handleTabChange);
    };
  }, [resetAllForms]);

  // Android hardware back button handler
  const handleInternalBack = useCallback(() => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    if (showAddCustomerModal) {
      setShowAddCustomerModal(false);
      return;
    }
    if (successInfo) {
      resetAllForms();
      return;
    }
    if (activeTab !== 'hub') {
      resetAllForms();
      setActiveTab('hub');
      localStorage.setItem('otherServicesTab', 'hub');
    }
  }, [showPreview, showAddCustomerModal, successInfo, activeTab, resetAllForms]);

  useBackHandler(Boolean(showPreview || showAddCustomerModal || successInfo || activeTab !== 'hub'), handleInternalBack);

  // Load Funds
  useEffect(() => {
    let isMounted = true;
    const fetchFunds = async () => {
      try {
        const { localDb } = await import('../lib/local-db');
        const res = await localDb.query("SELECT * FROM fin_funds");
        if (isMounted && res.values && res.values.length > 0) {
          const activeFunds = res.values.filter((f: any) => f.status !== 'inactive');
          setFunds(activeFunds);
        } else {
          const { ProviderFactory } = await import('../data/ProviderFactory');
          const docsResult: any = await ProviderFactory.getProvider().getDocs('fin_funds');
          const items = Array.isArray(docsResult) ? docsResult : (docsResult?.docs ? docsResult.docs.map((d: any) => ({ id: d.id, ...d.data() })) : []);
          if (isMounted && items.length > 0) {
            const activeFunds = items.filter((f: any) => f.status !== 'inactive');
            setFunds(activeFunds);
          }
        }
      } catch (err) {
        console.warn("Could not load fin_funds:", err);
      }
    };
    fetchFunds();

    const qFunds = query(collection(db, 'fin_funds'));
    const unsub = onSnapshot(qFunds, (snapshot) => {
      if (snapshot.docs.length > 0) {
        const fList = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((f: any) => f.status !== 'inactive');
        setFunds(fList);
      }
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  // Auto-select fund
  useEffect(() => {
    if (funds.length > 0) {
      const filtered = funds.filter(f => (paymentType === 'bank' ? f.type === 'bank' : f.type === 'cash'));
      const matched = filtered.find(f => (f.currency || 'USD') === currency) || filtered[0] || funds[0];
      if (matched && (!selectedFundId || !funds.some(f => f.id === selectedFundId && (paymentType === 'bank' ? f.type === 'bank' : f.type === 'cash')))) {
        setSelectedFundId(matched.id);
      }
    }
  }, [currency, paymentType, funds]);

  // Load existing customers
  useEffect(() => {
    const q = query(collection(db, 'customers'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const custs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setExistingCustomers(custs);
    });
    return () => unsubscribe();
  }, []);

  // Auto-detect customer liability currency
  useEffect(() => {
    let matchedCustomer: Customer | undefined;
    if (selectedCustomerId) {
      matchedCustomer = existingCustomers.find(c => c.id === selectedCustomerId);
    } else if (customer.name && String(customer.name).trim()) {
      matchedCustomer = existingCustomers.find(c => String(c.name || '').trim().toLowerCase() === String(customer.name).trim().toLowerCase());
    } else if (supplierName && String(supplierName).trim()) {
      matchedCustomer = existingCustomers.find(c => String(c.name || '').trim().toLowerCase() === String(supplierName).trim().toLowerCase());
    }

    if (matchedCustomer && matchedCustomer.liabilityCurrency) {
      const uCurrency = String(matchedCustomer.liabilityCurrency).trim().toUpperCase();
      if (['SAR', 'ريال سعودي'].includes(uCurrency)) {
        setCurrency('SAR');
      } else if (['YER', 'ريال يمني'].includes(uCurrency)) {
        setCurrency('YER');
      } else if (['USD', 'دولار'].includes(uCurrency)) {
        setCurrency('USD');
      }
    }
  }, [customer.name, supplierName, selectedCustomerId, existingCustomers]);

  // Load shop parts stock and disassembly batches for live matching & inventory deductions
  const [shopPartsList, setShopPartsList] = useState<any[]>([]);
  const [disassemblyBatchesList, setDisassemblyBatchesList] = useState<any[]>([]);

  useEffect(() => {
    const unsubStock = onSnapshot(collection(db, 'shop_parts_inventory'), (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setShopPartsList(items);
    });
    const unsubBatches = onSnapshot(collection(db, 'disassembly_batches'), (snapshot) => {
      const bList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setDisassemblyBatchesList(bList);
    });
    return () => {
      unsubStock();
      unsubBatches();
    };
  }, []);

  const totalSalesCost = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const paidSales = amountPaid === '' ? 0 : Number(amountPaid);

  const totalPurchaseCostDirect = purchaseItems.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const totalPurchaseCost = purchaseType === 'batch' ? (totalBatchCost === '' ? 0 : Number(totalBatchCost)) : totalPurchaseCostDirect;

  // Handlers for Sale Items
  const handleAddSaleItem = () => {
    if (!currentItem.name.trim() || currentItem.quantity < 1 || currentItem.unitCost < 0) return;
    
    let itemToSave = { ...currentItem };
    // Auto-resolve stock item and batch details if missing or typed manually
    if (activeTab === 'parts') {
      const trimmedName = itemToSave.name.trim().toLowerCase();
      let matchedStock = itemToSave.partInventoryId ? shopPartsList.find(s => s.id === itemToSave.partInventoryId) : null;
      if (!matchedStock) {
        matchedStock = (itemToSave.batchId ? shopPartsList.find(s => s.batchId === itemToSave.batchId && s.name.trim().toLowerCase() === trimmedName) : null)
                    || shopPartsList.find(s => s.name.trim().toLowerCase() === trimmedName && (s.quantity || 0) > 0)
                    || shopPartsList.find(s => s.name.trim().toLowerCase() === trimmedName);
      }
      if (matchedStock) {
        itemToSave.partInventoryId = matchedStock.id;
        if (!itemToSave.batchId && matchedStock.batchId) {
          itemToSave.batchId = matchedStock.batchId;
          itemToSave.batchName = matchedStock.batchName || '';
          itemToSave.batchTotalCost = matchedStock.batchTotalCost || 0;
        }
      }
    }

    if (editingIndex !== null) {
      setItems(curr => {
        const next = [...curr];
        next[editingIndex] = { ...itemToSave };
        return next;
      });
      setEditingIndex(null);
    } else {
      setItems([...items, { ...itemToSave, id: Date.now().toString() }]);
    }
    setCurrentItem(initialItem);
  };

  const handleEditSaleItem = (idx: number) => {
    setEditingIndex(idx);
    setCurrentItem(items[idx]);
  };

  const handleRemoveSaleItem = (idx: number) => {
    if (editingIndex === idx) {
      setEditingIndex(null);
      setCurrentItem(initialItem);
    }
    setItems(items.filter((_, i) => i !== idx));
  };

  // Handlers for Purchase Items
  const handleAddPurchaseItem = () => {
    if (!currentPurchaseItem.name.trim() || currentPurchaseItem.quantity < 1) return;

    if (editingPurchaseIdx !== null) {
      setPurchaseItems(curr => {
        const next = [...curr];
        next[editingPurchaseIdx] = { ...currentPurchaseItem };
        return next;
      });
      setEditingPurchaseIdx(null);
    } else {
      setPurchaseItems([...purchaseItems, { ...currentPurchaseItem, id: Date.now().toString() }]);
    }
    setCurrentPurchaseItem(initialPurchaseItem);
  };

  const handleEditPurchaseItem = (idx: number) => {
    setEditingPurchaseIdx(idx);
    setCurrentPurchaseItem(purchaseItems[idx]);
  };

  const handleRemovePurchaseItem = (idx: number) => {
    if (editingPurchaseIdx === idx) {
      setEditingPurchaseIdx(null);
      setCurrentPurchaseItem(initialPurchaseItem);
    }
    setPurchaseItems(purchaseItems.filter((_, i) => i !== idx));
  };
  // Final Execution for Purchases ("إتمام عملية الشراء وتغذية المخزون والخزينة")
  const handleSavePurchase = async () => {
    if (!supplierName.trim()) {
      setError("الرجاء إدخال اسم المورد أو البائع");
      return;
    }
    if (purchaseType === 'batch' && (!batchName.trim() || totalBatchCost === '' || Number(totalBatchCost) <= 0)) {
      setError("الرجاء إدخال اسم جهاز/دفعة التفكيك وإجمالي قيمة الشراء الصحيحة");
      return;
    }
    if (purchaseItems.length === 0) {
      setError("الرجاء إضافة صنف واحد على الأقل للمشتريات");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const batchOp = writeBatch(db);
      const batchDocRef = doc(collection(db, 'disassembly_batches'));
      const batchId = batchDocRef.id;
      const batchNumber = `DIS-${Math.floor(1000 + Math.random() * 9000)}`;

      // 1. Determine or create Customer record for supplier
      let finalCustomerId = selectedCustomerId || '';
      let customerNumberForUpdate: number | null = null;
      if (!finalCustomerId && supplierName && String(supplierName).trim()) {
        const matched = existingCustomers.find(c => String(c.name || '').trim().toLowerCase() === String(supplierName).trim().toLowerCase());
        if (matched) {
          finalCustomerId = matched.id;
        }
      }
      if (!finalCustomerId && supplierName && String(supplierName).trim()) {
        const settingsRef = doc(db, 'settings', 'app');
        try {
          const nextCustomerNumber = await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(settingsRef);
            let currentNum = 1;
            if (sfDoc.exists()) {
              currentNum = (sfDoc.data().lastCustomerNumber || 0) + 1;
            }
            return currentNum;
          });
          customerNumberForUpdate = nextCustomerNumber;
        } catch (e) {
           console.warn("Transaction for customer number failed", e);
           customerNumberForUpdate = Math.floor(Math.random() * 1000000);
        }
        
        const custRef = doc(collection(db, 'customers'));
        finalCustomerId = custRef.id;
        batchOp.set(custRef, {
          id: finalCustomerId,
          customerNumber: customerNumberForUpdate,
          name: supplierName.trim(),
          phone1: supplierPhone?.trim() || 'لا يوجد',
          liabilityCurrency: currency,
          createdAt: serverTimestamp(),
          hasWhatsapp: false,
          notes: 'مورد / عميل تم إنشاؤه من الشراء'
        });
      }

      // Generate invoice number O-xxx
      let maxOtherNum = 0;
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'app'));
        if (settingsDoc.exists() && settingsDoc.data().lastOtherInvoiceNumber) {
          maxOtherNum = Number(settingsDoc.data().lastOtherInvoiceNumber) || 0;
        }
        try {
          const { localDb } = await import('../lib/local-db');
          const resNum = await localDb.query("SELECT MAX(CAST(REPLACE(invoiceNumber, 'O-', '') AS INTEGER)) as maxNum FROM invoices WHERE invoiceNumber LIKE 'O-%'");
          if (resNum.values?.[0]?.maxNum) {
            const localMax = Number(resNum.values[0].maxNum);
            if (localMax > maxOtherNum) maxOtherNum = localMax;
          }
        } catch(e) {}
      } catch (e) {
        console.warn(e);
      }
      const nextOtherNum = maxOtherNum + 1;
      const assignedPurchaseNumber = `O-${nextOtherNum}`;
      
      const settingsRef = doc(db, 'settings', 'app');
      const settingsUpdates: any = { lastOtherInvoiceNumber: nextOtherNum };
      if (customerNumberForUpdate !== null) {
        settingsUpdates.lastCustomerNumber = customerNumberForUpdate;
      }
      batchOp.set(settingsRef, settingsUpdates, { merge: true });

      const paidAmount = amountPaidPurchase === '' ? 0 : Number(amountPaidPurchase);

      // 2. Create Purchase Invoice document in 'invoices' collection
      const purInvoiceRef = doc(collection(db, 'invoices'));
      const purInvoicePayload = {
        id: purInvoiceRef.id,
        invoiceNumber: assignedPurchaseNumber,
        customerId: finalCustomerId,
        customerName: supplierName.trim(),
        supplierId: finalCustomerId,
        supplierName: supplierName.trim(),
        currency,
        totalCost: totalPurchaseCost,
        amountPaid: paidAmount,
        status: 'delivered',
        invoiceType: 'purchase',
        type: 'purchase',
        templateType: 'purchase',
        isPurchase: 1,
        purchaseType: purchaseType,
        batchId: purchaseType === 'batch' ? batchId : '',
        batchName: purchaseType === 'batch' ? batchName.trim() : '',
        batchTotalCost: purchaseType === 'batch' ? Number(totalBatchCost) : 0,
        notes: invoiceNotes.trim() ? invoiceNotes.trim() : 'لا يوجد',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      batchOp.set(purInvoiceRef, purInvoicePayload);

      // 3. If batch purchase, create DisassemblyBatch record
      if (purchaseType === 'batch') {
        const batchPayload = {
          id: batchId,
          batchNumber,
          batchName: batchName.trim(),
          supplierName: supplierName.trim(),
          currency,
          totalBatchCost: Number(totalBatchCost),
          recoveredAmount: 0,
          isCostFullyRecovered: false,
          itemsCount: purchaseItems.length,
          fundId: selectedFundId,
          purchaseDate: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        batchOp.set(doc(db, 'disassembly_batches', batchId), batchPayload);
      }

      // 4. Add/Update items in parts_catalog & shop_parts_inventory
      for (const item of purchaseItems) {
        // Master Catalog update
        const cleanName = item.name.trim();
        const catDocId = cleanName.replace(/\//g, '_');
        batchOp.set(doc(db, 'parts_catalog', catDocId), {
          id: cleanName,
          name: cleanName,
          category: item.category || 'قطع غيار وملحقات',
          defaultCost: item.unitCost || 0,
          defaultSalePrice: item.salePrice || 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        // Shop Parts Inventory entry
        const invDocRef = doc(collection(db, 'shop_parts_inventory'));
        batchOp.set(invDocRef, {
          id: invDocRef.id,
          name: item.name.trim(),
          category: item.category || 'قطع غيار وملحقات',
          quantity: item.quantity,
          unitCost: purchaseType === 'batch' ? (totalBatchCost ? Number(totalBatchCost) / purchaseItems.length : 0) : item.unitCost,
          salePrice: item.salePrice,
          isDisassemblyBatch: purchaseType === 'batch',
          batchId: purchaseType === 'batch' ? batchId : '',
          batchName: purchaseType === 'batch' ? batchName.trim() : '',
          batchTotalCost: purchaseType === 'batch' ? Number(totalBatchCost) : 0,
          supplierName: supplierName.trim(),
          purchaseInvoiceId: purInvoiceRef.id,
          purchaseInvoiceNumber: assignedPurchaseNumber,
          currency,
          purchaseDate: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Store invoice items as well so they appear in statements/logs
        const invoiceItemRef = doc(collection(db, 'invoice_items'));
        const purchaseIso = new Date().toISOString();
        batchOp.set(invoiceItemRef, {
          id: invoiceItemRef.id,
          invoiceId: purInvoiceRef.id,
          invoiceNumber: assignedPurchaseNumber,
          customerId: finalCustomerId,
          customerName: supplierName.trim(),
          deviceType: item.name.trim(),
          deviceName: item.name.trim(),
          quantity: item.quantity,
          cost: item.quantity * item.unitCost,
          unitCost: purchaseType === 'batch' ? (totalBatchCost ? Number(totalBatchCost) / purchaseItems.length : 0) : item.unitCost,
          status: 'delivered',
          source: 'purchase',
          isPurchase: 1,
          partInventoryId: invDocRef.id,
          batchId: purchaseType === 'batch' ? batchId : '',
          batchName: purchaseType === 'batch' ? batchName.trim() : '',
          deviceNotes: item.notes || '',
          entryDate: purchaseIso,
          createdAt: serverTimestamp(),
          createdBy: user?.name || 'System'
        });
      }

      // 5. Disburse Funds from Vault
      const chosenFund = funds.find(f => f.id === selectedFundId) || funds[0];
      if (chosenFund && paidAmount > 0) {
        let nextVoucherNum = 1000;
        try {
          const { localDb } = await import('../lib/local-db');
          const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
          nextVoucherNum = (resNum.values?.[0]?.maxNum || 1000) + 1;
        } catch (e) {
          nextVoucherNum = 1001;
        }

        const txRef = doc(collection(db, 'vault_transactions'));
        
        const fundCurrency = chosenFund.currency || 'USD';
        let liabilityAmount = paidAmount;
        let receiptAmount = paidAmount;
        const normalizeCurrency = (c: string) => c?.toUpperCase().trim();
        if (normalizeCurrency(currency) !== normalizeCurrency(fundCurrency)) {
          const invRate = Number(paymentInvoiceRate) || 1;
          const fundRate = Number(paymentFundRate) || 1;
          receiptAmount = (liabilityAmount / invRate) * fundRate;
        }

        const txPayload = {
          id: txRef.id,
          currency: fundCurrency,
          amount: receiptAmount,
          customerName: supplierName.trim(),
          invoiceNumber: assignedPurchaseNumber,
          userName: user?.name || user?.username || 'المدير العام',
          userId: user?.id || 'admin',
          timestamp: serverTimestamp(),
          type: 'payment',
          notes: `سند صرف قيمة فاتورة مشتريات رقم ${assignedPurchaseNumber}${invoiceNotes.trim() && invoiceNotes.trim() !== 'لا يوجد' ? ` - ${invoiceNotes.trim()}` : ''}`,
          voucherNumber: nextVoucherNum,
          transactionCategory: 'مشتريات قطع وملحقات',
          fundId: chosenFund.id,
          fundName: chosenFund.name,
          customerId: finalCustomerId,
          paymentType: paymentType === 'bank' ? 2 : 1,
          liabilityCurrency: currency,
          liabilityAmount: liabilityAmount,
          receiptCurrency: fundCurrency,
          receiptAmount: receiptAmount,
          status: 'completed',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        batchOp.set(txRef, txPayload);

        // Deduct from fund balance
        const fundRef = doc(db, 'fin_funds', chosenFund.id);
        batchOp.update(fundRef, {
          balance: increment(-receiptAmount)
        });
      }

      await batchOp.commit();

      // Reset Purchase Form & Show Success Alert
      resetPurchaseForm();
      setSuccessInfo({ invoiceNumber: assignedPurchaseNumber });
      alert(`تم إتمام عملية الشراء وسند الصرف بنجاح وتحديث مخزون المحل والخزينة!\nالقيمة الإجمالية: ${formatMoney(totalPurchaseCost, currency)}`);
      setActiveTab('stock');
      localStorage.setItem('otherServicesTab', 'stock');
    } catch (err: any) {
      console.error("Error saving purchase:", err);
      setError(err.message || 'حدث خطأ أثناء حفظ عملية الشراء');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview Generator for Sales Invoices
  const generateOutputData = async () => {
    if (!customer.name.trim()) {
      setError("الرجاء إدخال اسم العميل");
      return null;
    }
    if (!noPhone && !customer.phone1.trim()) {
      setError("الرجاء إدخال رقم هاتف العميل أو تحديد خيار (بدون)");
      return null;
    }
    if (items.length === 0) {
      setError("الرجاء إضافة صنف واحد على الأقل");
      return null;
    }

    return {
      invoice: {
        invoiceNumber: 'PREVIEW',
        customerName: customer.name,
        currency,
        totalCost: totalSalesCost,
        amountPaid: paidSales,
        status: 'delivered',
        notes: invoiceNotes,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: items.map(item => ({
        ...item,
        deviceType: item.name,
        deviceName: '',
        faultType: item.notes,
        cost: item.quantity * item.unitCost
      })),
      templateType: `sale_${activeTab}`,
    };
  };

  const handlePreviewInit = async () => {
    const data = await generateOutputData();
    if (data) {
      setCurrentOutput(data);
      setShowPreview(true);
      setError(null);
    }
  };

  // Final Execution for Sales Invoices ("حفظ وإصدار الفاتورة")
  const handleSaveFinal = async (action: 'save' | 'print' | 'whatsapp') => {
    if (!customer.name.trim()) {
      setError("الرجاء إدخال اسم العميل");
      return;
    }
    if (!noPhone && !customer.phone1.trim()) {
      setError("الرجاء إدخال رقم هاتف العميل أو تحديد خيار (بدون)");
      return;
    }
    if (items.length === 0) {
      setError("الرجاء إضافة صنف واحد على الأقل");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const batch = writeBatch(db);
      
      let finalCustomerId = selectedCustomerId;
      let customerNumberForUpdate: number | null = null;
      if (!selectedCustomerId && customer.name && String(customer.name).trim()) {
        const matched = existingCustomers.find(c => String(c.name || '').trim().toLowerCase() === String(customer.name).trim().toLowerCase());
        if (matched) {
          finalCustomerId = matched.id;
        }
      }
      if (!finalCustomerId) {
        const settingsRef = doc(db, 'settings', 'app');
        const nextCustomerNumber = await runTransaction(db, async (transaction) => {
          const sfDoc = await transaction.get(settingsRef);
          let currentNum = 1;
          if (sfDoc.exists()) {
            currentNum = (sfDoc.data().lastCustomerNumber || 0) + 1;
          }
          return currentNum;
        });
        customerNumberForUpdate = nextCustomerNumber;
        const customerRef = doc(collection(db, 'customers'));
        batch.set(customerRef, {
          id: customerRef.id,
          customerNumber: nextCustomerNumber,
          name: customer.name.trim(),
          phone1: noPhone ? 'لا يوجد' : customer.phone1.trim(),
          phone2: customer.phone2?.trim() || '',
          notes: customer.notes?.trim() || '',
          liabilityCurrency: currency,
          createdAt: serverTimestamp(),
          hasWhatsapp: false
        });
        finalCustomerId = customerRef.id;
      }

      // Max invoice number
      let maxOtherNum = 0;
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'app'));
        if (settingsDoc.exists() && settingsDoc.data().lastOtherInvoiceNumber) {
          maxOtherNum = Number(settingsDoc.data().lastOtherInvoiceNumber) || 0;
        }
        try {
          const { localDb } = await import('../lib/local-db');
          const resNum = await localDb.query("SELECT MAX(CAST(REPLACE(invoiceNumber, 'O-', '') AS INTEGER)) as maxNum FROM invoices WHERE invoiceNumber LIKE 'O-%'");
          if (resNum.values?.[0]?.maxNum) {
            const localMax = Number(resNum.values[0].maxNum);
            if (localMax > maxOtherNum) maxOtherNum = localMax;
          }
        } catch(e) {}
      } catch (e) {
        console.warn(e);
      }

      const nextOtherNum = maxOtherNum + 1;
      const finalAssignedInvoiceNumber = `O-${nextOtherNum}`;

      const settingsRef = doc(db, 'settings', 'app');
      const settingsUpdates: any = { lastOtherInvoiceNumber: nextOtherNum };
      if (customerNumberForUpdate !== null) {
        settingsUpdates.lastCustomerNumber = customerNumberForUpdate;
      }
      batch.set(settingsRef, settingsUpdates, { merge: true });

      const timestampIsoStr = new Date().toISOString();
      const invoiceRef = doc(collection(db, 'invoices'));
      const invoiceDataToSave = {
        id: invoiceRef.id,
        invoiceNumber: finalAssignedInvoiceNumber,
        customerId: finalCustomerId,
        customerName: customer.name,
        currency,
        totalCost: totalSalesCost,
        amountPaid: paidSales,
        status: 'delivered', 
        invoiceType: `sale_${activeTab}`,
        notes: invoiceNotes.trim() ? invoiceNotes.trim() : 'لا يوجد',
        date: timestampIsoStr,
        entryDate: timestampIsoStr,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      batch.set(invoiceRef, invoiceDataToSave);

      // Save Invoice Items & Update Disassembly Batches / Stock
      for (const item of items) {
        let finalPartInventoryId = item.partInventoryId || '';
        let finalBatchId = item.batchId || '';
        let finalBatchName = item.batchName || '';

        // Verify stock item against active stock to prevent creating phantom negative records
        let stockItem = finalPartInventoryId ? shopPartsList.find(s => s.id === finalPartInventoryId) : null;
        if (!stockItem && item.name) {
          const trimmedName = item.name.trim().toLowerCase();
          stockItem = (finalBatchId ? shopPartsList.find(s => s.batchId === finalBatchId && s.name.trim().toLowerCase() === trimmedName) : null)
                   || shopPartsList.find(s => s.name.trim().toLowerCase() === trimmedName && (s.quantity || 0) > 0)
                   || shopPartsList.find(s => s.name.trim().toLowerCase() === trimmedName);
        }

        if (stockItem) {
          finalPartInventoryId = stockItem.id;
          if (!finalBatchId && stockItem.batchId) {
            finalBatchId = stockItem.batchId;
            finalBatchName = stockItem.batchName || '';
          }
        } else {
          // If no matching stock item in shop_parts_inventory, clear ID so it doesn't corrupt database with ghost records
          finalPartInventoryId = '';
        }

        const itemRef = doc(collection(db, 'invoice_items'));
        batch.set(itemRef, {
          id: itemRef.id,
          invoiceId: invoiceRef.id,
          invoiceNumber: finalAssignedInvoiceNumber,
          customerId: finalCustomerId,
          customerName: customer.name,
          deviceType: item.name,
          deviceName: item.name,
          quantity: item.quantity,
          cost: item.quantity * item.unitCost,
          unitCost: item.unitCost,
          status: 'delivered',
          source: `sale_${activeTab}`,
          partInventoryId: finalPartInventoryId,
          batchId: finalBatchId,
          batchName: finalBatchName,
          deviceNotes: item.notes || '',
          entryDate: timestampIsoStr,
          createdAt: serverTimestamp(),
          createdBy: user?.name || 'System'
        });

        // Deduct quantity from shop stock ONLY if verified stock item exists
        if (finalPartInventoryId) {
          const invRef = doc(db, 'shop_parts_inventory', finalPartInventoryId);
          batch.update(invRef, {
            quantity: increment(-item.quantity),
            updatedAt: serverTimestamp()
          });
        }

        // Batch Cost Recovery calculation
        if (finalBatchId) {
          const batchRef = doc(db, 'disassembly_batches', finalBatchId);
          const saleRevenue = item.quantity * item.unitCost;
          
          // Check if batch reaches or exceeds total batch cost
          const matchedBatch = disassemblyBatchesList.find(b => b.id === finalBatchId);
          const currentRec = Number(matchedBatch?.recoveredAmount || 0);
          const totalCost = Number(matchedBatch?.totalBatchCost || 0);
          const newEstimatedRec = currentRec + saleRevenue;
          const isFullyRecovered = totalCost > 0 && newEstimatedRec >= totalCost;

          // Increment recovered amount on batch
          batch.update(batchRef, {
            recoveredAmount: increment(saleRevenue),
            isCostFullyRecovered: isFullyRecovered ? 1 : 0,
            updatedAt: serverTimestamp()
          });
        }
      }

      // Record Deposit in Vault
      if (paidSales > 0) {
        let nextNum = 1000;
        try {
          const { localDb } = await import('../lib/local-db');
          const resNum = await localDb.query("SELECT COALESCE(MAX(voucherNumber), 1000) as maxNum FROM vault_transactions");
          nextNum = (resNum.values?.[0]?.maxNum || 1000) + 1;
        } catch (e) {
          nextNum = 1001;
        }

        const chosenFund = funds.find(f => f.id === selectedFundId) || funds[0];
        
        const fundCurrency = chosenFund?.currency || 'USD';
        let liabilityAmount = paidSales;
        let receiptAmount = paidSales;
        const normalizeCurrency = (c: string) => c?.toUpperCase().trim();
        if (normalizeCurrency(currency) !== normalizeCurrency(fundCurrency)) {
          const invRate = Number(paymentInvoiceRate) || 1;
          const fundRate = Number(paymentFundRate) || 1;
          receiptAmount = (liabilityAmount / invRate) * fundRate;
        }

        const txRef = doc(collection(db, 'vault_transactions'));
        
        batch.set(txRef, {
          id: txRef.id,
          currency: fundCurrency,
          amount: receiptAmount,
          customerName: customer.name || 'عميل نقدي',
          invoiceNumber: String(finalAssignedInvoiceNumber),
          userName: user?.name || 'المدير العام',
          userId: user?.id || 'admin',
          timestamp: serverTimestamp(),
          type: 'receipt',
          notes: `سند قبض / سداد في فاتورة مبيعات رقم ${finalAssignedInvoiceNumber}${invoiceNotes.trim() && invoiceNotes.trim() !== 'لا يوجد' ? ` - ${invoiceNotes.trim()}` : ''}`,
          voucherNumber: nextNum,
          transactionCategory: 'مبيعات قطع وخدمات',
          fundId: chosenFund ? chosenFund.id : '',
          fundName: chosenFund ? chosenFund.name : 'الخزينة الرئيسية',
          customerId: finalCustomerId || '',
          paymentType: paymentType === 'bank' ? 2 : 1,
          liabilityCurrency: currency,
          liabilityAmount: liabilityAmount,
          receiptCurrency: fundCurrency,
          receiptAmount: receiptAmount,
          status: 'completed',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        if (chosenFund) {
          const fundRef = doc(db, 'fin_funds', chosenFund.id);
          batch.update(fundRef, {
            balance: increment(receiptAmount)
          });
        }
      }

      await batch.commit();
      resetSalesForm();
      setSuccessInfo({ invoiceNumber: String(finalAssignedInvoiceNumber) });

      if (action === 'save') {
        setShowPreview(false);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'حدث خطأ أثناء الحفظ');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (activeTab === 'hub') {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-6 pb-12 text-right animate-fadeIn px-0 sm:px-4 font-cairo" dir="rtl">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="p-3 bg-indigo-500/20 rounded-xl">
              <Wrench size={28} className="text-indigo-400" />
            </div>
            خدمات أخرى
          </h2>
          <button 
            type="button"
            onClick={handleGoBackToMain}
            className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 flex items-center gap-2 cursor-pointer"
          >
            <span className="text-sm font-bold">رجوع للرئيسية</span>
            <ArrowRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <button 
            type="button"
            onClick={() => handleSwitchTab('software')}
            className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 text-white p-6 rounded-2xl transition-all hover:scale-[1.01] shadow-lg group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-cyan-500/10 rounded-xl group-hover:bg-cyan-500/20 transition-colors">
                <Cpu size={32} className="text-cyan-400" />
              </div>
              <div className="text-right">
                <h3 className="font-black text-xl mb-1">خدمات برمجية</h3>
                <p className="text-sm text-gray-400">إصدار فواتير للبرمجيات وخدمات النظام</p>
              </div>
            </div>
            <ArrowLeft size={24} className="text-gray-500 group-hover:text-cyan-400 transition-colors" />
          </button>

          <button 
            type="button"
            onClick={() => handleSwitchTab('maintenance')}
            className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 text-white p-6 rounded-2xl transition-all hover:scale-[1.01] shadow-lg group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-amber-500/10 rounded-xl group-hover:bg-amber-500/20 transition-colors">
                <Wrench size={32} className="text-amber-400" />
              </div>
              <div className="text-right">
                <h3 className="font-black text-xl mb-1">صيانة خارجية</h3>
                <p className="text-sm text-gray-400">إصدار فواتير لخدمات الصيانة خارج المحل</p>
              </div>
            </div>
            <ArrowLeft size={24} className="text-gray-500 group-hover:text-amber-400 transition-colors" />
          </button>

          <button 
            type="button"
            onClick={() => handleSwitchTab('parts')}
            className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 text-white p-6 rounded-2xl transition-all hover:scale-[1.01] shadow-lg group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-emerald-500/10 rounded-xl group-hover:bg-emerald-500/20 transition-colors">
                <Tag size={32} className="text-emerald-400" />
              </div>
              <div className="text-right">
                <h3 className="font-black text-xl mb-1">بيع قطع غيار وملحقات</h3>
                <p className="text-sm text-gray-400">إصدار فواتير مبيعات القطع والإكسسوارات</p>
              </div>
            </div>
            <ArrowLeft size={24} className="text-gray-500 group-hover:text-emerald-400 transition-colors" />
          </button>

          <button 
            type="button"
            onClick={() => handleSwitchTab('purchase')}
            className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 text-white p-6 rounded-2xl transition-all hover:scale-[1.01] shadow-lg group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-purple-500/10 rounded-xl group-hover:bg-purple-500/20 transition-colors">
                <ShoppingCart size={32} className="text-purple-400" />
              </div>
              <div className="text-right">
                <h3 className="font-black text-xl mb-1">شراء قطع وملحقات</h3>
                <p className="text-sm text-gray-400">إدخال مشتريات وتحديث مخزون المحل</p>
              </div>
            </div>
            <ArrowLeft size={24} className="text-gray-500 group-hover:text-purple-400 transition-colors" />
          </button>

          <button 
            type="button"
            onClick={() => handleSwitchTab('catalog')}
            className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 text-white p-6 rounded-2xl transition-all hover:scale-[1.01] shadow-lg group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-blue-500/10 rounded-xl group-hover:bg-blue-500/20 transition-colors">
                <BookOpen size={32} className="text-blue-400" />
              </div>
              <div className="text-right">
                <h3 className="font-black text-xl mb-1">دليل القطع والملحقات</h3>
                <p className="text-sm text-gray-400">إدارة وتسجيل أصناف وأنواع القطع</p>
              </div>
            </div>
            <ArrowLeft size={24} className="text-gray-500 group-hover:text-blue-400 transition-colors" />
          </button>

          <button 
            type="button"
            onClick={() => handleSwitchTab('stock')}
            className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 text-white p-6 rounded-2xl transition-all hover:scale-[1.01] shadow-lg group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-indigo-500/10 rounded-xl group-hover:bg-indigo-500/20 transition-colors">
                <Package size={32} className="text-indigo-400" />
              </div>
              <div className="text-right">
                <h3 className="font-black text-xl mb-1">مخزون ودفوعات المحل</h3>
                <p className="text-sm text-gray-400">متابعة وعرض كميات القطع والملحقات</p>
              </div>
            </div>
            <ArrowLeft size={24} className="text-gray-500 group-hover:text-indigo-400 transition-colors" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-cairo text-right" dir="rtl">
      {/* Top Navigation - Back to Hub */}
      <div className="flex justify-between items-center bg-[#121212] p-4 rounded-2xl border border-white/5 shadow-2xl">
        <h2 className="text-xl font-black text-white flex items-center gap-3">
          {activeTab === 'software' && <><Cpu className="text-cyan-400" size={24} /> خدمات برمجية</>}
          {activeTab === 'maintenance' && <><Wrench className="text-amber-400" size={24} /> صيانة خارجية</>}
          {activeTab === 'parts' && <><Tag className="text-emerald-400" size={24} /> بيع قطع غيار وملحقات</>}
          {activeTab === 'purchase' && <><ShoppingCart className="text-purple-400" size={24} /> شراء قطع وملحقات</>}
          {activeTab === 'catalog' && <><BookOpen className="text-blue-400" size={24} /> دليل القطع والملحقات</>}
          {activeTab === 'stock' && <><Package className="text-indigo-400" size={24} /> مخزون ودفوعات المحل</>}
        </h2>
        
        <div className="flex items-center gap-2">
          {['software', 'maintenance', 'parts', 'purchase'].includes(activeTab) && !successInfo && (
            <button
              type="button"
              onClick={resetAllForms}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 flex items-center gap-1.5 text-xs font-bold font-cairo cursor-pointer"
              title="إعادة تهيئة وتفريغ جميع حقول الإدخال"
            >
              <RotateCcw size={14} />
              <span>إعادة تهيئة الحقول</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSwitchTab('hub')}
            className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 flex items-center gap-2 cursor-pointer"
          >
            <span className="text-sm font-bold">العودة للخدمات</span>
            <ArrowRight size={20} />
          </button>
        </div>
      </div>

      {/* SUCCESS SCREEN */}
      {successInfo && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={36} />
          </div>
          <h3 className="text-xl font-black text-white">تم حفظ العملية بنجاح!</h3>
          <p className="text-sm text-emerald-300">رقم الفاتورة: <span className="font-mono font-bold">{successInfo.invoiceNumber}</span></p>

          <div className="flex justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={resetAllForms}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-lg shadow-emerald-900/20"
            >
              إجراء عملية جديدة
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: CATALOG MANAGEMENT */}
      {activeTab === 'catalog' && <PartsCatalogTable />}

      {/* TAB 2: SHOP STOCK & PURCHASES VIEW */}
      {activeTab === 'stock' && <ShopPartsStockView />}

      {/* TAB 3: PURCHASE PARTS & ACCESSORIES ("شراء قطع وملحقات") */}
      {activeTab === 'purchase' && !successInfo && (
        <div className="space-y-6 pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Column (Supplier, Batch details, Item Entry Form, Items List) */}
            <div className="lg:col-span-2 space-y-6">
              {/* Supplier Details */}
              <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
                <div className="flex flex-row items-center justify-between pb-3 border-b border-white/5 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black text-white flex items-center gap-2 shrink-0">
                      <UserIcon size={16} className="text-purple-400" />
                      <span>تفاصيل المورد</span>
                    </h3>
                    <button
                      type="button"
                      onClick={resetPurchaseForm}
                      className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg border border-white/5 text-[10px] font-bold font-cairo flex items-center gap-1 transition-all cursor-pointer"
                      title="إعادة تهيئة وتفريغ حقول الشراء"
                    >
                      <RotateCcw size={11} />
                      <span>تفريغ الحقول</span>
                    </button>
                  </div>

                  <div className="flex flex-row items-center justify-end gap-3 shrink-0 flex-wrap" title="تحديد عملة الشراء">
                    <label className="flex items-center gap-1 cursor-pointer group">
                      <input 
                        type="radio" 
                        name="purchase_currency_radio"
                        value="USD" 
                        checked={currency === 'USD'} 
                        onChange={(e) => setCurrency(e.target.value as any)} 
                        className="w-3.5 h-3.5 accent-purple-500 cursor-pointer mb-0.5" 
                      />
                      <span className={`text-[10px] font-bold transition-colors ${currency === 'USD' ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>دولار </span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer group">
                      <input 
                        type="radio" 
                        name="purchase_currency_radio"
                        value="SAR" 
                        checked={currency === 'SAR'} 
                        onChange={(e) => setCurrency(e.target.value as any)} 
                        className="w-3.5 h-3.5 accent-purple-500 cursor-pointer mb-0.5" 
                      />
                      <span className={`text-[10px] font-bold transition-colors ${currency === 'SAR' ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>سعودي </span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer group">
                      <input 
                        type="radio" 
                        name="purchase_currency_radio"
                        value="YER" 
                        checked={currency === 'YER'} 
                        onChange={(e) => setCurrency(e.target.value as any)} 
                        className="w-3.5 h-3.5 accent-purple-500 cursor-pointer mb-0.5" 
                      />
                      <span className={`text-[10px] font-bold transition-colors ${currency === 'YER' ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>ريال </span>
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold flex items-center gap-2">
                    <AlertTriangle size={16} />
                    <span>{error}</span>
                  </div>
                )}

              {/* Supplier Info & Purchase Type */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <CustomerAutocomplete
                    customers={existingCustomers}
                    label="اسم المورد / البائع (أو عميل)"
                    placeholder="ابحث عن عميل/مورد أو اكتب جديد..."
                    initialValue={supplierName}
                    onSelect={(cust) => {
                      setSupplierName(cust.name);
                      setSupplierPhone(cust.phone1 || cust.phone2 || '');
                      setSelectedCustomerId(cust.id);
                    }}
                    onInputChange={(val) => {
                      setSupplierName(val);
                      const matched = existingCustomers.find(c => String(c.name || '').trim().toLowerCase() === String(val || '').trim().toLowerCase());
                      if (matched) {
                        setSelectedCustomerId(matched.id);
                        setSupplierPhone(matched.phone1 || matched.phone2 || '');
                      } else {
                        setSelectedCustomerId(null);
                      }
                    }}
                    onAddNew={() => setShowAddCustomerModal(true)}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-300 block">رقم هاتف المورد / البائع</label>
                    <button 
                      type="button"
                      onClick={() => {
                        if (supplierPhone === 'لا يوجد') {
                          setSupplierPhone('');
                        } else {
                          setSupplierPhone('لا يوجد');
                        }
                      }}
                      className={`text-[9px] font-black px-2 py-0.5 rounded border transition-all ${supplierPhone === 'لا يوجد' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-white/5 border-white/10 text-gray-500'}`}
                    >
                      بدون
                    </button>
                  </div>
                  <input
                    type="text"
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                    disabled={supplierPhone === 'لا يوجد'}
                    placeholder="رقم الهاتف (اختياري)"
                    className={`w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 ${supplierPhone === 'لا يوجد' ? 'opacity-50' : ''}`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">نوع العملية</label>
                  <select
                    value={purchaseType}
                    onChange={(e) => setPurchaseType(e.target.value as any)}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="direct">شراء قطع وملحقات جاهزة (مباشر)</option>
                    <option value="batch">شراء جهاز/دفعة تالفة للتفكيك والتشليح (مثل ستارلينك)</option>
                  </select>
                </div>
              </div>

                {/* Disassembly Batch Details */}
                {purchaseType === 'batch' && (
                  <div className="p-4 bg-purple-500/5 border border-purple-500/20 rounded-2xl space-y-4">
                    <div className="flex items-center gap-2 text-purple-300 text-xs font-bold">
                      <Layers size={16} />
                      <span>تفاصيل جهاز/دفعة التفكيك (Batch)</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-300 block">اسم الجهاز / الدفعة الأساسية <span className="text-red-400">*</span></label>
                        <input
                          type="text"
                          value={batchName}
                          onChange={(e) => setBatchName(e.target.value)}
                          placeholder="مثال: جهاز ستارلينك V2 شبه تالف (موقوف الخدمة)"
                          className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-300 block">إجمالي تكلفة شراء الجهاز بالكامل ({currency}) <span className="text-red-400">*</span></label>
                        <input
                          type="number"
                          step="any"
                          value={totalBatchCost}
                          onChange={(e) => setTotalBatchCost(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="مثال: 100"
                          className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-black text-amber-400 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Add Item Form for Purchase */}
              <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <h4 className="text-xs font-black text-white flex items-center gap-2">
                    <Package size={16} className="text-purple-400" />
                    <span>{purchaseType === 'batch' ? 'إدخال القطع المستخرجة والمفرزة من الجهاز:' : 'إدخال القطع والملحقات المشتراة:'}</span>
                  </h4>
                  <span className="text-[10px] text-gray-400 font-bold bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
                    العدد المضاف: {purchaseItems.length} صنف
                  </span>
                </div>

                {/* Items Input Form Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* اسم القطعة / الملحق */}
                  <div className="flex flex-row items-center gap-2.5 md:col-span-2">
                    <label className="text-xs text-gray-300 font-bold whitespace-nowrap shrink-0 w-24">اسم القطعة:</label>
                    <div className="flex-1 min-w-0">
                      <PartsAutocomplete
                        value={currentPurchaseItem.name}
                        onChange={(val) => setCurrentPurchaseItem(prev => ({ ...prev, name: val }))}
                        onSelectPart={(part: any) => {
                          setCurrentPurchaseItem(prev => ({
                            ...prev,
                            name: part.name,
                            category: part.category || prev.category,
                            unitCost: part.defaultCost || prev.unitCost,
                            salePrice: part.defaultSalePrice || prev.salePrice
                          }));
                        }}
                        placeholder="اختر صنفاً أو اكتب اسماً جديداً..."
                      />
                    </div>
                  </div>

                  {/* الكمية */}
                  <div className="flex flex-row items-center gap-2.5">
                    <label className="text-xs text-gray-300 font-bold whitespace-nowrap shrink-0 w-24">الكمية:</label>
                    <input
                      type="number"
                      min="1"
                      value={currentPurchaseItem.quantity}
                      onChange={(e) => setCurrentPurchaseItem(prev => ({ ...prev, quantity: Math.max(1, Number(e.target.value)) }))}
                      className="flex-1 bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* تكلفة القطعة الواحدة */}
                  {purchaseType === 'direct' && (
                    <div className="flex flex-row items-center gap-2.5">
                      <label className="text-xs text-gray-300 font-bold whitespace-nowrap shrink-0 w-24">التكلفة ({currency}):</label>
                      <input
                        type="number"
                        step="any"
                        value={currentPurchaseItem.unitCost}
                        onChange={(e) => setCurrentPurchaseItem(prev => ({ ...prev, unitCost: Number(e.target.value) }))}
                        className="flex-1 bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  )}

                  {/* سعر البيع المقترح */}
                  <div className="flex flex-row items-center gap-2.5">
                    <label className="text-xs text-gray-300 font-bold whitespace-nowrap shrink-0 w-24">سعر البيع ({currency}):</label>
                    <input
                      type="number"
                      step="any"
                      value={currentPurchaseItem.salePrice}
                      onChange={(e) => setCurrentPurchaseItem(prev => ({ ...prev, salePrice: Number(e.target.value) }))}
                      className="flex-1 bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleAddPurchaseItem}
                    className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-purple-900/20 active:scale-95"
                  >
                    <Plus size={16} />
                    <span>{editingPurchaseIdx !== null ? 'تحديث الصنف' : 'إضافة إلى القائمة'}</span>
                  </button>
                </div>

                {/* Added Purchase Items Table */}
                {purchaseItems.length > 0 && (
                  <div className="bg-[#121212] border border-white/5 rounded-2xl overflow-hidden mt-4">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">اسم القطعة</th>
                          <th className="p-3">الكمية</th>
                          {purchaseType === 'direct' && <th className="p-3">التكلفة الفردية</th>}
                          <th className="p-3">سعر البيع المقترح</th>
                          <th className="p-3 text-center">إجراء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-gray-200">
                        {purchaseItems.map((pi, idx) => (
                          <tr key={pi.id}>
                            <td className="p-3 font-mono text-gray-500">{idx + 1}</td>
                            <td className="p-3 font-bold text-white">{pi.name}</td>
                            <td className="p-3 font-mono font-bold">{pi.quantity}</td>
                            {purchaseType === 'direct' && <td className="p-3 font-mono text-amber-400">{formatMoney(pi.unitCost, currency)}</td>}
                            <td className="p-3 font-mono text-emerald-400">{formatMoney(pi.salePrice, currency)}</td>
                            <td className="p-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemovePurchaseItem(idx)}
                                className="p-1 text-red-400 hover:text-red-300"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar Column: Payment, Summary & Posting Action */}
            <div className="space-y-6">
              <div className="bg-[#141414] border border-purple-500/20 rounded-3xl p-6 shadow-2xl space-y-5 lg:sticky lg:top-4">
                <div className="flex items-center gap-2 pb-3 border-b border-white/5 text-purple-300 font-bold text-sm">
                  <CircleDollarSign size={18} className="text-purple-400" />
                  <span>ملخص الترحيل والصرف المالي</span>
                </div>

                {/* Summary Badges */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-3 text-center">
                    <span className="text-[10px] text-gray-400 block mb-0.5">عدد الأصناف</span>
                    <span className="text-sm font-mono font-black text-white">{purchaseItems.length} صنف</span>
                  </div>
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-3 text-center">
                    <span className="text-[10px] text-gray-400 block mb-0.5">إجمالي التكلفة</span>
                    <span className="text-sm font-mono font-black text-amber-400" dir="ltr">
                      {formatMoney(totalPurchaseCost, currency)}
                    </span>
                  </div>
                </div>

                {/* Source of Fund */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">مصدر الصرف (الخزينة/الحساب)</label>
                  <select
                    value={selectedFundId}
                    onChange={(e) => setSelectedFundId(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white focus:outline-none focus:border-purple-500"
                  >
                    {funds.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.currency || 'USD'}) - الرصيد: {formatMoney(parseFundBalance(f.balance), f.currency)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Paid Amount */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-300 block">المبلغ المدفوع للمورد ({currency})</label>
                    <button
                      type="button"
                      onClick={() => setAmountPaidPurchase(totalPurchaseCost)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 font-bold underline cursor-pointer"
                    >
                      دفع كامل المبلغ
                    </button>
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={amountPaidPurchase}
                    onChange={(e) => setAmountPaidPurchase(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0.00 (اتركه فارغاً للآجل)"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-purple-500"
                  />
                  {Number(amountPaidPurchase || 0) < totalPurchaseCost && (
                    <p className="text-[10px] text-amber-400/90 font-bold">
                      المتبقي كدين للمورد: {formatMoney(Math.max(0, totalPurchaseCost - Number(amountPaidPurchase || 0)), currency)}
                    </p>
                  )}
                </div>

                {/* Purchase Invoice Notes / Details Field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-300 block">ملاحظات وتفاصيل الفاتورة</label>
                  <input
                    type="text"
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    placeholder="لا يوجد (اختياري، تظهر في كشف الحساب)"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* Multi-currency Exchange Inputs */}
                {(funds.find(f => f.id === selectedFundId)?.currency || 'USD') !== currency && (
                  <div className="p-3.5 bg-purple-500/10 border border-purple-500/20 rounded-2xl space-y-2 animate-fadeIn">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-purple-300">سعر الصرف (فاتورة: {currency})</label>
                        <input
                          type="number"
                          step="any"
                          value={paymentInvoiceRate}
                          onChange={(e) => setPaymentInvoiceRate(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-purple-300">سعر الصرف (صندوق: {funds.find(f => f.id === selectedFundId)?.currency || 'USD'})</label>
                        <input
                          type="number"
                          step="any"
                          value={paymentFundRate}
                          onChange={(e) => setPaymentFundRate(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                    <div className="p-2 bg-black/40 rounded-lg text-center">
                      <span className="text-[10px] text-gray-400">سيتم صرف من الصندوق: </span>
                      <span className="text-xs font-black font-mono text-emerald-400" dir="ltr">
                        {formatMoney((Number(amountPaidPurchase || 0) / (Number(paymentInvoiceRate) || 1)) * (Number(paymentFundRate) || 1), funds.find(f => f.id === selectedFundId)?.currency || 'USD')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Primary Posting Action Button */}
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleSavePurchase}
                    disabled={isSubmitting}
                    className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xl shadow-purple-900/40 active:scale-95 disabled:opacity-50"
                  >
                    <Save size={18} />
                    <span>{isSubmitting ? 'جاري الترحيل والحفظ...' : 'ترحيل عملية الشراء وتغذية المخزون'}</span>
                  </button>
                  <p className="text-[10px] text-center text-gray-500 font-bold">
                    سيتم ترحيل الفاتورة وتحديث المخزون وقيد الصرف في الخزينة
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Quick-Action Bar for Mobile & Compact Screens */}
          <div className="lg:hidden fixed bottom-14 md:bottom-4 left-4 right-4 z-40 bg-[#141414]/95 backdrop-blur-xl border border-purple-500/30 p-3.5 rounded-2xl shadow-2xl flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-400 font-bold">إجمالي الشراء ({purchaseItems.length} صنف):</span>
              <span className="text-sm font-mono font-black text-amber-400">{formatMoney(totalPurchaseCost, currency)}</span>
            </div>
            <button
              type="button"
              onClick={handleSavePurchase}
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-purple-900/40 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Save size={16} />
              <span>{isSubmitting ? 'جاري الترحيل...' : 'ترحيل الشراء'}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: SALES OF SERVICES & PARTS ("خدمات برمجية / صيانة خارجية / بيع قطع غيار") */}
      {['software', 'maintenance', 'parts'].includes(activeTab) && !successInfo && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-32 md:pb-16">
          {/* Main Input Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Details */}
            <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
              <div className="flex flex-row items-center justify-between pb-3 border-b border-white/5 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black text-white flex items-center gap-2 shrink-0">
                    <UserIcon size={16} className="text-emerald-400" />
                    <span>تفاصيل العميل</span>
                  </h3>
                  <button
                    type="button"
                    onClick={resetSalesForm}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg border border-white/5 text-[10px] font-bold font-cairo flex items-center gap-1 transition-all cursor-pointer"
                    title="إعادة تهيئة وتفريغ حقول الفاتورة"
                  >
                    <RotateCcw size={11} />
                    <span>تفريغ الحقول</span>
                  </button>
                </div>

                <div className="flex flex-row items-center justify-end gap-3 shrink-0 flex-wrap" title="تتغير العملة تلقائياً حسب عملة حساب العميل">
                  <label className="flex items-center gap-1 cursor-pointer group">
                    <input 
                      type="radio" 
                      value="USD" 
                      checked={currency === 'USD'} 
                      onChange={(e) => setCurrency(e.target.value as any)} 
                      className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer mb-0.5" 
                    />
                    <span className={`text-[10px] font-bold transition-colors ${currency === 'USD' ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>دولار </span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer group">
                    <input 
                      type="radio" 
                      value="SAR" 
                      checked={currency === 'SAR'} 
                      onChange={(e) => setCurrency(e.target.value as any)} 
                      className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer mb-0.5" 
                    />
                    <span className={`text-[10px] font-bold transition-colors ${currency === 'SAR' ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>سعودي </span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer group">
                    <input 
                      type="radio" 
                      value="YER" 
                      checked={currency === 'YER'} 
                      onChange={(e) => setCurrency(e.target.value as any)} 
                      className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer mb-0.5" 
                    />
                    <span className={`text-[10px] font-bold transition-colors ${currency === 'YER' ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>ريال </span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <CustomerAutocomplete
                    customers={existingCustomers}
                    onSelect={(c) => {
                      setCustomer({ name: c.name, phone1: c.phone1 === 'لا يوجد' ? '' : c.phone1, phone2: c.phone2 || '', notes: c.notes || '' });
                      setSelectedCustomerId(c.id || null);
                      setNoPhone(c.phone1 === 'لا يوجد');
                    }}
                    onInputChange={(val) => {
                      setCustomer(prev => ({ ...prev, name: val }));
                      const matched = existingCustomers.find(c => String(c.name || '').trim().toLowerCase() === String(val || '').trim().toLowerCase());
                      if (matched) {
                        setSelectedCustomerId(matched.id || null);
                      } else if (selectedCustomerId) {
                        setSelectedCustomerId(null);
                      }
                    }}
                    onAddNew={() => setShowAddCustomerModal(true)}
                    label="اسم العميل الكامل *"
                    placeholder="ابحث عن عميل أو أدخل اسم جديد..."
                    initialValue={customer.name}
                    type="name"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-between w-24 shrink-0">
                    <label className="text-xs text-gray-400 font-bold text-right">رقم الهاتف</label>
                    <button 
                      type="button"
                      onClick={() => {
                        setNoPhone(!noPhone);
                        if (!noPhone) setCustomer(prev => ({ ...prev, phone1: '' }));
                      }}
                      className={`text-[9px] font-black px-2 py-0.5 rounded border transition-all ${noPhone ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-white/5 border-white/10 text-gray-500'}`}
                    >
                      بدون
                    </button>
                  </div>
                  <div className={`relative flex-1 ${noPhone ? 'opacity-30 pointer-events-none' : ''}`}>
                    <CustomerAutocomplete
                      customers={existingCustomers}
                      onSelect={(c) => {
                        setCustomer({ name: c.name, phone1: c.phone1 === 'لا يوجد' ? '' : c.phone1, phone2: c.phone2 || '', notes: c.notes || '' });
                        setSelectedCustomerId(c.id || null);
                        setNoPhone(c.phone1 === 'لا يوجد');
                      }}
                      onInputChange={(val) => {
                        setCustomer(prev => ({ ...prev, phone1: val }));
                        if (selectedCustomerId) setSelectedCustomerId(null);
                      }}
                      placeholder="7xxxxxxxx"
                      initialValue={noPhone ? 'لا يوجد' : customer.phone1}
                      type="phone"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 font-bold w-24 shrink-0 text-right">رقم إضافي</label>
                  <input 
                    type="tel" 
                    inputMode="tel"
                    dir="ltr"
                    value={customer.phone2}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9+*#]/g, '');
                      setCustomer(prev => ({ ...prev, phone2: val }));
                    }}
                    placeholder="05XXXXXXXX"
                    className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 flex-1 focus:border-emerald-500 outline-none text-xs font-mono text-white text-right"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 font-bold w-24 shrink-0 text-right">ملاحظات</label>
                  <input 
                    type="text" 
                    value={customer.notes}
                    onChange={(e) => setCustomer(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="ملاحظات العميل (اختياري)..."
                    className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 flex-1 focus:border-emerald-500 outline-none text-xs font-bold text-white text-right"
                  />
                </div>
              </div>
            </div>

            {/* Service / Part Item Entry */}
            <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
              <h3 className="text-xs font-black text-white border-b border-white/5 pb-3">
                {activeTab === 'parts' ? 'إدخال بيع قطع الغيار والملحقات:' : 'بيانات الخدمة / الصيانة:'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[10px] text-gray-400 block font-bold">
                    {activeTab === 'parts' ? 'اسم القطعة / الملحق' : 'اسم الخدمة / البيان'}
                  </label>
                  {activeTab === 'parts' ? (
                    <div>
                      <PartsAutocomplete
                        value={currentItem.name}
                        onChange={(val) => setCurrentItem(prev => ({ ...prev, name: val }))}
                        onSelectPart={(part: any) => {
                          setCurrentItem(prev => ({
                            ...prev,
                            name: part.name,
                            unitCost: part.salePrice || part.defaultSalePrice || prev.unitCost,
                            partInventoryId: part.partInventoryId || part.id || '',
                            batchId: part.batchId || '',
                            batchName: part.batchName || '',
                            batchTotalCost: part.batchTotalCost || 0
                          }));
                        }}
                        showStockStatus={true}
                      />
                      {currentItem.partInventoryId && (() => {
                        const matched = shopPartsList.find(s => s.id === currentItem.partInventoryId);
                        const inStock = matched ? Number(matched.quantity || 0) : 0;
                        return (
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px]">
                            <span className={`px-2 py-0.5 rounded-full font-bold ${inStock >= currentItem.quantity ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                              المتوفر بالمخزون: {inStock} قطعة
                            </span>
                            {currentItem.batchName && (
                              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded font-bold border border-purple-500/30">
                                دفعة تفكيك: {currentItem.batchName}
                              </span>
                            )}
                            {currentItem.quantity > inStock && (
                              <span className="text-amber-400 font-bold">
                                (تنبيه: الكمية المدخلة تتجاوز المتوفر بالمخزون)
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={currentItem.name}
                      onChange={(e) => setCurrentItem(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="مثال: برمجة راوتر / صيانة شاشة"
                      className="w-full bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 block font-bold">الكمية</label>
                  <input
                    type="number"
                    min="1"
                    value={currentItem.quantity}
                    onChange={(e) => setCurrentItem(prev => ({ ...prev, quantity: Math.max(1, Number(e.target.value)) }))}
                    className="w-full bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-white focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 block font-bold">السعر الفردي ({currency})</label>
                  <input
                    type="number"
                    step="any"
                    value={currentItem.unitCost}
                    onChange={(e) => setCurrentItem(prev => ({ ...prev, unitCost: Number(e.target.value) }))}
                    className="w-full bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleAddSaleItem}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-900/20"
                >
                  <Plus size={16} />
                  <span>{editingIndex !== null ? 'تحديث الصنف' : 'إضافة إلى الفاتورة'}</span>
                </button>
              </div>

              {/* Items List */}
              {items.length > 0 && (
                <div className="bg-[#121212] border border-white/5 rounded-2xl overflow-hidden mt-4">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-[#181818] text-gray-400 border-b border-white/5 font-bold">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">الصنف / البيان</th>
                        <th className="p-3">الكمية</th>
                        <th className="p-3">السعر</th>
                        <th className="p-3">الإجمالي</th>
                        <th className="p-3 text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-gray-200">
                      {items.map((it, idx) => (
                        <tr key={it.id}>
                          <td className="p-3 font-mono text-gray-500">{idx + 1}</td>
                          <td className="p-3 font-bold text-white">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{it.name}</span>
                              {it.batchName && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded border border-purple-500/30 font-normal">
                                  دفعة: {it.batchName}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 font-mono">{it.quantity}</td>
                          <td className="p-3 font-mono text-emerald-400">{formatMoney(it.unitCost, currency)}</td>
                          <td className="p-3 font-mono font-bold text-emerald-400">{formatMoney(it.quantity * it.unitCost, currency)}</td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveSaleItem(idx)}
                              className="p-1 text-red-400 hover:text-red-300"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Payment & Summary Sidebar */}
          <div className="space-y-6">
            <div className="bg-[#141414] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
              <h3 className="text-xs font-black text-white border-b border-white/5 pb-3">ملخص الفاتورة والسداد</h3>

              <div className="p-4 bg-[#181818] rounded-2xl space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">الإجمالي المستحق:</span>
                  <span className="font-mono font-black text-base text-emerald-400">{formatMoney(totalSalesCost, currency)}</span>
                </div>

                <div className="space-y-1 pt-2 border-t border-white/5">
                  <label className="text-[10px] text-gray-400 block font-bold">المبلغ المدفوع حالياً</label>
                  <input
                    type="number"
                    step="any"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0.00"
                    className="w-full bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1 pt-2 border-t border-white/5">
                  <label className="text-[10px] text-gray-400 block font-bold">ملاحظات وتفاصيل الفاتورة</label>
                  <input
                    type="text"
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    placeholder="لا يوجد (اختياري، تظهر في كشف الحساب)"
                    className="w-full bg-[#121212] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Fund Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-300 block">إيداع المبلغ في الخزينة/الحساب</label>
                <select
                  value={selectedFundId}
                  onChange={(e) => setSelectedFundId(e.target.value)}
                  className="w-full bg-[#181818] border border-white/10 rounded-xl p-2.5 text-xs font-bold text-white focus:outline-none"
                >
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.currency || 'USD'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Multi-currency Exchange Inputs for Sales */}
              {(funds.find(f => f.id === selectedFundId)?.currency || 'USD') !== currency && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl animate-fadeIn">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-emerald-300">سعر الصرف (فاتورة: {currency})</label>
                    <input
                      type="number"
                      step="any"
                      value={paymentInvoiceRate}
                      onChange={(e) => setPaymentInvoiceRate(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-emerald-300">سعر الصرف (صندوق: {funds.find(f => f.id === selectedFundId)?.currency || 'USD'})</label>
                    <input
                      type="number"
                      step="any"
                      value={paymentFundRate}
                      onChange={(e) => setPaymentFundRate(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="col-span-2 mt-2 p-2 bg-black/40 rounded-lg text-center">
                    <span className="text-[10px] text-gray-400">سيتم إيداع مبلغ: </span>
                    <span className="text-sm font-black font-mono text-emerald-400" dir="ltr">
                      {formatMoney((Number(amountPaid || 0) / (Number(paymentInvoiceRate) || 1)) * (Number(paymentFundRate) || 1), funds.find(f => f.id === selectedFundId)?.currency || 'USD')}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 pt-3">
                <button
                  type="button"
                  onClick={() => handleSaveFinal('save')}
                  disabled={isSubmitting}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xl shadow-emerald-900/30 active:scale-95 disabled:opacity-50"
                >
                  <Save size={18} />
                  <span>حفظ وإصدار الفاتورة</span>
                </button>

                <button
                  type="button"
                  onClick={handlePreviewInit}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border border-white/5"
                >
                  <Eye size={16} />
                  <span>معاينة الطباعة</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomerModal && (
        <AddCustomerModal
          isOpen={showAddCustomerModal}
          onClose={() => setShowAddCustomerModal(false)}
          initialName={activeTab === 'purchase' ? supplierName : customer.name}
          onSuccess={(newCust) => {
            setSelectedCustomerId(newCust.id || null);
            if (activeTab === 'purchase') {
              setSupplierName(newCust.name);
              setSupplierPhone(newCust.phone1 || newCust.phone2 || '');
            } else {
              setCustomer({
                name: newCust.name,
                phone1: newCust.phone1 || '',
                phone2: newCust.phone2 || '',
                notes: newCust.notes || ''
              });
            }
            setShowAddCustomerModal(false);
          }}
          user={user || { id: 'admin', name: 'المدير العام', username: 'admin', role: 'admin' }}
          customers={existingCustomers}
        />
      )}

      {/* Print Preview Overlay */}
      {showPreview && currentOutput && (
        <PrintPreviewOverlay
          type="invoice"
          data={currentOutput}
          shopConfig={shopConfig}
          user={user}
          onClose={() => setShowPreview(false)}
          onPrint={() => handleSaveFinal('print')}
          onWhatsApp={() => handleSaveFinal('whatsapp')}
          onSave={() => handleSaveFinal('save')}
          isSaving={isSubmitting}
        />
      )}
    </div>
  );
}
