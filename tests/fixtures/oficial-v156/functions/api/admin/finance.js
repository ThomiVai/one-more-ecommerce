import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,assertion,deploymentOnly} from './_operations.js';
import {validDate,today,validKey} from './_settlements.js';
const methods=['cash','transfer','mercadopago','other'];
const kinds=['expense','contribution','withdrawal','transfer','adjustment'];
const categories=['shipping','commission','advertising','other'];
const amount=n=>Number.isSafeInteger(n)&&Math.abs(n)<=1e13;
const note=n=>typeof n==='string'&&n.trim().length>=3&&n.trim().length<=300;
export async function onRequestGet({request,env}){
 const denied=await check(request,env)||deploymentOnly(request);if(denied)return denied;
 const p=new URL(request.url).searchParams,to=p.get('to')||today(),from=p.get('from')||to.slice(0,7)+'-01';
 if(!validDate(from)||!validDate(to)||from>to||to>today())return json({error:'Elegí un período válido, hasta hoy.'},400);
 try{
 const revision=(await env.DB.prepare('SELECT revision FROM finance_revision WHERE id=1').first()).revision;
 const opening=await env.DB.prepare('SELECT * FROM cash_opening WHERE id=1').first();
 const flows=(await env.DB.prepare('SELECT method,COALESCE(SUM(amount_cents),0) amount_cents FROM cash_flows_v139 WHERE flow_date<=? GROUP BY method').bind(to).all()).results;
 const accounts=methods.map(method=>({method,balance_cents:opening&&to>=opening.start_date?opening[method+'_cents']+(flows.find(f=>f.method===method)?.amount_cents||0):null}));
 const profit=await env.DB.prepare('SELECT COALESCE(SUM(revenue_cents),0) revenue_cents,COALESCE(SUM(cost_cents),0) cost_cents FROM sales_activity_v135 WHERE day>=? AND day<=?').bind(from,to).first();
 const expenses=(await env.DB.prepare('SELECT category,SUM(amount_cents) amount_cents FROM expense_activity_v139 WHERE activity_date>=? AND activity_date<=? GROUP BY category').bind(from,to).all()).results;
 const expense_cents=expenses.reduce((s,e)=>s+e.amount_cents,0);
 const flow=await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END),0) incoming_cents,COALESCE(SUM(CASE WHEN amount_cents<0 THEN -amount_cents ELSE 0 END),0) outgoing_cents FROM cash_flows_v139 WHERE flow_date>=? AND flow_date<=? AND source NOT IN ('cash-entry','cash-reversal')`).bind(from,to).first();
 const entries=(await env.DB.prepare(`SELECT e.*,x.id reversal_id,x.reversed_at,x.reason reversal_reason,COALESCE(u.name,CASE WHEN e.actor='shared-admin' THEN 'Acceso compartido' ELSE e.actor END) recorded_by,COALESCE(v.name,x.actor) reversed_by FROM cash_entries e LEFT JOIN cash_reversals x ON x.entry_id=e.id LEFT JOIN team_users u ON e.actor='user:'||u.id LEFT JOIN team_users v ON x.actor='user:'||v.id WHERE (e.paid_at>=? AND e.paid_at<=?) OR (x.reversed_at>=? AND x.reversed_at<=?) ORDER BY e.paid_at DESC,e.rowid DESC LIMIT 100`).bind(from,to,from,to).all()).results;
 const ledger=(await env.DB.prepare(`SELECT f.*,COALESCE(e.note,CASE WHEN s.record_type='sale' AND s.direction='payment' THEN 'Cobro de venta' WHEN s.record_type='sale' THEN 'Reintegro a cliente' WHEN s.direction='payment' THEN 'Pago a proveedor' ELSE 'Reintegro del proveedor' END,'Corrección de dinero') label,COALESCE(s.record_type,e.record_type) record_type,COALESCE(s.record_id,e.record_id) record_id FROM cash_flows_v139 f LEFT JOIN cash_reversals x ON f.source='cash-reversal' AND x.id=f.source_id LEFT JOIN cash_entries e ON (f.source='cash-entry' AND e.id=f.source_id) OR (f.source='cash-reversal' AND e.id=x.entry_id) LEFT JOIN settlement_reversals z ON f.source='settlement-reversal' AND z.id=f.source_id LEFT JOIN settlements s ON (f.source='settlement' AND s.id=f.source_id) OR (f.source='settlement-reversal' AND s.id=z.settlement_id) WHERE f.flow_date>=? AND f.flow_date<=? ORDER BY f.flow_date DESC,f.source_id LIMIT 100`).bind(from,to).all()).results;
 return json({ledger,revision,opening,accounts,from,to,profit:{...profit,expense_cents,result_cents:profit.revenue_cents-profit.cost_cents-expense_cents},expenses,flow,entries,history_limit:100});
 }catch{return json({error:'No se pudo cargar caja. Aplicá la migración V139 y actualizá.'},503)}
}
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||!validKey(b)||b.confirmed!==true||!Number.isSafeInteger(b.expected_finance_revision)||b.expected_finance_revision<0||!['opening','entry','reverse'].includes(b.action))return json({error:'Completá y confirmá la revisión de caja.'},400);
 return operation(request,env,'finance',b,async(_state,key,actor)=>{
 const revision=(await env.DB.prepare('SELECT revision FROM finance_revision WHERE id=1').first()).revision;
 if(revision!==b.expected_finance_revision)throw new OperationError('Caja cambió. Actualizá y revisá antes de confirmar.');
 const guards=[assertion(env,'EXISTS(SELECT 1 FROM finance_revision WHERE id=1 AND revision=?)',[revision])];
 const opening=await env.DB.prepare('SELECT * FROM cash_opening WHERE id=1').first();
 if(b.action==='opening'){
  if(opening)throw new OperationError('La caja ya tiene saldos iniciales. Usá un ajuste documentado para corregirlos.');
  if(!validDate(b.start_date)||b.start_date>today()||!note(b.note)||methods.some(m=>!amount(b[m+'_cents'])))throw new OperationError('Revisá fecha, motivo y los cuatro saldos iniciales.',400);
  return {body:{ok:true,id:'opening'},status:201,statements:[...guards,assertion(env,'NOT EXISTS(SELECT 1 FROM cash_opening)'),env.DB.prepare('INSERT INTO cash_opening(id,operation_key,start_date,cash_cents,transfer_cents,mercadopago_cents,other_cents,note,actor) VALUES(1,?,?,?,?,?,?,?,?)').bind(key,b.start_date,...methods.map(m=>b[m+'_cents']),b.note.trim(),actor)]};
 }
 if(!opening)throw new OperationError('Primero confirmá la fecha y los saldos iniciales de caja.');
 const id=crypto.randomUUID();
 if(b.action==='reverse'){
  const entry=typeof b.entry_id==='string'?await env.DB.prepare('SELECT * FROM cash_entries WHERE id=?').bind(b.entry_id).first():null;
  if(!entry)throw new OperationError('El apunte de caja no existe.',404);
  if(!validDate(b.reversed_at)||b.reversed_at<entry.paid_at||b.reversed_at>today()||!note(b.reason))throw new OperationError('Revisá fecha y motivo de la corrección.',400);
  guards.push(assertion(env,'NOT EXISTS(SELECT 1 FROM cash_reversals WHERE entry_id=?)',[entry.id]));
  return {body:{ok:true,id},status:201,statements:[...guards,env.DB.prepare('INSERT INTO cash_reversals(id,entry_id,operation_key,reversed_at,reason,actor) VALUES(?,?,?,?,?,?)').bind(id,entry.id,key,b.reversed_at,b.reason.trim(),actor)]};
 }
 if(!kinds.includes(b.kind)||!methods.includes(b.method)||!amount(b.amount_cents)||!b.amount_cents||(b.kind!=='adjustment'&&b.amount_cents<0)||!categories.includes(b.category)||!validDate(b.paid_at)||b.paid_at<opening.start_date||b.paid_at>today()||!note(b.note))throw new OperationError('Revisá importe, tipo, medio, fecha y descripción.',400);
 if(b.kind==='transfer'&&(!methods.includes(b.destination)||b.destination===b.method))throw new OperationError('Elegí dos medios distintos para el traslado.',400);
 if(b.kind!=='transfer'&&b.destination!=null)throw new OperationError('Solo los traslados tienen un medio de destino.',400);
 const rt=b.record_type??null,rid=b.record_id??null;
 if(rt!==null||rid!==null){
  if(b.kind!=='expense'||!['sale','purchase'].includes(rt)||typeof rid!=='string')throw new OperationError('La vinculación debe ser de un gasto a una compra o venta.',400);
  guards.push(assertion(env,'EXISTS(SELECT 1 FROM settlement_balances_v137 WHERE record_type=? AND record_id=?)',[rt,rid]));
  if(!await env.DB.prepare('SELECT record_id FROM settlement_balances_v137 WHERE record_type=? AND record_id=?').bind(rt,rid).first())throw new OperationError('El comprobante vinculado no existe.',404);
 }
 return {body:{ok:true,id},status:201,statements:[...guards,env.DB.prepare('INSERT INTO cash_entries(id,operation_key,kind,amount_cents,method,destination,paid_at,category,note,record_type,record_id,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,key,b.kind,b.amount_cents,b.method,b.kind==='transfer'?b.destination:null,b.paid_at,b.kind==='expense'?b.category:'other',b.note.trim(),rt,rid,actor)]};
 });
}
