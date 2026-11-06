import {json,allowOrigin} from '../_utils.js';
import {actorId,accessGuard} from '../_access.js';
import {permitted} from './partners.js';
import {ready,body,fields,txt,fail,digest,eligibility,readiness,assertion,errorResponse} from '../_partner-inquiries.js';
async function access(request,env){const denied=await ready(request,env);return denied?{denied}:permitted(request,env)}
export async function onRequestGet({request,env}){
 const {denied}=await access(request,env);if(denied)return denied;
 try{
  const p=new URL(request.url).searchParams,id=p.get('id');
  if(id){const item=await env.DB.prepare('SELECT * FROM partner_inquiries WHERE id=?').bind(txt(id,1,80,'la consulta')).first();if(!item)fail('Consulta inexistente.',404);
   const history=(await env.DB.prepare('SELECT * FROM partner_inquiry_reviews WHERE inquiry_id=? ORDER BY revision DESC LIMIT 100').bind(id).all()).results;
   return json({item,history,history_limit:100,benefits_enabled:false});}
  const after=txt(p.get('after')||'',0,80,'la página'),q=txt(p.get('q')||'',0,100,'la búsqueda').toLowerCase(),status=p.get('status')||'';
  if(status&&!['prepared','received','rejected','linked'].includes(status))fail('Estado inválido.');
  const rows=(await env.DB.prepare("SELECT id,declared_code,buyer_confirmed,status,sale_id,revision,created_at FROM partner_inquiries WHERE id>? AND (?='' OR status=?) AND (?='' OR instr(lower(declared_code||' '||id||' '||COALESCE(sale_id,'')),?)>0) ORDER BY id LIMIT 31").bind(after,status,status,q,q).all()).results;
  return json({items:rows.slice(0,30),next:rows.length>30?rows[29].id:null,benefits_enabled:false,notice:'Preparada no prueba envío ni recepción de WhatsApp. No cuenta como venta ni recompensa.'});
 }catch(e){return errorResponse(e)}
}
export async function onRequestPost({request,env}){
 const {denied,actor}=await access(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido.'},403);
 try{
  const b=await body(request);fields(b,['operation_key','id','expected_revision','status','sale_id','reason','buyer_evidence','identity_evidence']);
  const key=txt(b.operation_key,16,100,'la clave de operación'),who=actorId(actor),hash=await digest(b);
  const replay=async()=>{const old=await env.DB.prepare('SELECT * FROM partner_inquiry_reviews WHERE operation_key=?').bind(key).first();if(!old)return null;if(old.actor!==who||old.request_hash!==hash)fail('La operación ya fue usada con otros datos o cuenta.',409);return json({id:old.inquiry_id,revision:old.revision,benefits_enabled:false,replayed:true})};
  const old=await replay();if(old)return old;
  const id=txt(b.id,1,80,'la consulta');if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0)fail('Reabrí la consulta.');
  const row=await env.DB.prepare('SELECT * FROM partner_inquiries WHERE id=?').bind(id).first();if(!row)fail('Consulta inexistente.',404);if(row.revision!==b.expected_revision)fail('La consulta cambió. Reabrila.',409);
  if(!['received','rejected','linked'].includes(b.status))fail('Decisión inválida.');
  const reason=txt(b.reason,10,1000,'el motivo y constancia de recepción'),buyer=txt(b.buyer_evidence,0,1000,'la confirmación del comprador'),identity=txt(b.identity_evidence,0,1000,'la correspondencia con la venta');
  const sale=b.status==='linked'?txt(b.sale_id,1,80,'la venta existente'):null;
  if(b.status!=='linked'&&b.sale_id!==null)fail('No corresponde una venta para este estado.');
  if(sale){
   if(row.partner_id&&!row.buyer_confirmed&&buyer.length<10)fail('Falta confirmación explícita del comprador: registrá qué dijo, cuándo y por qué canal.');
   if(identity.length<10)fail('Explicá cómo comprobaste que la venta corresponde a esta consulta.');
   if(!await env.DB.prepare('SELECT id FROM sales WHERE id=?').bind(sale).first())fail('Elegí una venta ya registrada.',404);
  }
  const result={id,revision:row.revision+1,status:b.status,sale_id:sale,benefits_enabled:false},after={status:b.status,sale_id:sale,revision:result.revision};
  const statements=[accessGuard(env,actor,request),assertion(env,readiness),assertion(env,'EXISTS(SELECT 1 FROM partner_inquiries WHERE id=? AND revision=?)',[id,row.revision])];
  if(sale){statements.push(assertion(env,'EXISTS(SELECT 1 FROM sales WHERE id=?)',[sale]));if(row.partner_id)statements.push(assertion(env,eligibility,[row.partner_id,row.declared_code]));}
  statements.push(env.DB.prepare('UPDATE partner_inquiries SET status=?,sale_id=?,revision=revision+1 WHERE id=?').bind(b.status,sale,id),env.DB.prepare('INSERT INTO partner_inquiry_reviews(id,inquiry_id,revision,actor,before_json,after_json,reason,buyer_evidence,identity_evidence,operation_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,result.revision,who,JSON.stringify({status:row.status,sale_id:row.sale_id,revision:row.revision}),JSON.stringify(after),reason,buyer,identity,key,hash),env.DB.prepare('DELETE FROM management_assertions'));
  try{await env.DB.batch(statements)}catch(e){const cached=await replay();if(cached)return cached;if(/UNIQUE|CHECK|FOREIGN KEY|inquiry_revision/i.test(e.message))fail('Cambió la consulta, permisos, partner o la venta ya está vinculada. Reabrí y revisá.',409);throw e}
  return json(result,201);
 }catch(e){return errorResponse(e)}
}
