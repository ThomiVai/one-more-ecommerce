import {json,allowOrigin} from '../_utils.js';
import {actorId,accessGuard} from '../_access.js';
import {loadInventory} from '../_catalog.js';
import {ready,readiness,body,fields,txt,digest,fail,errorResponse} from '../_partner-inquiries.js';
import {permitted} from './partners.js';
import {assertion,lineGuards} from './_operations.js';
import {today} from './_settlements.js';
import {calculateQuote} from '../../../assets/partner-quote-math-v170.js';
const schemaReady=readiness+' AND EXISTS(SELECT 1 FROM partner_quota_schema WHERE id=1 AND version=166) AND EXISTS(SELECT 1 FROM partner_quote_schema WHERE id=1 AND version=167)';
const ident=v=>txt(v,1,150,'el identificador');
const eligible=`EXISTS(SELECT 1 FROM partners p JOIN customers c ON c.id=p.customer_id JOIN partner_agreements a ON a.partner_id=p.id JOIN partner_program_versions v ON v.id=a.version_id WHERE p.id=? AND p.status='active' AND c.status='active' AND a.id=? AND a.status='confirmed' AND a.unresolved=0 AND v.program_id=p.program_id)`;
async function access(request,env){
 const denied=await ready(request,env);if(denied)return {denied};const p=await permitted(request,env);if(p.denied)return p;
 if(env.PARTNERS_PERIODS_V166!=='true'||env.PARTNERS_QUOTES_V167!=='true')return {denied:json({error:'Catálogo interno desactivado.'},503)};
 try{if(!(await env.DB.prepare('SELECT '+schemaReady+' ok').first())?.ok)throw Error()}catch{return {denied:json({error:'Falta verificar V166 y V167 en producción.'},503)}}return p;
}
export const productSnapshot=p=>digest({id:p.id,physical_id:p.physicalId,name:p.name,brand:p.brand,size:p.size,quantity:p.quantity,cost:p.cost_cents,revision:p.revision,archived:p.archived});
async function source(request,env){const revision=(await env.DB.prepare('SELECT revision FROM catalog_identity_revision WHERE id=1').first()).revision,state=await loadInventory(request,env);return {revision,state,products:state.items.filter(p=>p.commercialId&&!p.inventoryOnly&&!p.archived&&!p.id.startsWith('combo-'))}}
async function periodInfo(env,partner,id){
 const select=`SELECT p.*,COALESCE((SELECT SUM(units) FROM partner_quota_movements WHERE period_id=p.id),0) used_units,EXISTS(SELECT 1 FROM partner_quota_reviews WHERE period_id=p.id) reviewed FROM partner_quota_periods p`;
 const p=id?await env.DB.prepare(select+' WHERE p.partner_id=? AND p.id=?').bind(partner,id).first():await env.DB.prepare(select+' WHERE p.partner_id=? ORDER BY seq DESC LIMIT 1').bind(partner).first();if(!p)return null;
 const ok=(await env.DB.prepare('SELECT '+eligible+' ok').bind(partner,p.agreement_id).first())?.ok;
 const available=!!ok&&!p.reviewed&&p.mode==='simulation'&&p.start_on<=today()&&p.expires_on>today()?Math.max(0,4-p.used_units):0;
 return {...p,available_units:available,can_quote:available>0};
}
export async function onRequestGet({request,env}){
 const a=await access(request,env);if(a.denied)return a.denied;
 try{
  const q=new URL(request.url).searchParams,partnerId=ident(q.get('partner_id')),partner=await env.DB.prepare('SELECT p.id,p.code,c.name FROM partners p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').bind(partnerId).first();if(!partner)fail('Entrenador inexistente.',404);
  if(q.get('id')){
   const row=await env.DB.prepare('SELECT * FROM partner_quote_drafts WHERE id=? AND partner_id=?').bind(ident(q.get('id')),partnerId).first();if(!row)fail('Cotización inexistente.',404);
   const {items_json,operation_key,request_hash,...quote}=row,lines=JSON.parse(items_json),s=await source(request,env),p=await periodInfo(env,partnerId,row.period_id);
   let stale=!p?.can_quote||p.revision!==row.period_revision||s.revision!==row.catalog_revision||row.units>p.available_units;
   for(const l of lines){if(l.unit_price_cents!==calculateQuote([{product_id:l.product_id,quantity:1,acquisition_cents:l.acquisition_cents,other_cents:l.other_cents}]).items[0].unit_price_cents)stale=true;const current=s.products.find(p=>p.id===l.product_id);if(!current||await productSnapshot(current)!==l.source_snapshot)stale=true;}
   return json({quote,lines,partner,needs_recheck:stale,benefits_enabled:false});
  }
  if(q.get('view')==='quotes'){
   const before=q.get('before')||'999999999999';if(!/^\d{1,12}$/.test(before))fail('Página inválida.');
   const rows=(await env.DB.prepare('SELECT id,seq,units,total_cents,status,created_at FROM partner_quote_drafts WHERE partner_id=? AND seq<? ORDER BY seq DESC LIMIT 21').bind(partnerId,Number(before)).all()).results;
   return json({items:rows.slice(0,20),next:rows.length>20?rows[19].seq:null,benefits_enabled:false});
  }
  if(q.has('view')&&q.get('view')!=='catalog')fail('Vista inválida.');
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),query=norm(txt(q.get('q')||'',0,100,'la búsqueda')),after=txt(q.get('after')||'',0,150,'la página'),s=await source(request,env);
  const found=s.products.filter(p=>p.id>after&&norm([p.brand,p.name,p.size,p.id].join(' ')).includes(query)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const items=await Promise.all(found.slice(0,30).map(async p=>({id:p.id,name:p.name,brand:p.brand,size:p.size,quantity:p.quantity,reference_cost_cents:p.cost_cents>0?p.cost_cents:null,cost_reference:'inventory_average_not_confirmed',source_snapshot:await productSnapshot(p)})));
  return json({partner,items,next:found.length>30?items[29].id:null,period:await periodInfo(env,partnerId),catalog_revision:s.revision,benefits_enabled:false,mode:'simulation'});
 }catch(e){return errorResponse(e)}
}
export async function onRequestPost({request,env}){
 const a=await access(request,env);if(a.denied)return a.denied;if(!allowOrigin(request,env))return json({error:'Origen inválido.'},403);
 try{
  const b=await body(request);fields(b,['operation_key','partner_id','period_id','expected_period_revision','expected_catalog_revision','lines','delivery_zone','shipping_cents','notes','costs_confirmed','availability_confirmed','confirmed']);
  const key=txt(b.operation_key,16,100,'la operación'),who=actorId(a.actor),hash=await digest(b);
  const replay=async()=>{const old=await env.DB.prepare('SELECT id,request_hash,actor FROM partner_quote_drafts WHERE operation_key=?').bind(key).first();if(!old)return null;if(old.request_hash!==hash||old.actor!==who)fail('Operación ya usada con otros datos o cuenta.',409);return json({id:old.id,benefits_enabled:false,replayed:true,status:'draft',mode:'simulation'})};
  const old=await replay();if(old)return old;
  if(b.confirmed!==true||b.costs_confirmed!==true||b.availability_confirmed!==true)fail('Confirmá costos completos, disponibilidad y el borrador interno.');
  if(!Number.isSafeInteger(b.shipping_cents)||b.shipping_cents<0||!['hurlingham','outside'].includes(b.delivery_zone)||b.delivery_zone==='hurlingham'&&b.shipping_cents!==0)fail('Confirmá el envío: Hurlingham sin cargo aparte; fuera, cotizar antes.');
  const partnerId=ident(b.partner_id),periodId=ident(b.period_id),p=await periodInfo(env,partnerId,periodId);
  if(!p?.can_quote||!Number.isSafeInteger(b.expected_period_revision)||p.revision!==b.expected_period_revision)fail('El período venció, cambió o no tiene saldo. Actualizá la ficha.',409);
  const s=await source(request,env);if(!Number.isSafeInteger(b.expected_catalog_revision)||s.revision!==b.expected_catalog_revision)fail('El catálogo cambió. Actualizá antes de cotizar.',409);
  if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>4)fail('Elegí de 1 a 4 variantes.');
  const selected=[];
  for(const l of b.lines){fields(l,['product_id','quantity','acquisition_cents','other_cents','source_snapshot','cost_evidence']);const row=s.products.find(p=>p.id===ident(l.product_id));if(!row||l.source_snapshot!==await productSnapshot(row))fail('Cambió el inventario o la variante. Volvé a buscarla.',409);selected.push({...l,cost_evidence:txt(l.cost_evidence,10,1500,'la fuente del costo y gastos'),name:row.name||'',brand:row.brand||'',size:row.size||'',physical_id:row.physicalId||null,stock_cost_snapshot:row.cost_cents??null,stock_revision_snapshot:row.revision??null});}
  let calc;try{calc=calculateQuote(selected,b.shipping_cents)}catch(e){fail(e.message)}if(calc.units>p.available_units)fail('La cantidad supera el saldo actual del período.',409);
  const notes=txt(b.notes,10,2000,'las condiciones'),id=crypto.randomUUID(),statements=[accessGuard(env,a.actor,request),assertion(env,schemaReady),assertion(env,eligible,[partnerId,p.agreement_id]),assertion(env,"EXISTS(SELECT 1 FROM partner_quota_periods p WHERE p.id=? AND p.partner_id=? AND p.revision=? AND p.mode='simulation' AND p.start_on<=date('now','-3 hours') AND p.expires_on>date('now','-3 hours') AND NOT EXISTS(SELECT 1 FROM partner_quota_reviews r WHERE r.period_id=p.id) AND 4-COALESCE((SELECT SUM(units) FROM partner_quota_movements WHERE period_id=p.id),0)>=?)",[periodId,partnerId,p.revision,calc.units]),assertion(env,'EXISTS(SELECT 1 FROM catalog_identity_revision WHERE id=1 AND revision=?)',[s.revision])];
  for(const l of selected){const row=s.products.find(p=>p.id===l.product_id);if(row.physicalId)statements.push(...lineGuards(env,row,s.state.stocks.get(row.physicalId)));else statements.push(assertion(env,'NOT EXISTS(SELECT 1 FROM catalog_stock_links WHERE catalog_id=?) AND NOT EXISTS(SELECT 1 FROM stock_items WHERE product_id=?)',[row.id,row.id]));}
  statements.push(env.DB.prepare('INSERT INTO partner_quote_drafts(id,partner_id,period_id,period_revision,catalog_revision,units,real_cost_cents,subtotal_cents,shipping_cents,total_cents,delivery_zone,items_json,notes,operation_key,request_hash,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,partnerId,periodId,p.revision,s.revision,calc.units,calc.real_cost_cents,calc.subtotal_cents,calc.shipping_cents,calc.total_cents,b.delivery_zone,JSON.stringify(calc.items),notes,key,hash,who),env.DB.prepare('DELETE FROM management_assertions'));
  try{await env.DB.batch(statements)}catch(e){const cached=await replay();if(cached)return cached;if(/UNIQUE|CHECK constraint|FOREIGN KEY|conflict/i.test(String(e.message)))fail('La ficha, el inventario, el cupo o los permisos cambiaron. Actualizá antes de reintentar.',409);throw e}
  return json({id,partner_id:partnerId,total_cents:calc.total_cents,units:calc.units,benefits_enabled:false,mode:'simulation',status:'draft'},201);
 }catch(e){return errorResponse(e)}
}
