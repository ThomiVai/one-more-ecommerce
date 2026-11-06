import {passwordError,hashPassword} from '../_passwords.js';
import {json,check,allowOrigin} from '../_utils.js';
import {principal,USER_FIELDS,randomToken,personalHash,authorizedBatch} from '../_access.js';
import {assertion} from './_operations.js';
export async function onRequestGet({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 const actor=await principal(request,env);if(actor.role!=='admin')return json({error:'Esta sección requiere permisos de administrador.'},403);
 try{
  const [users,settings,events]=await env.DB.batch([
   env.DB.prepare(`SELECT ${USER_FIELDS},(SELECT COUNT(*) FROM team_sessions s WHERE s.user_id=team_users.id AND s.revision=team_users.revision AND s.expires_at>?) sessions_count FROM team_users ORDER BY created_at,id`).bind(Date.now()),
   env.DB.prepare('SELECT shared_access FROM team_settings WHERE id=1'),
   env.DB.prepare('SELECT id,actor_id,actor_name,action,target_id,detail,created_at FROM team_access_events ORDER BY created_at DESC,rowid DESC LIMIT 100')
  ]);
  return json({users:users.results,shared_access:settings.results[0]?.shared_access===1,events:events.results});
 }catch{return json({error:'No se pudo cargar el equipo. Verificá schema-v132.sql.'},503)}
}
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'Solicitud inválida'},400)}
 if(!b||typeof b!=='object')return json({error:'Datos inválidos'},400);
 const actor=await principal(request,env);
 try{
  if(b.action==='create'){
   const username=String(b.username||'').trim().toLowerCase(),name=String(b.name||'').trim(),role=b.role;
   if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)||name.length<2||name.length>80||!['admin','operator'].includes(role))return json({error:'Completá nombre, usuario de 3 a 40 caracteres y permiso.'},400);
   const chosen=b.password!==undefined;if(chosen&&passwordError(b.password))return json({error:passwordError(b.password)},400);
   const id=crypto.randomUUID(),key=chosen?null:'om_'+randomToken(),hash=chosen?await hashPassword(id,b.password,env):await personalHash(id,key);
   const statements=[];
   if(role==='operator')statements.push(assertion(env,"EXISTS(SELECT 1 FROM team_users WHERE role='admin' AND active=1)"));
   statements.push(env.DB.prepare('INSERT INTO team_users(id,username,name,role,key_hash) VALUES(?,?,?,?,?)').bind(id,username,name,role,hash));
   await authorizedBatch(request,env,statements,'user-create',id,username+' · '+(role==='admin'?'administrador':'operador'));
   return json({ok:true,user:{id,username,name,role,active:1,revision:0},...(chosen?{password_set:true}:{key,shown_once:true})},201);
  }
  if(b.action==='shared-access'){
   if(actor.type!=='user')return json({error:'Entrá con tu usuario administrador antes de cambiar el acceso compartido.'},409);
   if(typeof b.enabled!=='boolean')return json({error:'Indicá si el acceso queda habilitado.'},400);
   await authorizedBatch(request,env,[env.DB.prepare('UPDATE team_settings SET shared_access=? WHERE id=1').bind(b.enabled?1:0)],b.enabled?'shared-enable':'shared-disable','shared-admin');return json({ok:true});
  }
  if(!['update','reset-key','revoke-sessions'].includes(b.action)||!Number.isSafeInteger(b.expected_revision))return json({error:'Acción o revisión inválida. Actualizá el equipo.'},400);
  const target=await env.DB.prepare(`SELECT ${USER_FIELDS} FROM team_users WHERE id=?`).bind(String(b.id||'')).first();
  if(!target)return json({error:'Usuario inexistente.'},404);
  if(target.revision!==b.expected_revision)return json({error:'Otro administrador cambió este acceso. Actualizá y revisá.'},409);
  const self=actor.type==='user'&&actor.id===target.id;
  const statements=[assertion(env,'EXISTS(SELECT 1 FROM team_users WHERE id=? AND revision=?)',[target.id,target.revision])];
  let key=null,detail=target.username;
  if(b.action==='update'){
   if(!['admin','operator'].includes(b.role)||typeof b.active!=='boolean')return json({error:'Permiso o estado inválido.'},400);
   if(self&&(!b.active||b.role!=='admin'))return json({error:'No podés quitarte tus propios permisos ni desactivar tu cuenta.'},409);
   if(!b.active||b.role!=='admin')statements.push(assertion(env,"EXISTS(SELECT 1 FROM team_users WHERE id<>? AND role='admin' AND active=1)",[target.id]));
   statements.push(env.DB.prepare("UPDATE team_users SET role=?,active=?,revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(b.role,b.active?1:0,target.id));detail+=' · '+(b.role==='admin'?'administrador':'operador')+' · '+(b.active?'activo':'desactivado');
  }else{
   if(self)return json({error:'Para tu cuenta usá Renovar mi clave; para salir usá Cerrar sesión.'},409);
   if(b.action==='reset-key'){
    const chosen=b.password!==undefined;if(chosen&&passwordError(b.password))return json({error:passwordError(b.password)},400);
    key=chosen?null:'om_'+randomToken();const hash=chosen?await hashPassword(target.id,b.password,env):await personalHash(target.id,key);statements.push(env.DB.prepare("UPDATE team_users SET key_hash=?,revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(hash,target.id));
   }else statements.push(env.DB.prepare("UPDATE team_users SET revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(target.id));
  }
  statements.push(env.DB.prepare('DELETE FROM team_sessions WHERE user_id=?').bind(target.id));
  await authorizedBatch(request,env,statements,'user-'+b.action,target.id,detail);
  return json({ok:true,...(b.action==='reset-key'&&b.password!==undefined?{password_set:true}:{}),...(key?{key,shown_once:true,user:{id:target.id,username:target.username,name:target.name,role:target.role}}:{})});
 }catch(e){return json({error:/UNIQUE/i.test(String(e.message))?'Ese usuario ya existe. Elegí otro nombre.':/CHECK|constraint/i.test(String(e.message))?'Los accesos cambiaron o falta un administrador activo. Actualizá y revisá.':'No se guardó el acceso. Volvé a intentar.'},/constraint|UNIQUE/i.test(String(e.message))?409:503)}
}
