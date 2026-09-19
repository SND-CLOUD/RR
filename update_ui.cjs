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

const newUI = `<td className="px-1 py-1 text-center whitespace-nowrap text-[9px] sm:text-[10px]">
                          {outstandingAmt > 0 ? (
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              <span className="inline-block bg-rose-500/10 text-rose-400 px-1 py-0.5 rounded text-[9px] font-bold">
                                {outstandingAmt.toFixed(0)}
                              </span>
                              <span className="text-[7px] text-rose-500/70 font-black">عليه</span>
                            </div>
                          ) : outstandingAmt < 0 ? (
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              <span className="inline-block bg-emerald-500/10 text-emerald-400 px-1 py-0.5 rounded text-[9px] font-bold">
                                {Math.abs(outstandingAmt).toFixed(0)}
                              </span>
                              <span className="text-[7px] text-emerald-500/70 font-black">له</span>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-[9px] font-bold">0</span>
                          )}
                        </td>`;

const newContent = content.replace(oldUI, newUI);

fs.writeFileSync('src/components/Customers.tsx', newContent, 'utf8');
console.log('UI updated');
