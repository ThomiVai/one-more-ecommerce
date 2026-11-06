import {json,check,allowOrigin} from '../_utils.js';
import {assertion} from '../admin/_operations.js';
import {authorizedBatch} from '../_access.js';
export async function onRequestPatch({request,env,params}){
 const fail=await check(request,env);if(fail)return fail;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!['confirmed','cancelled'].includes(b?.status))return json({error:'Estado inválido'},400);
 try{const saved=await authorizedBatch(request,env,[assertion(env,"EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pending')",[params.id]),env.DB.prepare("UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=? AND status='pending'").bind(b.status,params.id)],'request-'+b.status,params.id);
 const result=saved[2];
 if(!result.meta?.changes)return json({error:'Pedido no encontrado o ya procesado'},409);
 return json({id:params.id,status:b.status,loyverse_synced:false});
 }catch{return json({error:'La solicitud o tu acceso cambiaron. Actualizá y revisá antes de continuar.'},409)}
}
