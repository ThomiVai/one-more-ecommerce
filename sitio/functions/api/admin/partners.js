import {json,check,allowOrigin} from '../_utils.js';
import {principal,actorId,accessGuard} from '../_access.js';
import {assertion} from './_operations.js';

class InputError extends Error{constructor(message,status=400){super(message);this.status=status}}
const fail=(message,status=400)=>{throw new InputError(message,status)};
const fields=(b,allowed)=>{if(!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).some(k=>!allowed.includes(k)))fail('Datos o campos no admitidos.');};
const text=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail('Revisá '+label+'.');return v.trim();};
const id=v=>text(v,1,80,'el identificador');
const revision=b=>{if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0)fail('Actualizá la ficha antes de guardar.');return b.expected_revision;};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v)))))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function permitted(request,env){
 const denied=await check(request,env);if(denied)return {denied};
 const actor=await principal(request,env);
 if(actor?.type!=='user'||actor.role!=='admin')return {denied:json({error:'PARTNERS requiere tu usuario personal administrador.'},403)};
 if(env.PARTNERS_PHASE1!=='true')return {denied:json({error:'La base de PARTNERS todavía no está habilitada en producción.'},503)};
 try{if((await env.DB.prepare('SELECT version FROM partners_schema WHERE id=1').first())?.version!==141)throw Error();}
 catch{return {denied:json({error:'Falta verificar la migración de PARTNERS V141 en producción.'},503)};}
 return {actor};
}
export function normalizeContact(kind,value){
 value=text(value,1,150,'el contacto');
 if(kind==='phone'){
   const normalized=value.replace(/[ ()-]/g,'');
   if(!/^\+[1-9][0-9]{6,14}$/.test(normalized))fail('Escribí el teléfono completo con + y código de país; confirmá el número sin conversiones automáticas.');
   return normalized;
 }
 if(kind==='email'){
   const normalized=value.toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))fail('Revisá el email.');
   return normalized;
 }
 fail('Tipo de contacto no admitido.');
}
export async function onRequestGet({request,env}){
 const {denied}=await permitted(request,env);if(denied)return denied;
 try{
  const p=new URL(request.url).searchParams,mode=p.get('mode')||'partners';
  const q=text(p.get('q')||'',0,100,'la búsqueda').toLowerCase(),after=p.get('after')||'';
  if(after.length>80)fail('Paginación inválida.');
  const limit=30;
  if(mode==='customers'){
   const rows=(await env.DB.prepare(`SELECT c.id,c.name,c.status,c.revision FROM customers c WHERE c.id>? AND (?='' OR instr(lower(c.name),?)>0 OR EXISTS(SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=c.id AND instr(cc.normalized,?)>0)) ORDER BY c.id LIMIT ?`).bind(after,q,q,q,limit+1).all()).results;
   return json({items:rows.slice(0,limit),next:rows.length>limit?rows[limit-1].id:null});
  }
  if(mode==='detail'){
   const partnerId=id(p.get('id'));
   const partner=await env.DB.prepare('SELECT p.*,c.name AS customer_name,c.status AS customer_status FROM partners p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').bind(partnerId).first();
   if(!partner)return json({error:'Partner inexistente.'},404);
   const [agreements,contacts,events]=await env.DB.batch([
    env.DB.prepare('SELECT * FROM partner_agreements WHERE partner_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(partnerId),
    env.DB.prepare('SELECT kind,value,verified FROM customer_contacts WHERE customer_id=? ORDER BY kind').bind(partner.customer_id),
    env.DB.prepare('SELECT id,entity_id,action,actor,before_json,after_json,created_at FROM partner_events WHERE entity_id=? OR entity_id IN (SELECT id FROM partner_agreements WHERE partner_id=?) ORDER BY created_at DESC,id DESC LIMIT 100').bind(partnerId,partnerId)
   ]);
   return json({partner,agreements:agreements.results,contacts:contacts.results,events:events.results,history_limit:100,benefits_enabled:false});
  }
  if(mode!=='partners')fail('Vista no admitida.');
  const status=p.get('status')||'';if(status&&!['candidate','active','paused','closed'].includes(status))fail('Estado inválido.');
  const rows=(await env.DB.prepare(`SELECT p.id,p.customer_id,p.code,p.instagram,p.status,p.revision,c.name AS customer_name FROM partners p JOIN customers c ON c.id=p.customer_id WHERE p.id>? AND (?='' OR p.status=?) AND (?='' OR instr(lower(c.name),?)>0 OR instr(lower(p.code),?)>0 OR instr(lower(p.instagram),?)>0) ORDER BY p.id LIMIT ?`).bind(after,status,status,q,q,q,q,limit+1).all()).results;
  return json({items:rows.slice(0,limit),next:rows.length>limit?rows[limit-1].id:null,benefits_enabled:false});
 }catch(e){return json({error:e instanceof InputError?e.message:'No se pudo cargar PARTNERS. Revisá la preparación de producción.'},e.status||503)}
}
export async function onRequestPost({request,env}){
 const {denied,actor}=await permitted(request,env);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido.'},403);
 let b;try{b=await request.json()}catch{return json({error:'Solicitud inválida.'},400)}
 try{
  if(!b||typeof b!=='object'||Array.isArray(b))fail('Solicitud inválida.');
  const key=text(b.operation_key,16,100,'la clave de operación'),who=actorId(actor);
  const hash=await digest(b);
  const replay=async()=>{
   const old=await env.DB.prepare('SELECT request_hash,actor,result_json FROM partner_operations WHERE operation_key=?').bind(key).first();
   if(!old)return null;
   if(old.request_hash!==hash||old.actor!==who)fail('La clave de operación ya fue usada con otros datos o por otra cuenta.',409);
   return json({...JSON.parse(old.result_json),replayed:true});
  };
  const old=await replay();if(old)return old;
  let result,entityId,action=b.action,before={},after={},statements=[];
  if(action==='customer-create'){
   fields(b,['action','operation_key','name','contact_kind','contact_value','contact_confirmed']);
   const name=text(b.name,2,100,'el nombre'),customerId=crypto.randomUUID();
   const kind=b.contact_kind||'',value=b.contact_value||'';
   if(!['','phone','email'].includes(kind))fail('Tipo de contacto inválido.');
   if(Boolean(kind)!==Boolean(value))fail('Completá el tipo y el valor de contacto, o dejá ambos vacíos.');
   if(b.contact_confirmed!==undefined&&typeof b.contact_confirmed!=='boolean')fail('Confirmación de contacto inválida.');
   let normalized;
   if(kind){normalized=normalizeContact(kind,value);if(b.contact_confirmed!==true)fail('Confirmá con el cliente que el contacto es correcto.');
    const conflict=await env.DB.prepare('SELECT customer_id FROM customer_contacts WHERE kind=? AND normalized=?').bind(kind,normalized).first();
    if(conflict)return json({error:'Ese contacto ya está registrado. Buscá el cliente existente; si es compartido, dejá el caso pendiente y no dupliques el contacto.',customer_id:conflict.customer_id},409);
   }
   statements.push(env.DB.prepare('INSERT INTO customers(id,name,created_by) VALUES(?,?,?)').bind(customerId,name,who));
   if(kind)statements.push(env.DB.prepare('INSERT INTO customer_contacts(id,customer_id,kind,value,normalized,verified,created_by) VALUES(?,?,?,?,?,1,?)').bind(crypto.randomUUID(),customerId,kind,value.trim(),normalized,who));
   result={id:customerId,revision:0};entityId=customerId;after={name,contact_kind:kind};
  }else if(action==='partner-create'){
   fields(b,['action','operation_key','customer_id','code','instagram']);
   const customerId=id(b.customer_id),code=text(b.code,4,20,'el código').toUpperCase();
   if(!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code))fail('El código usa 4 a 20 letras, números o guion.');
   const instagram=text(b.instagram||'',0,31,'Instagram').replace(/^@/,'');if(instagram&&!/^[A-Za-z0-9._]{1,30}$/.test(instagram))fail('Ingresá solo el usuario de Instagram, sin enlace.');
   if(!await env.DB.prepare("SELECT id FROM customers WHERE id=? AND status='active'").bind(customerId).first())fail('Elegí un cliente activo existente.');
   entityId=crypto.randomUUID();
   statements.push(assertion(env,"EXISTS(SELECT 1 FROM customers WHERE id=? AND status='active')",[customerId]),env.DB.prepare("INSERT INTO partners(id,customer_id,program_id,code,instagram,created_by) VALUES(?,?,'partners',?,?,?)").bind(entityId,customerId,code,instagram,who));
   result={id:entityId,revision:0,code};after={customer_id:customerId,code,status:'candidate'};
  }else if(action==='partner-update'){
   fields(b,['action','operation_key','id','status','expected_revision']);entityId=id(b.id);const rev=revision(b),status=b.status;
   if(!['candidate','active','paused','closed'].includes(status))fail('Estado inválido.');
   const row=await env.DB.prepare('SELECT status,revision FROM partners WHERE id=?').bind(entityId).first();if(!row)fail('Partner inexistente.',404);
   if(row.revision!==rev||row.status==='closed')fail('La ficha cambió o está cerrada. Actualizá el listado.',409);
   if(status==='active'){
    if(!await env.DB.prepare("SELECT id FROM partner_agreements WHERE partner_id=? AND status='confirmed'").bind(entityId).first())fail('Primero registrá y confirmá un acuerdo. Los beneficios seguirán desactivados.',409);
    statements.push(assertion(env,"EXISTS(SELECT 1 FROM partner_agreements WHERE partner_id=? AND status='confirmed')",[entityId]));
   }
   statements.push(assertion(env,"EXISTS(SELECT 1 FROM partners WHERE id=? AND revision=? AND status<>'closed')",[entityId,rev]),env.DB.prepare("UPDATE partners SET status=?,revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(status,entityId));
   before={status:row.status,revision:rev};after={status,revision:rev+1};result={id:entityId,revision:rev+1};
  }else if(action==='agreement-create'){
   fields(b,['action','operation_key','partner_id','kind','terms','unresolved']);
   const partnerId=id(b.partner_id),terms=text(b.terms,10,4000,'lo acordado');
   if(!['pilot','prior_commitment'].includes(b.kind)||typeof b.unresolved!=='boolean')fail('Revisá el tipo y las condiciones pendientes.');
   if(!await env.DB.prepare("SELECT id FROM partners WHERE id=? AND status<>'closed'").bind(partnerId).first())fail('Partner inexistente o cerrado.',409);
   entityId=crypto.randomUUID();statements.push(assertion(env,"EXISTS(SELECT 1 FROM partners WHERE id=? AND status<>'closed')",[partnerId]),env.DB.prepare("INSERT INTO partner_agreements(id,partner_id,version_id,kind,terms,unresolved,created_by) VALUES(?,?,'partners-base-1',?,?,?,?)").bind(entityId,partnerId,b.kind,terms,Number(b.unresolved),who));
   after={partner_id:partnerId,kind:b.kind,status:'draft',unresolved:b.unresolved};result={id:entityId,revision:0};
  }else if(action==='agreement-confirm'){
   fields(b,['action','operation_key','id','expected_revision','confirmed']);entityId=id(b.id);const rev=revision(b);if(b.confirmed!==true)fail('Confirmá expresamente que los términos están completos.');
   const row=await env.DB.prepare('SELECT a.*,p.status AS partner_status FROM partner_agreements a JOIN partners p ON p.id=a.partner_id WHERE a.id=?').bind(entityId).first();
   if(!row)fail('Acuerdo inexistente.',404);
   if(row.revision!==rev||row.status!=='draft'||row.unresolved||row.partner_status==='closed')fail('Hay condiciones pendientes, la ficha cambió o el partner está cerrado. Conservá este borrador y registrá uno nuevo con los términos completos.',409);
   statements.push(assertion(env,"EXISTS(SELECT 1 FROM partner_agreements a JOIN partners p ON p.id=a.partner_id WHERE a.id=? AND a.revision=? AND a.status='draft' AND a.unresolved=0 AND p.status<>'closed')",[entityId,rev]),env.DB.prepare("UPDATE partner_agreements SET status='confirmed',revision=revision+1,confirmed_by=?,confirmed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(who,entityId));
   before={status:'draft',revision:rev};after={status:'confirmed',revision:rev+1};result={id:entityId,revision:rev+1,benefits_enabled:false};
  }else fail('Acción no admitida.');
  statements.push(env.DB.prepare('INSERT INTO partner_events(id,entity_id,action,actor,before_json,after_json,operation_key) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),entityId,action,who,JSON.stringify(before),JSON.stringify(after),key));
  try{
   await env.DB.batch([accessGuard(env,actor,request),env.DB.prepare('INSERT INTO partner_operations(operation_key,request_hash,actor,result_json) VALUES(?,?,?,?)').bind(key,hash,who,JSON.stringify(result)),...statements,env.DB.prepare('DELETE FROM management_assertions')]);
  }catch(e){const cached=await replay();if(cached)return cached;if(/UNIQUE|CHECK constraint|immutable|preserve_|FOREIGN KEY/i.test(String(e.message)))fail('Los datos cambiaron o el cliente/código ya existe. Actualizá y revisá antes de reintentar.',409);throw e;}
  return json(result,201);
 }catch(e){return json({error:e instanceof InputError?e.message:'No se pudo guardar PARTNERS. No se completó la operación; revisá la preparación de producción.'},e.status||503)}
}
