export const parseDate = (dateVal: any): Date | null => {
  if (dateVal === undefined || dateVal === null || dateVal === '') return null;
  if (dateVal instanceof Date) {
    return isNaN(dateVal.getTime()) || dateVal.getFullYear() < 2000 ? null : dateVal;
  }
  
  // Handle Firestore / Firestore-like / serialized JSON objects
  if (typeof dateVal === 'object') {
    if (typeof dateVal.toDate === 'function') {
      try {
        const d = dateVal.toDate();
        if (d instanceof Date && !isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
      } catch (e) {
        // ignore and fallback
      }
    }
    if (typeof dateVal.toISOString === 'function') {
      try {
        const d = new Date(dateVal.toISOString());
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
      } catch (e) {
        // ignore
      }
    }

    if (dateVal.$date) {
      const d = parseDate(dateVal.$date);
      if (d) return d;
    }

    const rawSecs = dateVal.seconds ?? dateVal._seconds ?? dateVal.secondsValue;
    if (rawSecs !== undefined && rawSecs !== null && rawSecs !== '') {
      const secs = typeof rawSecs === 'number' ? rawSecs : parseFloat(String(rawSecs));
      // Only treat as date if it is a real timestamp (year 2000+)
      if (!isNaN(secs) && secs >= 946684800 && secs <= 4102444800) {
        const rawNanos = dateVal.nanoseconds ?? dateVal._nanoseconds ?? 0;
        const nanos = typeof rawNanos === 'number' ? rawNanos : parseFloat(String(rawNanos)) || 0;
        const ms = secs * 1000 + nanos / 1000000;
        const d = new Date(ms);
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
      }
    }

    if (dateVal.date) {
      const d = parseDate(dateVal.date);
      if (d) return d;
    }
    if (dateVal.timestamp) {
      const d = parseDate(dateVal.timestamp);
      if (d) return d;
    }
  }

  // Handle number input (must be an actual Epoch timestamp in year 2000-2100)
  if (typeof dateVal === 'number') {
    if (isNaN(dateVal)) return null;
    // Unix seconds (e.g. 1719283739)
    if (dateVal >= 946684800 && dateVal <= 4102444800) {
      const d = new Date(dateVal * 1000);
      return !isNaN(d.getTime()) && d.getFullYear() >= 2000 ? d : null;
    }
    // Unix milliseconds (e.g. 1719283739000)
    if (dateVal >= 946684800000 && dateVal <= 4102444800000) {
      const d = new Date(dateVal);
      return !isNaN(d.getTime()) && d.getFullYear() >= 2000 ? d : null;
    }
    // Any other number (0, 50, 1000, 50000) is a financial amount or index, NOT a date
    return null;
  }

  // Handle string input
  if (typeof dateVal === 'string') {
    let trimmed = dateVal.trim();
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'NaN' || trimmed === '---' || trimmed === '[object Object]') {
      return null;
    }

    // Convert Arabic-Indic digits to ASCII
    trimmed = trimmed.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());

    // Check if it's a JSON string (e.g. '{"seconds":1715000000}' or '"2024-05-20"')
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try {
        const parsedJson = JSON.parse(trimmed);
        if (parsedJson) {
          const d = parseDate(parsedJson);
          if (d) return d;
        }
      } catch (e) {
        // ignore JSON parse error
      }
    }

    // Check DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY format
    const dmYMatch = trimmed.match(/^(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{2,4})(?:\s+(.*))?$/);
    if (dmYMatch) {
      let p1 = parseInt(dmYMatch[1], 10);
      let p2 = parseInt(dmYMatch[2], 10);
      let year = parseInt(dmYMatch[3], 10);
      if (year < 100) year += 2000;

      let day = p1;
      let month = p2;

      if (p2 > 12 && p1 <= 12) {
        day = p2;
        month = p1;
      }

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000) {
        let hours = 0, minutes = 0, seconds = 0;
        if (dmYMatch[4]) {
          const timeStr = dmYMatch[4].trim();
          const timeMatch = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(ص|م|AM|PM|am|pm)?$/i);
          if (timeMatch) {
            hours = parseInt(timeMatch[1], 10);
            minutes = parseInt(timeMatch[2], 10);
            seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
            const ampm = timeMatch[4] ? timeMatch[4].toUpperCase() : '';
            if ((ampm === 'PM' || ampm === 'م') && hours < 12) hours += 12;
            if ((ampm === 'AM' || ampm === 'ص') && hours === 12) hours = 0;
          }
        }
        const d = new Date(year, month - 1, day, hours, minutes, seconds);
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
      }
    }

    // If string is purely numeric, check if it's a valid epoch timestamp
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsedNum = parseFloat(trimmed);
      if (!isNaN(parsedNum)) {
        if (parsedNum >= 946684800 && parsedNum <= 4102444800) {
          const d = new Date(parsedNum * 1000);
          return !isNaN(d.getTime()) && d.getFullYear() >= 2000 ? d : null;
        }
        if (parsedNum >= 946684800000 && parsedNum <= 4102444800000) {
          const d = new Date(parsedNum);
          return !isNaN(d.getTime()) && d.getFullYear() >= 2000 ? d : null;
        }
        // Otherwise it's a normal number/amount, not a date
        return null;
      }
    }
    
    // Parse standard date string (e.g. ISO 2024-05-20T...)
    const d = new Date(trimmed);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) {
      return d;
    }

    // Fallback: replace slashes with dashes (e.g., 2024/05/20 -> 2024-05-20)
    const formattedStr = trimmed.replace(/\//g, '-');
    const d2 = new Date(formattedStr);
    if (!isNaN(d2.getTime()) && d2.getFullYear() >= 2000) {
      return d2;
    }
  }

  return null;
};

