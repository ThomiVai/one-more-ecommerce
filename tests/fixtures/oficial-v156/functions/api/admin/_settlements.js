import {assertion,OperationError} from './_operations.js';
export const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const validSnapshot=b=>Number.isSafeInteger(b.expected_revision)&&b.expected_revision>=0&&Number.isSafeInteger(b.expected_balance_cents);
export const validKey=b=>typeof b.operation_key==='string'&&/^[\w-]{12,100}$/.test(b.operation_key);
export async function readBalance(env,type,id){return env.DB.prepare('SELECT * FROM settlement_balances_v137 WHERE record_type=? AND record_id=?').bind(type,id).first()}
export function checkSnapshot(current,b){if(!current)throw new OperationError('El comprobante original no existe.',404);if(current.revision!==b.expected_revision||current.balance_cents!==b.expected_balance_cents)throw new OperationError('El saldo cambió. Actualizá el detalle y revisá el movimiento antes de confirmar.')}
export function balanceGuard(env,current){return assertion(env,'EXISTS(SELECT 1 FROM settlement_balances_v137 WHERE record_type=? AND record_id=? AND revision=? AND balance_cents=?)',[current.record_type,current.record_id,current.revision,current.balance_cents])}
export async function settlementDetails(env,type,id){
 const [balances,entries]=await env.DB.batch([
  env.DB.prepare('SELECT * FROM settlement_balances_v137 WHERE record_type=? AND record_id=?').bind(type,id),
  env.DB.prepare(`SELECT e.*,x.id reversal_id,x.reversed_at,x.reason reversal_reason,x.created_at reversal_created_at,COALESCE(u.name,CASE WHEN e.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) recorded_by,COALESCE(v.name,CASE WHEN x.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) reversed_by FROM settlements e LEFT JOIN settlement_reversals x ON x.settlement_id=e.id LEFT JOIN team_users u ON e.actor='user:'||u.id LEFT JOIN team_users v ON x.actor='user:'||v.id WHERE e.record_type=? AND e.record_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100`).bind(type,id)]);
 return {balance:balances.results[0]||null,entries:entries.results||[],limit:100};
}
