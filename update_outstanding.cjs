const fs = require('fs');
const content = fs.readFileSync('src/components/Customers.tsx', 'utf8');

const regex = /  const getCustomerOutstandingAmount = \(customerId: string\) => \{[\s\S]*?\};/;

const newFunc = `  const getCustomerOutstandingAmount = (customerId: string) => {
    const customerName = customers.find(c => c.id === customerId)?.name || '';
    const customerInvs = invoices.filter(inv => inv.customerId === customerId || (customerName && inv.customerName === customerName));
    
    let totalDebit = 0;
    let totalCredit = 0;

    customerInvs.forEach(inv => {
      const invItems = items.filter(it => it.invoiceNumber === inv.invoiceNumber);
      const actualCost = getInvoiceActualCost(invItems, inv);
      
      const explicitType = inv.invoiceType || inv.templateType || inv.type || '';
      let isPurchase = explicitType === 'purchase' || String(explicitType).startsWith('purchase') || inv.type === 'purchase' || String(inv.invoiceNumber).startsWith('PUR-') || String(inv.invoiceNumber).startsWith('DIS-');
      if (inv.notes && (inv.notes.includes('شراء') || inv.notes.includes('مورد') || inv.notes.includes('مشتريات'))) {
        isPurchase = true;
      }

      if (isPurchase) {
        totalCredit += actualCost;
      } else {
        totalDebit += actualCost;
      }
    });

    const customerTransactions = transactions.filter(tx => 
      tx.customerId === customerId &&
      !tx.isReversed &&
      !tx.isReversal &&
      tx.status !== 'reversed' &&
      tx.status !== 'reversal'
    );

    customerTransactions.forEach(tx => {
      if (tx.type === 'receipt' || tx.type === 'invoice_payment') {
        const liabilityAmount = tx.liabilityAmount || Math.abs(Number(tx.amount || 0));
        totalCredit += liabilityAmount;
      } else if (tx.type === 'payment') {
        const liabilityAmount = tx.liabilityAmount || Math.abs(Number(tx.amount || 0));
        totalDebit += liabilityAmount;
      }
    });

    return totalDebit - totalCredit;
  };`;

const newContent = content.replace(regex, newFunc);

fs.writeFileSync('src/components/Customers.tsx', newContent, 'utf8');
console.log('Updated getCustomerOutstandingAmount');
