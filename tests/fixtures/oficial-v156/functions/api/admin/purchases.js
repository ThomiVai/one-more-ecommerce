import {json,check,allowOrigin} from '../_utils.js';
import {sameVariant} from '../../../assets/purchase-identity-v134.js';
import {prepareReceiving} from './_receiving.js';
import {operation,OperationError} from './_operations.js';
export async function onRequestGet({request,env}){
 const bad=await check(request,env);if(bad)return bad;
 try{const res=await env.DB.prepare(`SELECT p.*,b.balance_cents settlement_balance_cents,b.paid_cents,b.refunded_cents,b.entry_count,COALESCE(r.credit_cents,0) credited_cents,COALESCE(r.returns_count,0) returns_count FROM purchase_documents p LEFT JOIN (SELECT purchase_id,SUM(credit_cents) credit_cents,COUNT(*) returns_count FROM active_purchase_returns_v138 GROUP BY purchase_id) r ON r.purchase_id=p.id LEFT JOIN settlement_balances_v137 b ON b.record_type='purchase' AND b.record_id=p.id ORDER BY p.created_at DESC,p.rowid DESC LIMIT 30`).all();return json({purchases:res.results||[]})}catch{return json({error:'No se pudieron consultar compras'},503)}
}
export async function onRequestPost({request,env}){
 const bad=await check(request,env);if(bad)return bad;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||typeof b!=='object')return json({error:'Comprobante inválido'},400);
 const supplier=String(b.supplier||'').trim().slice(0,130),doc=String(b.document_number||'').trim().slice(0,90),date=String(b.document_date||'');
 const lines=b.lines;
 if(!supplier||!doc||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(lines)||!lines.length||lines.length>80)return json({error:'Comprobante incompleto'},400);
 let total=0;
 for(const l of lines){
  if(!l||(!l.new_variant&&!/^[\w-]{2,100}$/.test(l.product_id||''))||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>10000||!Number.isSafeInteger(l.unit_cost_cents)||l.unit_cost_cents<0||l.unit_cost_cents>1e10||!Number.isSafeInteger(l.line_total_cents)||l.line_total_cents<0||l.line_total_cents>1e12||Math.abs(l.line_total_cents-l.quantity*l.unit_cost_cents)>2)return json({error:'Revisá cantidades, costos y subtotales'},400);
  total+=l.line_total_cents;
 }
 if(!Number.isSafeInteger(b.document_total_cents)||b.document_total_cents<0||b.document_total_cents>1e12||Math.abs(total-b.document_total_cents)>2)return json({error:'El total no coincide con los renglones'},400);
 return operation(request,env,'purchase',b,async(state,key,actor)=>{
  const existing=await env.DB.prepare('SELECT id FROM purchase_documents WHERE supplier=? AND document_number=?').bind(supplier,doc).first();
  if(existing)throw new OperationError('Ese comprobante ya fue importado. No se volvió a sumar stock.');
  const id=crypto.randomUUID(),statements=[],seen=new Set(),identities=[],createdVariants=[];
  statements.push(env.DB.prepare('INSERT INTO purchase_documents(id,supplier,document_number,document_date,document_total_cents,line_count) VALUES(?,?,?,?,?,?)').bind(id,supplier,doc,date,b.document_total_cents,lines.length));
  for(const l of lines){
   const prepared=await prepareReceiving(request,env,state,l,actor),row=prepared.row,sid=row.physicalId;
   if(identities.some(p=>sameVariant(p,row)))throw new OperationError('Hay dos renglones para la misma variante. Agrupalos antes de confirmar.',400);identities.push(row);
   if(prepared.created)createdVariants.push(row.id);
   if(seen.has(sid))throw new OperationError('Dos renglones corresponden al mismo SKU físico. Agrupalos antes de confirmar.',400);seen.add(sid);
   const old=state.stocks.get(sid),before=old?.quantity??0,after=before+l.quantity;
   if(after>100000)throw new OperationError('El stock superaría el máximo permitido.',400);
   const cost=before>0?Math.round(((old.cost_cents||0)*before+l.unit_cost_cents*l.quantity)/after):l.unit_cost_cents;
   statements.push(...prepared.statements);
   // Los IDs históricos siempre siguen siendo los físicos, no los comerciales.
   statements.push(env.DB.prepare('INSERT INTO purchase_lines(id,purchase_id,product_id,supplier_code,description,quantity,unit_cost_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,sid,String(l.supplier_code||'').slice(0,80),String(l.description||'').slice(0,200),l.quantity,l.unit_cost_cents,l.line_total_cents));
   statements.push(env.DB.prepare("INSERT INTO stock_items(product_id,quantity,cost_cents,min_quantity,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity,cost_cents=excluded.cost_cents,updated_at=datetime('now')").bind(sid,after,cost,old?.min_quantity??1));
   statements.push(env.DB.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),sid,l.quantity,before,after,`Compra ${supplier} #${doc}`.slice(0,150)));
  }
  return {body:{ok:true,id,lines:lines.length,units:lines.reduce((n,l)=>n+l.quantity,0),created_variants:createdVariants},statements};
 });
}
