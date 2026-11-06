import {json,allowOrigin} from './_utils.js';
import {ready,body,fields,txt,fail,digest,eligibility,readiness,assertion,errorResponse} from './_partner-inquiries.js';
export async function onRequestPost({request,env}){
 const denied=await ready(request,env);if(denied)return denied;
 if(!allowOrigin(request,env)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Origen inválido.'},403);
 try{
  const b=await body(request);fields(b,['operation_key','code','buyer_confirmed','summary']);
  const key=txt(b.operation_key,36,36,'la clave de consulta');if(!/^[0-9a-f-]{36}$/i.test(key))fail('Clave de consulta inválida.');
  const code=txt(b.code,0,20,'el código').toUpperCase(),summary=txt(b.summary,25,10000,'el resumen');
  if(code&&!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code))fail('Código inválido.');
  if(typeof b.buyer_confirmed!=='boolean'||(!code&&b.buyer_confirmed))fail('Confirmación inválida.');
  const hash=await digest({code,summary,buyer_confirmed:b.buyer_confirmed});
  const replay=async()=>{const old=await env.DB.prepare('SELECT id,request_hash FROM partner_inquiries WHERE operation_key=?').bind(key).first();if(!old)return null;if(old.request_hash!==hash)fail('La clave ya fue usada con otros datos.',409);return json({id:old.id,status:'prepared',replayed:true,benefits_enabled:false})};
  const old=await replay();if(old)return old;
  let partner=null;
  if(code){partner=await env.DB.prepare('SELECT id FROM partners WHERE code=? COLLATE NOCASE').bind(code).first();if(!partner||!(await env.DB.prepare('SELECT '+eligibility+' AS ok').bind(partner.id,code).first())?.ok)fail('Código no disponible. Revisalo o quitá el código para continuar.',400)}
  const id=crypto.randomUUID(),statements=[assertion(env,readiness)];
  if(partner)statements.push(assertion(env,eligibility,[partner.id,code]));
  statements.push(env.DB.prepare('INSERT INTO partner_inquiries(id,operation_key,request_hash,declared_code,partner_id,buyer_confirmed,summary) VALUES(?,?,?,?,?,?,?)').bind(id,key,hash,code,partner?.id??null,Number(b.buyer_confirmed),summary),env.DB.prepare('DELETE FROM management_assertions'));
  try{await env.DB.batch(statements)}catch(e){const cached=await replay();if(cached)return cached;if(/CHECK|UNIQUE|FOREIGN KEY/i.test(e.message))fail('La preparación del código cambió. Revisá antes de reintentar.',409);throw e}
  return json({id,status:'prepared',benefits_enabled:false},201);
 }catch(e){return errorResponse(e)}
}
