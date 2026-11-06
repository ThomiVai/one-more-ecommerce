import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {environment,seed,sale,request as shared,count} from './helpers.mjs';
import {sessionHash} from '../sitio/functions/api/_access.js';
import {onRequestGet as get,onRequestPost as post} from '../sitio/functions/api/admin/partner-referrals.js';
import {onRequestPost as partners} from '../sitio/functions/api/admin/partners.js';
import {onRequestPost as sell} from '../sitio/functions/api/admin/sales.js';
import {onRequestPost as settle} from '../sitio/functions/api/admin/settlements.js';
import {onRequestPost as giveBack} from '../sitio/functions/api/admin/sale-returns.js';
import {onRequestPost as undoReturn,onRequestGet as getUndoReturn} from '../sitio/functions/api/admin/return-reversals.js';
import {onRequestPost as undoSettlement} from '../sitio/functions/api/admin/settlement-reversals.js';
const migration=readFileSync(new URL('../schema-v142-referrals-production.sql',import.meta.url),'utf8');
const host='one-more-suplementos.pages.dev',path='/api/admin/partner-referrals';
function req(e,url=path,b,extra={}){return new Request('https://'+host+url,{method:b===undefined?'GET':'POST',headers:{cookie:e.cookie,origin:'https://'+host,'content-type':'application/json',...extra},body:b===undefined?undefined:JSON.stringify(b)});}
async function decode(r){return {status:r.status,...await r.json()};}
const send=(e,b)=>post({env:e.env,request:req(e,path,b)}).then(decode);
const query=(e,search='')=>get({env:e.env,request:req(e,path+search)}).then(decode);
const cmd=(e,b)=>partners({env:e.env,request:req(e,'/api/admin/partners',{operation_key:crypto.randomUUID(),...b})}).then(decode);
async function user(e,id='admin',role='admin'){
 const token=(id==='admin'?'a':'b').repeat(43);e.db.prepare('INSERT INTO team_users(id,username,name,role,key_hash) VALUES(?,?,?,?,?)').run(id,id,id,role,'qa');
 e.db.prepare('INSERT INTO team_sessions(token_hash,user_id,revision,expires_at) VALUES(?,?,0,?)').run(await sessionHash(token),id,Date.now()+1000000);e.cookie='om_admin=v2.'+token;
}
async function customer(e,name,contact=true){return cmd(e,{action:'customer-create',name,...contact?{contact_kind:'phone',contact_value:'+54911'+String(++e.phone).padStart(8,'0'),contact_confirmed:true}:{}});}
async function newSale(e,reference='VENTA-QA',quantity=2,date='2026-10-21'){
 const b=sale('bulk-star-24',reference,quantity);b.sold_at=date;b.lines[0].unit_price_cents=500;
 const r=await sell({env:e.env,request:shared('/api/admin/sales',b)});const result=await decode(r);assert.equal(result.status,201,JSON.stringify(result));return result.id;
}
const balance=(e,id)=>e.db.prepare("SELECT * FROM settlement_balances_v137 WHERE record_type='sale' AND record_id=?").get(id);
async function pay(e,id,amount,direction='payment'){
 const b=balance(e,id);const r=await decode(await settle({env:e.env,request:shared('/api/admin/settlements',{record_type:'sale',record_id:id,direction,amount_cents:amount,paid_at:'2026-10-25',method:'transfer',reference:'QA',note:'Prueba de integración local',operation_key:crypto.randomUUID(),expected_revision:b.revision,expected_balance_cents:b.balance_cents})}));assert.equal(r.status,201,JSON.stringify(r));return r;
}
async function setup(role='admin'){
 const e=environment();e.db.exec(migration);e.env.PARTNERS_PHASE1='true';e.phone=0;await user(e,'admin',role);seed(e.db,'bulk-star-24',200,100);
 if(role==='admin'){
  e.owner=await customer(e,'Partner QA');e.customer=await customer(e,'Comprador QA');
  e.partner=await cmd(e,{action:'partner-create',customer_id:e.owner.id,code:'REF-QA'});
  const a=await cmd(e,{action:'agreement-create',partner_id:e.partner.id,kind:'pilot',terms:'Acuerdo completo de prueba sin beneficios automáticos.',unresolved:false});
  await cmd(e,{action:'agreement-confirm',id:a.id,expected_revision:0,confirmed:true});await cmd(e,{action:'partner-update',id:e.partner.id,expected_revision:0,status:'active'});
  e.saleId=await newSale(e);
 }
 return e;
}
function body(e,more={}){
 const h=e.db.prepare('SELECT revision FROM partner_referral_heads WHERE sale_id=?').get(e.saleId);
 return {operation_key:crypto.randomUUID(),sale_id:e.saleId,expected_revision:h?.revision??-1,expected_sale_revision:balance(e,e.saleId).revision,
 customer_id:e.customer.id,partner_id:e.partner.id,customer_kind:'new',identity_verified:true,identity_evidence:'Comprador confirmó contacto y revisamos compras y conversaciones previas sin compras anteriores.',
 attribution_evidence:'El comprador confirmó que vino por REF-QA por WhatsApp.',delivered:true,delivered_at:'2026-10-25',delivery_evidence:'El comprador confirmó recepción por WhatsApp.',variable_costs_complete:true,variable_costs_cents:50,costs_evidence:'Comisión 30 y embalaje 20; sin envío a cargo del negocio.',reason:'Primera vinculación y revisión manual de prueba.',...more};
}
async function item(e,id=e.saleId){const d=await query(e,'?mode=detail&id='+id);assert.equal(d.status,200,JSON.stringify(d));return d.item;}
const snapshot=e=>Object.fromEntries(['sales','sale_lines','sale_combo_groups','stock_items','stock_movements','purchase_documents','purchase_lines','settlements','cash_entries','team_users','catalog_overrides','sale_returns','sale_return_lines'].map(t=>[t,e.db.prepare('SELECT * FROM '+t).all()]));
test('V142 aditiva repetible conserva todas las tablas previas y beneficios desactivados',()=>{
 const e=environment();try{const tables=e.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all();const snap=()=>Object.fromEntries(tables.map(t=>[t.name,e.db.prepare('SELECT * FROM "'+t.name+'"').all()]));const before=snap();e.db.exec(migration);e.db.exec(migration);assert.deepEqual(snap(),before);assert.equal(e.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(e.db.prepare('SELECT benefits_enabled FROM partner_programs').get().benefits_enabled,0);}finally{e.db.close();}
});
test('V142 rechaza marca oficial antes de crear sus tablas',()=>{
 const e=environment({partners:false});try{e.db.exec("CREATE TABLE deployment_identity(id INTEGER,database_id TEXT,project TEXT);INSERT INTO deployment_identity VALUES(1,'oficial','one-more-preproduccion');CREATE TABLE partners_schema(id INTEGER,version INTEGER);INSERT INTO partners_schema VALUES(1,141);CREATE TABLE partner_programs(id TEXT,benefits_enabled INTEGER);INSERT INTO partner_programs VALUES('partners',0)");assert.throws(()=>e.db.exec(migration));assert.equal(e.db.prepare("SELECT name FROM sqlite_master WHERE name='partner_referral_events'").get(),undefined);}finally{e.db.close();}
});
test('API exige migración, bandera, usuario personal administrador y host staging',async()=>{
 const e=await setup();try{e.env.PARTNERS_PHASE1='false';assert.equal((await query(e)).status,503);e.env.PARTNERS_PHASE1='true';
 assert.equal((await get({env:e.env,request:shared(path)})).status,403);
 assert.equal((await get({env:e.env,request:new Request('https://one-more-preproduccion.pages.dev'+path)})).status,403);
 assert.equal((await get({env:e.env,request:new Request('https://one-more-suplementos.pages.dev'+path)})).status,401);
 e.db.exec('DROP TABLE partner_referrals_schema');assert.equal((await query(e)).status,503);
 }finally{e.db.close();}
 const op=await setup('operator');try{assert.equal((await query(op)).status,403);assert.equal((await send(op,{})).status,403);}finally{op.db.close();}
});
test('vincula venta existente sin recrearla ni afectar stock, caja, precios o autores históricos',async()=>{
 const e=await setup();try{const before=snapshot(e);assert.equal((await send(e,body(e))).status,201);assert.deepEqual(snapshot(e),before);assert.equal(count(e.db,'partner_referral_events'),1);assert.equal(e.db.prepare('SELECT actor FROM partner_referral_events').get().actor,'user:admin');assert.equal((await item(e)).review_status,'pending');}finally{e.db.close();}
});
test('venta cobrada, entregada, nueva y con costos completos se verifica sin conceder beneficio',async()=>{
 const e=await setup();try{assert.equal((await pay(e,e.saleId,1000)).status,201);assert.equal((await send(e,body(e))).status,201);const r=await item(e);assert.equal(r.review_status,'verified');assert.deepEqual(r.reasons,[]);assert.equal(r.contribution_cents,750);assert.equal(r.benefits_enabled,false);assert.equal(e.db.prepare('SELECT benefits_enabled FROM partner_programs').get().benefits_enabled,0);}finally{e.db.close();}
});
test('pedido/consulta no se puede vincular como venta y no mueve stock',async()=>{
 const e=await setup();try{const before=snapshot(e);assert.equal((await send(e,body(e,{sale_id:'consulta-por-whatsapp'}))).status,404);assert.deepEqual(snapshot(e),before);}finally{e.db.close();}
});
test('cobro parcial o ausente no se infiere de una entrega ni de una venta confirmada',async()=>{
 const e=await setup();try{await pay(e,e.saleId,400);await send(e,body(e));const r=await item(e);assert.equal(r.balance_cents,600);assert.equal(r.review_status,'pending');assert.ok(r.reasons.some(s=>s.includes('Cobro')));}finally{e.db.close();}
});
test('entrega sin evidencia, fecha imposible o futura se rechaza; entrega pendiente se conserva',async()=>{
 const e=await setup();try{for(const more of [{delivery_evidence:''},{delivered_at:'2026-02-30'},{delivered_at:'2099-01-01'},{delivered_at:'2026-10-20'}])assert.equal((await send(e,body(e,more))).status,400);
 await pay(e,e.saleId,1000);assert.equal((await send(e,body(e,{delivered:false,delivery_evidence:'',delivered_at:''}))).status,201);assert.ok((await item(e)).reasons.some(s=>s.includes('Entrega')));}finally{e.db.close();}
});
test('identidad dudosa y atribución desconocida permiten guardar pendientes sin inventar referidos',async()=>{
 const e=await setup();try{const c=await customer(e,'Persona sin contacto',false);assert.equal((await send(e,body(e,{customer_id:c.id,customer_kind:'unknown',identity_verified:false,identity_evidence:'',partner_id:null,attribution_evidence:''}))).status,201);const r=await item(e);assert.equal(r.review_status,'pending');assert.ok(r.reasons.some(s=>s.includes('Identidad')));assert.ok(r.reasons.some(s=>s.includes('atribución')));}finally{e.db.close();}
});
test('cliente nuevo exige contacto confirmado, revisión de historial y evidencia explícita',async()=>{
 const e=await setup();try{const c=await customer(e,'Sin contacto',false);for(const more of [{customer_id:c.id},{identity_verified:false},{identity_evidence:''},{attribution_evidence:''}])assert.equal((await send(e,body(e,more))).status,400);assert.equal(count(e.db,'partner_referral_events'),0);}finally{e.db.close();}
});
test('compra del propio partner y cliente recurrente quedan separados de nuevos externos',async()=>{
 for(const kind of ['own','recurrent']){const e=await setup();try{await pay(e,e.saleId,1000);await send(e,body(e,kind==='own'?{customer_id:e.owner.id}:{customer_kind:'recurrent'}));const r=await item(e);assert.equal(r.review_status,'pending');assert.equal(r.own_purchase,kind==='own');assert.ok(r.reasons.some(s=>s.includes(kind==='own'?'propio partner':'recurrente')));}finally{e.db.close();}}
});
test('dos ventas del mismo cliente cuentan una sola vez aun con dos partners y orden de carga inverso',async()=>{
 const e=await setup();try{const later=await newSale(e,'SEGUNDA',2,'2026-10-22');await pay(e,later,1000);const first=e.saleId;e.saleId=later;await send(e,body(e));assert.equal((await item(e)).review_status,'verified');
 const c=await customer(e,'Otro partner');const p=await cmd(e,{action:'partner-create',customer_id:c.id,code:'OTRO-QA'});const a=await cmd(e,{action:'agreement-create',partner_id:p.id,kind:'pilot',terms:'Otro acuerdo de prueba completo para QA.',unresolved:false});await cmd(e,{action:'agreement-confirm',id:a.id,expected_revision:0,confirmed:true});await cmd(e,{action:'partner-update',id:p.id,expected_revision:0,status:'active'});
 e.saleId=first;await pay(e,first,1000);await send(e,body(e,{partner_id:p.id}));const rows=(await query(e)).items;assert.equal(rows.filter(x=>x.review_status==='verified').length,1);assert.equal(rows.find(x=>x.sale_id===later).review_status,'pending');}finally{e.db.close();}
});
test('partner pausado o cerrado no deja una venta verificada',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);await send(e,body(e));assert.equal((await item(e)).review_status,'verified');await cmd(e,{action:'partner-update',id:e.partner.id,status:'paused',expected_revision:1});assert.equal((await item(e)).review_status,'pending');}finally{e.db.close();}
});
test('costos desconocidos y costo de compra cero no se presentan como contribución calculada',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);await send(e,body(e,{variable_costs_complete:false,costs_evidence:'Envío todavía no calculado.'}));assert.equal((await item(e)).contribution_cents,null);
 e.db.prepare('UPDATE sale_lines SET unit_cost_cents=0 WHERE sale_id=?').run(e.saleId);await send(e,body(e));const r=await item(e);assert.equal(r.contribution_cents,null);assert.equal(r.review_status,'pending');}finally{e.db.close();}
});
test('margen no positivo queda pendiente aun con todas las confirmaciones',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);await send(e,body(e,{variable_costs_cents:1000}));const r=await item(e);assert.equal(r.contribution_cents,-200);assert.equal(r.review_status,'pending');}finally{e.db.close();}
});
test('corrección agrega versión inmutable, motivo y autor; no borra el vínculo previo',async()=>{
 const e=await setup();try{const first=await send(e,body(e));const second=await send(e,body(e,{partner_id:null,attribution_evidence:'El cliente indicó que todavía no puede confirmar la recomendación.',reason:'Corrección de atribución solicitada por el cliente.'}));assert.equal(second.status,201);assert.equal(second.revision,1);const old=e.db.prepare('SELECT * FROM partner_referral_events WHERE id=?').get(first.id);assert.equal(old.partner_id,e.partner.id);assert.equal(e.db.prepare('SELECT previous_id FROM partner_referral_events WHERE id=?').get(second.id).previous_id,first.id);for(const sql of ['DELETE FROM partner_referral_events','UPDATE partner_referral_events SET reason=\'reescrito\'','DELETE FROM partner_referral_heads'])assert.throws(()=>e.db.exec(sql));const d=await query(e,'?mode=detail&id='+e.saleId);assert.equal(d.history.length,2);}finally{e.db.close();}
});
test('reintento y doble clic concurrentes devuelven una sola revisión y evento auditado',async()=>{
 const e=await setup();try{const b=body(e),r=await Promise.all([send(e,b),send(e,b)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,201]);assert.equal(r[0].id,r[1].id);assert.equal(count(e.db,'partner_referral_events'),1);assert.equal(e.db.prepare("SELECT COUNT(*) n FROM partner_events WHERE action='referral-review'").get().n,1);assert.equal((await send(e,{...b,reason:'Otro motivo con la misma clave.'})).status,409);}finally{e.db.close();}
});
test('otra cuenta no puede reutilizar una clave ni obtener su resultado',async()=>{
 const e=await setup();try{const b=body(e);await send(e,b);await user(e,'other');const r=await send(e,b);assert.equal(r.status,409);assert.equal(r.id,undefined);}finally{e.db.close();}
});
test('dos vínculos concurrentes con claves distintas no duplican la venta',async()=>{
 const e=await setup();try{const r=await Promise.all([send(e,body(e)),send(e,body(e))]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(count(e.db,'partner_referral_events'),1);assert.equal(count(e.db,'partner_referral_heads'),1);}finally{e.db.close();}
});
test('snapshot viejo y cambio del comprobante dentro del batch no guardan revisión',async()=>{
 const e=await setup();try{const b=body(e);await pay(e,e.saleId,400);assert.equal((await send(e,b)).status,409);e.env.DB.beforeBatch=db=>db.prepare("UPDATE settlement_revisions SET revision=revision+1 WHERE record_type='sale' AND record_id=?").run(e.saleId);assert.equal((await send(e,body(e))).status,409);assert.equal(count(e.db,'partner_referral_events'),0);}finally{e.db.close();}
});
test('revocación de permisos durante el batch revierte vínculo, auditoría y clave',async()=>{
 const e=await setup();try{const before=count(e.db,'partner_operations');e.env.DB.beforeBatch=db=>db.exec("UPDATE team_users SET active=0 WHERE id='admin'");assert.equal((await send(e,body(e))).status,409);assert.equal(count(e.db,'partner_referral_events'),0);assert.equal(count(e.db,'partner_operations'),before);}finally{e.db.close();}
});
test('fallo de auditoría revierte toda la revisión, incluida cabecera y clave',async()=>{
 const e=await setup();try{const before=count(e.db,'partner_operations');e.db.exec("CREATE TRIGGER qa_referral_audit_fail BEFORE INSERT ON partner_events WHEN NEW.action='referral-review' BEGIN SELECT RAISE(ABORT,'qa_failure'); END");assert.equal((await send(e,body(e))).status,503);assert.equal(count(e.db,'partner_referral_events'),0);assert.equal(count(e.db,'partner_referral_heads'),0);assert.equal(count(e.db,'partner_operations'),before);}finally{e.db.close();}
});
test('campos falsos, importes inválidos y origen cruzado no se guardan',async()=>{
 const e=await setup();try{for(const more of [{actor:'otro'},{variable_costs_cents:-1},{variable_costs_cents:0.5},{variable_costs_cents:'20'},{variable_costs_cents:1e14},{variable_costs_complete:'true'},{expected_revision:-2},{customer_kind:'verified'},{reason:''},{partner_id:'inexistente'}])assert.equal((await send(e,body(e,more))).status,400);
 const r=await post({env:e.env,request:req(e,path,body(e),{origin:'https://evil.com'})});assert.equal(r.status,403);assert.equal(count(e.db,'partner_referral_events'),0);}finally{e.db.close();}
});
test('devoluciones parciales recalculan importe/costo y exigen revisión y conciliación actualizadas',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);await send(e,body(e));const line=e.db.prepare('SELECT id FROM sale_lines WHERE sale_id=?').get(e.saleId);
 assert.equal((await giveBack({env:e.env,request:shared('/api/admin/sale-returns',{sale_id:e.saleId,operation_key:crypto.randomUUID(),returned_at:'2026-10-25',reason:'Devolución de una unidad para QA',lines:[{sale_line_id:line.id,quantity:1,return_to_stock:true}]})})).status,201);
 let r=await item(e);assert.equal(r.net_revenue_cents,500);assert.equal(r.net_acquisition_cost_cents,100);assert.equal(r.contribution_cents,350);assert.equal(r.review_status,'pending');assert.ok(r.reasons.some(s=>s.includes('cambió')));
 await pay(e,e.saleId,500,'refund');await send(e,body(e));r=await item(e);assert.equal(r.review_status,'verified');assert.equal(r.contribution_cents,350);
 const ret=e.db.prepare('SELECT id FROM sale_returns WHERE sale_id=?').get(e.saleId);const b=balance(e,e.saleId);const plan=await (await getUndoReturn({env:e.env,request:shared('/api/admin/return-reversals?type=sale&id='+ret.id)})).json();const reversal=await undoReturn({env:e.env,request:shared('/api/admin/return-reversals',{record_type:'sale',return_id:ret.id,operation_key:crypto.randomUUID(),reversed_at:'2026-10-25',reason:'Anulación de devolución QA',confirmed:true,expected_plan:plan.stamp,expected_revision:b.revision,expected_balance_cents:b.balance_cents})});assert.equal(reversal.status,201,await reversal.text());r=await item(e);assert.equal(r.net_revenue_cents,1000);assert.equal(r.net_acquisition_cost_cents,200);assert.equal(r.review_status,'pending');
 }finally{e.db.close();}
});
test('devolución total no verifica cliente aunque la revisión se actualice',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);const line=e.db.prepare('SELECT id FROM sale_lines WHERE sale_id=?').get(e.saleId);await giveBack({env:e.env,request:shared('/api/admin/sale-returns',{sale_id:e.saleId,operation_key:crypto.randomUUID(),returned_at:'2026-10-25',reason:'Devolución completa QA',lines:[{sale_line_id:line.id,quantity:2,return_to_stock:true}]})});await pay(e,e.saleId,1000,'refund');await send(e,body(e));const r=await item(e);assert.equal(r.net_revenue_cents,0);assert.equal(r.review_status,'pending');}finally{e.db.close();}
});
test('anulación de un cobro revoca la evaluación verificada sin borrar la revisión',async()=>{
 const e=await setup();try{const paid=await pay(e,e.saleId,1000);await send(e,body(e));const b=balance(e,e.saleId);assert.equal((await undoSettlement({env:e.env,request:shared('/api/admin/settlement-reversals',{settlement_id:paid.id,reversed_at:'2026-10-25',reason:'Cobro registrado por error QA',operation_key:crypto.randomUUID(),expected_revision:b.revision,expected_balance_cents:b.balance_cents})})).status,201);assert.equal((await item(e)).review_status,'pending');assert.equal(count(e.db,'partner_referral_events'),1);}finally{e.db.close();}
});
test('correcciones concurrentes conservan una sola revisión nueva',async()=>{
 const e=await setup();try{await send(e,body(e));const a=body(e,{reason:'Primera corrección concurrente QA.'}),b=body(e,{reason:'Segunda corrección concurrente QA.'});const r=await Promise.all([send(e,a),send(e,b)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(count(e.db,'partner_referral_events'),2);assert.equal(e.db.prepare('SELECT revision FROM partner_referral_heads').get().revision,1);}finally{e.db.close();}
});
test('devolución sin ingreso físico no revierte el costo de adquisición consumido',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);const line=e.db.prepare('SELECT id FROM sale_lines WHERE sale_id=?').get(e.saleId);const r=await giveBack({env:e.env,request:shared('/api/admin/sale-returns',{sale_id:e.saleId,operation_key:crypto.randomUUID(),returned_at:'2026-10-25',reason:'Reintegro comercial sin retorno físico QA',lines:[{sale_line_id:line.id,quantity:1,return_to_stock:false}]})});assert.equal(r.status,201);await pay(e,e.saleId,500,'refund');await send(e,body(e));const i=await item(e);assert.equal(i.net_revenue_cents,500);assert.equal(i.net_acquisition_cost_cents,200);assert.equal(i.contribution_cents,250);assert.equal(i.review_status,'verified');}finally{e.db.close();}
});
test('cabecera y líneas de costos inconsistentes quedan pendientes',async()=>{
 const e=await setup();try{await pay(e,e.saleId,1000);e.db.prepare('UPDATE sales SET cost_cents=0 WHERE id=?').run(e.saleId);await send(e,body(e));const i=await item(e);assert.equal(i.contribution_cents,null);assert.equal(i.review_status,'pending');}finally{e.db.close();}
});
test('búsqueda paginada alcanza ventas anteriores a las últimas 100, sin credenciales ni SQL inyectado',async()=>{
 const e=await setup();try{for(let i=0;i<105;i++)e.db.prepare('INSERT INTO sales(id,reference,sold_at,channel,revenue_cents,cost_cents) VALUES(?,?,?,?,?,?)').run('older-'+String(i).padStart(3,'0'),'HIST-'+i,'2026-01-01','historica',100,10);const first=await query(e,'?mode=sales');assert.equal(first.items.length,30);assert.ok(first.next);const last=await query(e,'?mode=sales&q=HIST-104');assert.equal(last.items.length,1);assert.equal(last.items[0].reference,'HIST-104');assert.equal((await query(e,'?mode=sales&q=%25')).items.length,0);assert.ok(!JSON.stringify(first).includes('key_hash'));assert.ok(!JSON.stringify(first).includes('token_hash'));}finally{e.db.close();}
});
