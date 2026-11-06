import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,request,seed,data} from './helpers.mjs';
import {onRequestGet as summary} from '../sitio/functions/api/admin/summary.js';
import {onRequestGet as details} from '../sitio/functions/api/admin/record-details.js';

test('resumen usa todas las ventas y no solamente las últimas cien',async()=>{
 const {db,env}=environment();
 for(let n=0;n<105;n++)db.prepare('INSERT INTO sales(id,reference,sold_at,channel,note,revenue_cents,cost_cents) VALUES(?,?,?,?,?,?,?)').run('sale-'+n,'REF-'+n,'2026-10-21','whatsapp','',1000,600);
 seed(db,data('products')[0].id,3,500);
 const r=await summary({env,request:request('/api/admin/summary')});assert.equal(r.status,200);const d=await r.json();assert.equal(d.totals.sales_count,105);assert.equal(d.totals.revenue_cents,105000);assert.equal(d.totals.sold_cost_cents,63000);assert.equal(d.totals.units,3);assert.equal(d.totals.inventory_cost_cents,1500);db.close();
});
test('historial por producto devuelve movimientos y correcciones de costo sin modificarlos',async()=>{
 const {db,env}=environment();const id=data('products')[0].id;seed(db,id,2,100);
 db.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').run('mov-test',id,2,0,2,'Carga histórica');
 const r=await details({env,request:request('/api/admin/record-details?type=stock&id='+id)});assert.equal(r.status,200);assert.equal((await r.json()).movements[0].delta,2);assert.equal(db.prepare('SELECT quantity FROM stock_items').get().quantity,2);db.close();
});
test('detalle de venta conserva el costo histórico original',async()=>{
 const {db,env}=environment();db.prepare('INSERT INTO sales(id,reference,sold_at,channel,note,revenue_cents,cost_cents) VALUES(?,?,?,?,?,?,?)').run('sale-detail','DETALLE','2026-10-21','web','',5000,2000);
 db.prepare('INSERT INTO sale_lines(id,sale_id,product_id,quantity,unit_price_cents,unit_cost_cents) VALUES(?,?,?,?,?,?)').run('line-test','sale-detail','old-id',1,5000,2000);
 const r=await details({env,request:request('/api/admin/record-details?type=sale&id=sale-detail')});const d=await r.json();assert.equal(d.header.cost_cents,2000);assert.equal(d.lines[0].product_id,'old-id');db.close();
});
test('consultas nuevas requieren sesión y rechazan referencias inválidas',async()=>{
 const {db,env}=environment();assert.equal((await summary({env,request:new Request('https://one-more-suplementos.pages.dev/api/admin/summary')})).status,401);
 assert.equal((await details({env,request:request('/api/admin/record-details?type=sale&id=x%27')})).status,400);
 assert.equal((await details({env,request:request('/api/admin/record-details?type=sale&id=missing-id')})).status,404);db.close();
});
