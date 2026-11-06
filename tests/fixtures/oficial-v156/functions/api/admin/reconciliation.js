import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,assertion,deploymentOnly} from './_operations.js';
import {validKey,validSnapshot,readBalance,checkSnapshot,balanceGuard} from './_settlements.js';
export async function onRequestGet({request,env}){
 const denied=await check(request,env)||deploymentOnly(request);if(denied)return denied;
 const p=new URL(request.url).searchParams,type=p.get('type')||'all',status=p.get('status')||'pending',search=(p.get('search')||'').trim(),id=p.get('id')||'',page=Number(p.get('page')||0);
 if(!['all','sale','purchase'].includes(type)||!['all','pending','verified'].includes(status)||search.length>100||!Number.isSafeInteger(page)||page<0||page>100000)return json({error:'Filtros inválidos.'},400);
 try{
 const condition=`(?='all' OR r.record_type=?) AND (?='all' OR (?='pending' AND r.verified=0) OR (?='verified' AND r.verified=1)) AND (?='' OR instr(lower(r.label),lower(?))>0) AND (?='' OR r.record_id=?)`;
 const args=[type,type,status,status,status,search,search,id,id];
 const total=(await env.DB.prepare('SELECT COUNT(*) n FROM reconciliation_v139 r WHERE '+condition).bind(...args).first()).n;
 const rows=(await env.DB.prepare(`SELECT r.*,COALESCE(u.name,CASE WHEN r.review_actor='shared-admin' THEN 'Acceso compartido' ELSE r.review_actor END) reviewed_by FROM reconciliation_v139 r LEFT JOIN team_users u ON r.review_actor='user:'||u.id WHERE ${condition} ORDER BY r.record_date,r.record_type,r.record_id LIMIT 50 OFFSET ?`).bind(...args,page*50).all()).results;
 const counts=await env.DB.prepare('SELECT COUNT(*) total,COALESCE(SUM(verified),0) verified,COALESCE(SUM(CASE WHEN verified=0 THEN 1 ELSE 0 END),0) pending FROM reconciliation_v139').first();
 const history=id?(await env.DB.prepare(`SELECT v.*,COALESCE(u.name,CASE WHEN v.actor='shared-admin' THEN 'Acceso compartido' ELSE v.actor END) recorded_by FROM document_reviews v LEFT JOIN team_users u ON v.actor='user:'||u.id WHERE v.record_id=? AND (?='all' OR v.record_type=?) ORDER BY v.rowid DESC LIMIT 100`).bind(id,type,type).all()).results:[];
 const linked_expenses=id?(await env.DB.prepare(`SELECT e.*,x.id reversal_id,x.reversed_at,x.reason reversal_reason,COALESCE(u.name,CASE WHEN e.actor='shared-admin' THEN 'Acceso compartido' ELSE e.actor END) recorded_by FROM cash_entries e LEFT JOIN cash_reversals x ON x.entry_id=e.id LEFT JOIN team_users u ON e.actor='user:'||u.id WHERE e.record_id=? AND (?='all' OR e.record_type=?) AND e.kind='expense' ORDER BY e.rowid DESC LIMIT 100`).bind(id,type,type).all()).results:[];
 const linked_expense_total=id?(await env.DB.prepare(`SELECT COALESCE(SUM(e.amount_cents),0) amount_cents FROM cash_entries e WHERE e.record_id=? AND (?='all' OR e.record_type=?) AND e.kind='expense' AND NOT EXISTS(SELECT 1 FROM cash_reversals x WHERE x.entry_id=e.id)`).bind(id,type,type).first()).amount_cents:0;
 return json({rows,total,page,limit:50,counts,history,linked_expenses,linked_expense_total});
 }catch{return json({error:'No se pudo cargar la revisión. Aplicá V139 y actualizá.'},503)}
}
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||!validKey(b)||!validSnapshot(b)||b.confirmed!==true||!['sale','purchase'].includes(b.record_type)||typeof b.record_id!=='string'||!['verified','needs_review'].includes(b.conclusion)||typeof b.expected_review_id!=='string'||typeof b.note!=='string'||b.note.trim().length<3||b.note.trim().length>300)return json({error:'Confirmá el saldo revisado e indicá una nota.'},400);
 return operation(request,env,'reconciliation',b,async(_state,key,actor)=>{
  const current=await readBalance(env,b.record_type,b.record_id);checkSnapshot(current,b);
  const last=await env.DB.prepare('SELECT id FROM document_reviews WHERE record_type=? AND record_id=? ORDER BY rowid DESC LIMIT 1').bind(b.record_type,b.record_id).first();
  if((last?.id||'')!==b.expected_review_id)throw new OperationError('Otra persona revisó el comprobante. Actualizá el detalle.');
  const id=crypto.randomUUID();
  return {body:{ok:true,id},status:201,statements:[balanceGuard(env,current),assertion(env,"COALESCE((SELECT id FROM document_reviews WHERE record_type=? AND record_id=? ORDER BY rowid DESC LIMIT 1),'')=?",[b.record_type,b.record_id,b.expected_review_id]),env.DB.prepare('INSERT INTO document_reviews(id,operation_key,record_type,record_id,document_revision,balance_cents,conclusion,note,actor) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,key,b.record_type,b.record_id,current.revision,current.balance_cents,b.conclusion,b.note.trim(),actor)]};
 });
}
