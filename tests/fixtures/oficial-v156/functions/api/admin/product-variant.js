import {json,check,allowOrigin} from '../_utils.js';
import {operation,OperationError,assertion,stockGuard} from './_operations.js';
import {matchInfo,flavorOf} from './_matching.js';
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
// Crea la variante comercial y asocia el SKU histórico en un único batch.
// Nunca cambia saldos, costos ni referencias de compras/ventas.
export async function onRequestPost({request,env}){
 const denied=await check(request,env);if(denied)return denied;
 if(!allowOrigin(request,env))return json({error:'Origen inválido'},403);
 let b;try{b=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!b||b.confirmed!==true)return json({error:'Confirmá el sabor, gramaje y envase físico.'},400);
 return operation(request,env,'create-linked-variant',b,async(state,key,actor)=>{
  const physical=state.physical.find(p=>p.id===b.stock_id),parent=state.items.find(p=>p.commercialId===b.parent_id);
  if(!physical||!parent||parent.id.startsWith('combo-')||norm(parent.name)!==norm(physical.name))throw new OperationError('Elegí el mismo producto y presentación. No se combinan fórmulas diferentes.');
  if(state.archived.has(physical.id)||state.reverse.has(physical.id)||state.items.some(p=>p.commercialId===physical.id))throw new OperationError('El artículo ya tiene ficha comercial o está archivado. Actualizá Productos.');
  const price=Number(b.price),image=String(b.image_url||'').trim(),status=String(b.status||'draft');
  if(!Number.isFinite(price)||price<0||price>1e8||!['draft','published'].includes(status)||status==='published'&&!price)throw new OperationError('Revisá precio y publicación.',400);
  if(image&&!/^\/(?:images|api\/product-image)\/[\w./-]+$/.test(image))throw new OperationError('Cargá una imagen desde el panel.',400);
  if(status==='published'&&!image)throw new OperationError('Cargá la foto del sabor antes de publicarlo.',400);
  if(!matchInfo({...physical,size:physical.size.split(' · ')[0]+' · '+parent.size.split(' · ').slice(1).join(' · ')},parent).ok)throw new OperationError('La presentación del producto elegido es diferente.');
  const id='om-new-'+crypto.randomUUID(),variant={...parent,id,size:physical.size};
  if(!flavorOf(physical)||flavorOf(physical)==='unknown'||!matchInfo(physical,variant).ok)throw new OperationError('El sabor no está identificado o la presentación no coincide. Revisá el envase.');
  const duplicate=state.items.find(p=>p.commercialId&&norm(p.brand)===norm(parent.brand)&&norm(p.name)===norm(parent.name)&&matchInfo(physical,p).ok&&flavorOf(p)===flavorOf(physical));
  if(duplicate)throw new OperationError('Ese sabor ya existe. Usá Identificar artículo para asociar su ficha; no se creó un duplicado.');
  const group=parent.variantGroup||'parent:'+parent.id;
  const signature=JSON.stringify([norm(parent.brand),norm(parent.name),norm(physical.size)]);
  return {status:201,body:{ok:true,id,stock_id:physical.id},statements:[
   stockGuard(env,physical.id,state.stocks.get(physical.id)),
   assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[physical.id]),
   env.DB.prepare('INSERT INTO catalog_creation_keys(signature,product_id) VALUES(?,?)').bind(signature,id),
   env.DB.prepare('INSERT INTO catalog_new_products(id,group_id,name,brand,size,category,price_cents,publication_status,image_url,description) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,group,parent.name,parent.brand,physical.size,parent.category||'Otros',Math.round(price*100),status,image,parent.description||''),
   env.DB.prepare('INSERT INTO catalog_stock_links(catalog_id,stock_id) VALUES(?,?)').bind(id,physical.id),
   env.DB.prepare('INSERT INTO stock_link_audit(id,catalog_id,old_stock_id,new_stock_id,action,actor) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),id,null,physical.id,'create-flavor',actor)
  ]};
 });
}
