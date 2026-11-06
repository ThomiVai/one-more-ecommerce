import {json,check,allowOrigin} from '../_utils.js';
import {authorizedBatch} from '../_access.js';
export async function onRequestGet({request,env}){
 const fail=await check(request,env);if(fail)return fail;
 const rows=await env.DB.prepare('SELECT id,created_at,source,customer_name,customer_phone,status,total_cents,note,items_json FROM orders ORDER BY created_at DESC LIMIT 200').all();
 return json({orders:(rows.results||[]).map(x=>({...x,items:JSON.parse(x.items_json),items_json:undefined}))});
}
export async function onRequestPost({request,env}){
 const fail=await check(request,env);if(fail)return fail;if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!Array.isArray(b.items)||b.items.length<1||b.items.length>40)return json({error:'Se requieren 1 a 40 artículos'},400);
 const items=[];
 for(const x of b.items){if(typeof x.name!=='string'||!x.name.trim()||x.name.length>180||!Number.isInteger(x.qty)||x.qty<1||x.qty>99||!Number.isInteger(x.price_cents)||x.price_cents<0||x.price_cents>1e10)return json({error:'Producto o importe inválido'},400);items.push({sku:String(x.sku||'').slice(0,90),name:x.name.trim(),qty:x.qty,price_cents:x.price_cents});}
 const total=items.reduce((s,x)=>s+x.qty*x.price_cents,0);
 const name=String(b.customer_name||'').slice(0,100),phone=String(b.customer_phone||'').slice(0,50),note=String(b.note||'').slice(0,500);
 const id=crypto.randomUUID();
 try{await authorizedBatch(request,env,[env.DB.prepare('INSERT INTO orders (id,source,customer_name,customer_phone,total_cents,note,items_json) VALUES (?,?,?,?,?,?,?)').bind(id,'manual',name,phone,total,note,JSON.stringify(items))],'request-create',id);
 return json({id,status:'pending',total_cents:total},201);
 }catch{return json({error:'No se pudo guardar la solicitud. Actualizá tu sesión y revisá el listado.'},409)}
}
