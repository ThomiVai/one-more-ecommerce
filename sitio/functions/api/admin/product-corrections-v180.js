import {json,check,allowOrigin} from '../_utils.js';
import {loadInventory} from '../_catalog.js';
import {operation,OperationError,assertion,lineGuards,stockGuard,mappingGuard} from './_operations.js';
const sourceId='bulk-ena-155',targetId='ena-whey-907-ch';
const ids=['ena-whey-907-ch','ena-creatina-300-ne','gentech-creatina-250-ne','star-crea-doy-300-ne','bulk-ena-155'];
export const source=sourceId,target=targetId;
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function definitions(request,env){const r=await env.ASSETS.fetch(new URL('/data/correcciones-v180.json',request.url));if(!r.ok)throw new OperationError('Faltan los datos V180.',503);const rows=await r.json();if(rows.length!==ids.length||rows.some((r,i)=>r.id!==ids[i]))throw new OperationError('Datos V180 inválidos.',503);return rows;}
export function makePlan(state,defs){
 const catalog=defs.map(u=>{const p=state.catalogItems.find(p=>p.id===u.id);if(!p)throw new OperationError('No se encontró la ficha '+u.id);return {before:{id:p.id,name:p.name,brand:p.brand,size:p.size,price:p.price,status:p.status,image_url:p.image_url||'',description:p.description||''},after:{id:p.id,name:u.name??p.name,brand:u.brand??p.brand,size:u.size??p.size,price:u.price??p.price,status:u.price!==undefined?'published':p.status,image_url:'/images/v180/'+u.image,description:p.description||''}}});
 const from=state.items.find(p=>p.commercialId===sourceId),to=state.items.find(p=>p.commercialId===targetId);
 if(!from||!to||!/100%.*Whey/i.test(from.name)||!/907\s*g.*Chocolate/i.test(from.size)||!/TrueMade.*Whey/i.test(to.name)||!/930\s*g.*Chocolate/i.test(to.size))throw new OperationError('La identidad de las variantes ENA cambió. Revisá antes de corregir.');
 const a=state.stocks.get(from.physicalId),dest=to.physicalId||targetId,b=state.stocks.get(dest);
 const possible=!!from.physicalId&&!from.archived&&!to.archived&&a?.quantity===1&&Number.isSafeInteger(a.cost_cents)&&a.cost_cents>=0&&(b?.quantity??0)===0;
 // No mezcla costos con existencias previas: si destino ya tiene stock, exige revisión.
 return {catalog,inventory:{available:possible,source:from.physicalId||null,destination:dest,source_quantity:a?.quantity??0,destination_quantity:b?.quantity??0,cost_cents:a?.cost_cents??null,source_revision:a?.revision??null,destination_revision:b?.revision??null},from,to,oldSource:a||null,oldDestination:b||null};
}
async function snapshot(request,env,state){const defs=await definitions(request,env),plan=makePlan(state,defs),revision=await env.DB.prepare('SELECT revision FROM catalog_identity_revision WHERE id=1').first();const token=await sha({catalog:plan.catalog.map(x=>x.before),inventory:plan.inventory,revision:revision?.revision});return {plan,revision:revision?.revision,token};}
export async function onRequestGet({request,env}){const bad=await check(request,env);if(bad)return bad;try{const {plan,token}=await snapshot(request,env,await loadInventory(request,env));return json({catalog:plan.catalog,inventory:plan.inventory,token});}catch(e){return json({error:e.message||'No se pudo preparar la revisión.'},e.status||503);}}
export async function onRequestPost({request,env}){const bad=await check(request,env);if(bad)return bad;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);let body;try{body=await request.json()}catch{return json({error:'JSON inválido'},400)}if(body.confirmed!==true||typeof body.move_inventory!=='boolean'||typeof body.token!=='string')return json({error:'Revisá y confirmá los cambios.'},400);
 return operation(request,env,'product-corrections-v180',body,async(state,key,actor)=>{
  const {plan,token,revision}=await snapshot(request,env,state);if(token!==body.token)throw new OperationError('El catálogo o el stock cambiaron. Volvé a revisar.');
  const statements=[assertion(env,'EXISTS(SELECT 1 FROM catalog_identity_revision WHERE id=1 AND revision=?)',[revision])];
  for(const {after:p} of plan.catalog){if(!Number.isFinite(p.price)||p.price<0)throw new OperationError('Precio inválido.');statements.push(env.DB.prepare("INSERT INTO catalog_overrides(product_id,name,brand,size,price_cents,publication_status,image_url,description,updated_at) VALUES(?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,brand=excluded.brand,size=excluded.size,price_cents=excluded.price_cents,publication_status=excluded.publication_status,image_url=excluded.image_url,description=excluded.description,updated_at=datetime('now')").bind(p.id,p.name,p.brand,p.size,Math.round(p.price*100),p.status,p.image_url,p.description));}
  if(body.move_inventory){
   if(!plan.inventory.available)throw new OperationError('No hay exactamente 1 unidad de 100% Chocolate con costo válido y destino sin existencias. Revisá Gestión; no se movió stock.');
   const a=plan.oldSource,b=plan.oldDestination,sid=plan.inventory.source,did=plan.inventory.destination;
   if(sid===did)throw new OperationError('Origen y destino coinciden.');
   statements.push(...lineGuards(env,plan.from,a),stockGuard(env,did,b),mappingGuard(env,targetId,did),assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[did]));
   for(const [id,old,quantity,cost,min] of [[sid,a,0,a.cost_cents,a.min_quantity],[did,b,1,a.cost_cents,b?.min_quantity??1]]){
    const reason='Corrección V180: unidad física ENA TrueMade 930 g Chocolate registrada como 100% Whey 907 g';
    statements.push(env.DB.prepare("INSERT INTO stock_items(product_id,quantity,cost_cents,min_quantity,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity,cost_cents=excluded.cost_cents,min_quantity=excluded.min_quantity,updated_at=datetime('now')").bind(id,quantity,cost,min),env.DB.prepare('INSERT INTO stock_change_audit(id,operation_key,stock_id,before_json,after_json,reason,actor) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),key,id,JSON.stringify(old),JSON.stringify({quantity,cost_cents:cost,min_quantity:min}),reason,actor),env.DB.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),id,quantity-(old?.quantity??0),old?.quantity??0,quantity,reason));
   }
  }
  return {body:{ok:true,id:'v180',inventory_moved:body.move_inventory,backup:{catalog:plan.catalog.map(x=>x.before),inventory:plan.inventory,source:plan.oldSource,destination:plan.oldDestination}},statements};
 });
}
