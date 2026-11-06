import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,lineGuards} from './_operations.js';
export async function onRequestGet({request,env}){
 const bad=await check(request,env);if(bad)return bad;
 try{const r=await env.DB.prepare('SELECT product_id,archived_at,reason FROM inventory_archived ORDER BY archived_at DESC').all();return json({items:r.results||[]})}
 catch{return json({error:'No se pudo consultar archivo'},503)}
}
export async function onRequestPost({request,env}){
 const bad=await check(request,env);if(bad)return bad;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 const id=String(b?.product_id||''),action=String(b?.action||'');
 if(!/^[\w-]{2,100}$/.test(id)||!['archive','restore'].includes(action))return json({error:'Solicitud inválida'},400);
 return operation(request,env,'archive',b,async state=>{
  const row=state.items.find(p=>p.physicalId===id);if(!row)throw new OperationError('SKU desconocido.',400);
  const statements=[];
  if(action==='archive'){
   const old=state.stocks.get(id);if((old?.quantity??0)>0)throw new OperationError('Hay unidades físicas. No se puede archivar mercadería existente.');
   if(row.archived)return {body:{ok:true,product_id:id,archived:true},statements};
   statements.push(...lineGuards(env,row,old));
   statements.push(env.DB.prepare("INSERT INTO inventory_archived(product_id,reason) VALUES(?,'Archivado manualmente') ON CONFLICT(product_id) DO NOTHING").bind(id));
  }else statements.push(env.DB.prepare('DELETE FROM inventory_archived WHERE product_id=?').bind(id));
  return {body:{ok:true,product_id:id,archived:action==='archive'},statements};
 });
}
