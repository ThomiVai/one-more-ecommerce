import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {environment,request,seed,balance,count,root} from './helpers.mjs';
import {onRequestPost as create} from '../sitio/functions/api/admin/product-variant.js';
import {onRequestGet as analytics} from '../sitio/functions/api/admin/analytics.js';
import {loadCatalog,loadInventory,publicCatalog} from '../sitio/functions/api/_catalog.js';
const sid='inventory-star-platinum-whey-2lb-vainilla';
const body=()=>({stock_id:sid,parent_id:'bulk-star-24',confirmed:true,price:94900,status:'published',image_url:'/images/test.webp',operation_key:crypto.randomUUID()});
function setup(){const e=environment();seed(e.db,sid,1,6500000);e.db.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').run('old-movement',sid,1,0,1,'Compra histórica');return e}
test('sabor STAR creado y vinculado conserva SKU, saldo, costo e historial; reintento sin duplicados',async()=>{
 const {db,env}=setup(),b=body(),r=await create({env,request:request('/api/admin/product-variant',b)});assert.equal(r.status,201);const result=await r.json();
 assert.equal(balance(db,sid).quantity,1);assert.equal(balance(db,sid).cost_cents,6500000);assert.equal(count(db,'stock_items'),1);assert.equal(count(db,'stock_movements'),1);assert.equal(count(db,'stock_link_audit'),1);
 const cat=await loadCatalog(request('/'),env),parent=cat.items.find(p=>p.id==='bulk-star-24'),child=cat.items.find(p=>p.id===result.id);assert.equal(parent.variantGroup,child.variantGroup);assert.equal(child.packaging,'POTE');assert.equal(child.size,'910 g · Vainilla');
 const state=await loadInventory(request('/'),env);assert.equal(state.items.filter(p=>p.physicalId===sid).length,1);assert.equal(publicCatalog(cat.items).some(p=>p.id===result.id),true);
 const retry=await create({env,request:request('/api/admin/product-variant',b)});assert.equal((await retry.json()).replayed,true);assert.equal(count(db,'catalog_new_products'),1);db.close();
});
test('creación concurrente y errores no dejan fichas ni vínculos parciales',async()=>{
 const {db,env}=setup();env.DB.pauseStockReads(2);const results=await Promise.all([body(),body()].map(b=>create({env,request:request('/api/admin/product-variant',b)})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(count(db,'catalog_new_products'),1);assert.equal(count(db,'catalog_stock_links'),1);assert.equal(balance(db,sid).quantity,1);db.close();
 const e=setup();e.env.DB.beforeBatch=db=>db.prepare('UPDATE stock_items SET quantity=2 WHERE product_id=?').run(sid);assert.equal((await create({env:e.env,request:request('/api/admin/product-variant',body())})).status,409);assert.equal(count(e.db,'catalog_new_products'),0);assert.equal(count(e.db,'catalog_stock_links'),0);assert.equal(balance(e.db,sid).quantity,2);e.db.close();
});
test('presentación distinta, falta de foto, producto con ficha y duplicados se rechazan',async()=>{
 const {db,env}=setup();for(const patch of [{parent_id:'bulk-star-29'},{parent_id:'star-whey-doy-va'},{image_url:''},{confirmed:false},{stock_id:'bulk-star-24'}])assert.ok((await create({env,request:request('/api/admin/product-variant',{...body(),...patch})})).status>=400);
 assert.equal(count(db,'catalog_new_products'),0);const r=await create({env,request:request('/api/admin/product-variant',body())});const id=(await r.json()).id;db.prepare('DELETE FROM catalog_stock_links').run();assert.equal((await create({env,request:request('/api/admin/product-variant',body())})).status,409);assert.equal(count(db,'catalog_new_products'),1);assert.ok(id);db.close();
});
test('tienda agrupa un sabor nuevo en una sola tarjeta y conserva sabores si la cabecera está oculta',async()=>{
 const {db,env}=setup();const r=await create({env,request:request('/api/admin/product-variant',body())}),id=(await r.json()).id;
 const items=publicCatalog((await loadCatalog(request('/'),env)).items),src=readFileSync(root+'assets/index-onemore-v109-official.js','utf8'),a=src.indexOf('const omDynamicFlavorGroups'),b=src.indexOf('const omCategoryOrder',a),groupCode=src.slice(a,b);
 let result=vm.runInNewContext('const vs='+JSON.stringify(items)+';const omFlavorGroups=[];'+groupCode+';omCatalog');const family=result.filter(p=>p.id==='bulk-star-24'||p.id===id);assert.equal(family.length,1);assert.equal(family[0].variants.length,2);
 result=vm.runInNewContext('const vs='+JSON.stringify(items.filter(p=>p.id!=='bulk-star-24'))+';const omFlavorGroups=[["bulk-star-24",'+JSON.stringify(id)+']];'+groupCode+';omCatalog');assert.equal(result.some(p=>p.id===id),true);db.close();
});
test('métricas incluyen más de cien ventas, filtran fechas y conservan costos históricos',async()=>{
 const {db,env}=environment();for(let n=0;n<105;n++){db.prepare('INSERT INTO sales(id,reference,sold_at,channel,revenue_cents,cost_cents) VALUES(?,?,?,?,?,?)').run('s-'+n,'R-'+n,'2026-10-21',n%2?'web':'whatsapp',1000,600);db.prepare('INSERT INTO sale_lines(id,sale_id,product_id,quantity,unit_price_cents,unit_cost_cents) VALUES(?,?,?,?,?,?)').run('l-'+n,'s-'+n,sid,1,1000,600)}
 db.prepare('INSERT INTO sales(id,reference,sold_at,channel,revenue_cents,cost_cents) VALUES(?,?,?,?,?,?)').run('old-sale','OLD','2025-01-01','web',5000,2000);
 const r=await analytics({env,request:request('/api/admin/analytics?from=2026-10-01&to=2026-10-31')}),d=await r.json();assert.equal(r.status,200);assert.equal(d.totals.sales_count,105);assert.equal(d.totals.revenue_cents,105000);assert.equal(d.totals.cost_cents,63000);assert.equal(d.totals.units,105);assert.equal(d.top[0].units,105);assert.equal(d.channels.reduce((s,x)=>s+x.revenue_cents,0),105000);assert.equal(d.daily.length,1);
 const empty=await (await analytics({env,request:request('/api/admin/analytics?from=2026-09-01&to=2026-09-30')})).json();assert.equal(empty.totals.sales_count,0);assert.deepEqual(empty.daily,[]);assert.equal(count(db,'sales'),106);db.close();
});
test('consultas y altas requieren autenticación y escritura solo en preproducción',async()=>{
 const {db,env}=setup();assert.equal((await analytics({env,request:new Request('https://one-more-suplementos.pages.dev/api/admin/analytics?from=2026-10-01&to=2026-10-31')})).status,401);
 for(const q of ['from=2026-02-30&to=2026-03-01','from=2026-11-01&to=2026-10-01','from=2020-01-01&to=2026-10-31'])assert.equal((await analytics({env,request:request('/api/admin/analytics?'+q)})).status,400);
 assert.equal((await create({env,request:request('/api/admin/product-variant',body(),'one-more-preproduccion.pages.dev')})).status,403);assert.equal(count(db,'catalog_new_products'),0);db.close();
});
