import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,read,data,request,sale,purchase,seed,balance,count} from './helpers.mjs';
import {onRequestPost as sell} from '../sitio/functions/api/admin/sales.js';
import {onRequestPost as buy} from '../sitio/functions/api/admin/purchases.js';
import {onRequestGet as inventory,onRequestPost as adjust} from '../sitio/functions/api/admin/own-stock.js';
import {onRequestGet as catalog,onRequestPost as edit,onRequestPut as create} from '../sitio/functions/api/admin/catalog.js';
import {onRequestPost as link} from '../sitio/functions/api/admin/stock-links.js';
import {onRequestPost as archive} from '../sitio/functions/api/admin/inventory-archive.js';
import {onRequestGet as storefront} from '../sitio/functions/api/storefront-preview.js';
import {onRequestGet as publicApi} from '../sitio/functions/api/catalog.js';
import {onRequestPost as webOrder} from '../sitio/functions/api/web-orders.js';
import {matchInfo} from '../sitio/functions/api/admin/_matching.js';
import {loadInventory} from '../sitio/functions/api/_catalog.js';
const gid='inventory-gold-whey-910',fr='gold-whey-2lb-fr',ch='gold-whey-2lb-ch',direct=data('products')[0].id;
const post=(handler,env,path,b,host)=>handler({env,request:request(path,b,host)});
const setupGold=db=>{seed(db,gid,1,6083500);db.prepare('INSERT INTO catalog_stock_links(catalog_id,stock_id) VALUES(?,?)').run(fr,gid)};

