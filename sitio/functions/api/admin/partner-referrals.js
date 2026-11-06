import {json,allowOrigin} from '../_utils.js';
import {actorId,accessGuard} from '../_access.js';
import {deploymentOnly,databaseGuard} from '../_deployment.js';
import {assertion} from './_operations.js';
import {permitted} from './partners.js';
import {validDate,today} from './_settlements.js';

class InputError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status=400)=>{throw new InputError(message,status);};
const txt=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail('Revisá '+label+'.');return v.trim();};
const identifier=v=>txt(v,1,80,'el identificador');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v)))))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function access(request,env){
 const blocked=deploymentOnly(request)||await databaseGuard(request,env);if(blocked)return {denied:blocked};
 const p=await permitted(request,env);if(p.denied)return p;
 try{if((await env.DB.prepare('SELECT version FROM partner_referrals_schema WHERE id=1').first())?.version!==142)throw Error();}
 catch{return {denied:json({error:'Falta aplicar y verificar la migración de referidos V142 en producción.'},503)};}
 return p;
}
// Una fila por venta. Las correcciones agregan eventos; las ventas y sus líneas son inmutadas.
export const referralSelect=`SELECT s.id sale_id,s.reference,s.sold_at,s.channel,s.revenue_cents,s.cost_cents,
 b.balance_cents,b.paid_cents,b.refunded_cents,b.entry_count,b.revision sale_revision,
 COALESCE(r.refund_cents,0) return_cents,COALESCE(r.cost_reversal_cents,0) cost_reversal_cents,
 h.revision,h.event_id,e.customer_id,e.partner_id,e.customer_kind,e.identity_verified,e.identity_evidence,e.attribution_evidence,
 e.delivered,e.delivered_at,e.delivery_evidence,e.variable_costs_complete,e.variable_costs_cents,e.costs_evidence,
 e.sale_revision reviewed_sale_revision,e.reason,e.actor,e.created_at reviewed_at,c.name customer_name,c.status customer_status,
 p.code partner_code,p.status partner_status,p.customer_id partner_customer_id,pc.name partner_name,
 COALESCE(u.name,e.actor) recorded_by,
 EXISTS(SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=e.customer_id AND cc.verified=1) has_verified_contact,
 (EXISTS(SELECT 1 FROM sale_lines l WHERE l.sale_id=s.id AND l.unit_cost_cents<=0) OR s.cost_cents<>COALESCE((SELECT SUM(l.quantity*l.unit_cost_cents) FROM sale_lines l WHERE l.sale_id=s.id),0)) unknown_acquisition_cost,
 EXISTS(SELECT 1 FROM sale_lines l WHERE l.sale_id=s.id) has_lines,
 (SELECT h2.sale_id FROM partner_referral_heads h2 JOIN partner_referral_events e2 ON e2.id=h2.event_id JOIN sales s2 ON s2.id=h2.sale_id
   WHERE e2.customer_id=e.customer_id ORDER BY s2.sold_at,s2.created_at,s2.id LIMIT 1) first_linked_sale_id
 FROM sales s JOIN settlement_balances_v137 b ON b.record_type='sale' AND b.record_id=s.id
 LEFT JOIN (SELECT sale_id,SUM(refund_cents) refund_cents,SUM(cost_reversal_cents) cost_reversal_cents FROM active_sale_returns_v138 GROUP BY sale_id) r ON r.sale_id=s.id
 LEFT JOIN partner_referral_heads h ON h.sale_id=s.id LEFT JOIN partner_referral_events e ON e.id=h.event_id
 LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN partners p ON p.id=e.partner_id LEFT JOIN customers pc ON pc.id=p.customer_id
 LEFT JOIN team_users u ON e.actor='user:'||u.id`;
