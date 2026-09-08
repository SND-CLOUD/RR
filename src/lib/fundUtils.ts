/**
 * Financial & Fund Utilities
 * Safe parsing for fund balances, currency formatting and ledger calculations
 */

export const parseFundBalance = (balance: any): number => {
  if (typeof balance === 'number') {
    return isNaN(balance) ? 0 : balance;
  }
  if (!balance) return 0;

  if (typeof balance === 'object') {
    if (balance.type === 'increment') {
      // Incremental operation delta, not a valid static balance
      return 0;
    }
    if (balance.value !== undefined) {
      const val = Number(balance.value);
      return isNaN(val) ? 0 : val;
    }
    if (balance.balance !== undefined) {
      const val = Number(balance.balance);
      return isNaN(val) ? 0 : val;
    }
    if (balance.amount !== undefined) {
      const val = Number(balance.amount);
      return isNaN(val) ? 0 : val;
    }
    return 0;
  }

  if (typeof balance === 'string') {
    const trimmed = balance.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          if (parsed.value !== undefined) {
            const val = Number(parsed.value);
            return isNaN(val) ? 0 : val;
          }
          if (parsed.balance !== undefined) {
            const val = Number(parsed.balance);
            return isNaN(val) ? 0 : val;
          }
        }
      } catch (e) {}
    }
    // Clean string from formula/object residues
    if (trimmed.includes('[object Object]')) return 0;
    const num = parseFloat(trimmed.replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? 0 : num;
  }

  return 0;
};

export const getCurrencySymbol = (currency?: string): string => {
  if (!currency) return 'USD';
  const upper = currency.toUpperCase().trim();
  if (upper === 'USD' || upper === '$' || upper === 'دولار') return '$';
  if (upper === 'SAR' || upper === 'ر.س' || upper === 'سعودي' || upper === 'ريال سعودي') return 'ر.س';
  if (upper === 'YER' || upper === 'ر.ي' || upper === 'يمني' || upper === 'ريال يمني' || upper === 'ريال') return 'ر.ي';
  return currency;
};

export const formatMoney = (amount: number | string | undefined | null, currency?: string): string => {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || 0).replace(/[^0-9.-]/g, '')) || 0;
  const curr = (currency || 'USD').toUpperCase().trim();
  const formattedNum = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  
  if (curr === 'USD' || curr === '$') {
    return `$${formattedNum}`;
  }
  if (curr === 'SAR' || curr === 'ر.س') {
    return `${formattedNum} ر.س`;
  }
  if (curr === 'YER' || curr === 'ر.ي') {
    return `${formattedNum} ر.ي`;
  }
  return `${formattedNum} ${currency || 'USD'}`;
};
