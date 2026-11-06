import {settlementDetails} from './_settlements.js';
import {json,check} from '../_utils.js';
export async function onRequestGet({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 const params=new URL(request.url).searchParams,type=params.get('type'),id=params.get('id')||'';
 if(!/^[\w-]{2,100}$/.test(id)||!['sale','purchase','stock'].includes(type))return json({error:'Referencia inválida'},400);
 try{
  if(type==='stock'){
   const [movements,adjustments]=await env.DB.batch([
    env.DB.prepare('SELECT id,delta,quantity_before,quantity_after,reason,created_at FROM stock_movements WHERE product_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(id),
    env.DB.prepare(`SELECT a.id,a.before_json,a.after_json,a.reason,a.created_at,COALESCE(u.name,CASE WHEN a.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) recorded_by FROM stock_change_audit a LEFT JOIN team_users u ON a.actor='user:'||u.id WHERE a.stock_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100`).bind(id)]);
   return json({movements:movements.results||[],adjustments:adjustments.results||[],limit:100});
  }
  const header=type==='sale'
   ? await env.DB.prepare('SELECT * FROM sales WHERE id=?').bind(id).first()
   : await env.DB.prepare('SELECT * FROM purchase_documents WHERE id=?').bind(id).first();
  if(!header)return json({error:'El registro no existe'},404);
  const lines=type==='sale'
   ?await env.DB.prepare('SELECT l.*,COALESCE((SELECT SUM(r.quantity) FROM active_sale_return_lines_v138 r WHERE r.sale_line_id=l.id),0) returned_quantity FROM sale_lines l WHERE sale_id=? ORDER BY rowid').bind(id).all()
   :await env.DB.prepare('SELECT l.*,COALESCE((SELECT SUM(r.quantity) FROM active_purchase_return_lines_v138 r WHERE r.purchase_line_id=l.id),0) returned_quantity,COALESCE((SELECT SUM(r.credit_cents) FROM active_purchase_return_lines_v138 r WHERE r.purchase_line_id=l.id),0) returned_credit_cents FROM purchase_lines l WHERE purchase_id=? ORDER BY rowid').bind(id).all();
  const author=await env.DB.prepare("SELECT COALESCE(u.name,CASE WHEN o.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) name FROM management_operations o LEFT JOIN team_users u ON o.actor='user:'||u.id WHERE o.kind=? AND json_extract(o.result_json,'$.id')=? LIMIT 1").bind(type,id).first();
  let returns=[],returnLines=[],returnTotals=null;
  if(type==='sale'){
   returns=(await env.DB.prepare("SELECT r.*,COALESCE(u.name,CASE WHEN r.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) recorded_by FROM sale_returns r LEFT JOIN team_users u ON r.actor='user:'||u.id WHERE r.sale_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 100").bind(id).all()).results||[];
   returnLines=(await env.DB.prepare('SELECT l.* FROM sale_return_lines l WHERE l.return_id IN (SELECT id FROM sale_returns WHERE sale_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100) ORDER BY l.rowid').bind(id).all()).results||[];
   returnTotals=await env.DB.prepare('SELECT COUNT(*) returns_count,COALESCE(SUM(refund_cents),0) refund_cents,COALESCE(SUM(cost_reversal_cents),0) cost_reversal_cents FROM active_sale_returns_v138 WHERE sale_id=?').bind(id).first();
  }
  let purchaseReturns=[],purchaseReturnLines=[],purchaseReturnTotals=null;
  if(type==='purchase'){
   purchaseReturns=(await env.DB.prepare("SELECT r.*,COALESCE(u.name,CASE WHEN r.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) recorded_by FROM purchase_returns r LEFT JOIN team_users u ON r.actor='user:'||u.id WHERE r.purchase_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 100").bind(id).all()).results||[];
   purchaseReturnLines=(await env.DB.prepare('SELECT l.* FROM purchase_return_lines l WHERE l.return_id IN (SELECT id FROM purchase_returns WHERE purchase_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100) ORDER BY l.rowid').bind(id).all()).results||[];
   purchaseReturnTotals=await env.DB.prepare('SELECT COUNT(*) returns_count,COALESCE(SUM(credit_cents),0) credit_cents,COALESCE(SUM(inventory_removed_cents),0) inventory_removed_cents FROM active_purchase_returns_v138 WHERE purchase_id=?').bind(id).first();
  }
  const reversals=(await env.DB.prepare("SELECT x.*,COALESCE(u.name,CASE WHEN x.actor='shared-admin' THEN 'Acceso compartido' ELSE 'Sin autor registrado' END) recorded_by FROM return_reversals x LEFT JOIN team_users u ON x.actor='user:'||u.id WHERE x.record_type=? AND x.record_id=? ORDER BY x.created_at DESC,x.rowid DESC").bind(type,id).all()).results||[];
  const combos=type==='sale'?(await env.DB.prepare('SELECT * FROM sale_combo_groups WHERE sale_id=? ORDER BY rowid').bind(id).all()).results:[];
  const settlements=await settlementDetails(env,type,id);
  return json({return_reversals:reversals,combo_groups:combos,settlements,purchase_returns:purchaseReturns,purchase_return_lines:purchaseReturnLines,purchase_return_totals:purchaseReturnTotals,returns,return_lines:returnLines,return_totals:returnTotals,returns_limit:100,header:{...header,recorded_by:author?.name||'Sin autor registrado'},lines:lines.results||[]});
 }catch{return json({error:'No se pudo consultar el historial. No se modificó ningún registro.'},503)}
}