export function evaluate(row){
 const net=row.revenue_cents-row.return_cents,netCost=row.cost_cents-row.cost_reversal_cents;
 const marginKnown=!!row.event_id&&!!row.variable_costs_complete&&!!row.has_lines&&!row.unknown_acquisition_cost;
 const own=!!row.partner_id&&row.customer_id===row.partner_customer_id;
 const reasons=[];
 if(!row.event_id)reasons.push('Venta sin vincular.');
 else{
  if(!row.partner_id)reasons.push('Recomendación pendiente de atribución.');
  if(row.partner_id&&row.partner_status!=='active')reasons.push('Partner sin estado activo.');
  if(own)reasons.push('Compra del propio partner; no cuenta como referido externo.');
  if(!row.identity_verified||!row.has_verified_contact||row.customer_status!=='active')reasons.push('Identidad/contacto pendiente de verificación.');
  if(row.customer_kind==='unknown')reasons.push('Historial de cliente pendiente de revisión.');
  if(row.customer_kind==='recurrent'||row.first_linked_sale_id!==row.sale_id)reasons.push('Cliente recurrente o con una venta vinculada anterior.');
  if(row.reviewed_sale_revision!==row.sale_revision)reasons.push('El comprobante cambió desde la revisión; revisá cobros y devoluciones.');
  if(!row.delivered)reasons.push('Entrega sin confirmar.');
 }
 if(net<=0)reasons.push('Venta sin importe neto positivo.');
 if(!row.entry_count||row.balance_cents!==0||row.paid_cents-row.refunded_cents<=0)reasons.push('Cobro neto sin conciliar en caja.');
 if(!marginKnown)reasons.push('Costos de adquisición o variables pendientes.');
 const contribution=marginKnown?net-netCost-row.variable_costs_cents:null;
 if(contribution!==null&&contribution<=0)reasons.push('Margen de contribución no positivo.');
 return {...row,net_revenue_cents:net,net_acquisition_cost_cents:netCost,contribution_cents:contribution,
  review_status:reasons.length?'pending':'verified',reasons,own_purchase:own,benefits_enabled:false};
}
export async function onRequestGet({request,env}){
 const {denied}=await access(request,env);if(denied)return denied;
 try{
  const p=new URL(request.url).searchParams,mode=p.get('mode')||'list';
  if(mode==='detail'){
   const saleId=identifier(p.get('id')),row=await env.DB.prepare(referralSelect+' WHERE s.id=?').bind(saleId).first();if(!row)fail('Venta inexistente.',404);
   const history=(await env.DB.prepare('SELECT e.*,COALESCE(u.name,e.actor) recorded_by FROM partner_referral_events e LEFT JOIN team_users u ON e.actor=\'user:\'||u.id WHERE sale_id=? ORDER BY revision DESC LIMIT 100').bind(saleId).all()).results;
   let inquiry=null;
   try{inquiry=await env.DB.prepare('SELECT id,declared_code,buyer_confirmed FROM partner_inquiries WHERE sale_id=?').bind(saleId).first();}catch{} // V142 sigue funcionando antes de aplicar V160.
   return json({item:evaluate(row),inquiry,history,history_limit:100,benefits_enabled:false});
  }
  if(!['list','sales'].includes(mode))fail('Vista inválida.');
  const q=txt(p.get('q')||'',0,100,'la búsqueda').toLowerCase(),after=txt(p.get('after')||'',0,80,'la paginación');
  const rows=(await env.DB.prepare(referralSelect+` WHERE s.id>? ${mode==='list'?'AND h.event_id IS NOT NULL':''}
   AND (?='' OR instr(lower(s.reference),?)>0 OR instr(lower(COALESCE(c.name,'')),?)>0 OR instr(lower(COALESCE(p.code,'')),?)>0)
   ORDER BY s.id LIMIT 31`).bind(after,q,q,q,q).all()).results;
  return json({items:rows.slice(0,30).map(evaluate),next:rows.length>30?rows[29].sale_id:null,benefits_enabled:false,
   scope:'manual_review_of_linked_sales',notice:'Verificado es una evaluación administrativa actual, no una recompensa. No prueba que el historial anónimo esté completo.'});
 }catch(e){return json({error:e instanceof InputError?e.message:'No se pudieron consultar los referidos. Revisá la migración V142.'},e.status||503);}
}
export async function onRequestPost({request,env}){
 const {denied,actor}=await access(request,env);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido.'},403);
 let b;try{b=await request.json();}catch{return json({error:'Solicitud inválida.'},400);}
 try{
  const allowed=['operation_key','sale_id','expected_revision','expected_sale_revision','customer_id','partner_id','customer_kind','identity_verified','identity_evidence','attribution_evidence','delivered','delivered_at','delivery_evidence','variable_costs_complete','variable_costs_cents','costs_evidence','reason'];
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k)))fail('Campos no admitidos.');
  const key=txt(b.operation_key,16,100,'la clave de operación'),who=actorId(actor),hash=await digest(b);
  const replay=async()=>{const r=await env.DB.prepare('SELECT * FROM partner_operations WHERE operation_key=?').bind(key).first();if(!r)return null;if(r.actor!==who||r.request_hash!==hash)fail('La clave ya fue usada con otros datos o por otra cuenta.',409);return json({...JSON.parse(r.result_json),replayed:true});};
  const previous=await replay();if(previous)return previous;
  const saleId=identifier(b.sale_id),customerId=identifier(b.customer_id),partnerId=b.partner_id===null?null:identifier(b.partner_id);
  if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision< -1||!Number.isSafeInteger(b.expected_sale_revision)||b.expected_sale_revision<0)fail('Actualizá la venta antes de guardar.');
  if(!['unknown','new','recurrent'].includes(b.customer_kind))fail('Clasificación de cliente inválida.');
  for(const k of ['identity_verified','delivered','variable_costs_complete'])if(typeof b[k]!=='boolean')fail('Confirmación inválida.');
  const identity=txt(b.identity_evidence,b.identity_verified||b.customer_kind!=='unknown'?10:0,1000,'la evidencia de identidad e historial');
  const attribution=txt(b.attribution_evidence,partnerId?10:0,1000,'la confirmación de recomendación del cliente');
  const delivery=txt(b.delivery_evidence,b.delivered?10:0,1000,'la evidencia de entrega');
  const deliveredAt=b.delivered?b.delivered_at:'';
  if(b.delivered&&(!validDate(deliveredAt)||deliveredAt>today()))fail('La fecha de entrega debe ser válida y no futura.');
  const costs=txt(b.costs_evidence,b.variable_costs_complete?10:0,1000,'el detalle de costos variables');
  const variable=b.variable_costs_cents;if(!Number.isSafeInteger(variable)||variable<0||variable>1e13)fail('Costos variables inválidos.');
  const reason=txt(b.reason,10,500,'el motivo de esta vinculación o corrección');
  const row=await env.DB.prepare(referralSelect+' WHERE s.id=?').bind(saleId).first();if(!row)fail('Elegí una venta existente.',404);
  if((row.revision??-1)!==b.expected_revision||row.sale_revision!==b.expected_sale_revision)fail('La venta o vinculación cambió. Actualizá y revisá los datos.',409);
  if(b.delivered&&deliveredAt<row.sold_at)fail('La entrega no puede ser anterior a la venta.');
  const customer=await env.DB.prepare("SELECT id FROM customers WHERE id=? AND status='active'").bind(customerId).first();if(!customer)fail('Elegí un cliente activo existente.');
  if(partnerId&&!await env.DB.prepare('SELECT id FROM partners WHERE id=?').bind(partnerId).first())fail('Partner inexistente.');
  if((b.identity_verified||b.customer_kind==='new')&&!await env.DB.prepare('SELECT id FROM customer_contacts WHERE customer_id=? AND verified=1').bind(customerId).first())fail('Para verificar identidad o declarar cliente nuevo hace falta un contacto confirmado.');
  if(b.customer_kind==='new'&&!b.identity_verified)fail('Primero verificá la identidad y el historial del cliente.');
  const id=crypto.randomUUID(),rev=b.expected_revision+1,result={id,sale_id:saleId,revision:rev,benefits_enabled:false};
  const columns=['id','sale_id','revision','previous_id','customer_id','partner_id','customer_kind','identity_verified','identity_evidence','attribution_evidence','delivered','delivered_at','delivery_evidence','variable_costs_complete','variable_costs_cents','costs_evidence','sale_revision','reason','actor','operation_key'];
  const values=[id,saleId,rev,row.event_id??null,customerId,partnerId,b.customer_kind,Number(b.identity_verified),identity,attribution,Number(b.delivered),deliveredAt,delivery,Number(b.variable_costs_complete),variable,costs,row.sale_revision,reason,who,key];
  const statements=[accessGuard(env,actor,request),
   assertion(env,"EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos')",[]),
   assertion(env,"EXISTS(SELECT 1 FROM settlement_balances_v137 WHERE record_type='sale' AND record_id=? AND revision=?)",[saleId,row.sale_revision]),
   assertion(env,"EXISTS(SELECT 1 FROM customers WHERE id=? AND status='active')",[customerId]),
   assertion(env,b.expected_revision===-1?'NOT EXISTS(SELECT 1 FROM partner_referral_heads WHERE sale_id=?)':'EXISTS(SELECT 1 FROM partner_referral_heads WHERE sale_id=? AND revision=?)',b.expected_revision===-1?[saleId]:[saleId,b.expected_revision]),
   env.DB.prepare('INSERT INTO partner_operations(operation_key,request_hash,actor,result_json) VALUES(?,?,?,?)').bind(key,hash,who,JSON.stringify(result)),
   env.DB.prepare(`INSERT INTO partner_referral_events(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...values),
   b.expected_revision===-1?env.DB.prepare('INSERT INTO partner_referral_heads(sale_id,event_id,revision) VALUES(?,?,?)').bind(saleId,id,rev):env.DB.prepare('UPDATE partner_referral_heads SET event_id=?,revision=? WHERE sale_id=?').bind(id,rev,saleId),
   env.DB.prepare('INSERT INTO partner_events(id,entity_id,action,actor,before_json,after_json,operation_key) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),saleId,'referral-review',who,JSON.stringify({event_id:row.event_id??null,revision:row.revision??-1}),JSON.stringify({event_id:id,revision:rev,customer_id:customerId,partner_id:partnerId}),key),
   env.DB.prepare('DELETE FROM management_assertions')];
  // Identidad verificada también se revalida dentro del batch, ante cambios concurrentes.
  if(b.identity_verified||b.customer_kind==='new')statements.splice(4,0,assertion(env,'EXISTS(SELECT 1 FROM customer_contacts WHERE customer_id=? AND verified=1)',[customerId]));
  try{await env.DB.batch(statements);}catch(e){const cached=await replay();if(cached)return cached;if(/UNIQUE|CHECK constraint|FOREIGN KEY|referral_.*conflict/i.test(String(e.message)))fail('La venta, permisos o vinculación cambiaron. Actualizá antes de reintentar.',409);throw e;}
  return json(result,201);
 }catch(e){return json({error:e instanceof InputError?e.message:'No se guardó la revisión. No se modificaron ventas, stock ni caja.'},e.status||503);}
}
