import {verifyCredential} from '../_passwords.js';
import {json,allowOrigin} from '../_utils.js';
import {principal,publicIdentity,signSession,setCookie,cookieValue,sessionHash,personalHash,equal,digest,newSession,loginLimit,event,accessGuard} from '../_access.js';
import {deploymentOnly} from './_operations.js';
export async function onRequestPost({request,env}){
 const denied=deploymentOnly(request);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'Solicitud inválida'},400)}
 if(!b||typeof b.key!=='string'||b.key.length>200||typeof(b.username??'')!=='string')return json({error:'Revisá el usuario y la clave.'},400);
 const username=String(b.username||'').trim().toLowerCase();if(username.length>40)return json({error:'Revisá el usuario y la clave.'},400);
 try{
  const retry=await loginLimit(request,env,username||'shared');if(retry){const res=json({error:'Demasiados intentos. Esperá unos minutos antes de volver a intentar.'},429);res.headers.set('Retry-After',String(retry));return res}
  if(username){
   const user=await env.DB.prepare('SELECT * FROM team_users WHERE username=?').bind(username).first();
   const valid=user?await verifyCredential(user.id,b.key,user.key_hash,env):false;
   if(!user||!user.active||!valid)return json({error:'Usuario o clave incorrectos.'},401);
   const session=await newSession(env,user);
   const guard=env.DB.prepare('INSERT INTO management_assertions(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM team_users WHERE id=? AND revision=? AND active=1) THEN 1 ELSE 0 END)').bind(crypto.randomUUID(),user.id,user.revision);
   await env.DB.batch([guard,env.DB.prepare('DELETE FROM team_sessions WHERE expires_at<=?').bind(Date.now()),session.statement,event(env,{...user,type:'user'},'login',user.id),env.DB.prepare('DELETE FROM management_assertions')]);
   return setCookie(json({ok:true,user:publicIdentity({...user,type:'user'}),expires_in_seconds:28800}),session.cookie);
  }
  if(!env.ADMIN_API_KEY)return json({error:'El acceso compartido no está configurado. Ingresá con tu usuario personal.'},401);
  const settings=await env.DB.prepare('SELECT shared_access FROM team_settings WHERE id=1').first();
  if(!settings?.shared_access||!equal(await digest(b.key),await digest(env.ADMIN_API_KEY)))return json({error:'Clave incorrecta o acceso compartido desactivado.'},401);
  const p={type:'shared',id:'shared-admin',name:'Acceso compartido',username:'',role:'admin'};
  await env.DB.batch([accessGuard(env,p,request),event(env,p,'login-shared'),env.DB.prepare('DELETE FROM management_assertions')]);
  return setCookie(json({ok:true,user:publicIdentity(p),expires_in_seconds:28800}),await signSession(env.ADMIN_API_KEY,Date.now()+8*3600*1000));
 }catch{return json({error:'No se pudo iniciar sesión. Verificá schema-v132.sql e intentá nuevamente.'},503)}
}
export async function onRequestGet({request,env}){
 try{const p=await principal(request,env);return json({authenticated:!!p,user:publicIdentity(p)})}catch{return json({error:'Aplicá schema-v132.sql en YOUR_D1_DATABASE_NAME antes de usar esta versión.'},503)}
}
export async function onRequestDelete({request,env}){
 const denied=deploymentOnly(request);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 try{const cookie=cookieValue(request);if(/^v2\.[\w-]{43}$/.test(cookie))await env.DB.prepare('DELETE FROM team_sessions WHERE token_hash=?').bind(await sessionHash(cookie.slice(3))).run();return setCookie(json({ok:true}),'',0)}catch{return json({error:'No se pudo cerrar la sesión. Volvé a intentar.'},503)}
}
