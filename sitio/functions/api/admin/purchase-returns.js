import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,assertion,stockGuard} from './_operations.js';
import {purchaseReturnAllocation,purchaseCredit} from '../../../assets/purchase-return-values-v136.js';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||typeof b!=='object'||typeof b.purchase_id!=='string'||!/^[\w-]{2,100}$/.test(b.purchase_id)||!validDate(b.returned_at)||b.returned_at>today()||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.trim().length>300||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>80)return json({error:'Completá compra, fecha válida, motivo y productos a devolver.'},400);
 if(typeof b.operation_key!=='string'||!/^[\w-]{12,100}$/.test(b.operation_key))return json({error:'Actualizá la revisión antes de confirmar la devolución.'},400);
 const seen=new Set();
 for(const l of b.lines){if(!l||typeof l.purchase_line_id!=='string'||!/^[\w-]{2,100}$/.test(l.purchase_line_id)||seen.has(l.purchase_line_id)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>10000||typeof l.remove_from_stock!=='boolean'||!Number.isSafeInteger(l.expected_returned_quantity)||l.expected_returned_quantity<0||!Number.isSafeInteger(l.expected_credit_cents)||l.expected_credit_cents<0)return json({error:'Revisá cantidades, importe y elegí explícitamente si se descuentan existencias por cada producto.'},400);seen.add(l.purchase_line_id)}
 return operation(request,env,'purchase-return',b,async(state,key,actor)=>{
  const purchase=await env.DB.prepare('SELECT * FROM purchase_documents WHERE id=?').bind(b.purchase_id).first();
  if(!purchase)throw new OperationError('El comprobante original no existe.',404);
  if(b.returned_at<purchase.document_date)throw new OperationError('La devolución no puede ser anterior a la compra.',400);
  const original=await env.DB.prepare('SELECT l.*,COALESCE((SELECT SUM(r.quantity) FROM active_purchase_return_lines_v138 r WHERE r.purchase_line_id=l.id),0) returned_quantity,COALESCE((SELECT SUM(r.credit_cents) FROM active_purchase_return_lines_v138 r WHERE r.purchase_line_id=l.id),0) returned_credit_cents FROM purchase_lines l WHERE l.purchase_id=? ORDER BY l.rowid').bind(purchase.id).all();
  let allocation;try{allocation=purchaseReturnAllocation(original.results,purchase.document_total_cents)}catch(e){throw new OperationError(e.message)}
  const id=crypto.randomUUID(),statements=[],stockChanges=new Map();let credit=0,inventoryRemoved=0;
  for(const line of b.lines){
   const old=original.results.find(l=>l.id===line.purchase_line_id);
   if(!old)throw new OperationError('El renglón no pertenece a esta compra.',400);
   if(old.returned_quantity+line.quantity>old.quantity)throw new OperationError('La cantidad supera las unidades pendientes de devolución. Actualizá el detalle.');
   const amount=purchaseCredit(allocation.get(old.id),old.quantity,old.returned_quantity,line.quantity,old.returned_credit_cents);
   if(line.expected_returned_quantity!==old.returned_quantity||line.expected_credit_cents!==amount)throw new OperationError('El saldo o importe de la devolución cambió. Actualizá y revisá el comprobante.');
   credit+=amount;
   statements.push(assertion(env,'EXISTS(SELECT 1 FROM purchase_lines WHERE id=? AND purchase_id=? AND product_id=? AND quantity=? AND unit_cost_cents=? AND line_total_cents=?) AND COALESCE((SELECT SUM(quantity) FROM active_purchase_return_lines_v138 WHERE purchase_line_id=?),0)=?',[old.id,purchase.id,old.product_id,old.quantity,old.unit_cost_cents,old.line_total_cents,old.id,old.returned_quantity]));
   statements.push(env.DB.prepare('INSERT INTO purchase_return_lines(id,return_id,purchase_line_id,product_id,quantity,remove_from_stock,unit_cost_cents,original_line_total_cents,credit_cents) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,old.id,old.product_id,line.quantity,line.remove_from_stock?1:0,old.unit_cost_cents,old.line_total_cents,amount));
   if(line.remove_from_stock){
    const physical=state.stocks.get(old.product_id);
    if(!physical)throw new OperationError('El SKU histórico no tiene inventario activo. Revisalo antes de descontar mercadería.');
    if(state.archived.has(old.product_id))throw new OperationError('El SKU histórico está archivado. Restauralo antes de descontar mercadería.');
    const change=stockChanges.get(old.product_id)||{old:physical,quantity:0};change.quantity+=line.quantity;stockChanges.set(old.product_id,change);
   }
  }
  for(const [sid,change] of stockChanges){
   const {old,quantity}=change,after=old.quantity-quantity;
   if(after<0)throw new OperationError('No hay suficientes unidades del SKU histórico para devolver esa mercadería. Revisá las existencias; no se guardó la operación.');
   inventoryRemoved+=quantity*old.cost_cents;
   statements.push(stockGuard(env,sid,old),assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[sid]));
   // Mantiene el promedio actual: sacar unidades no reescribe adquisiciones ni ventas pasadas.
   statements.push(env.DB.prepare("UPDATE stock_items SET quantity=?,updated_at=datetime('now') WHERE product_id=?").bind(after,sid));
   statements.push(env.DB.prepare('INSERT INTO return_stock_effects(record_type,return_id,product_id,before_quantity,after_quantity,before_cost_cents,after_cost_cents,revision_after) VALUES(?,?,?,?,?,?,?,?)').bind('purchase',id,sid,old.quantity,after,old.cost_cents,old.cost_cents,old.revision+1));
   statements.push(env.DB.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),sid,-quantity,old.quantity,after,`Devolución a proveedor ${id} · Compra ${purchase.document_number}`.slice(0,150)));
  }
  statements.unshift(assertion(env,'EXISTS(SELECT 1 FROM purchase_documents WHERE id=? AND document_total_cents=? AND document_date=?)',[purchase.id,purchase.document_total_cents,purchase.document_date]),env.DB.prepare('INSERT INTO purchase_returns(id,purchase_id,operation_key,returned_at,reason,credit_cents,inventory_removed_cents,actor) VALUES(?,?,?,?,?,?,?,?)').bind(id,purchase.id,key,b.returned_at,b.reason.trim(),credit,inventoryRemoved,actor));
  return {body:{ok:true,id,purchase_id:purchase.id,credit_cents:credit,inventory_removed_cents:inventoryRemoved,units:b.lines.reduce((n,l)=>n+l.quantity,0),removed_units:b.lines.filter(l=>l.remove_from_stock).reduce((n,l)=>n+l.quantity,0)},statements,status:201};
 });
}
