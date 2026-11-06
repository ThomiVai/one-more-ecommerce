import {json,check,allowOrigin} from '../_utils.js';
import {principal,actorId,authorizedBatch} from '../_access.js';
import {loadCatalog} from '../_catalog.js';
import {matchInfo,flavorOf,confirmableUnknownFlavor} from './_matching.js';
import {assertion,deploymentOnly} from './_operations.js';
const ID=/^[a-zA-Z0-9_-]{2,100}$/;
export async function onRequestGet({request,env}){
 const bad=await check(request,env);if(bad)return bad;
 try{
  const catalog=await loadCatalog(request,env);
  const [links,stock,archived]=await Promise.all([
   env.DB.prepare('SELECT * FROM catalog_stock_links ORDER BY catalog_id').all(),
   env.DB.prepare('SELECT * FROM stock_items ORDER BY product_id').all(),
   env.DB.prepare('SELECT product_id FROM inventory_archived').all()]);
  return json({links:links.results||[],stock:stock.results||[],physical:catalog.physical,
   archived:(archived.results||[]).map(x=>x.product_id),mode:'review_only',storefront_stock_blocking:false});
 }catch{return json({error:'No se pudieron cargar los vínculos.'},503)}
}
export async function onRequestPost({request,env}){
 const bad=await check(request,env);if(bad)return bad;const denied=deploymentOnly(request);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 const catalogId=String(b?.catalog_id||''),action=String(b?.action||''),stockId=String(b?.stock_id||'');
 if(!ID.test(catalogId)||!['link','unlink','resolve-flavor'].includes(action))return json({error:'Acción o identificador inválido'},400);
 try{
  const old=await env.DB.prepare('SELECT stock_id FROM catalog_stock_links WHERE catalog_id=?').bind(catalogId).first();
  const statements=[];
  if(action==='unlink'){
   if(!old)return json({ok:true,catalog_id:catalogId,linked:false});
   statements.push(assertion(env,'EXISTS(SELECT 1 FROM catalog_stock_links WHERE catalog_id=? AND stock_id=?)',[catalogId,old.stock_id]));
   statements.push(env.DB.prepare('DELETE FROM catalog_stock_links WHERE catalog_id=?').bind(catalogId));
  }else{
   if(!ID.test(stockId))return json({error:'SKU inválido'},400);
   const data=await loadCatalog(request,env),commercial=data.items.find(p=>p.id===catalogId),physical=data.physical.find(p=>p.id===stockId);
   if(!commercial||!physical)return json({error:'Variante o SKU inexistente'},400);
   if(data.physical.some(p=>p.id===catalogId)||data.items.some(p=>p.id===stockId))return json({error:'Ya hay una identidad directa por ID; no se comparte con otra variante.'},409);
   if(old&&old.stock_id===stockId)return json({ok:true,catalog_id:catalogId,stock_id:stockId,linked:true});
   if(old)return json({error:'La variante ya está vinculada. Revisá y desvinculá explícitamente antes de cambiarla.'},409);
   const valid=action==='resolve-flavor'?confirmableUnknownFlavor(physical,commercial)&&String(b.confirmed_flavor)===flavorOf(commercial):matchInfo(physical,commercial).ok;
   if(!valid)return json({error:'Marca, fórmula, gramaje, envase o sabor no coinciden. Confirmá el envase físico.'},409);
   statements.push(assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[stockId]));
   statements.push(env.DB.prepare('INSERT INTO catalog_stock_links(catalog_id,stock_id) VALUES(?,?)').bind(catalogId,stockId));
  }
  statements.push(env.DB.prepare('INSERT INTO stock_link_audit(id,catalog_id,old_stock_id,new_stock_id,action,actor) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),catalogId,old?.stock_id??null,action==='unlink'?null:stockId,action,actorId(await principal(request,env))));
  statements.push(env.DB.prepare('DELETE FROM management_assertions'));
  await authorizedBatch(request,env,statements,'stock-'+action,catalogId,stockId);
  return json({ok:true,catalog_id:catalogId,stock_id:action==='unlink'?null:stockId,linked:action!=='unlink'});
 }catch(e){return json({error:/UNIQUE|concurrent_change|CHECK constraint/i.test(String(e.message))?'Los vínculos cambiaron. Actualizá antes de continuar.':'No se guardó el vínculo. Verificá la migración V129.'},409)}
}
