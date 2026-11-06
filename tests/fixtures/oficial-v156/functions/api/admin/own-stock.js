import {json,check,allowOrigin} from '../_utils.js';
import {loadInventory} from '../_catalog.js';
import {operation,OperationError,resolveLine,lineGuards} from './_operations.js';
export async function onRequestGet({request,env}){
 const bad=await check(request,env);if(bad)return bad;
 try{
  const state=await loadInventory(request,env);
  const history=await env.DB.prepare('SELECT product_id,delta,quantity_before,quantity_after,reason,created_at FROM stock_movements ORDER BY created_at DESC LIMIT 60').all();
  return json({items:[...state.stocks.values()],variants:state.items,history:history.results||[],total_units:state.total_units,source:'ONE_MORE_D1',version:'v129'});
 }catch(e){return json({error:'No se pudo cargar inventario. Verificá la migración V129 y los vínculos.'},503)}
}
export async function onRequestPost({request,env}){
 const bad=await check(request,env);if(bad)return bad;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||typeof b!=='object')return json({error:'Ajuste inválido'},400);
 const id=String(b.product_id||''),quantity=b.quantity,cost=b.cost_cents,min=b.min_quantity,reason=String(b.reason||'').trim().slice(0,150);
 if(!/^[\w-]{2,100}$/.test(id)||!Number.isSafeInteger(quantity)||quantity<0||quantity>100000||!Number.isSafeInteger(cost)||cost<0||cost>1e12||!Number.isSafeInteger(min)||min<0||min>100000||!reason||!(b.expected_revision===null||Number.isSafeInteger(b.expected_revision)))return json({error:'Revisá valores, motivo y versión del saldo. Actualizá el panel.'},400);
 return operation(request,env,'adjustment',b,async(state,key,actor)=>{
  // Ajustar un SKU antiguo sin identificar no exige inventar una oferta comercial.
  const row=state.items.find(p=>p.physicalId===id)||resolveLine(state,id);
  if(!row.physicalId||row.archived)throw new OperationError('SKU inexistente o archivado.');
  const sid=row.physicalId,old=state.stocks.get(sid);
  if((old?.revision??null)!==b.expected_revision)throw new OperationError('El saldo cambió desde que abriste la ficha. Actualizá y revisá antes de guardar.');
  const before=old?.quantity??0,delta=quantity-before;
  const statements=[...lineGuards(env,row,old),
   env.DB.prepare("INSERT INTO stock_items(product_id,quantity,cost_cents,min_quantity,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity,cost_cents=excluded.cost_cents,min_quantity=excluded.min_quantity,updated_at=datetime('now')").bind(sid,quantity,cost,min),
   env.DB.prepare('INSERT INTO stock_change_audit(id,operation_key,stock_id,before_json,after_json,reason,actor) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),key,sid,JSON.stringify(old||null),JSON.stringify({quantity,cost_cents:cost,min_quantity:min}),reason,actor)];
  if(delta!==0)statements.push(env.DB.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),sid,delta,before,quantity,reason));
  return {body:{ok:true,product_id:sid,quantity},statements};
 });
}
