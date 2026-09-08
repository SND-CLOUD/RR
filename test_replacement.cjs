const fs = require('fs');
const content = fs.readFileSync('src/components/Customers.tsx', 'utf8');

const regex = /const getCustomerOutstandingAmount = \(customerId: string\) => \{[\s\S]*?\};/;
const match = content.match(regex);
if (match) {
    console.log("Found:\n" + match[0]);
} else {
    console.log("Not found.");
}
