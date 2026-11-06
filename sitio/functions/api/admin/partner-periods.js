import {json,allowOrigin} from '../_utils.js';
import {actorId,accessGuard} from '../_access.js';
import {permitted} from './partners.js';
import {ready,readiness,body,fields,txt,digest,fail,errorResponse} from '../_partner-inquiries.js';
import {assertion} from './_operations.js';
import {validDate,today} from './_settlements.js';

const schemaReady=readiness+' AND EXISTS(SELECT 1 FROM partner_quota_schema WHERE id=1 AND version=166)';
const ident=v=>txt(v,1,80,'el identificador');
const eligible=`EXISTS(SELECT 1 FROM partners p JOIN customers c ON c.id=p.customer_id JOIN partner_agreements a ON a.partner_id=p.id JOIN partner_program_versions v ON v.id=a.version_id WHERE p.id=? AND p.status='active' AND c.status='active' AND a.id=? AND a.status='confirmed' AND a.unresolved=0 AND v.program_id=p.program_id)`;
const netUnits=`COALESCE((SELECT SUM(l.quantity) FROM sale_lines l WHERE l.sale_id=s.id),0)-COALESCE((SELECT SUM(l.quantity) FROM active_sale_return_lines_v138 l JOIN active_sale_returns_v138 r ON r.id=l.return_id WHERE r.sale_id=s.id),0)`;
const select=`SELECT p.*,x.status partner_status,c.status customer_status,c.name partner_name,x.code,
 COALESCE((SELECT SUM(m.units) FROM partner_quota_movements m WHERE m.period_id=p.id),0) used_units,
 r.decision,r.notes review_notes,r.used_units_at_review,r.actor reviewed_by,r.created_at reviewed_at
 FROM partner_quota_periods p JOIN partners x ON x.id=p.partner_id JOIN customers c ON c.id=x.customer_id
 LEFT JOIN partner_quota_reviews r ON r.period_id=p.id`;
