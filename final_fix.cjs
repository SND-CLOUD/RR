const fs = require('fs');
const file = 'src/components/OtherServiceInvoice.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/onChange=\{\(e\) \=onFocus=\{handleSmartFocus\}\s*>\s*/g, "onChange={(e) => ");
code = code.replace(/onChange=\{\(e\) \=onFocus=\{handleSmartFocus\}\s*/g, "onChange={(e) => ");

fs.writeFileSync(file, code);
