const fs = require('fs');
const content = fs.readFileSync('src/components/Customers.tsx', 'utf8');

const oldFunc = `  const getCustomerOutstandingAmount = (customerId: string) => {
    return Math.max(0, getCustomerTotalCost(customerId) - getCustomerTotalPaid(customerId));
  };`;

const newFunc = `  const getCustomerOutstandingAmount = (customerId: string) => {
    const entries = getStatementEntries(customerId);
    if (entries.length === 0) return 0;
    return entries[entries.length - 1].runningBalance || 0;
  };`;

if (content.includes(oldFunc)) {
  console.log('Found it!');
} else {
  console.log('Not found!');
}
