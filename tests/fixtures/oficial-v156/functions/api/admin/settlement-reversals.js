import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,assertion} from './_operations.js';
import {validDate,today,validKey,validSnapshot,readBalance,checkSnapshot,balanceGuard} from './_settlements.js';
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||typeof b.settlement_id!=='string'||!/^[\w-]{2,100}$/.test(b.settlement_id)||!validDate(b.reversed_at)||b.reversed_at>today()||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.trim().length>300||!validKey(b)||!validSnapshot(b))return json({error:'Completá fecha, motivo y revisión de la anulación.'},400);
 return operation(request,env,'settlement-reversal',b,async(_state,key,actor)=>{
  const entry=await env.DB.prepare('SELECT * FROM settlements WHERE id=?').bind(b.settlement_id).first();if(!entry)throw new OperationError('El movimiento no existe.',404);
  const current=await readBalance(env,entry.record_type,entry.record_id);checkSnapshot(current,b);
  if(b.reversed_at<entry.paid_at)throw new OperationError('La anulación no puede ser anterior al movimiento.',400);
  if(await env.DB.prepare('SELECT id FROM settlement_reversals WHERE settlement_id=?').bind(entry.id).first())throw new OperationError('El movimiento ya está anulado. Revisá el historial.');
  const id=crypto.randomUUID();
  return {body:{ok:true,id,settlement_id:entry.id,record_type:entry.record_type,record_id:entry.record_id},status:201,statements:[balanceGuard(env,current),assertion(env,'NOT EXISTS(SELECT 1 FROM settlement_reversals WHERE settlement_id=?)',[entry.id]),env.DB.prepare('INSERT INTO settlement_reversals(id,settlement_id,operation_key,reversed_at,reason,actor) VALUES(?,?,?,?,?,?)').bind(id,entry.id,key,b.reversed_at,b.reason.trim(),actor)]};
 });
}
