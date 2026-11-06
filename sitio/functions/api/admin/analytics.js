import {json,check} from '../_utils.js';
import {loadInventory} from '../_catalog.js';
const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export async function onRequestGet({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 const q=new URL(request.url).searchParams,from=q.get('from'),to=q.get('to');
 if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>365)return json({error:'Elegí un período válido de hasta 366 días.'},400);
 try{
  const [totals,daily,channels,top]=await env.DB.batch([
   env.DB.prepare('SELECT COALESCE(SUM(sales_count),0) sales_count,COALESCE(SUM(returns_count),0) returns_count,COALESCE(SUM(corrections_count),0) corrections_count,COALESCE(SUM(revenue_cents),0) revenue_cents,COALESCE(SUM(cost_cents),0) cost_cents,COALESCE(SUM(gross_revenue_cents),0) gross_revenue_cents,COALESCE(SUM(refund_cents),0) refund_cents,(SELECT COALESCE(SUM(units),0) FROM sale_item_activity_v135 WHERE day BETWEEN ? AND ?) units FROM sales_activity_v135 WHERE day BETWEEN ? AND ?').bind(from,to,from,to),
   env.DB.prepare('SELECT day,SUM(sales_count) sales_count,SUM(returns_count) returns_count,SUM(corrections_count) corrections_count,SUM(revenue_cents) revenue_cents,SUM(cost_cents) cost_cents FROM sales_activity_v135 WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day').bind(from,to),
   env.DB.prepare('SELECT channel,SUM(sales_count) sales_count,SUM(returns_count) returns_count,SUM(corrections_count) corrections_count,SUM(revenue_cents) revenue_cents FROM sales_activity_v135 WHERE day BETWEEN ? AND ? GROUP BY channel ORDER BY revenue_cents DESC').bind(from,to),
   env.DB.prepare('SELECT product_id,SUM(units) units,SUM(revenue_cents) revenue_cents,SUM(cost_cents) cost_cents FROM sale_item_activity_v135 WHERE day BETWEEN ? AND ? GROUP BY product_id HAVING SUM(units)>0 ORDER BY units DESC,revenue_cents DESC,product_id LIMIT 5').bind(from,to)
  ]);
  const state=await loadInventory(request,env);
  return json({from,to,totals:totals.results[0],daily:daily.results,channels:channels.results,top:top.results.map(r=>{const p=state.items.find(p=>p.physicalId===r.product_id);return {...r,label:p?[p.brand,p.name,p.size].filter(Boolean).join(' · '):r.product_id}}),scope:'all_recorded_sales_in_period',accounting:'sales_and_returns_by_own_date'});
 }catch{return json({error:'No se pudieron cargar las métricas. Verificá la migración V135 y volvé a intentar.'},503)}
}
