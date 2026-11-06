import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError} from './_operations.js';
import {validDate,today,validKey,validSnapshot,readBalance,checkSnapshot,balanceGuard} from './_settlements.js';
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||!['sale','purchase'].includes(b.record_type)||typeof b.record_id!=='string'||!/^[\w-]{2,100}$/.test(b.record_id)||!['payment','refund'].includes(b.direction)||!Number.isSafeInteger(b.amount_cents)||b.amount_cents<1||b.amount_cents>1e13||!validDate(b.paid_at)||b.paid_at>today()||!['cash','transfer','mercadopago','other'].includes(b.method)||typeof b.reference!=='string'||b.reference.length>100||typeof b.note!=='string'||b.note.length>300||!validKey(b)||!validSnapshot(b))return json({error:'Completá importe, fecha, medio y revisión del saldo.'},400);
 return operation(request,env,'settlement',b,async(_state,key,actor)=>{
  const current=await readBalance(env,b.record_type,b.record_id);checkSnapshot(current,b);
  if(b.paid_at<current.record_date)throw new OperationError('La fecha no puede ser anterior al comprobante.',400);
  const limit=b.direction==='payment'?Math.max(current.balance_cents,0):Math.max(-current.balance_cents,0);
  if(b.amount_cents>limit)throw new OperationError('El importe supera el saldo disponible para este movimiento. Revisá cobros, pagos y devoluciones.');
  const id=crypto.randomUUID();
  return {body:{ok:true,id,record_type:b.record_type,record_id:b.record_id,amount_cents:b.amount_cents},status:201,statements:[balanceGuard(env,current),env.DB.prepare('INSERT INTO settlements(id,operation_key,record_type,record_id,direction,amount_cents,paid_at,method,reference,note,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,key,b.record_type,b.record_id,b.direction,b.amount_cents,b.paid_at,b.method,b.reference.trim(),b.note.trim(),actor)]};
 });
}
