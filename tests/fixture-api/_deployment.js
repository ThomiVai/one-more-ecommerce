import {json} from './_utils.js';
export const STAGING_DATABASE_ID='00000000-0000-0000-0000-000000000000';
export function deploymentOnly(request){
 const host=new URL(request.url).hostname;
 return ['localhost','127.0.0.1','one-more-suplementos.pages.dev'].includes(host)?null:json({error:'V141 está limitada a preproducción. No admite el dominio oficial.'},403);
}
const cache=new WeakMap();
export async function databaseGuard(request,env){
 if(!cache.has(request))cache.set(request,(async()=>{try{const row=env.DB&&await env.DB.prepare('SELECT database_id,project FROM deployment_identity WHERE id=1').first();return row?.database_id===STAGING_DATABASE_ID&&row?.project==='one-more-suplementos'?null:json({error:'Verificá la identidad de staging y el binding DB antes de usar V141.'},503)}catch{return json({error:'Falta preparar la identidad de staging V141.'},503)}})());
 return cache.get(request);
}
