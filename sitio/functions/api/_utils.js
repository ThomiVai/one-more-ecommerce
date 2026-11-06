import {deploymentOnly,databaseGuard} from './_deployment.js';
import {principal,permits} from './_access.js';
export {signSession,verifySession} from './_access.js';
export function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
export async function auth(req,env){try{return !!await principal(req,env)}catch{return false}}
export async function check(req,env){
 const denied=deploymentOnly(req)||await databaseGuard(req,env);if(denied)return denied;
 if(!env.DB)return json({error:'Base D1 no vinculada (DB).'},503);
 try{const p=await principal(req,env);if(!p)return json({error:'Tu sesión terminó o el acceso fue desactivado. Volvé a ingresar.'},401);if(!permits(p,req))return json({error:'Esta acción requiere permisos de administrador.'},403);return null}
 catch{return json({error:'Aplicá schema-v132.sql en YOUR_D1_DATABASE_NAME antes de usar esta versión.'},503)}
}
export function allowOrigin(req,env){const origin=req.headers.get('origin');return !origin||new URL(req.url).origin===origin}
