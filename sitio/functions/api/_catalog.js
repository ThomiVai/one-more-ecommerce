// Única composición de catálogo para tienda y gestión. Solo lectura.
export async function loadCatalog(request, env) {
  const paths=['products.json','storefront-base-v129.json','inventory-catalog.json'];
  const [products, storefront, physical] = await Promise.all(paths.map(async path => {
    const r=await env.ASSETS.fetch(new URL('/data/'+path,request.url));
    if(!r.ok)throw Error('Catálogo no disponible: '+path);
    const items=await r.json();if(!Array.isArray(items))throw Error('Catálogo inválido');return items;
  }));
  const [changes,extras]=await Promise.all([
    env.DB.prepare('SELECT * FROM catalog_overrides').all(),
    env.DB.prepare('SELECT * FROM catalog_new_products').all()
  ]);
  const byId=new Map([...products,...storefront].map(p=>[p.id,{...p,managed:false}]));
  for(const p of extras.results||[]){
    if(byId.has(p.id))throw Error('ID comercial duplicado: '+p.id);
    byId.set(p.id,{...p,variantGroup:p.group_id,price:p.price_cents===null?null:p.price_cents/100,
      status:p.publication_status,managed:true,modified:true,newProduct:true,objectives:[],packaging:''});
  }
  for(const o of changes.results||[]){
    const p=byId.get(o.product_id);if(!p)continue;
    byId.set(p.id,{...p,name:o.name,brand:o.brand,size:o.size,
      price:o.price_cents===null?null:o.price_cents/100,status:o.publication_status,
      image_url:o.image_url,description:o.description,managed:true,modified:true});
  }
  // El grupo conserva la identidad del producto base sin editarlo ni copiar su stock.
  for(const p of byId.values()){
    if(!p.newProduct)continue;
    const parent=p.group_id?.startsWith('parent:')?byId.get(p.group_id.slice(7)):
      [...byId.values()].find(x=>!x.newProduct&&x.variantGroup===p.group_id);
    if(parent){parent.variantGroup=p.group_id;p.packaging=parent.packaging||'';}
  }
  // V181: esta imagen histórica de 100% Chocolate era en realidad TrueMade.
  // Solo se reemplazan rutas identificadas como incorrectas. Una foto futura
  // cargada desde Gestión se respeta; no se cambia ninguna fila de D1.
  const incorrect100WheyPhotos=new Set([
    '/api/product-image/a612e014-0539-4032-b7a0-0b4418c021d5.webp',
    '/images/staging-v99/ena/100-whey-2lb-ch-front.webp'
  ]);
  const items=[...byId.values()].map(p=>{
    let image=p.image_url||p.catalogImage||p.cardImage||'';
    if(p.id==='bulk-ena-155'&&/^100%\s*Whey Protein$/i.test(p.name)&&/^907\s*g\s*·\s*Chocolate$/i.test(p.size)&&incorrect100WheyPhotos.has(image))image='/images/v180/ena-100-whey-ch.webp';
    const corrected=image!==(p.image_url||p.catalogImage||p.cardImage||'')?{...p,image_url:image}:p;
    return {...corrected,image_url:corrected.image_url||corrected.catalogImage||corrected.cardImage||'',catalogImage:corrected.image_url||corrected.catalogImage||corrected.cardImage||'',cardImage:corrected.image_url||corrected.cardImage||corrected.catalogImage||''};
  });
  return {items,physical,original:products.length,
    modified:items.filter(p=>p.managed).length};
}
export const publicCatalog=items=>items.filter(p=>p.status==='published'&&Number(p.price)>0&&!p.inventoryOnly);

export async function loadInventory(request,env){
  const catalog=await loadCatalog(request,env);
  const [stock,links,archive]=await Promise.all([
    env.DB.prepare('SELECT s.*,r.revision FROM stock_items s LEFT JOIN stock_revisions r ON r.product_id=s.product_id').all(),
    env.DB.prepare('SELECT * FROM catalog_stock_links').all(),
    env.DB.prepare('SELECT product_id FROM inventory_archived').all()
  ]);
  const stocks=new Map((stock.results||[]).map(s=>[s.product_id,s]));
  const physical=new Map(catalog.physical.map(p=>[p.id,p]));
  // Los saldos sin definición estática nunca desaparecen del inventario.
  for(const id of stocks.keys())if(!physical.has(id))physical.set(id,catalog.items.find(p=>p.id===id)||{id,name:'SKU histórico por identificar',brand:'',size:''});
  const forward=new Map(),reverse=new Map(),known=new Set(catalog.items.map(p=>p.id));
  for(const l of links.results||[]){
    if(!known.has(l.catalog_id)||!physical.has(l.stock_id)||forward.has(l.catalog_id)||reverse.has(l.stock_id)
      ||(l.catalog_id!==l.stock_id&&(physical.has(l.catalog_id)||known.has(l.stock_id))))throw Error('Vínculos de inventario inconsistentes; revisar antes de operar');
    forward.set(l.catalog_id,l.stock_id);reverse.set(l.stock_id,l.catalog_id);
  }
  const archived=new Set((archive.results||[]).map(x=>x.product_id));
  const represented=new Set();
  const items=catalog.items.filter(p=>!p.id.startsWith('combo-')).map(p=>{
    const sid=forward.get(p.id)||(physical.has(p.id)&&!reverse.has(p.id)?p.id:null);
    if(sid)represented.add(sid);
    const s=stocks.get(sid);
    return {...p,physicalId:sid,commercialId:p.id,virtualVariant:!sid,
      linkedToVariant:!!sid&&sid!==p.id,quantity:s?.quantity??0,cost_cents:s?.cost_cents??null,
      min_quantity:s?.min_quantity??1,revision:s?.revision??null,registered:!!s,archived:archived.has(sid)};
  });
  for(const [id,p] of physical){
    if(represented.has(id))continue;
    const s=stocks.get(id);
    items.push({...p,id,commercialId:null,physicalId:id,virtualVariant:false,inventoryOnly:true,
      price:null,quantity:s?.quantity??0,cost_cents:s?.cost_cents??null,min_quantity:s?.min_quantity??1,
      revision:s?.revision??null,registered:!!s,archived:archived.has(id),needsIdentification:true});
  }
  return {...catalog,catalogItems:catalog.items,items,stocks,forward,reverse,archived,
    links:links.results||[],total_units:[...stocks.values()].reduce((n,s)=>n+s.quantity,0)};
}