test('migración aditiva y repetible conserva stock y movimientos',()=>{
 const {db}=environment();seed(db,direct,3,500);db.prepare('INSERT INTO stock_movements(id,product_id,delta,quantity_before,quantity_after,reason) VALUES(?,?,?,?,?,?)').run('old',direct,3,0,3,'histórico');
 db.exec(read('schema-v129.sql'));db.exec(read('schema-v129.sql'));assert.equal(balance(db,direct).quantity,3);assert.equal(count(db,'stock_movements'),1);db.close();
});
test('GOLD cuatro variantes, una unidad en Frutilla, costo solo en el SKU real',async()=>{
 const {db,env}=environment();setupGold(db);const res=await inventory({env,request:request('/api/admin/own-stock')});assert.equal(res.status,200);const d=await res.json(),rows=d.variants.filter(p=>p.id.startsWith('gold-whey-'));
 assert.equal(rows.length,4);assert.equal(rows.reduce((n,p)=>n+p.quantity,0),1);assert.equal(rows.find(p=>p.id===fr).cost_cents,6083500);assert.ok(rows.filter(p=>p.id!==fr).every(p=>p.quantity===0&&p.cost_cents===null));assert.equal(d.total_units,1);assert.equal(d.variants.filter(p=>p.physicalId===gid).length,1);db.close();
});
test('SKU histórico sin JSON permanece visible y contado',async()=>{
 const {db,env}=environment();seed(db,'unknown-history',4,12);const state=await loadInventory(request('/'),env);assert.equal(state.total_units,4);assert.ok(state.items.find(p=>p.physicalId==='unknown-history'&&p.needsIdentification));db.close();
});
test('GOLD editable: precio e imagen se propagan a todas las lecturas',async()=>{
 const {db,env}=environment();setupGold(db);const b={id:fr,name:'100% Whey Protein',brand:'GOLD NUTRITION',size:'2 lb · Frutilla',price:75000,status:'published',image_url:'/images/new.webp',description:'Descripción'};
 assert.equal((await post(edit,env,'/api/admin/catalog',b)).status,200);
 const a=await (await catalog({env,request:request('/api/admin/catalog')})).json();
 const p=await (await publicApi({env,request:request('/api/catalog')})).json();
 const s=await (await storefront({env,request:request('/api/storefront-preview')})).json();
 const i=await (await inventory({env,request:request('/api/admin/own-stock')})).json();
 for(const rows of [a.items,p.products,s.items,i.variants]){const row=rows.find(p=>p.id===fr);assert.equal(row.price,75000);assert.equal(row.catalogImage,'/images/new.webp')}
 assert.equal(balance(db,gid).cost_cents,6083500);db.close();
});
test('ocultar variante la quita de ambas APIs públicas y preserva existencia administrativa',async()=>{
 const {db,env}=environment();setupGold(db);
 const b={id:fr,name:'100% Whey Protein',brand:'GOLD NUTRITION',size:'2 lb · Frutilla',price:71900,status:'hidden',image_url:'',description:''};await post(edit,env,'/api/admin/catalog',b);
 const p=await (await publicApi({env,request:request('/api/catalog')})).json();const s=await (await storefront({env,request:request('/api/storefront-preview')})).json();const i=await (await inventory({env,request:request('/api/admin/own-stock')})).json();
 assert.ok(!p.products.some(x=>x.id===fr));assert.ok(!s.items.some(x=>x.id===fr));assert.equal(i.variants.find(x=>x.id===fr).quantity,1);db.close();
});
test('venta por ID comercial descuenta el SKU GOLD histórico y conserva costo real',async()=>{
 const {db,env}=environment();setupGold(db);const res=await post(sell,env,'/api/admin/sales',sale(fr,'SALE-GOLD'));assert.equal(res.status,201);const d=await res.json();assert.equal(d.cost_cents,6083500);assert.equal(balance(db,gid).quantity,0);assert.equal(db.prepare('SELECT product_id FROM sale_lines').get().product_id,gid);db.close();
});
test('compra por ID comercial suma al SKU vinculado, con costo promedio y sin duplicados',async()=>{
 const {db,env}=environment();setupGold(db);const res=await post(buy,env,'/api/admin/purchases',purchase(fr,'BUY-GOLD',1,5000000));assert.equal(res.status,200);assert.equal(balance(db,gid).quantity,2);assert.equal(balance(db,gid).cost_cents,5541750);assert.equal(count(db,'stock_items'),1);assert.equal(db.prepare('SELECT product_id FROM purchase_lines').get().product_id,gid);db.close();
});
test('dos ventas concurrentes sobre una unidad: una confirma y la otra se revierte entera',async()=>{
 const {db,env}=environment();seed(db,direct);const rs=await Promise.all(['A','B'].map(ref=>post(sell,env,'/api/admin/sales',sale(direct,ref))));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
 assert.equal(count(db,'sales'),1);assert.equal(count(db,'sale_lines'),1);assert.equal(count(db,'management_operations'),1);assert.equal(count(db,'stock_movements'),1);assert.equal(balance(db,direct).quantity,0);assert.equal(count(db,'management_assertions'),0);db.close();
});
test('dos compras concurrentes: conflicto recuperable sin perder unidades',async()=>{
 const {db,env}=environment();env.DB.pauseStockReads(2);const bodies=['A','B'].map(n=>purchase(direct,n));const rs=await Promise.all(bodies.map(b=>post(buy,env,'/api/admin/purchases',b)));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
 const failed=rs.findIndex(r=>r.status===409);assert.equal((await post(buy,env,'/api/admin/purchases',bodies[failed])).status,200);
 assert.equal(balance(db,direct).quantity,2);assert.equal(count(db,'purchase_documents'),2);assert.equal(count(db,'stock_movements'),2);db.close();
});
test('venta y compra concurrentes no pisan saldo ni costo',async()=>{
 const {db,env}=environment();seed(db,direct,1,100);const sb=sale(direct,'MIXED'),pb=purchase(direct,'MIXED',1,200);
 env.DB.pauseStockReads(2);const rs=await Promise.all([post(sell,env,'/api/admin/sales',sb),post(buy,env,'/api/admin/purchases',pb)]);assert.equal(rs.filter(r=>r.status===409).length,1);
 if(rs[0].status===409)await post(sell,env,'/api/admin/sales',sb);else await post(buy,env,'/api/admin/purchases',pb);
 assert.equal(balance(db,direct).quantity,1);assert.equal(count(db,'sales'),1);assert.equal(count(db,'purchase_documents'),1);db.close();
});
test('reintento de venta es idempotente y clave reutilizada con otros datos se rechaza',async()=>{
 const {db,env}=environment();seed(db,direct,3);const body=sale(direct,'RETRY');await post(sell,env,'/api/admin/sales',body);
 const res=await post(sell,env,'/api/admin/sales',body);assert.equal(res.status,200);assert.equal((await res.json()).replayed,true);
 assert.equal((await post(sell,env,'/api/admin/sales',{...body,note:'otro contenido'})).status,409);assert.equal(balance(db,direct).quantity,2);assert.equal(count(db,'sales'),1);db.close();
});
test('doble clic concurrente con misma referencia registra exactamente una venta',async()=>{
 const {db,env}=environment();seed(db,direct,2);const body=sale(direct,'DOUBLE');const rs=await Promise.all([post(sell,env,'/api/admin/sales',body),post(sell,env,'/api/admin/sales',body)]);assert.ok(rs.every(r=>[200,201].includes(r.status)));assert.equal(count(db,'sales'),1);assert.equal(balance(db,direct).quantity,1);db.close();
});
test('reintento de compra no suma otra vez',async()=>{
 const {db,env}=environment();const body=purchase(direct,'RETRY');await post(buy,env,'/api/admin/purchases',body);const res=await post(buy,env,'/api/admin/purchases',body);assert.equal((await res.json()).replayed,true);assert.equal(balance(db,direct).quantity,1);assert.equal(count(db,'purchase_documents'),1);db.close();
});
test('IDs comercial y físico del mismo SKU no se pueden vender dos veces en una venta',async()=>{
 const {db,env}=environment();setupGold(db);const b=sale(fr,'ALIAS');b.lines.push({...b.lines[0],product_id:gid});const res=await post(sell,env,'/api/admin/sales',b);assert.equal(res.status,400);assert.equal(count(db,'sales'),0);assert.equal(balance(db,gid).quantity,1);db.close();
});
test('SKU genérico sin sabor requiere confirmación y variante sin SKU no inventa mercadería',async()=>{
 const {db,env}=environment();seed(db,gid);
 assert.equal((await post(buy,env,'/api/admin/purchases',purchase(gid,'UNKNOWN'))).status,409);
 assert.equal((await post(buy,env,'/api/admin/purchases',purchase(ch,'NEW-FLAVOR'))).status,409);
 assert.equal(count(db,'purchase_documents'),0);assert.equal(count(db,'stock_items'),1);db.close();
});
test('ajuste con versión vieja falla y cambio de costo queda auditado sin inventar movimiento',async()=>{
 const {db,env}=environment();seed(db,direct,2,100);
 const b={product_id:direct,quantity:2,cost_cents:200,min_quantity:1,reason:'Corrección costo',expected_revision:0,operation_key:'adjust-A'};
 assert.equal((await post(adjust,env,'/api/admin/own-stock',b)).status,200);assert.equal(count(db,'stock_change_audit'),1);assert.equal(count(db,'stock_movements'),0);
 assert.equal((await post(adjust,env,'/api/admin/own-stock',{...b,quantity:1,operation_key:'adjust-B'})).status,409);assert.equal(balance(db,direct).quantity,2);db.close();
});
test('rollback de varias líneas cuando otro socio cambia un saldo antes del batch',async()=>{
 const {db,env}=environment();const second=data('products')[1].id;seed(db,direct,2);seed(db,second,2);
 env.DB.beforeBatch=db=>db.prepare('UPDATE stock_items SET cost_cents=300 WHERE product_id=?').run(second);
 const b=sale(direct,'MULTI');b.lines.push({...b.lines[0],product_id:second});const r=await post(sell,env,'/api/admin/sales',b);
 assert.equal(r.status,409);assert.equal(balance(db,direct).quantity,2);assert.equal(balance(db,second).quantity,2);assert.equal(count(db,'sale_lines'),0);assert.equal(count(db,'sales'),0);assert.equal(count(db,'management_operations'),0);db.close();
});
test('pedido cancelado en paralelo no se convierte en venta',async()=>{
 const {db,env}=environment();seed(db,direct);const oid=crypto.randomUUID();db.prepare('INSERT INTO orders(id,source,customer_name,customer_phone,total_cents,note,items_json) VALUES(?,?,?,?,?,?,?)').run(oid,'web','','',0,'','[]');
 env.DB.beforeBatch=db=>db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(oid);
 const res=await post(sell,env,'/api/admin/sales',{...sale(direct,'ORDER-RACE'),order_id:oid});assert.equal(res.status,409);assert.equal(balance(db,direct).quantity,1);assert.equal(count(db,'sales'),0);db.close();
});
test('WhatsApp registra solicitud sin descontar ni registrar venta',async()=>{
 const {db,env}=environment();seed(db,direct,2);const res=await post(webOrder,env,'/api/web-orders',{summary:'ONE MORE - Solicitud de compra para coordinar por WhatsApp'});assert.equal(res.status,201);assert.equal(balance(db,direct).quantity,2);assert.equal(count(db,'sales'),0);assert.equal(count(db,'stock_movements'),0);db.close();
});
test('producción rechazada por handlers de escritura nuevos',async()=>{
 const {db,env}=environment();seed(db,direct);
 const res=await post(sell,env,'/api/admin/sales',sale(direct,'PROD'),'one-more-preproduccion.pages.dev');assert.equal(res.status,403);assert.equal(count(db,'sales'),0);db.close();
});
test('matching: 0.25 kg coincide con 250 g; sabores y envases diferentes se rechazan',()=>{
 const p={id:'sample',brand:'STAR',name:'Creatina',size:'250 g · Neutro · Pote'};
 assert.equal(matchInfo({...p,size:'0.25 kg · Neutro · Pote'},p).ok,true);
 assert.equal(matchInfo({...p,size:'250 g · Uva · Pote'},p).ok,false);
 assert.equal(matchInfo({...p,size:'250 g · Neutro · Doypack'},p).ok,false);
});
test('vinculación GOLD explícita conserva unidades y audita enlace y reversión',async()=>{
 const {db,env}=environment();seed(db,gid,1,6083500);
 const b={catalog_id:fr,stock_id:gid,action:'resolve-flavor',confirmed_flavor:'frutilla'};
 assert.equal((await post(link,env,'/api/admin/stock-links',b)).status,200);assert.equal(count(db,'stock_link_audit'),1);assert.equal(balance(db,gid).quantity,1);
 assert.equal((await post(link,env,'/api/admin/stock-links',{catalog_id:fr,action:'unlink'})).status,200);assert.equal(count(db,'stock_link_audit'),2);assert.equal(count(db,'stock_movements'),0);db.close();
});
test('archivar no permite ocultar unidades y admite restauración',async()=>{
 const {db,env}=environment();seed(db,direct,1);
 const b={product_id:direct,action:'archive',operation_key:'arc-1'};assert.equal((await post(archive,env,'/api/admin/inventory-archive',b)).status,409);
 db.prepare('UPDATE stock_items SET quantity=0 WHERE product_id=?').run(direct);
 assert.equal((await post(archive,env,'/api/admin/inventory-archive',b)).status,200);
 assert.equal((await post(archive,env,'/api/admin/inventory-archive',{...b,action:'restore',operation_key:'arc-2'})).status,200);assert.equal(count(db,'inventory_archived'),0);db.close();
});
test('nueva ficha comercial no duplica variante exacta existente',async()=>{
 const {db,env}=environment();const b={name:'100% Whey Protein',brand:'GOLD NUTRITION',size:'2 lb · Frutilla',price:71900,group_id:'gold-whey',category:'Proteína'};
 assert.equal((await create({env,request:request('/api/admin/catalog',b)})).status,409);assert.equal(count(db,'catalog_new_products'),0);db.close();
});

test('dos altas simultáneas de una variante crean una sola ficha comercial',async()=>{
 const {db,env}=environment();const b={name:'Producto de prueba',brand:'MARCA QA',size:'300 g · Neutro',price:123,group_id:'qa-family',category:'Creatina'};
 const rs=await Promise.all([create({env,request:request('/api/admin/catalog',b)}),create({env,request:request('/api/admin/catalog',b)})]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(count(db,'catalog_new_products'),1);assert.equal(count(db,'stock_items'),0);db.close();
});
test('identidad vinculada no puede cambiar de sabor mediante edición comercial',async()=>{
 const {db,env}=environment();setupGold(db);
 const res=await post(edit,env,'/api/admin/catalog',{id:fr,name:'100% Whey Protein',brand:'GOLD NUTRITION',size:'2 lb · Chocolate',price:71900,status:'published',image_url:'',description:''});assert.equal(res.status,409);assert.equal(balance(db,gid).quantity,1);db.close();
});
