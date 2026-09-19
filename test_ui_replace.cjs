const fs = require('fs');
const content = fs.readFileSync('src/components/Customers.tsx', 'utf8');

const oldUI = `<td className="px-1 py-1 text-center whitespace-nowrap text-[9px] sm:text-[10px]">
                          {outstandingAmt > 0 ? (
                            <span className="inline-block bg-rose-500/10 text-rose-400 px-1 py-0.5 rounded text-[9px] font-bold">
                              {outstandingAmt.toFixed(0)}
                            </span>
                          ) : (
                            <span className="text-slate-600 text-[9px] font-bold">0</span>
                          )}
                        </td>`;

if (content.includes(oldUI)) {
  console.log('UI found!');
} else {
  console.log('UI not found!');
}
