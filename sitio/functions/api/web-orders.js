import {json,allowOrigin} from './_utils.js';
export async function onRequestPost({request,env}){
 if(!env.DB)return json({error:'Base no configurada'},503);
 if(!allowOrigin(request,env))return json({error:'Origen no autorizado'},403);
 const type=request.headers.get('content-type')||'';if(!type.includes('application/json'))return json({error:'Formato inválido'},415);
 const size=Number(request.headers.get('content-length')||0);if(size>14000)return json({error:'Pedido demasiado grande'},413);
 let body;try{body=await request.json()}catch{return json({error:'JSON inválido'},400)}
 const summary=String(body?.summary||'');if(summary.length<25||summary.length>10000)return json({error:'Resumen inválido'},400);
 if(!/ONE MORE/i.test(summary))return json({error:'Solicitud inválida'},400);
 const id=crypto.randomUUID();
 // El pedido de WhatsApp no es una venta: no calcular ganancia, no descontar stock.
 // Almacenamos resumen textual sin aceptar totales o costos manipulables como datos contables.
 const items=[{name:'Solicitud de carrito desde checkout web',qty:1,price_cents:0,summary}];
 try{
  await env.DB.prepare('INSERT INTO orders (id,source,customer_name,customer_phone,total_cents,note,items_json) VALUES (?,?,?,?,?,?,?)')
   .bind(id,'web','','',0,summary,JSON.stringify(items)).run();
  return json({id,status:'pending',recorded:true},201);
 }catch{return json({error:'No se pudo registrar el pedido'},503)}
}
