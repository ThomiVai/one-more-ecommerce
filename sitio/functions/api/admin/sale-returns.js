import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,assertion,stockGuard} from './_operations.js';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||typeof b!=='object'||typeof b.sale_id!=='string'||!/^[\w-]{2,100}$/.test(b.sale_id)||!validDate(b.returned_at)||b.returned_at>today()||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.trim().length>300||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>60)return json({error:'Completá venta, fecha válida, motivo y productos a devolver.'},400);
 if(typeof b.operation_key!=='string'||!/^[\w-]{12,100}$/.test(b.operation_key))return json({error:'Actualizá la revisión antes de confirmar la devolución.'},400);
 const seen=new Set();
 for(const l of b.lines){if(!l||typeof l.sale_line_id!=='string'||!/^[\w-]{2,100}$/.test(l.sale_line_id)||seen.has(l.sale_line_id)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>1000||typeof l.return_to_stock!=='boolean')return json({error:'Revisá cantidades y elegí explícitamente si vuelve mercadería por cada producto.'},400);seen.add(l.sale_line_id)}
 return operation(request,env,'sale-return',b,async(state,key,actor)=>{
  const sale=await env.DB.prepare('SELECT * FROM sales WHERE id=?').bind(b.sale_id).first();
  if(!sale)throw new OperationError('La venta original no existe.',404);
  if(b.returned_at<sale.sold_at)throw new OperationError('La devolución no puede ser anterior a la venta.',400);
  const original=await env.DB.prepare('SELECT l.*,COALESCE((SELECT SUM(r.quantity) FROM active_sale_return_lines_v138 r WHERE r.sale_line_id=l.id),0) returned_quantity FROM sale_lines l WHERE l.sale_id=? ORDER BY l.rowid').bind(sale.id).all();
  const id=crypto.randomUUID(),statements=[],stockChanges=new Map();let refund=0,costReversal=0;
  for(const line of b.lines){
   const old=original.results.find(l=>l.id===line.sale_line_id);
   if(!old)throw new OperationError('El renglón no pertenece a esta venta.',400);
   if(old.returned_quantity+line.quantity>old.quantity)throw new OperationError('La cantidad supera las unidades pendientes de devolución. Actualizá el detalle.');
   refund+=line.quantity*old.unit_price_cents;
   statements.push(assertion(env,'EXISTS(SELECT 1 FROM sale_lines WHERE id=? AND sale_id=? AND product_id=? AND quantity=? AND unit_price_cents=? AND unit_cost_cents=?) AND COALESCE((SELECT SUM(quantity) FROM active_sale_return_lines_v138 WHERE sale_line_id=?),0)=?',[old.id,sale.id,old.product_id,old.quantity,old.unit_price_cents,old.unit_cost_cents,old.id,old.returned_quantity]));
   statements.push(env.DB.prepare('INSERT INTO sale_return_lines(id,return_id,sale_line_id,product_id,quantity,return_to_stock,unit_price_cents,unit_cost_cents) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,old.id,old.product_id,line.quantity,line.return_to_stock?1:0,old.unit_price_cents,old.unit_cost_cents));
   if(line.return_to_stock){
    const physical=state.stocks.get(old.product_id);
    if(!physical)throw new OperationError('El SKU histórico no tiene inventario activo. Revisalo en Productos antes de devolver mercadería.');
    if(state.archived.has(old.product_id))throw new OperationError('El SKU histórico está archivado. Restauralo antes de reingresar mercadería.');
    const change=stockChanges.get(old.product_id)||{old:physical,quantity:0,value:0};change.quantity+=line.quantity;change.value+=line.quantity*old.unit_cost_cents;stockChanges.set(old.product_id,change);costReversal+=line.quantity*old.unit_cost_cents;
   }
  }
  for(const [sid,change] of stockChanges){
   const {old,quantity,value}=change,after=old.quantity+quantity;if(after>100000)throw new OperationError('El stock superaría el máximo permitido.',400);
   const cost=Math.round((old.quantity*old.cost_cents+value)/after);
   statements.push(stockGuard(env,sid,old),assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[sid]));
   statements.push(env.DB.prepare("UPDATE stock_items SET quantity=?,cost_cents=?,updated_at=datetime('now') WHERE product_id=?").bind(after,cost,sid));
   statements.push(env.DB.prepare('INSERT INTO return_stock_effects(record_type,return_id,product_id,before_quantity,after_quantity,before_cost_cents,after_cost_cents,revision_after) VALUES(?,?,?,?,?,?,?,?)').bind('sale',id,sid,old.quantity,after,old.cost_cents,cost,old.revision+1));
   statements.push(env.DB.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),sid,quantity,old.quantity,after,`Devolución ${id} · Venta ${sale.reference}`.slice(0,150)));
  }
  statements.unshift(env.DB.prepare('INSERT INTO sale_returns(id,sale_id,operation_key,returned_at,reason,refund_cents,cost_reversal_cents,actor) VALUES(?,?,?,?,?,?,?,?)').bind(id,sale.id,key,b.returned_at,b.reason.trim(),refund,costReversal,actor));
  return {body:{ok:true,id,sale_id:sale.id,refund_cents:refund,cost_reversal_cents:costReversal,units:b.lines.reduce((n,l)=>n+l.quantity,0),restocked_units:b.lines.filter(l=>l.return_to_stock).reduce((n,l)=>n+l.quantity,0)},statements,status:201};
 });
}
