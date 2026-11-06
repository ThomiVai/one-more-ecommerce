import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {environment,seed,sale} from './helpers.mjs';
import {sessionHash} from '../sitio/functions/api/_access.js';
import {onRequestGet as get,onRequestPost as post} from '../sitio/functions/api/admin/partners.js';
import {onRequestPost as sell} from '../sitio/functions/api/admin/sales.js';
import {deploymentOnly,databaseGuard} from '../sitio/functions/api/_deployment.js';
import {onRequest as middleware} from '../sitio/functions/_middleware.js';
const migration=readFileSync(new URL('../schema-v141-partners-production.sql',import.meta.url),'utf8');
const host='one-more-suplementos.pages.dev';
async function setup(role='admin'){
 const e=environment();e.db.exec(migration);e.env.PARTNERS_PHASE1='true';
 const token='a'.repeat(43);e.db.prepare('INSERT INTO team_users(id,username,name,role,key_hash) VALUES(?,?,?,?,?)').run('owner','owner','Administrador QA',role,'fake-hash');
 e.db.prepare('INSERT INTO team_sessions(token_hash,user_id,revision,expires_at) VALUES(?,?,0,?)').run(await sessionHash(token),'owner',Date.now()+1000000);
 e.cookie='om_admin=v2.'+token;return e;
}
const request=(e,path,body,extra={})=>new Request('https://'+host+path,{method:body===undefined?'GET':'POST',headers:{cookie:e.cookie||'',origin:'https://'+host,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
const command=async(e,body)=>{const response=await post({env:e.env,request:request(e,'/api/admin/partners',{operation_key:crypto.randomUUID(),...body})});return {status:response.status,...await response.json()};};
const createCustomer=(e,more={})=>command(e,{action:'customer-create',name:'Cliente QA',...more});
const createPartner=(e,customer_id,code='QA-ONE')=>command(e,{action:'partner-create',customer_id,code,instagram:'qa_fitness'});
const count=(e,table)=>e.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
const snapshot=e=>Object.fromEntries(['stock_items','stock_movements','sales','sale_lines','purchase_documents','purchase_lines','cash_entries','cash_opening','settlements','sale_returns','catalog_overrides','team_users'].map(t=>[t,e.db.prepare('SELECT * FROM '+t).all()]));
test('migración aditiva repetible preserva todas las tablas previas, incluye product_mappings extra',()=>{
 const e=environment({partners:false});try{e.db.exec('CREATE TABLE product_mappings(id TEXT); INSERT INTO product_mappings VALUES(\'dato-legado\')');seed(e.db,'legacy',3,222);
 const oldTables=e.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(r=>r.name);const original=()=>Object.fromEntries(oldTables.map(t=>[t,e.db.prepare('SELECT * FROM \"'+t+'\"').all()]));const before=original();e.db.exec(migration);e.db.exec(migration);assert.deepEqual(original(),before);assert.equal(e.db.prepare('SELECT id FROM product_mappings').get().id,'dato-legado');assert.equal(count(e,'partner_program_versions'),1);assert.equal(e.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{e.db.close();}
});
test('marca oficial y hosts oficiales se rechazan',async()=>{
 const e=environment({partners:false});try{e.db.exec("CREATE TABLE deployment_identity(id INTEGER PRIMARY KEY,database_id TEXT,project TEXT);INSERT INTO deployment_identity VALUES(1,'99efe950-f8d1-4869-8e50-e6f9a862fdc8','one-more-preproduccion')");assert.throws(()=>e.db.exec(migration));assert.equal(count(e,'sales'),0);
 for(const h of ['one-more-preproduccion.pages.dev','www.one-more-preproduccion.pages.dev','one-more-preproduccion.pages.dev','abc.one-more-suplementos.pages.dev','evil.com'])assert.equal(deploymentOnly(new Request('https://'+h+'/api/admin/partners')).status,403);
 assert.equal((await databaseGuard(new Request('https://'+host+'/api/admin/partners'),e.env)).status,503);
 }finally{e.db.close();}
});
test('requiere bandera, migración y cuenta personal admin para lecturas y escrituras',async()=>{
 for(const role of ['admin','operator']){const e=await setup(role);try{
 if(role==='admin'){e.env.PARTNERS_PHASE1='false';assert.equal((await get({env:e.env,request:request(e,'/api/admin/partners')})).status,503);e.env.PARTNERS_PHASE1='true';}
 else{assert.equal((await get({env:e.env,request:request(e,'/api/admin/partners')})).status,403);assert.equal((await createCustomer(e)).status,403);}
 const shared=request({...e,cookie:''},'/api/admin/partners',undefined,{authorization:'Bearer local-test-only'});assert.equal((await get({env:e.env,request:shared})).status,403);
 assert.equal((await get({env:e.env,request:request({...e,cookie:''},'/api/admin/partners')})).status,401);
 }finally{e.db.close();}}
});
test('crea cliente sin contacto sin convertirlo en adquisición y normaliza contactos explícitos',async()=>{
 const e=await setup();try{
 const c=await createCustomer(e);assert.equal(c.status,201);assert.equal(count(e,'customer_contacts'),0);
 assert.equal((await createCustomer(e,{contact_kind:'phone',contact_value:'11 1234-5678',contact_confirmed:true})).status,400);
 assert.equal((await createCustomer(e,{contact_kind:'phone',contact_value:'+54 9 11 1234-5678',contact_confirmed:false})).status,400);
 assert.equal((await createCustomer(e,{contact_kind:'phone',contact_value:'+54 9 11 1234-5678',contact_confirmed:true})).status,201);
 const duplicate=await createCustomer(e,{contact_kind:'phone',contact_value:'+5491112345678',contact_confirmed:true});assert.equal(duplicate.status,409);assert.ok(duplicate.customer_id);assert.equal(count(e,'customers'),2);
 assert.equal((await createCustomer(e,{contact_kind:'email',contact_value:'Ejemplo+uno@Correo.com',contact_confirmed:true})).status,201);
 assert.equal(e.db.prepare("SELECT normalized FROM customer_contacts WHERE kind='email'").get().normalized,'ejemplo+uno@correo.com');
 }finally{e.db.close();}
});
test('campos desconocidos, autor falso y códigos inválidos no se guardan',async()=>{
 const e=await setup();try{assert.equal((await createCustomer(e,{created_by:'otro'})).status,400);const c=await createCustomer(e);
 for(const code of ['ab','<script>','UNA CLAVE'])assert.equal((await createPartner(e,c.id,code)).status,400);
 assert.equal(count(e,'partners'),0);assert.equal((await createPartner(e,c.id,'qa-uno')).code,'QA-UNO');
 assert.equal((await createPartner(e,c.id,'OTRO-CODIGO')).status,409);
 const c2=await createCustomer(e);assert.equal((await createPartner(e,c2.id,'QA-UNO')).status,409);
 }finally{e.db.close();}
});
test('mismo reintento devuelve mismo ID, otro cuerpo o autor con misma clave se rechaza',async()=>{
 const e=await setup();try{const body={action:'customer-create',name:'Persona',operation_key:crypto.randomUUID()};const a=await command(e,body),b=await command(e,body);assert.equal(a.id,b.id);assert.equal(b.replayed,true);assert.equal(count(e,'customers'),1);assert.equal(count(e,'partner_events'),1);assert.equal((await command(e,{...body,name:'Otra persona'})).status,409);
 }finally{e.db.close();}
});
test('concurrencia en contacto y código produce una única identidad',async()=>{
 const e=await setup();try{const bodies=[0,1].map(()=>createCustomer(e,{contact_kind:'phone',contact_value:'+5491111122222',contact_confirmed:true}));const r=await Promise.all(bodies);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(count(e,'customers'),1);const c=await createCustomer(e);const ids=e.db.prepare('SELECT id FROM customers ORDER BY id').all().map(x=>x.id);const partners=await Promise.all(ids.map(customer_id=>createPartner(e,customer_id,'MISMO-CODIGO')));assert.deepEqual(partners.map(x=>x.status).sort(),[201,409]);assert.equal(count(e,'partners'),1);assert.equal(count(e,'partner_events'),3);
 }finally{e.db.close();}
});
test('clave idempotente de otro administrador no devuelve datos de la operación original',async()=>{
 const e=await setup();try{
 const body={action:'customer-create',name:'Persona',operation_key:crypto.randomUUID()};assert.equal((await command(e,body)).status,201);
 const token='b'.repeat(43);e.db.prepare("INSERT INTO team_users(id,username,name,role,key_hash) VALUES('other','other','Otro administrador QA','admin','fake')").run();
 e.db.prepare("INSERT INTO team_sessions(token_hash,user_id,revision,expires_at) VALUES(?,'other',0,?)").run(await sessionHash(token),Date.now()+100000);
 e.cookie='om_admin=v2.'+token;const result=await command(e,body);assert.equal(result.status,409);assert.equal(result.id,undefined);assert.equal(count(e,'customers'),1);
 }finally{e.db.close();}
});
test('revocación entre lectura y batch revierte operación y auditoría',async()=>{
 const e=await setup();try{e.env.DB.beforeBatch=db=>db.exec("UPDATE team_users SET active=0 WHERE id='owner'");assert.equal((await createCustomer(e)).status,409);assert.equal(count(e,'customers'),0);assert.equal(count(e,'partner_events'),0);assert.equal(count(e,'partner_operations'),0);
 }finally{e.db.close();}
});
test('fallo de evento hace rollback de cliente y clave idempotente',async()=>{
 const e=await setup();try{e.db.exec("CREATE TRIGGER qa_event_failure BEFORE INSERT ON partner_events BEGIN SELECT RAISE(ABORT,'qa_failure'); END;");assert.equal((await createCustomer(e)).status,503);assert.equal(count(e,'customers'),0);assert.equal(count(e,'partner_operations'),0);
 }finally{e.db.close();}
});
test('compromiso previo pendiente no confirma; nuevo acuerdo completo conserva el anterior',async()=>{
 const e=await setup();try{const c=await createCustomer(e),p=await createPartner(e,c.id);const terms='Precio especial prometido por una historia; presentación pendiente.';
 const first=await command(e,{action:'agreement-create',partner_id:p.id,kind:'prior_commitment',terms,unresolved:true});assert.equal(first.status,201);
 assert.equal((await command(e,{action:'agreement-confirm',id:first.id,expected_revision:0,confirmed:true})).status,409);
 const second=await command(e,{action:'agreement-create',partner_id:p.id,kind:'prior_commitment',terms:'Una unidad de la variante acordada al precio escrito por los socios. Vigencia acordada individualmente.',unresolved:false});
 assert.equal((await command(e,{action:'agreement-confirm',id:second.id,expected_revision:0,confirmed:true})).status,201);
 assert.equal(e.db.prepare('SELECT terms FROM partner_agreements WHERE id=?').get(first.id).terms,terms);
 assert.equal((await command(e,{action:'partner-update',id:p.id,status:'active',expected_revision:0})).status,201);
 assert.equal(e.db.prepare('SELECT benefits_enabled FROM partner_programs').get().benefits_enabled,0);
 assert.throws(()=>e.db.exec("UPDATE partner_agreements SET terms='reescrito' WHERE status='confirmed'"));
 }finally{e.db.close();}
});
test('activación sin acuerdo, revisión vieja y cierre protegen el historial',async()=>{
 const e=await setup();try{const c=await createCustomer(e),p=await createPartner(e,c.id);assert.equal((await command(e,{action:'partner-update',id:p.id,status:'active',expected_revision:0})).status,409);
 assert.equal((await command(e,{action:'partner-update',id:p.id,status:'paused',expected_revision:0})).status,201);
 assert.equal((await command(e,{action:'partner-update',id:p.id,status:'candidate',expected_revision:0})).status,409);
 assert.equal((await command(e,{action:'partner-update',id:p.id,status:'closed',expected_revision:1})).status,201);
 assert.equal((await command(e,{action:'partner-update',id:p.id,status:'candidate',expected_revision:2})).status,409);
 assert.throws(()=>e.db.prepare('DELETE FROM partners WHERE id=?').run(p.id));assert.throws(()=>e.db.exec("UPDATE partners SET code='OTRO'"));assert.throws(()=>e.db.exec('DELETE FROM partner_events'));
 }finally{e.db.close();}
});
test('listas paginadas, búsqueda literal y detalle sin exponer credenciales',async()=>{
 const e=await setup();try{for(let i=0;i<32;i++)await createCustomer(e,{name:'Cliente '+i});let r=await get({env:e.env,request:request(e,'/api/admin/partners?mode=customers')}),d=await r.json();assert.equal(d.items.length,30);assert.ok(d.next);
 r=await get({env:e.env,request:request(e,'/api/admin/partners?mode=customers&after='+d.next)});assert.equal((await r.json()).items.length,2);
 r=await get({env:e.env,request:request(e,'/api/admin/partners?mode=customers&q=%25')});assert.equal((await r.json()).items.length,0);
 const c=await createCustomer(e,{name:'Persona consulta'}),p=await createPartner(e,c.id);r=await get({env:e.env,request:request(e,'/api/admin/partners?mode=detail&id='+p.id)});const txt=await r.text();assert.ok(txt.includes('Persona consulta'));assert.ok(!txt.includes('key_hash'));assert.ok(!txt.includes('token_hash'));
 }finally{e.db.close();}
});
test('flujo de PARTNERS no altera stock, ventas, costos, caja ni usuarios',async()=>{
 const e=await setup();try{seed(e.db,'sku-qa',3,123);const before=snapshot(e);const c=await createCustomer(e),p=await createPartner(e,c.id);await command(e,{action:'agreement-create',partner_id:p.id,kind:'pilot',terms:'Condiciones del futuro piloto todavía pendientes.',unresolved:true});assert.deepEqual(snapshot(e),before);
 const body=sale('sku-qa','VENTA-REGRESION');const r=await sell({env:e.env,request:request(e,'/api/admin/sales',body)});assert.equal(r.status,201);assert.equal(e.db.prepare("SELECT quantity FROM stock_items WHERE product_id='sku-qa'").get().quantity,2);
 }finally{e.db.close();}
});
test('middleware bloquea host oficial y origen cruzado no guarda',async()=>{
 const e=await setup();try{const blocked=await middleware({env:e.env,request:new Request('https://one-more-preproduccion.pages.dev/api/admin/partners'),next:()=>{throw Error('no debe entrar')}});assert.equal(blocked.status,403);const r=await post({env:e.env,request:request(e,'/api/admin/partners',{action:'customer-create',name:'Persona',operation_key:crypto.randomUUID()},{origin:'https://evil.com'})});assert.equal(r.status,403);assert.equal(count(e,'customers'),0);
 }finally{e.db.close();}
});
