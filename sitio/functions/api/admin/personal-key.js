import {passwordError,hashPassword,verifyCredential} from '../_passwords.js';
import {json,check,allowOrigin} from '../_utils.js';
import {principal,randomToken,personalHash,newSession,setCookie,authorizedBatch,loginLimit} from '../_access.js';
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'Solicitud inválida'},400)}
 if(b?.confirmed!==true)return json({error:'Confirmá que vas a guardar tu nueva clave.'},400);
 const p=await principal(request,env);if(p.type!=='user')return json({error:'Ingresá con tu cuenta personal.'},409);
 const chosen=b.password!==undefined;
 if(!chosen){const row=await env.DB.prepare('SELECT key_hash FROM team_users WHERE id=?').bind(p.id).first();if(row?.key_hash.startsWith('pbkdf2-'))return json({error:'Para cambiar tu contraseña, indicá la actual y elegí una nueva.'},400)}
 if(chosen){const retry=await loginLimit(request,env,p.username);if(retry){const r=json({error:'Demasiados intentos. Esperá unos minutos antes de intentar nuevamente.'},429);r.headers.set('Retry-After',String(retry));return r}const error=passwordError(b.password);if(error)return json({error},400);const row=await env.DB.prepare('SELECT key_hash FROM team_users WHERE id=?').bind(p.id).first();if(!row||!await verifyCredential(p.id,b.current_password,row.key_hash,env))return json({error:'La contraseña actual no coincide. No se cambió tu acceso.'},400)}
 const key=chosen?null:'om_'+randomToken(),hash=chosen?await hashPassword(p.id,b.password,env):await personalHash(p.id,key),next={...p,revision:p.revision+1},session=await newSession(env,next);
 try{
  await authorizedBatch(request,env,[env.DB.prepare("UPDATE team_users SET key_hash=?,revision=revision+1,updated_at=datetime('now') WHERE id=?").bind(hash,p.id),env.DB.prepare('DELETE FROM team_sessions WHERE user_id=?').bind(p.id),session.statement],'personal-key-renew',p.id);
  return setCookie(json({ok:true,...(chosen?{password_set:true}:{key,shown_once:true}),user:{id:p.id,username:p.username,name:p.name,role:p.role}}),session.cookie);
 }catch{return json({error:'No se pudo renovar la clave. Actualizá la sesión y volvé a intentar.'},409)}
}
