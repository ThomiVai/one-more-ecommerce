import {comboRecipe,comboCandidate,comboPrices} from '../../../assets/combo-recipes-v138.js';
import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,resolveLine,lineGuards,assertion} from './_operations.js';
export async function onRequestGet({request,env}){
 const bad=await check(request,env);if(bad)return bad;
 try{const r=await env.DB.prepare(`SELECT s.*,b.balance_cents settlement_balance_cents,b.paid_cents,b.refunded_cents,b.entry_count,COALESCE(r.refund_cents,0) refunded_cents,COALESCE(r.cost_reversal_cents,0) cost_reversal_cents,COALESCE(r.returns_count,0) returns_count FROM sales s LEFT JOIN (SELECT sale_id,SUM(refund_cents) refund_cents,SUM(cost_reversal_cents) cost_reversal_cents,COUNT(*) returns_count FROM active_sale_returns_v138 GROUP BY sale_id) r ON r.sale_id=s.id LEFT JOIN settlement_balances_v137 b ON b.record_type='sale' AND b.record_id=s.id ORDER BY s.created_at DESC,s.rowid DESC LIMIT 100`).all();return json({sales:r.results||[]})}catch{return json({error:'No se pudieron consultar ventas'},503)}
}
export async function onRequestPost({request,env}){
 const bad=await check(request,env);if(bad)return bad;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||typeof b!=='object')return json({error:'Venta inválida'},400);
 const reference=String(b.reference||'').trim().slice(0,100),soldAt=String(b.sold_at||''),channel=String(b.channel||'historica'),note=String(b.note||'').trim().slice(0,300);
 if(!reference||!/^\d{4}-\d{2}-\d{2}$/.test(soldAt)||!['historica','whatsapp','instagram','web','otra'].includes(channel)||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>30)return json({error:'Referencia, fecha, canal o líneas inválidas'},400);
 const orderId=b.order_id==null?null:String(b.order_id).trim();if(orderId&&!/^[0-9a-f-]{36}$/i.test(orderId))return json({error:'ID de pedido inválido'},400);
 let revenue=0;
 for(const l of b.lines){
  if(!l||!/^[\w-]{2,100}$/.test(l.product_id||'')||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>1000||!Number.isSafeInteger(l.unit_price_cents)||l.unit_price_cents<0||l.unit_price_cents>1e10)return json({error:'Revisá productos, cantidades y precios'},400);
  revenue+=l.quantity*l.unit_price_cents;
 }
 if(revenue>1e13)return json({error:'Venta supera límite'},400);
 return operation(request,env,'sale',b,async state=>{
  const existing=await env.DB.prepare('SELECT id FROM sales WHERE reference=?').bind(reference).first();
  if(existing)throw new OperationError('Referencia ya registrada. No se volvió a descontar stock.');
  const id=crypto.randomUUID(),statements=[],seenSingles=new Set(),resolved=[],groups=[],stockTotals=new Map();let cost=0;
  for(const l of b.lines){
   if(l.product_id.startsWith('combo-')){
    const recipe=comboRecipe(l.product_id),combo=state.catalogItems.find(p=>p.id===l.product_id);
    if(!recipe||!combo||l.components_confirmed!==true||!Array.isArray(l.components)||l.components.length!==2)throw new OperationError('Elegí y confirmá las dos variantes exactas del combo.',400);
    const rows=l.components.map((component,i)=>{if(typeof component!=='string')throw new OperationError('Componente inválido.',400);const row=resolveLine(state,component);if(!comboCandidate(row,recipe.slots[i],state.catalogItems))throw new OperationError('La fórmula, presentación o envase no pertenece a esta receta de combo.',400);return row});
    const prices=comboPrices(l.unit_price_cents,rows),group={id:crypto.randomUUID(),combo_id:l.product_id,label:[combo.brand,combo.name].join(' · '),quantity:l.quantity,unit_price_cents:l.unit_price_cents,recipe:rows.map((p,i)=>({product_id:p.id,physical_id:p.physicalId,label:[p.brand,p.name,p.size].join(' · '),unit_price_cents:prices[i]}))};groups.push(group);
    rows.forEach((row,i)=>resolved.push({l:{product_id:row.id,quantity:l.quantity,unit_price_cents:prices[i]},row,sid:row.physicalId,group,slot:i}));
   }else{const row=resolveLine(state,l.product_id);if(seenSingles.has(row.physicalId))throw new OperationError('Dos renglones apuntan al mismo SKU físico.',400);seenSingles.add(row.physicalId);resolved.push({l,row,sid:row.physicalId})}
  }
  for(const r of resolved){const old=state.stocks.get(r.sid);if(!old)throw new OperationError('Primero ingresá el stock del componente.');r.old=old;cost+=old.cost_cents*r.l.quantity;const item=stockTotals.get(r.sid)||{old,quantity:0,row:r.row};item.quantity+=r.l.quantity;stockTotals.set(r.sid,item)}
  for(const [sid,item] of stockTotals)if(item.old.quantity<item.quantity)throw new OperationError(`Stock insuficiente para ${item.row.brand} ${item.row.name} ${item.row.size}: ${item.old.quantity} disponible. Conservá la solicitud a pedido; no se descontó nada.`);
  statements.push(env.DB.prepare('INSERT INTO sales(id,reference,sold_at,channel,note,revenue_cents,cost_cents,order_id) VALUES(?,?,?,?,?,?,?,?)').bind(id,reference,soldAt,channel,note,revenue,cost,orderId));
  if(orderId)statements.push(assertion(env,"EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pending')",[orderId]));
  for(const group of groups)statements.push(env.DB.prepare('INSERT INTO sale_combo_groups(id,sale_id,combo_id,label,quantity,unit_price_cents,recipe_json) VALUES(?,?,?,?,?,?,?)').bind(group.id,id,group.combo_id,group.label,group.quantity,group.unit_price_cents,JSON.stringify(group.recipe)));
  for(const {l,row,sid,old,group,slot} of resolved){
   statements.push(...lineGuards(env,row,old));const lineId=crypto.randomUUID();
   statements.push(env.DB.prepare('INSERT INTO sale_lines(id,sale_id,product_id,quantity,unit_price_cents,unit_cost_cents) VALUES(?,?,?,?,?,?)').bind(lineId,id,sid,l.quantity,l.unit_price_cents,old.cost_cents));
   if(group)statements.push(env.DB.prepare('INSERT INTO sale_combo_components(sale_line_id,group_id,slot) VALUES(?,?,?)').bind(lineId,group.id,slot));
  }
  for(const [sid,{old,quantity}] of stockTotals){
   statements.push(env.DB.prepare("UPDATE stock_items SET quantity=quantity-?,updated_at=datetime('now') WHERE product_id=?").bind(quantity,sid));
   statements.push(env.DB.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),sid,-quantity,old.quantity,old.quantity-quantity,`Venta ${reference}`.slice(0,150)));
  }
  if(orderId)statements.push(env.DB.prepare("UPDATE orders SET status='confirmed',updated_at=datetime('now') WHERE id=?").bind(orderId));
  return {body:{ok:true,id,reference,revenue_cents:revenue,cost_cents:cost,gross_profit_cents:revenue-cost},status:201,statements};
 });
}
