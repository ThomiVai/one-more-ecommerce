import {json,check} from '../_utils.js';
export async function onRequestGet({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 try{
  // Totales reales de todas las operaciones; no dependen de límites de las listas.
  const totals=await env.DB.prepare(`SELECT
   (SELECT COUNT(*) FROM sales) AS sales_count,
   (SELECT COALESCE(SUM(revenue_cents),0) FROM sales_activity_v135) AS revenue_cents,
   (SELECT COALESCE(SUM(cost_cents),0) FROM sales_activity_v135) AS sold_cost_cents,
   (SELECT COALESCE(SUM(refund_cents),0) FROM active_sale_returns_v138) AS refunded_cents,
   (SELECT COUNT(*) FROM sale_returns) AS returns_count,
   (SELECT COUNT(*) FROM purchase_documents) AS purchases_count,
   (SELECT COALESCE(SUM(amount_cents),0) FROM purchase_activity_v136) AS purchases_cents,
   (SELECT COALESCE(SUM(credit_cents),0) FROM active_purchase_returns_v138) AS purchase_credits_cents,
   (SELECT COUNT(*) FROM purchase_returns) AS purchase_returns_count,
   (SELECT COUNT(*) FROM orders WHERE status='pending') AS pending_count,
   (SELECT COALESCE(SUM(quantity),0) FROM stock_items) AS units,
   (SELECT COALESCE(SUM(quantity*cost_cents),0) FROM stock_items) AS inventory_cost_cents`).first();
  const money=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN record_type='sale' AND balance_cents>0 THEN balance_cents ELSE 0 END),0) sale_pending_cents,COALESCE(SUM(CASE WHEN record_type='purchase' AND balance_cents>0 THEN balance_cents ELSE 0 END),0) purchase_pending_cents,COALESCE(SUM(CASE WHEN record_type='sale' AND balance_cents<0 THEN -balance_cents ELSE 0 END),0) sale_refund_due_cents,COALESCE(SUM(CASE WHEN record_type='purchase' AND balance_cents<0 THEN -balance_cents ELSE 0 END),0) purchase_refund_due_cents FROM settlement_balances_v137").first();
  return json({money,totals,scope:'all_records',version:'v135'});
 }catch{return json({error:'No se pudo cargar el resumen. Actualizá para volver a intentar.'},503)}
}
