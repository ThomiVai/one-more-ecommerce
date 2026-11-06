import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
export const root=fileURLToPath(new URL('../sitio/',import.meta.url));
export const read=path=>readFileSync(path.startsWith('fixtures/')?new URL('./'+path,import.meta.url):path.startsWith('schema')&&path!=='schema-v140-production.sql'?new URL('./fixtures/regression-sql/'+path,import.meta.url):path==='schema-v140-production.sql'?new URL('../'+path,import.meta.url):resolve(root,path),'utf8');
export const data=name=>JSON.parse(read('data/'+name+'.json'));
export const schemas=["fixtures/schema.sql", "fixtures/schema-v114.sql", "fixtures/schema-v115.sql", "fixtures/schema-v116.sql", "fixtures/schema-v117.sql", "fixtures/schema-v120.sql", "fixtures/schema-v123.sql", "fixtures/schema-v125.sql", "fixtures/schema-v128.sql", "fixtures/schema-v129.sql", "fixtures/schema-v132.sql", "fixtures/schema-v134.sql", "fixtures/schema-v135.sql", "fixtures/schema-v136.sql", "fixtures/schema-v137.sql", "fixtures/schema-v138.sql", "fixtures/schema-v139.sql"];
export function environment({partners=true}={}){
 const db=new DatabaseSync(':memory:');for(const file of schemas.filter(f=>f!=='schema-v140-production.sql'))db.exec(read(file));
 if(partners)db.exec(readFileSync(new URL('../schema-v141-partners-production.sql',import.meta.url),'utf8'));
 let remaining=0,waiting=[],barrier=null;const adapter={pauseStockReads(n){remaining=n;barrier=new Promise(resolve=>waiting.push(resolve))},beforeBatch:null,prepare(sql){let args=[];const q={bind(...a){args=a;return q},async first(){return db.prepare(sql).get(...args)??null},async all(){const result={results:db.prepare(sql).all(...args)};if(remaining>0&&sql.includes('FROM stock_items s')){const gate=barrier;remaining--;if(!remaining){waiting.forEach(fn=>fn());waiting=[]}await gate}return result},async run(){return q.execute()},execute(){if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {success:true,results:db.prepare(sql).all(...args),meta:{changes:0}};const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}}}};return q},async batch(statements){if(adapter.beforeBatch){const f=adapter.beforeBatch;adapter.beforeBatch=null;f(db)}db.exec('BEGIN');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};
 return {db,env:{ADMIN_API_KEY:'local-test-only',DB:adapter,ASSETS:{async fetch(url){try{return new Response(read(new URL(url).pathname.slice(1)))}catch{return new Response('Not found',{status:404})}}}}};
}
export const request=(path,body,host='one-more-suplementos.pages.dev')=>new Request('https://'+host+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer local-test-only','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
export const sale=(id,reference,quantity=1)=>({reference,channel:'whatsapp',sold_at:'2026-10-21',lines:[{product_id:id,quantity,unit_price_cents:7190000}]});
export const purchase=(id,document_number,quantity=1,cost=100)=>({supplier:'TEST',document_number,document_date:'2026-10-21',document_total_cents:quantity*cost,lines:[{product_id:id,quantity,unit_cost_cents:cost,line_total_cents:quantity*cost}]});
export const seed=(db,id,quantity=1,cost=100)=>db.prepare('INSERT INTO stock_items(product_id,quantity,cost_cents) VALUES(?,?,?)').run(id,quantity,cost);
export const balance=(db,id)=>db.prepare('SELECT * FROM stock_items WHERE product_id=?').get(id);
export const count=(db,table)=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
