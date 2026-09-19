const fs = require('fs');
const content = fs.readFileSync('src/components/Customers.tsx', 'utf8');

const oldDesktopStats = `                    {(() => {
                      const totalPaid = getCustomerTotalPaid(selectedCustomer.id!);
                      const totalCost = getCustomerTotalCost(selectedCustomer.id!);
                      const diff = totalPaid - totalCost;
                      const curr = getCustomerCurrencyLabel(selectedCustomer.id!);
                      
                      if (diff > 0.01) {
                        return (
                          <div className="space-y-1">
                            <div className="text-lg font-black text-emerald-400 font-mono">+{diff.toFixed(2)} {curr}</div>
                            <span className="inline-block px-2 py-0.5 rounded-lg text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold font-cairo">دائن (له متبقي لدينا)</span>
                          </div>
                        );
                      } else if (diff < -0.01) {
                        return (
                          <div className="space-y-1">
                            <div className="text-lg font-black text-rose-500 font-mono">-{Math.abs(diff).toFixed(2)} {curr}</div>
                            <span className="inline-block px-2 py-0.5 rounded-lg text-[9px] bg-rose-500/10 border border-rose-500/20 text-rose-500 font-bold font-cairo">مدين (عليه مستحقات للدفع)</span>
                          </div>
                        );
                      } else {
                        return (
                          <div className="space-y-1">
                            <div className="text-lg font-black text-slate-400 font-mono">0.00 {curr}</div>
                            <span className="inline-block px-2 py-0.5 rounded-lg text-[9px] bg-white/[0.02] border border-white/5 text-slate-400 font-bold font-cairo">رصيد خالي من المديونيات</span>
                          </div>
                        );
                      }
                    })()}`;

const newDesktopStats = `                    {(() => {
                      const outstandingAmt = getCustomerOutstandingAmount(selectedCustomer.id!);
                      const diff = -outstandingAmt; // diff = Credit - Debit. If diff > 0 -> "له", diff < 0 -> "عليه"
                      const curr = getCustomerCurrencyLabel(selectedCustomer.id!);
                      
                      if (diff > 0.01) {
                        return (
                          <div className="space-y-1">
                            <div className="text-lg font-black text-emerald-400 font-mono">+{diff.toFixed(2)} {curr}</div>
                            <span className="inline-block px-2 py-0.5 rounded-lg text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold font-cairo">دائن (له متبقي لدينا)</span>
                          </div>
                        );
                      } else if (diff < -0.01) {
                        return (
                          <div className="space-y-1">
                            <div className="text-lg font-black text-rose-500 font-mono">-{Math.abs(diff).toFixed(2)} {curr}</div>
                            <span className="inline-block px-2 py-0.5 rounded-lg text-[9px] bg-rose-500/10 border border-rose-500/20 text-rose-500 font-bold font-cairo">مدين (عليه مستحقات للدفع)</span>
                          </div>
                        );
                      } else {
                        return (
                          <div className="space-y-1">
                            <div className="text-lg font-black text-slate-400 font-mono">0.00 {curr}</div>
                            <span className="inline-block px-2 py-0.5 rounded-lg text-[9px] bg-white/[0.02] border border-white/5 text-slate-400 font-bold font-cairo">رصيد خالي من المديونيات</span>
                          </div>
                        );
                      }
                    })()}`;

let updatedContent = content.replace(oldDesktopStats, newDesktopStats);

const oldMobileStats = `                    {(() => {
                        const totalPaid = getCustomerTotalPaid(selectedCustomer.id!);
                        const totalCost = getCustomerTotalCost(selectedCustomer.id!);
                        const diff = totalPaid - totalCost;
                        const curr = getCustomerCurrencyLabel(selectedCustomer.id!);
                        
                        if (diff > 0.01) {
                          return <div className="text-lg font-black text-emerald-400 font-mono">+{diff.toFixed(2)} {curr}</div>;
                        } else if (diff < -0.01) {
                          return <div className="text-lg font-black text-rose-500 font-mono">{diff.toFixed(2)} {curr}</div>;
                        } else {
                          return <div className="text-lg font-black text-slate-400 font-mono">0.00 {curr}</div>;
                        }
                      })()}`;

const newMobileStats = `                    {(() => {
                        const outstandingAmt = getCustomerOutstandingAmount(selectedCustomer.id!);
                        const diff = -outstandingAmt;
                        const curr = getCustomerCurrencyLabel(selectedCustomer.id!);
                        
                        if (diff > 0.01) {
                          return <div className="text-lg font-black text-emerald-400 font-mono">+{diff.toFixed(2)} {curr}</div>;
                        } else if (diff < -0.01) {
                          return <div className="text-lg font-black text-rose-500 font-mono">-{Math.abs(diff).toFixed(2)} {curr}</div>;
                        } else {
                          return <div className="text-lg font-black text-slate-400 font-mono">0.00 {curr}</div>;
                        }
                      })()}`;

updatedContent = updatedContent.replace(oldMobileStats, newMobileStats);

fs.writeFileSync('src/components/Customers.tsx', updatedContent, 'utf8');
console.log('Stats updated');