export const formatDateTime = (dateVal: any): string => {
  const date = parseDate(dateVal);
  if (!date) return '---';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
};

export const formatDate = (dateVal: any, fallbackText: string = '---'): string => {
  const d = parseDate(dateVal);
  if (!d) return fallbackText;
  try {
    return d.toLocaleDateString('ar-YE');
  } catch (e) {
    return fallbackText;
  }
};

export const formatTime = (dateVal: any, fallbackText: string = '---'): string => {
  const d = parseDate(dateVal);
  if (!d) return fallbackText;
  try {
    return d.toLocaleTimeString('ar-YE', { hour12: true, hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return fallbackText;
  }
};

export const renderSafeValue = (val: any): any => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      try {
        const d = val.toDate();
        return d instanceof Date && !isNaN(d.getTime()) && d.getFullYear() >= 2000 ? d.toLocaleDateString('ar-YE') : '---';
      } catch (e) {
        return '---';
      }
    }
    if (val instanceof Date) {
      return isNaN(val.getTime()) || val.getFullYear() < 2000 ? '---' : val.toLocaleDateString('ar-YE');
    }
    if (val._isTimestamp || (val.seconds !== undefined && val.nanoseconds !== undefined)) {
      const d = parseDate(val);
      return d ? d.toLocaleDateString('ar-YE') : '---';
    }
    // Increment or financial value object (e.g. { type: 'increment', value: 5000 })
    if (val.value !== undefined && typeof val.value === 'number') {
      return val.value;
    }
    if (val.balance !== undefined && typeof val.balance === 'number') {
      return val.balance;
    }
    if (val.amount !== undefined && typeof val.amount === 'number') {
      return val.amount;
    }
    if (Array.isArray(val)) {
      return val.map(renderSafeValue).join(', ');
    }
    if ((val as any).$$typeof) {
      return val;
    }
    try {
      return JSON.stringify(val);
    } catch (e) {
      return String(val);
    }
  }
  return val;
};

export const parseTxDate = (tx: any): Date | null => {
  if (!tx) return null;
  return parseDate(tx.timestamp) || parseDate(tx.updatedAt) || parseDate(tx.createdAt) || parseDate(tx.date) || parseDate(tx.actionDate) || parseDate(tx.deliveredAt) || null;
};

export const formatTxDate = (tx: any, fallbackText: string = '---'): string => {
  const d = parseTxDate(tx);
  if (d) return formatDateTime(d);
  const backupRaw = String(tx?.timestamp || tx?.updatedAt || tx?.createdAt || tx?.date || fallbackText);
  return backupRaw === '[object Object]' ? fallbackText : backupRaw;
};

export const resolveEntryDateString = (item: any, invoice?: any): string => {
  const candidates = [
    item?.entryDate,
    invoice?.entryDate,
    invoice?.date,
    invoice?.createdAt,
    invoice?.issueDate,
    item?.createdAt,
    item?.updatedAt,
    invoice?.updatedAt,
  ];

  for (const cand of candidates) {
    if (cand !== undefined && cand !== null && cand !== '' && cand !== '[object Object]') {
      const parsed = parseDate(cand);
      if (parsed && !isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  return new Date().toISOString();
};

