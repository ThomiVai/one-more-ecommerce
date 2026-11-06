import {json} from './_utils.js';
export const PRODUCTION_DATABASE_ID='00000000-0000-0000-0000-000000000000';
export function deploymentOnly(request){
 const host=new URL(request.url).hostname;
 return ['localhost','127.0.0.1','one-more.com.ar','www.one-more.com.ar','one-more-suplementos.pages.dev'].includes(host)?null:json({error:'Esta entrega está limitada a la web oficial de ONE MORE.'},403);
}
const cache=new WeakMap();
export async function databaseGuard(request,env){
 if(!cache.has(request))cache.set(request,(async()=>{try{const row=env.DB&&await env.DB.prepare('SELECT database_id,project FROM deployment_identity WHERE id=1').first();return row?.database_id===PRODUCTION_DATABASE_ID&&row?.project==='one-more-suplementos'?null:json({error:'La base oficial todavía no está verificada. Revisá el binding DB y la migración de producción.'},503)}catch{return json({error:'Falta preparar y verificar la base oficial de ONE MORE.'},503)}})());
 return cache.get(request);
}
