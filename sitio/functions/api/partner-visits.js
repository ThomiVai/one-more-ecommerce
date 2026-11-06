import {json,allowOrigin} from './_utils.js';
import {ready,body,fields,txt,fail,eligibility,readiness,assertion,errorResponse} from './_partner-inquiries.js';
export const trafficReadiness="EXISTS(SELECT 1 FROM partner_traffic_schema WHERE id=1 AND version=169)";
export async function onRequestPost({request,env}){
 const denied=await ready(request,env);if(denied)return denied;
 if(env.PARTNERS_TRAFFIC_V169!=='true'||env.ONE_MORE_READ_ONLY==='true')return json({error:'Medición deshabilitada.'},503);
 if(!allowOrigin(request,env)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Origen inválido.'},403);
 try{
  try{if(!(await env.DB.prepare('SELECT '+trafficReadiness+' AS ok').first())?.ok)throw Error()}catch{fail('Falta preparar la medición de enlaces.',503)}
  const b=await body(request);fields(b,['visit_id','code']);
  const id=txt(b.visit_id,36,36,'la visita');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))fail('Visita inválida.');
  const code=txt(b.code,4,20,'el código').toUpperCase();if(!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code))fail('Código inválido.');
  const partner=await env.DB.prepare('SELECT id FROM partners WHERE code=? COLLATE NOCASE').bind(code).first();
  if(!partner||!(await env.DB.prepare('SELECT '+eligibility+' AS ok').bind(partner.id,code).first())?.ok)fail('Código no disponible.',400);
  const replay=async()=>{const old=await env.DB.prepare('SELECT partner_id FROM partner_link_visits WHERE id=?').bind(id).first();if(!old)return null;if(old.partner_id!==partner.id)fail('La visita ya corresponde a otro código.',409);return json({recorded:true,replayed:true,benefits_enabled:false})};
  const old=await replay();if(old)return old;
  try{await env.DB.batch([
   assertion(env,readiness+' AND '+trafficReadiness),assertion(env,eligibility,[partner.id,code]),
   env.DB.prepare('INSERT INTO partner_link_visits(id,partner_id) VALUES(?,?)').bind(id,partner.id),
   env.DB.prepare('DELETE FROM management_assertions')
  ])}catch(e){const old=await replay();if(old)return old;if(/CHECK|UNIQUE|FOREIGN KEY/i.test(e.message))fail('El código cambió antes de registrar la visita.',409);throw e}
  return json({recorded:true,benefits_enabled:false},201);
 }catch(e){return errorResponse(e)}
}
