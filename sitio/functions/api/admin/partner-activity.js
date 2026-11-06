import {json} from '../_utils.js';
import {permitted} from './partners.js';
import {ready,txt,fail,errorResponse} from '../_partner-inquiries.js';
import {trafficReadiness} from '../partner-visits.js';
import {referralSelect,evaluate} from './partner-referrals.js';
// Lectura administrativa. No crea contactos, consultas, ventas ni recompensas.
export async function onRequestGet({request,env}){
 const denied=await ready(request,env);if(denied)return denied;
 const access=await permitted(request,env);if(access.denied)return access.denied;
 try{
  const params=new URL(request.url).searchParams;
  const id=txt(params.get('partner_id'),1,80,'el partner'),view=params.get('view')||'inquiries',after=txt(params.get('after')||'',0,80,'la página');
  if(!['inquiries','sales'].includes(view))fail('Vista inválida.');
  const queries=[
   env.DB.prepare(`SELECT p.id,p.code,p.status,p.program_id,c.name,c.status customer_status,
    EXISTS(SELECT 1 FROM partner_agreements a JOIN partner_program_versions v ON v.id=a.version_id
     WHERE a.partner_id=p.id AND a.status='confirmed' AND a.unresolved=0 AND v.program_id=p.program_id) has_agreement
    FROM partners p JOIN customers c ON c.id=p.customer_id WHERE p.id=?`).bind(id),
   env.DB.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(status='prepared'),0) prepared,COALESCE(SUM(status='received'),0) received,
    COALESCE(SUM(status='linked'),0) linked,COALESCE(SUM(status='rejected'),0) rejected,
    COALESCE(SUM(buyer_confirmed=0 AND status<>'rejected'),0) checkout_unconfirmed,
    COALESCE(SUM(status='linked' AND NOT EXISTS(SELECT 1 FROM partner_referral_heads h WHERE h.sale_id=i.sale_id)),0) linked_without_review,
    COALESCE(SUM(status='linked' AND EXISTS(SELECT 1 FROM partner_referral_heads h JOIN partner_referral_events e ON e.id=h.event_id WHERE h.sale_id=i.sale_id AND e.partner_id IS NOT NULL AND e.partner_id<>i.partner_id)),0) different_attribution
    FROM partner_inquiries i WHERE partner_id=?`).bind(id),
   env.DB.prepare(`SELECT COUNT(*) total FROM partner_referral_heads h JOIN partner_referral_events e ON e.id=h.event_id WHERE e.partner_id=?`).bind(id),
   view==='inquiries'
    ?env.DB.prepare('SELECT id,created_at,status,buyer_confirmed,sale_id FROM partner_inquiries WHERE partner_id=? AND id>? ORDER BY id LIMIT 31').bind(id,after)
    :env.DB.prepare(referralSelect+' WHERE e.partner_id=? AND s.id>? ORDER BY s.id LIMIT 31').bind(id,after)
  ];
  // Un solo batch de SELECT mantiene las cuentas y la página en la misma lectura.
  const result=await env.DB.batch(queries),partner=result[0].results[0];if(!partner)fail('Partner inexistente.',404);
  const eligible=partner.status==='active'&&partner.customer_status==='active'&&partner.program_id==='partners'&&!!partner.has_agreement&&/^[A-Z0-9][A-Z0-9-]{3,19}$/i.test(partner.code);
  const rows=result[3].results;
  let traffic={available:false,notice:'Medición de visitas sin habilitar o migración V169 pendiente.'};
  if(env.PARTNERS_TRAFFIC_V169==='true'){
   let schema=false;try{schema=!!(await env.DB.prepare('SELECT '+trafficReadiness+' AS ok').first())?.ok}catch{}
   if(schema){const stats=await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) total,COALESCE(SUM(date(created_at,'-3 hours')=date('now','-3 hours')),0) today,COALESCE(SUM(created_at>=datetime('now','-30 days')),0) last_30_days FROM partner_link_visits WHERE partner_id=?").bind(id),
    env.DB.prepare("SELECT date(created_at,'-3 hours') day,COUNT(*) visits FROM partner_link_visits WHERE partner_id=? AND date(created_at,'-3 hours')>=date('now','-3 hours','-13 days') GROUP BY day ORDER BY day DESC").bind(id)
   ]);traffic={available:true,...stats[0].results[0],daily:stats[1].results,timezone:'America/Argentina/Buenos_Aires',notice:'Visitas registradas, no personas únicas. Recargas en la misma pestaña se agrupan por 30 minutos. Pueden faltar visitas por bloqueadores o preferencias de privacidad; no prueba una recomendación ni una compra.'};}
  }
  return json({partner,link:{eligible,url:eligible?'https://one-more.com.ar/?partner='+encodeURIComponent(partner.code)+'#productos':null,
   notice:eligible?'Enlace del entrenador para compartir con compradores. El comprador debe confirmar la recomendación.':'Para usar el código se requiere partner y cliente activos, con acuerdo confirmado y completo.'},
   traffic,overview:{inquiries:result[1].results[0],manually_attributed_sales:result[2].results[0].total},view,
   items:rows.slice(0,30).map(r=>view==='sales'?evaluate(r):r),next:rows.length>30?(view==='sales'?rows[29].sale_id:rows[29].id):null,
   benefits_enabled:false,notice:'El código declarado y la atribución manual se cuentan por separado. Una consulta no es una venta; verificado no habilita beneficios.'});
 }catch(e){return errorResponse(e)}
}
