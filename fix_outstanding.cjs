const fs = require('fs');
const content = fs.readFileSync('src/components/Customers.tsx', 'utf8');

const oldFunc = `  const getCustomerOutstandingAmount = (customerId: string) => {
    return Math.max(0, getCustomerTotalCost(customerId) - getCustomerTotalPaid(customerId));
  };`;

if (content.includes(oldFunc)) {
  console.log('Found it!');
} else {
  console.log('Not found!');
}
