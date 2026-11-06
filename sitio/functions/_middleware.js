import {deploymentOnly,databaseGuard} from './api/_deployment.js';
export async function onRequest(context){
 const path=new URL(context.request.url).pathname;
 if(path.startsWith('/api/')){
  const denied=deploymentOnly(context.request)||await databaseGuard(context.request,context.env);if(denied)return denied;
  if(context.env.ONE_MORE_READ_ONLY==='true'&&!['GET','HEAD','OPTIONS'].includes(context.request.method)&&path!=='/api/admin/session')return Response.json({error:'Gestión en modo consulta durante la migración. No se guardaron cambios.'},{status:503,headers:{'cache-control':'no-store'}});
 }
 return context.next();
}
