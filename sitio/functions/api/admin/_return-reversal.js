import {OperationError} from './_operations.js';
export async function reversalPlan(env,state,type,id){
 const sale=type==='sale',table=sale?'sale_returns':'purchase_returns',lineTable=sale?'sale_return_lines':'purchase_return_lines';
 const row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();if(!row)throw new OperationError('La devolución no existe.',404);
 if(await env.DB.prepare('SELECT id FROM return_reversals WHERE record_type=? AND return_id=?').bind(type,id).first())throw new OperationError('Esta devolución ya fue corregida.');
 const lines=(await env.DB.prepare(`SELECT * FROM ${lineTable} WHERE return_id=? ORDER BY rowid`).bind(id).all()).results;
 const effects=(await env.DB.prepare('SELECT * FROM return_stock_effects WHERE record_type=? AND return_id=?').bind(type,id).all()).results;
 const quantities=new Map();for(const l of lines)if(sale?l.return_to_stock:l.remove_from_stock)quantities.set(l.product_id,(quantities.get(l.product_id)||0)+l.quantity);
 const stocks=[];
 for(const [sid,q] of quantities){const old=state.stocks.get(sid);if(!old||state.archived.has(sid))throw new OperationError('Revisá o restaurá el SKU histórico antes de compensar unidades.');const delta=sale?-q:q,after=old.quantity+delta;if(after<0||after>100000)throw new OperationError('Las existencias actuales no permiten compensar esa devolución. No se modificó nada.');const snapshot=effects.find(e=>e.product_id===sid),exact=snapshot&&old.revision===snapshot.revision_after&&old.quantity===snapshot.after_quantity&&old.cost_cents===snapshot.after_cost_cents;stocks.push({product_id:sid,delta,before_quantity:old.quantity,after_quantity:after,before_cost_cents:old.cost_cents,after_cost_cents:exact?snapshot.before_cost_cents:old.cost_cents,revision:old.revision,valuation_mode:exact?'restore_snapshot':'current_average'})}
 const recordId=sale?row.sale_id:row.purchase_id;
 const balance=await env.DB.prepare('SELECT * FROM settlement_balances_v137 WHERE record_type=? AND record_id=?').bind(type,recordId).first();
 return {record_type:type,return_id:id,record_id:recordId,returned_at:row.returned_at,amount_cents:sale?row.refund_cents:row.credit_cents,cost_cents:sale?row.cost_reversal_cents:0,stocks,balance_revision:balance.revision,balance_before_cents:balance.balance_cents,balance_after_cents:balance.balance_cents+(sale?row.refund_cents:row.credit_cents)};
}
export const planStamp=p=>JSON.stringify(p);
