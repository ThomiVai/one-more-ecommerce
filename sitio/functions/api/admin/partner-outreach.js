import {json,check,allowOrigin} from '../_utils.js';
import {principal,actorId,accessGuard} from '../_access.js';
const stages=['new','contacted','replied','negotiating','ready','converted','declined','do_not_contact'];
const finalStages=['converted','declined','do_not_contact'];
class InputError extends Error{constructor(message,status=400){super(message);this.status=status}}
const fail=(message,status=400)=>{throw new InputError(message,status)};
const text=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail('Revisá '+label+'.');return v.trim()};
const fields=(b,allowed)=>{if(!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).some(k=>!allowed.includes(k)))fail('Campos no admitidos.')};
export function normalizeInstagram(value){
 let s=text(value,1,200,'Instagram');
 if(/^https?:\/\//i.test(s)){let u;try{u=new URL(s)}catch{fail('Enlace de Instagram inválido.')};if(!['instagram.com','www.instagram.com'].includes(u.hostname)||u.search||u.hash)fail('Usá el enlace directo al perfil de Instagram.');s=u.pathname.replace(/^\/|\/$/g,'');}
 s=s.replace(/^@/,'').toLowerCase();if(!/^[a-z0-9._]{1,30}$/.test(s)||['p','reel','reels','stories','explore','direct','accounts'].includes(s))fail('Ingresá un usuario o enlace de perfil de Instagram válido.');return s;
}
export function validDate(value){const s=text(value??'',0,10,'la próxima fecha');if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s))fail('Fecha inválida.');return s}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(b)))))].map(n=>n.toString(16).padStart(2,'0')).join('');
function assertion(env,condition,args=[]){const id=crypto.randomUUID();return {id,statement:env.DB.prepare(`INSERT INTO management_assertions(id,ok) VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`).bind(id,...args)}}
async function permitted(request,env){
 const denied=await check(request,env);if(denied)return {denied};const actor=await principal(request,env);
 if(actor?.type!=='user'||actor.role!=='admin')return {denied:json({error:'Captación requiere tu usuario personal administrador.'},403)};
 if(env.PARTNERS_PHASE1!=='true')return {denied:json({error:'Partners no está habilitado en producción.'},503)};
 try{if((await env.DB.prepare('SELECT version FROM partner_outreach_schema WHERE id=1').first())?.version!==159)throw Error()}catch{return {denied:json({error:'Falta aplicar la migración de captación V159 en producción.'},503)}}
 return {actor};
}
export async function onRequestGet({request,env}){
 const {denied,actor}=await permitted(request,env);if(denied)return denied;
 try{
  const p=new URL(request.url).searchParams,mode=p.get('mode')||'list';
  const admins=(await env.DB.prepare("SELECT id,name,username FROM team_users WHERE active=1 AND role='admin' ORDER BY name,id").all()).results;
  if(mode==='detail'){
   const id=text(p.get('id'),1,80,'el candidato'),row=await env.DB.prepare('SELECT p.*,u.name AS owner_name FROM partner_prospects p LEFT JOIN team_users u ON u.id=p.owner_id WHERE p.id=?').bind(id).first();if(!row)fail('Candidato inexistente.',404);
   const events=(await env.DB.prepare('SELECT * FROM partner_prospect_events WHERE prospect_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(id).all()).results;
   return json({prospect:row,events,history_limit:100,admins,benefits_enabled:false});
  }
  if(mode!=='list')fail('Vista no admitida.');
  const q=text(p.get('q')||'',0,100,'la búsqueda').toLowerCase(),stage=p.get('stage')||'',owner=p.get('owner')||'',due=p.get('due')==='1',today=validDate(p.get('today')||new Date().toISOString().slice(0,10)),after=text(p.get('after')||'',0,80,'la página');
  if(stage&&!stages.includes(stage))fail('Estado inválido.');
  const rows=(await env.DB.prepare(`SELECT p.*,u.name AS owner_name FROM partner_prospects p LEFT JOIN team_users u ON u.id=p.owner_id WHERE p.id>? AND (?='' OR p.stage=?) AND (?='' OR p.owner_id=?) AND (?='' OR instr(lower(p.name||' '||p.instagram||' '||p.specialty||' '||p.town),?)>0) AND (?=0 OR (p.follow_up_on<>'' AND p.follow_up_on<=? AND p.stage NOT IN ('converted','declined','do_not_contact'))) ORDER BY p.id LIMIT 31`).bind(after,stage,stage,owner,owner,q,q,due?1:0,today).all()).results;
  const counts=(await env.DB.prepare('SELECT stage,COUNT(*) AS total FROM partner_prospects GROUP BY stage').all()).results;
  const pending=await env.DB.prepare("SELECT COUNT(*) AS total FROM partner_prospects WHERE follow_up_on<>'' AND follow_up_on<=? AND stage NOT IN ('converted','declined','do_not_contact')").bind(today).first();
  return json({items:rows.slice(0,30),next:rows.length>30?rows[29].id:null,counts,followups_due:pending.total,admins,current_user:actor.id,benefits_enabled:false,metrics_scope:'Todos los candidatos; no son ventas ni beneficios.'});
 }catch(e){return json({error:e instanceof InputError?e.message:'No se pudo cargar captación.'},e.status||503)}
}
export async function onRequestPost({request,env}){
 const {denied,actor}=await permitted(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido.'},403);
 let b;try{const raw=await request.text();if(new TextEncoder().encode(raw).length>14000)return json({error:'Solicitud demasiado grande.'},413);b=JSON.parse(raw)}catch{return json({error:'Solicitud inválida.'},400)}
 try{
  fields(b,['action','operation_key','id','expected_revision','instagram','name','specialty','town','source','owner_id','follow_up_on','notes','stage','note','code','customer_id','identity_confirmed']);
  const key=text(b.operation_key,16,100,'la clave de operación'),who=actorId(actor),hash=await digest(b);
  const replay=async()=>{const old=await env.DB.prepare('SELECT * FROM partner_outreach_operations WHERE operation_key=?').bind(key).first();if(!old)return null;if(old.request_hash!==hash||old.actor!==who)fail('Esa operación ya se usó con otros datos o cuenta.',409);return json({...JSON.parse(old.result_json),replayed:true})};
  const prior=await replay();if(prior)return prior;
  let id,before={},after,result,statements=[],guards=[];
  const guard=(sql,args=[])=>{const g=assertion(env,sql,args);guards.push(g);return g.statement};
  const ownerGuard=id=>guard("EXISTS(SELECT 1 FROM team_users WHERE id=? AND active=1 AND role='admin')",[id]);
  const profileFree=ig=>guard("NOT EXISTS(SELECT 1 FROM partners WHERE lower(ltrim(instagram,'@'))=?)",[ig]);
  statements.push(guard("EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos') AND EXISTS(SELECT 1 FROM partner_outreach_schema WHERE id=1 AND version=159)"));
  if(b.action==='create'){
   fields(b,['action','operation_key','instagram','name','specialty','town','source','owner_id','follow_up_on','notes']);
   const instagram=normalizeInstagram(b.instagram),name=text(b.name,2,100,'el nombre'),owner=text(b.owner_id||actor.id,1,80,'el responsable');
   if(await env.DB.prepare('SELECT id,stage FROM partner_prospects WHERE instagram=? COLLATE NOCASE').bind(instagram).first())fail('Ese perfil ya tiene seguimiento. Buscalo; no crees otra ficha.',409);
   if(await env.DB.prepare("SELECT id FROM partners WHERE lower(ltrim(instagram,'@'))=?").bind(instagram).first())fail('Ese Instagram ya tiene ficha de partner. Buscalo en Partners.',409);
   id=crypto.randomUUID();after={name,instagram,stage:'new',owner_id:owner,specialty:text(b.specialty||'',0,100,'la especialidad'),town:text(b.town||'',0,100,'la zona'),source:text(b.source||'',0,200,'el origen'),follow_up_on:validDate(b.follow_up_on),notes:text(b.notes||'',0,3000,'las notas'),revision:0};
   statements.push(ownerGuard(owner),profileFree(instagram),env.DB.prepare('INSERT INTO partner_prospects(id,instagram,name,specialty,town,source,owner_id,follow_up_on,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,instagram,name,after.specialty,after.town,after.source,owner,after.follow_up_on,after.notes,who));result={id,revision:0};
  }else{
   id=text(b.id,1,80,'el candidato');if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0)fail('Reabrí la ficha antes de guardar.');
   before=await env.DB.prepare('SELECT * FROM partner_prospects WHERE id=?').bind(id).first();if(!before)fail('Candidato inexistente.',404);if(before.revision!==b.expected_revision)fail('La ficha cambió. Reabrila y revisá el historial.',409);
   statements.push(guard('EXISTS(SELECT 1 FROM partner_prospects WHERE id=? AND revision=?)',[id,b.expected_revision]));
   const note=text(b.note,3,1500,'el motivo o resultado');
   if(b.action==='update'){
    fields(b,['action','operation_key','id','expected_revision','name','specialty','town','source','owner_id','follow_up_on','notes','stage','note']);
    if(before.stage==='converted')fail('La ficha ya fue creada. Continuá desde Partners.',409);
    const stage=b.stage;if(!stages.includes(stage)||stage==='converted')fail('Estado no admitido.');
    if(finalStages.includes(before.stage)&&stage!==before.stage)fail('Este contacto está cerrado. No se reabre automáticamente.',409);
    const owner=text(b.owner_id||before.owner_id,1,80,'el responsable');after={...before,name:text(b.name,2,100,'el nombre'),specialty:text(b.specialty||'',0,100,'la especialidad'),town:text(b.town||'',0,100,'la zona'),source:text(b.source||'',0,200,'el origen'),owner_id:owner,notes:text(b.notes||'',0,3000,'las notas'),stage,follow_up_on:finalStages.includes(stage)?'':validDate(b.follow_up_on),revision:before.revision+1};
    statements.push(ownerGuard(owner),env.DB.prepare("UPDATE partner_prospects SET name=?,specialty=?,town=?,source=?,owner_id=?,follow_up_on=?,notes=?,stage=?,revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(after.name,after.specialty,after.town,after.source,owner,after.follow_up_on,after.notes,stage,id));result={id,revision:after.revision};
   }else if(b.action==='convert'){
    fields(b,['action','operation_key','id','expected_revision','code','customer_id','identity_confirmed','note']);
    if(before.stage!=='ready')fail('Primero registrá que está listo para el acuerdo.',409);if(b.identity_confirmed!==true)fail('Confirmá que es la misma persona y revisá clientes existentes.');
    const code=text(b.code,4,20,'el código').toUpperCase();if(!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code))fail('El código usa 4 a 20 letras, números o guion.');
    const customer=b.customer_id?text(b.customer_id,1,80,'el cliente'):crypto.randomUUID(),partner=crypto.randomUUID();
    statements.push(profileFree(before.instagram));
    if(b.customer_id)statements.push(guard("EXISTS(SELECT 1 FROM customers WHERE id=? AND status='active')",[customer]));
    else{
     if(await env.DB.prepare('SELECT id FROM customers WHERE lower(trim(name))=lower(?)').bind(before.name).first())fail('Ya existe un cliente con ese nombre. Revisalo y elegí la ficha existente.',409);
     statements.push(guard('NOT EXISTS(SELECT 1 FROM customers WHERE lower(trim(name))=lower(?))',[before.name]),env.DB.prepare('INSERT INTO customers(id,name,created_by) VALUES(?,?,?)').bind(customer,before.name,who));
    }
    statements.push(env.DB.prepare("INSERT INTO partners(id,customer_id,program_id,code,instagram,status,created_by) VALUES(?,?,'partners',?,?,'candidate',?)").bind(partner,customer,code,before.instagram,who),env.DB.prepare("UPDATE partner_prospects SET stage='converted',partner_id=?,follow_up_on='',revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(partner,id));
    after={...before,stage:'converted',partner_id:partner,follow_up_on:'',revision:before.revision+1};result={id,partner_id:partner,customer_id:customer,revision:after.revision,partner_status:'candidate',benefits_enabled:false};
    statements.push(env.DB.prepare('INSERT INTO partner_events(id,entity_id,action,actor,before_json,after_json,operation_key) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),partner,'outreach-convert',who,'{}',JSON.stringify({customer_id:customer,code,instagram:before.instagram,status:'candidate',prospect_id:id}),'outreach:'+key));
   }else fail('Acción no admitida.');
   b={...b,note};
  }
  const note=b.action==='create'?'Candidato registrado':b.note;
  const cleanup=guards.map(g=>env.DB.prepare('DELETE FROM management_assertions WHERE id=?').bind(g.id));
  try{await env.DB.batch([accessGuard(env,actor,request),env.DB.prepare('INSERT INTO partner_outreach_operations(operation_key,request_hash,actor,result_json) VALUES(?,?,?,?)').bind(key,hash,who,JSON.stringify(result)),...statements,env.DB.prepare('INSERT INTO partner_prospect_events(id,prospect_id,action,actor,before_json,after_json,note,operation_key) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,b.action,who,JSON.stringify(before),JSON.stringify(after),note,key),...cleanup,env.DB.prepare('DELETE FROM management_assertions')]);}
  catch(e){const cached=await replay();if(cached)return cached;if(/UNIQUE|CHECK constraint|FOREIGN KEY/i.test(String(e.message)))fail('Los datos cambiaron, el código ya existe o la cuenta no está activa. Reabrí y revisá antes de reintentar.',409);throw e}
  return json(result,201);
 }catch(e){return json({error:e instanceof InputError?e.message:'No se pudo guardar. Revisá la preparación V159; no se completó la operación.'},e.status||503)}
}