const plus30=date=>new Date(Date.parse(date+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
export function describePeriod(row,date=today()){
 if(!row)return null;
 const state=row.decision?'reviewed':date>=row.expires_on?'review_due':date<row.start_on?'scheduled':'open';
 return {...row,state,remaining_units:Math.max(0,4-row.used_units),available_units:state==='open'&&row.partner_status==='active'&&row.customer_status==='active'?Math.max(0,4-row.used_units):0,benefits_enabled:false};
}
async function access(request,env){
 const blocked=await ready(request,env);if(blocked)return {denied:blocked};
 const p=await permitted(request,env);if(p.denied)return p;
 if(env.PARTNERS_PERIODS_V166!=='true')return {denied:json({error:'Control interno V166 desactivado.'},503)};
 try{if(!(await env.DB.prepare('SELECT '+schemaReady+' ok').first())?.ok)throw Error()}
 catch{return {denied:json({error:'Falta aplicar V166 en producción. Los datos anteriores se conservan.'},503)}};
 return p;
}
export async function onRequestGet({request,env}){
 const a=await access(request,env);if(a.denied)return a.denied;
 try{
  const q=new URL(request.url).searchParams,view=q.get('view')||'partner';
  if(view==='due'){
   const after=q.get('after')||'0';if(!/^\d{1,12}$/.test(after))fail('Página inválida.');
   const rows=(await env.DB.prepare(select+" WHERE r.id IS NULL AND p.expires_on<=date('now','-3 hours') AND p.seq>? ORDER BY p.seq LIMIT 31").bind(Number(after)).all()).results;
   return json({items:rows.slice(0,30).map(r=>describePeriod(r)),next:rows.length>30?rows[29].seq:null,benefits_enabled:false,mode:'simulation'});
  }
  const partnerId=ident(q.get('partner_id'));
  if(!await env.DB.prepare('SELECT id FROM partners WHERE id=?').bind(partnerId).first())fail('Entrenador inexistente.',404);
  const latest=await env.DB.prepare(select+' WHERE p.partner_id=? ORDER BY p.seq DESC LIMIT 1').bind(partnerId).first();
  const periodId=q.get('period_id')?ident(q.get('period_id')):latest?.id;
  const current=periodId?await env.DB.prepare(select+' WHERE p.id=? AND p.partner_id=?').bind(periodId,partnerId).first():null;
  if(periodId&&!current)fail('Período inexistente para este entrenador.',404);
  if(view==='sales'){
   if(!current)fail('Primero prepará un período.');
   const query=txt(q.get('q')||'',0,100,'la búsqueda');
   const items=(await env.DB.prepare(`SELECT s.id,s.reference,s.sold_at,${netUnits} net_units FROM sales s WHERE s.sold_at>=? AND s.sold_at<? AND s.sold_at<=date('now','-3 hours') AND instr(lower(s.reference),lower(?))>0 AND NOT EXISTS(SELECT 1 FROM partner_quota_movements m WHERE m.sale_id=s.id AND m.units+COALESCE((SELECT SUM(x.units) FROM partner_quota_movements x WHERE x.reverses_id=m.id),0)>0) AND (${netUnits})>0 ORDER BY s.sold_at DESC,s.id LIMIT 31`).bind(current.start_on,current.expires_on,query).all()).results;
   return json({items:items.slice(0,30),refine_search:items.length>30,benefits_enabled:false});
  }
  if(view!=='partner')fail('Vista inválida.');
  const after=q.get('after')||'999999999999';if(!/^\d{1,12}$/.test(after))fail('Página inválida.');
  const rows=(await env.DB.prepare(select+' WHERE p.partner_id=? AND p.seq<? ORDER BY p.seq DESC LIMIT 11').bind(partnerId,Number(after)).all()).results;
  const movements=current?(await env.DB.prepare(`SELECT m.*,s.reference FROM partner_quota_movements m LEFT JOIN sales s ON s.id=m.sale_id WHERE m.period_id=? ORDER BY m.seq DESC LIMIT 100`).bind(current.id).all()).results:[];
  return json({latest:describePeriod(latest),period:describePeriod(current),history:rows.slice(0,10).map(r=>describePeriod(r)),next:rows.length>10?rows[9].seq:null,movements,history_limit:100,benefits_enabled:false,mode:'simulation'});
 }catch(e){return errorResponse(e)}
}
export async function onRequestPost({request,env}){
 const a=await access(request,env);if(a.denied)return a.denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido.'},403);
 try{
  const b=await body(request),key=txt(b?.operation_key,16,100,'la clave de operación'),who=actorId(a.actor),hash=await digest(b);
  const replay=async()=>{const old=await env.DB.prepare('SELECT * FROM partner_quota_operations WHERE operation_key=?').bind(key).first();if(!old)return null;if(old.actor!==who||old.request_hash!==hash)fail('Operación ya usada con otros datos o cuenta.',409);return json({...JSON.parse(old.result_json),replayed:true})};
  const old=await replay();if(old)return old;
  if(b.confirmed!==true)fail('Confirmá el registro interno de prueba.');
  let result,statements=[];
  const common=['action','operation_key','confirmed'];
  const newPeriod=(partnerId,agreementId,start,previousId,kind,reason)=>{
   if(!validDate(start)||start>today())fail('La fecha de inicio debe ser real y no futura.');
   const id=crypto.randomUUID(),end=plus30(start);
   statements.push(assertion(env,eligible,[partnerId,agreementId]),assertion(env,'NOT EXISTS(SELECT 1 FROM partner_quota_periods WHERE partner_id=? AND start_on<? AND expires_on>?)',[partnerId,end,start]),env.DB.prepare('INSERT INTO partner_quota_periods(id,partner_id,agreement_id,previous_id,kind,start_on,expires_on,actor,reason) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,partnerId,agreementId,previousId,kind,start,end,who,reason));
   return id;
  };
  if(b.action==='start'){
   fields(b,[...common,'partner_id','agreement_id','expected_latest_period_id','start_on','reason']);
   const partnerId=ident(b.partner_id),agreementId=ident(b.agreement_id),previous=await env.DB.prepare(select+' WHERE p.partner_id=? ORDER BY p.seq DESC LIMIT 1').bind(partnerId).first();
   if((previous?.id||'')!==txt(b.expected_latest_period_id,0,80,'el último período'))fail('La ficha cambió. Actualizá antes de iniciar.',409);
   if(previous&&previous.decision!=='pause')fail('Ya tiene un período. Usá su revisión mensual; una finalización no se reactiva desde acá.',409);
   const reason=txt(b.reason,10,1500,'el motivo');
   statements.push(assertion(env,"COALESCE((SELECT id FROM partner_quota_periods WHERE partner_id=? ORDER BY seq DESC LIMIT 1),'')=?",[partnerId,previous?.id||'']));
   if(previous)statements.push(assertion(env,"EXISTS(SELECT 1 FROM partner_quota_reviews WHERE period_id=? AND decision='pause')",[previous.id]));
   const id=newPeriod(partnerId,agreementId,b.start_on,previous?.id||null,previous?'reactivation':'welcome',reason);
   result={id,partner_id:partnerId,benefits_enabled:false,mode:'simulation'};
  }else{
   const row=await env.DB.prepare(select+' WHERE p.id=?').bind(ident(b.period_id)).first();if(!row)fail('Período inexistente.',404);
   if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision!==row.revision)fail('El período cambió. Actualizá antes de guardar.',409);
   statements.push(assertion(env,'EXISTS(SELECT 1 FROM partner_quota_periods WHERE id=? AND revision=?)',[row.id,row.revision]));
   if(b.action==='use'){
    fields(b,[...common,'period_id','expected_revision','sale_id','units','identity_evidence','reason']);
    const saleId=ident(b.sale_id),units=b.units,evidence=txt(b.identity_evidence,10,1500,'la confirmación de que la venta corresponde al entrenador'),reason=txt(b.reason,10,1500,'el motivo');
    if(!Number.isInteger(units)||units<1||units>4)fail('Ingresá entre 1 y 4 unidades enteras.');
    if(row.decision||today()<row.start_on||today()>=row.expires_on||row.used_units+units>4)fail('Período vencido, revisado o sin unidades suficientes.',409);
    const saleGuard=`EXISTS(SELECT 1 FROM sales s WHERE s.id=? AND s.sold_at>=? AND s.sold_at<? AND s.sold_at<=date('now','-3 hours') AND (${netUnits})>=?)`;
    if(!(await env.DB.prepare('SELECT '+saleGuard+' ok').bind(saleId,row.start_on,row.expires_on,units).first())?.ok)fail('La venta no corresponde al plazo o no tiene esas unidades netas.',409);
    statements.push(assertion(env,eligible,[row.partner_id,row.agreement_id]),assertion(env,"date('now','-3 hours')>=? AND date('now','-3 hours')<? AND NOT EXISTS(SELECT 1 FROM partner_quota_reviews WHERE period_id=?)",[row.start_on,row.expires_on,row.id]),assertion(env,'COALESCE((SELECT SUM(units) FROM partner_quota_movements WHERE period_id=?),0)+?<=4',[row.id,units]),assertion(env,saleGuard,[saleId,row.start_on,row.expires_on,units]),env.DB.prepare("INSERT INTO partner_quota_movements(id,period_id,kind,sale_id,units,reason,identity_evidence,actor) VALUES(?,?,'use',?,?,?,?,?)").bind(crypto.randomUUID(),row.id,saleId,units,reason,evidence,who));
   }else if(b.action==='reverse'){
    fields(b,[...common,'period_id','expected_revision','movement_id','reason','units']);
    const movement=await env.DB.prepare("SELECT * FROM partner_quota_movements WHERE id=? AND period_id=? AND kind='use'").bind(ident(b.movement_id),row.id).first();if(!movement)fail('Uso inexistente para este período.',404);
    const reason=txt(b.reason,10,1500,'el motivo de corrección'),units=b.units===undefined?movement.units:b.units;
    if(!Number.isInteger(units)||units<1||units>movement.units)fail('Revisá cuántas unidades querés corregir.');
    statements.push(assertion(env,'?+COALESCE((SELECT SUM(units) FROM partner_quota_movements WHERE reverses_id=?),0)>=?',[movement.units,movement.id,units]));
    statements.push(env.DB.prepare("INSERT INTO partner_quota_movements(id,period_id,kind,reverses_id,units,reason,identity_evidence,actor) VALUES(?,?,'reversal',?,?,?,'',?)").bind(crypto.randomUUID(),row.id,movement.id,-units,reason,who));
   }else if(b.action==='review'){
    fields(b,[...common,'period_id','expected_revision','decision','notes','agreement_id']);
    if(!['continue','pause','finish'].includes(b.decision))fail('Elegí continuar, pausar o finalizar.');
    if(row.decision||today()<row.expires_on)fail('La revisión se registra desde el vencimiento y una sola vez.',409);
    const notes=txt(b.notes,10,3000,'las notas de la revisión');
    statements.push(assertion(env,"date('now','-3 hours')>=? AND NOT EXISTS(SELECT 1 FROM partner_quota_reviews WHERE period_id=?)",[row.expires_on,row.id]),env.DB.prepare('INSERT INTO partner_quota_reviews(id,period_id,decision,notes,used_units_at_review,actor) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),row.id,b.decision,notes,row.used_units,who));
    if(b.decision==='continue'){
     const nextId=newPeriod(row.partner_id,ident(b.agreement_id),today(),row.id,'renewal',notes);
     result={id:row.id,next_period_id:nextId,partner_id:row.partner_id,benefits_enabled:false,mode:'simulation'};
    }else if(b.agreement_id!==undefined&&b.agreement_id!=='')fail('No hace falta un acuerdo para pausar o finalizar.');
   }else fail('Acción inválida.');
   statements.push(env.DB.prepare('UPDATE partner_quota_periods SET revision=revision+1 WHERE id=?').bind(row.id));
   result??={id:row.id,partner_id:row.partner_id,revision:row.revision+1,benefits_enabled:false,mode:'simulation'};
  }
  try{await env.DB.batch([accessGuard(env,a.actor,request),assertion(env,schemaReady),env.DB.prepare('INSERT INTO partner_quota_operations(operation_key,request_hash,actor,result_json) VALUES(?,?,?,?)').bind(key,hash,who,JSON.stringify(result)),...statements,env.DB.prepare('DELETE FROM management_assertions')])}
  catch(e){const cached=await replay();if(cached)return cached;if(/UNIQUE|CHECK constraint|immutable|FOREIGN KEY|conflict/i.test(String(e.message)))fail('Los datos cambiaron o esa venta, corrección o revisión ya está registrada. Actualizá y revisá.',409);throw e}
  return json(result,201);
 }catch(e){return errorResponse(e)}
}
