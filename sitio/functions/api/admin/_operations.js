import {principal,actorId,accessGuard,event} from '../_access.js';
import {json} from '../_utils.js';
import {loadInventory} from '../_catalog.js';
export class OperationError extends Error {constructor(message,status=409){super(message);this.status=status}}
import {deploymentOnly} from '../_deployment.js';
export {deploymentOnly} from '../_deployment.js';
export function assertion(env,condition,params=[]){
  return env.DB.prepare(`INSERT INTO management_assertions(id,ok) VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`)
    .bind(crypto.randomUUID(),...params);
}
export function stockGuard(env,id,old){
  return assertion(env,old
    ? 'EXISTS(SELECT 1 FROM stock_items s JOIN stock_revisions r ON r.product_id=s.product_id WHERE s.product_id=? AND r.revision=?)'
    : 'NOT EXISTS(SELECT 1 FROM stock_items WHERE product_id=?)',old?[id,old.revision]:[id]);
}
export function mappingGuard(env,catalogId,stockId){
  if(!catalogId)return assertion(env,'NOT EXISTS(SELECT 1 FROM catalog_stock_links WHERE stock_id=?)',[stockId]);
  return assertion(env, catalogId===stockId
    ? 'NOT EXISTS(SELECT 1 FROM catalog_stock_links WHERE catalog_id=? OR stock_id=?)'
    : 'EXISTS(SELECT 1 FROM catalog_stock_links WHERE catalog_id=? AND stock_id=?)',[catalogId,stockId]);
}
export async function operation(request,env,kind,b,run){
  const denied=deploymentOnly(request);if(denied)return denied;
  // Claves naturales preservan compatibilidad con clientes legados.
  const natural=kind==='sale'?b.reference:kind==='purchase'?[b.supplier,b.document_number]:null;
  const key=b.operation_key?String(b.operation_key):natural?JSON.stringify([kind,natural]):null;
  if(!key||key.length>500) return json({error:'Falta una clave de operación válida; actualizá el panel.'},400);
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>k!=='operation_key').map(k=>[k,canonical(v[k])])):v;
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(b)))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const replay=async()=>{
    const found=await env.DB.prepare('SELECT * FROM management_operations WHERE operation_key=?').bind(key).first();
    if(!found)return null;
    if(found.kind!==kind||found.request_hash!==hash)return json({error:'La clave ya fue usada con otros datos. Revisá el historial.'},409);
    return json({...JSON.parse(found.result_json),replayed:true});
  };
  try{
    const cached=await replay();if(cached)return cached;
    const catalogRevision=['purchase','create-linked-variant'].includes(kind)?await env.DB.prepare('SELECT revision FROM catalog_identity_revision WHERE id=1').first():null;
    const state=['settlement','settlement-reversal','finance','reconciliation'].includes(kind)?null:await loadInventory(request,env);
    const actor=await principal(request,env);
    const result=await run(state,key,actorId(actor));
    const statements=[accessGuard(env,actor,request),...(catalogRevision?[assertion(env,'EXISTS(SELECT 1 FROM catalog_identity_revision WHERE id=1 AND revision=?)',[catalogRevision.revision])]:[]),env.DB.prepare('INSERT INTO management_operations(operation_key,kind,request_hash,result_json,actor) VALUES(?,?,?,?,?)').bind(key,kind,hash,JSON.stringify(result.body),actorId(actor)),...result.statements,event(env,actor,kind==='archive'&&result.body.archived===false?'restore':kind,result.body.id||result.body.product_id||result.body.stock_id||'',kind==='sale'?b.reference:kind==='purchase'?[b.supplier,b.document_number].join(' · '):b.reason||b.note||'')];
    // Cada aserción tiene ID propio; se limpian dentro del mismo batch atómico.
    statements.push(env.DB.prepare('DELETE FROM management_assertions'));
    await env.DB.batch(statements);
    return json(result.body,result.status||200);
  }catch(e){
    try{const cached=await replay();if(cached)return cached}catch{}
    if(e instanceof OperationError)return json({error:e.message},e.status);
    const message=String(e.message||e);
    if(/concurrent_change|CHECK constraint|UNIQUE constraint/i.test(message))return json({error:'Los datos cambiaron o la operación ya existe. Actualizá y verificá el historial antes de reintentar.'},409);
    return json({error:'No se pudo guardar. Verificá las migraciones V129, V132, V134, V135, V136, V137, V138 y V139 y los vínculos; no se completó la operación.'},503);
  }
}
export function resolveLine(state,id){
  const row=state.items.find(p=>p.commercialId===id)||state.items.find(p=>p.physicalId===id);
  if(!row)throw new OperationError('Producto o variante desconocida.',400);
  if(!row.physicalId)throw new OperationError('Todavía no hay mercadería recibida para esta variante. Ingresala desde Compras.');
  if(row.archived)throw new OperationError('El SKU está archivado; restauralo antes de operar.');
  if(row.needsIdentification&&/sabor por verificar|sabor a confirmar|por definir/i.test(row.size||''))throw new OperationError('Confirmá el sabor del SKU antes de ingresar o vender unidades.');
  return row;
}
export function lineGuards(env,row,old){return [stockGuard(env,row.physicalId,old),mappingGuard(env,row.commercialId,row.physicalId),
  assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[row.physicalId])];}
