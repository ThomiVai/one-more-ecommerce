import {OperationError,assertion,stockGuard,mappingGuard} from './_operations.js';
import {buildPurchaseVariant,sameVariant,historicalCandidates,identityText,flavorKey,identityStamp} from '../../../assets/purchase-identity-v134.js';
import {principal,event} from '../_access.js';
// Protege también la identidad comercial durante el primer ingreso.
export function commercialGuard(env,p){
 if(p.newProduct)return assertion(env,'EXISTS(SELECT 1 FROM catalog_new_products WHERE id=? AND name=? AND brand=? AND size=? AND group_id=?)',[p.id,p.name,p.brand,p.size,p.group_id]);
 const same='EXISTS(SELECT 1 FROM catalog_overrides WHERE product_id=? AND name=? AND brand=? AND size=?)';
 return assertion(env,p.managed?same:'NOT EXISTS(SELECT 1 FROM catalog_overrides WHERE product_id=?) OR '+same,p.managed?[p.id,p.name,p.brand,p.size]:[p.id,p.id,p.name,p.brand,p.size]);
}
export async function prepareReceiving(request,env,state,line,actor){
 const creating=!!line.new_variant,statements=[];let row,parent;
 if(creating){
  const user=await principal(request,env);if(user.role!=='admin')throw new OperationError('Un administrador debe agregar el sabor faltante.',403);
  parent=state.items.find(p=>p.commercialId===line.new_variant.parent_id);if(!parent)throw new OperationError('El producto existente cambió. Actualizá antes de agregar el sabor.');
  try{row=buildPurchaseVariant(parent,line.new_variant.flavor)}catch(e){throw new OperationError(e.message,400)}
  if(state.items.some(p=>p.commercialId&&sameVariant(row,p)))throw new OperationError('Ese sabor ya existe. Elegí su variante en el renglón en lugar de crear otra ficha.');
  row={...row,id:'om-new-'+crypto.randomUUID()};row.commercialId=row.id;
 }else row=state.items.find(p=>p.commercialId===line.product_id)||state.items.find(p=>p.physicalId===line.product_id);
 if(!row)throw new OperationError('Elegí una variante conocida.',400);
 if(row.archived)throw new OperationError('El artículo está archivado. Restauralo antes de recibir mercadería.');
 if(row.needsIdentification&&(!row.brand||!row.size||flavorKey(row)==='unknown'))throw new OperationError('El sabor histórico no está identificado. Elegí la variante comercial y confirmá el envase.');
 const first=!row.physicalId,review=line.receiving||{},requiresReview=first||creating||line.source==='pdf';
 if(requiresReview&&review.confirmed!==true)throw new OperationError('Confirmá sabor, presentación y envase del renglón antes de ingresar unidades.');
 if((first||creating)&&!review.identity)throw new OperationError('Actualizá el renglón y revisá la presentación antes de habilitar el inventario.',400);
 if(review.identity&&review.identity!==identityStamp(row))throw new OperationError('La ficha cambió desde que elegiste la variante. Actualizá el renglón.');
 let sid=row.physicalId;
 if(!first&&review.stock_id&&review.stock_id!==sid)throw new OperationError('Esa variante ya tiene un inventario físico diferente. Actualizá el renglón.');
 if(first){
  const candidates=historicalCandidates(state.items,row);
  if(review.stock_id){
   const selected=candidates.find(p=>p.physicalId===review.stock_id);
   if(!selected||selected.archived)throw new OperationError('El artículo histórico elegido no es compatible o está archivado.');
   if((await principal(request,env)).role!=='admin')throw new OperationError('Un administrador debe confirmar la asociación con el artículo histórico.',403);
   sid=selected.physicalId;
   statements.push(stockGuard(env,sid,state.stocks.get(sid)),mappingGuard(env,null,sid));
   if(!creating)statements.push(commercialGuard(env,row));
  }else{
   if(candidates.length)throw new OperationError('Hay un artículo histórico compatible. Revisalo y elegilo antes de abrir otro inventario.');
   sid=row.id;statements.push(stockGuard(env,sid,null),mappingGuard(env,row.id,sid));
   if(!creating)statements.push(commercialGuard(env,row));
  }
 }else statements.push(stockGuard(env,sid,state.stocks.get(sid)),mappingGuard(env,row.commercialId,sid));
 statements.push(assertion(env,'NOT EXISTS(SELECT 1 FROM inventory_archived WHERE product_id=?)',[sid]));
 if(creating){
  statements.push(commercialGuard(env,parent));
  const signature=JSON.stringify([identityText(row.brand),identityText(row.name),identityText(row.size)]);
  statements.push(env.DB.prepare('INSERT INTO catalog_creation_keys(signature,product_id) VALUES(?,?)').bind(signature,row.id));
  statements.push(env.DB.prepare('INSERT INTO catalog_new_products(id,group_id,name,brand,size,category,price_cents,publication_status,image_url,description) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(row.id,row.variantGroup,row.name,row.brand,row.size,row.category||'Otros',null,'draft','',row.description||''));
  statements.push(event(env,await principal(request,env),'purchase-create-variant',row.id,[row.brand,row.name,row.size].join(' · ')));
 }
 if(first&&review.stock_id){
  statements.push(env.DB.prepare('INSERT INTO catalog_stock_links(catalog_id,stock_id) VALUES(?,?)').bind(row.id,sid));
  statements.push(env.DB.prepare('INSERT INTO stock_link_audit(id,catalog_id,old_stock_id,new_stock_id,action,actor) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),row.id,null,sid,'receive-identify',actor));
 }else if(first)statements.push(event(env,await principal(request,env),'purchase-enable-stock',row.id,[row.brand,row.name,row.size].join(' · ')));
 return {row:{...row,physicalId:sid},statements,created:creating};
}
