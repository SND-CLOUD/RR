/**
 * Dynamic Voucher & Invoice Resolution Service
 * Separates immutable system identifiers (invoiceId, customerId) from live display labels.
 * Always resolves the human-readable number and description dynamically at render/print time.
 */

export interface InvoiceLike {
  id?: string;
  invoiceNumber?: string | number;
  customerId?: string;
  customerName?: string;
  type?: string;
  invoiceType?: string;
  templateType?: string;
  notes?: string;
  totalCost?: number;
}

export interface VoucherLike {
  id?: string;
  voucherNumber?: string | number;
  invoiceId?: string;
  invoiceNumber?: string | number;
  customerId?: string;
  customerName?: string;
  type?: string;
  notes?: string;
  details?: string;
  statementNote?: string;
  transactionCategory?: string;
  category?: string;
  referenceNumber?: string;
  reference?: string;
}

/**
 * Resolves the live, human-readable invoice number for a voucher/transaction.
 * Prioritizes looking up the live invoice via the immutable `invoiceId`.
 */
export function resolveLiveInvoiceNumber(
  voucher: VoucherLike | null | undefined,
  invoices?: InvoiceLike[] | Map<string, InvoiceLike> | null
): string {
  if (!voucher) return '';

  // 1. Immutable invoiceId lookup in invoices map/list
  if (voucher.invoiceId && invoices) {
    let matchedInvoice: InvoiceLike | undefined;
    if (invoices instanceof Map) {
      matchedInvoice = invoices.get(voucher.invoiceId);
    } else if (Array.isArray(invoices)) {
      matchedInvoice = invoices.find(inv => inv.id === voucher.invoiceId);
    }
    if (matchedInvoice && matchedInvoice.invoiceNumber) {
      return String(matchedInvoice.invoiceNumber).replace(/^#/, '').trim();
    }
  }

  // 2. Fallback to voucher's stored invoiceNumber
  if (voucher.invoiceNumber) {
    return String(voucher.invoiceNumber).replace(/^#/, '').trim();
  }

  // 3. Fallback to referenceNumber if present and not a voucher number
  if (voucher.referenceNumber && !voucher.referenceNumber.startsWith('VT-')) {
    return String(voucher.referenceNumber).replace(/^#/, '').trim();
  }

  return '';
}

const INVOICE_HEADER_CLEANUP_REGEX = /^(سند صرف (قيمة )?فاتورة (مشتريات )?(رقم )?[A-Za-z0-9#-]+|سداد (في )?(ال)?فاتورة (صيانة |مبيعات )?(رقم )?[A-Za-z0-9#-]+|سداد مسبق (ل)?فاتورة (صيانة )?(رقم )?[A-Za-z0-9#-]+|سند قبض ((\/|-) سداد في )?فاتورة (مبيعات )?(رقم )?[A-Za-z0-9#-]+|دفعة (في |من )?فاتورة (رقم )?[A-Za-z0-9#-]+)\s*(\(بدون خروج الأجهزة\))?\s*[-–—:]?\s*/i;

/**
 * Dynamically resolves the full statement and financial note for a voucher.
 * Ensures that whenever an invoice is renumbered or updated, all prints, ledgers,
 * and previews immediately reflect the live invoice number without modifying DB text.
 */
export function resolveVoucherDynamicStatement(
  voucher: VoucherLike | null | undefined,
  invoices?: InvoiceLike[] | Map<string, InvoiceLike> | null
): string {
  if (!voucher) return 'لا يوجد بيان مسجل.';

  const liveInvNum = resolveLiveInvoiceNumber(voucher, invoices);
  const rawDetails = (voucher.details || '').trim();
  const rawStatementNote = (voucher.statementNote || '').trim();
  const rawNotes = (voucher.notes || '').trim();

  // Extract any exchange rate tag like [سعر الصرف: ...]
  let exchangeRateTag = '';
  const exMatch = (rawNotes || rawDetails).match(/(\[سعر الصرف:[^\]]+\])/);
  if (exMatch) {
    exchangeRateTag = ` ${exMatch[1]}`;
  }

  // Extract user-entered custom notes if separated by hyphen/dash (e.g. "سداد في الفاتورة رقم 130 - دفعة أولى")
  let customExtraNote = '';
  const candidateNotes = rawNotes || rawDetails || '';
  if (candidateNotes) {
    const cleanedNote = candidateNotes.replace(/\[سعر الصرف:[^\]]+\]/g, '').trim();
    // Strip standard header with any invoice number pattern
    const strippedHeader = cleanedNote.replace(INVOICE_HEADER_CLEANUP_REGEX, '').trim();
    if (strippedHeader && strippedHeader !== 'لا يوجد' && strippedHeader !== 'null' && strippedHeader !== 'undefined') {
      customExtraNote = ` - ${strippedHeader}`;
    }
  }

  // 1. If linked to an invoice (has live invoice number)
  if (liveInvNum) {
    const isPayment = voucher.type === 'payment' || 
                      voucher.transactionCategory === 'مشتريات قطع وملحقات' || 
                      voucher.category === 'مشتريات قطع وملحقات' ||
                      (rawNotes && rawNotes.includes('مشتريات'));

    const isPrepayment = rawNotes.includes('سداد مسبق') || rawDetails.includes('سداد مسبق');

    let baseStatement = '';
    if (isPayment) {
      baseStatement = `سند صرف قيمة فاتورة مشتريات رقم ${liveInvNum}`;
    } else if (isPrepayment) {
      baseStatement = `سداد مسبق لفاتورة صيانة رقم ${liveInvNum}`;
    } else {
      baseStatement = `سداد في الفاتورة رقم ${liveInvNum}`;
    }

    return `${baseStatement}${customExtraNote}${exchangeRateTag}`;
  }

  // 2. If an explicit manual statementNote is provided (not invoice-based)
  if (rawStatementNote && rawStatementNote !== 'null' && rawStatementNote !== 'undefined') {
    // If the saved statementNote has user notes placed before (لكم / عليكم مبلغ ...)
    // Re-order it so user notes are cleanly at the end
    const match = rawStatementNote.match(/^(.*?)\s*(لكم|عليكم)\s+(مبلغ\s+.*)$/);
    if (match && match[1].trim()) {
      const userText = match[1].trim();
      const keyword = match[2];
      const rest = match[3].trim();
      return `${keyword} ${rest} - ${userText}`;
    }
    return rawStatementNote;
  }

  // 3. Fallback based on category or type with user notes placed at the end
  const cat = voucher.category || voucher.transactionCategory;
  const baseType = voucher.type === 'payment' ? 'سند صرف' : 'سند قبض';
  const baseLabel = (cat && cat !== 'عام') ? `${baseType} - ${cat}` : `${baseType} مالي`;

  const userNote = (rawNotes || rawDetails || '').trim();
  if (userNote && userNote !== 'لا يوجد' && userNote !== 'لا توجد تفاصيل.' && userNote !== 'null' && userNote !== 'undefined') {
    if (!userNote.startsWith(baseType) && !userNote.startsWith('سداد') && !userNote.startsWith('لكم') && !userNote.startsWith('عليكم')) {
      return `${baseLabel} - ${userNote}`;
    }
    return userNote;
  }

  return baseLabel;
}

/**
 * Resolves only genuine additional/extra notes entered by user,
 * filtering out auto-generated system statement headers.
 */
export function resolveVoucherExtraNotes(
  voucher: VoucherLike | null | undefined
): string {
  if (!voucher) return '';
  const rawDetails = (voucher.details || '').trim();
  const rawNotes = (voucher.notes || '').trim();

  // If details has custom user text different from system patterns
  if (rawDetails && rawDetails !== 'لا يوجد' && rawDetails !== 'null' && rawDetails !== 'undefined' && !rawDetails.startsWith('سداد في الفاتورة') && !rawDetails.startsWith('سند صرف') && !rawDetails.startsWith('سند قبض')) {
    return rawDetails;
  }

  if (rawNotes && rawNotes !== 'لا يوجد' && rawNotes !== 'null' && rawNotes !== 'undefined') {
    const cleanedNote = rawNotes.replace(/\[سعر الصرف:[^\]]+\]/g, '').trim();
    const strippedHeader = cleanedNote.replace(INVOICE_HEADER_CLEANUP_REGEX, '').trim();
    if (strippedHeader && strippedHeader !== 'لا يوجد' && strippedHeader !== 'null' && strippedHeader !== 'undefined') {
      return strippedHeader;
    }
  }

  return '';
}

/**
 * Cleanly formats a customer reference without printing internal database UUIDs.
 */
export function formatCustomerReference(
  customerNumber?: number | string | null
): string {
  if (!customerNumber) return '';
  const clean = String(customerNumber).replace(/^#/, '').trim();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num > 0) {
    return `#${num}`;
  }
  return '';
}
