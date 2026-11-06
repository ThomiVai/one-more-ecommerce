// Presentación y búsqueda. No escribe pedidos, precios, inventario ni ventas.
export const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-AR').trim();
export const categorySlugs={creatinas:'Creatina',proteinas:'Proteína','pre-entrenos':'Pre-entreno',aminoacidos:'Aminoácidos',rendimiento:'Rendimiento',salud:'Salud & Bienestar',hidratacion:'Energía & Hidratación',snacks:'Alimentos & Snacks',accesorios:'Accesorios'};
export function matchesSearch(product,query,category=''){
 const values=[product.name,product.brand,product.size,product.contents,category,...(product.variants||[]).flatMap(v=>[v.name,v.size,v.flavor])];
 const haystack=normalize(values.join(' '));return normalize(query).split(/\s+/).filter(Boolean).every(t=>haystack.includes(t));
}
export function catalogUrl({query='',category='Todo',brand='Todas'}={}){
 const p=new URLSearchParams(),slug=Object.keys(categorySlugs).find(k=>categorySlugs[k]===category);
 if(slug)p.set('categoria',slug);if(query.trim())p.set('q',query.trim().slice(0,100));if(brand!=='Todas'&&brand.trim())p.set('marca',brand.trim().slice(0,100));
 return '/'+(p.size?'?'+p.toString():'')+'#suplementos';
}
export function readCatalogState(search,brands=[]){
 const p=new URLSearchParams(search),key=p.get('categoria');return {query:(p.get('q')||'').slice(0,100),category:Object.hasOwn(categorySlugs,key)?categorySlugs[key]:'Todo',brand:brands.includes(p.get('marca'))?p.get('marca'):'Todas'};
}
export function priceInfo(product){
 const variants=product.variants||[product],prices=variants.map(p=>p.price).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>0);
 return {value:prices.length?Math.min(...prices):null,from:new Set(prices).size>1||prices.length<variants.length};
}
export function heroSelections(products,categoryOf){
 const choices=[
  {label:'Creatinas',category:'Creatina',id:'star-crea-pote-300-ne',caption:'Presentaciones y marcas para sumar a tu rutina.'},
  {label:'Proteínas',category:'Proteína',id:'star-whey-doy-va',caption:'Encontrá tu marca, presentación y sabor.'},
  {label:'Pre-entrenos',category:'Pre-entreno',id:'bulk-gentech-86',caption:'Conocé las opciones y revisá sus ingredientes en la ficha.'}
 ];
 return choices.flatMap(c=>{const list=products.filter(p=>categoryOf(p)===c.category);const product=list.find(p=>p.id===c.id)||list[0];return product?[{...c,product}]:[];});
}
export function installStoreMotion(doc=globalThis.document,view=globalThis.window){
 if(!doc||!view||view.matchMedia('(prefers-reduced-motion: reduce)').matches||!view.IntersectionObserver||!view.MutationObserver)return ()=>{};
 const tracked=new Set(),pulses=new Set();let frame=0,lastCount=null,stopped=false;
 const reveal=el=>{el.dataset.om143Reveal='visible';observer.unobserve(el);};
 const observer=new view.IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)reveal(e.target);},{threshold:0.08,rootMargin:'0px 0px -25px 0px'});
 const scan=()=>{
  frame=0;if(stopped)return;
  for(const el of tracked)if(!el.isConnected){observer.unobserve(el);tracked.delete(el);}
  doc.querySelectorAll('.om143-category-card,.section-head,.om-star-card,.home-featured article,#catalogo .product').forEach(el=>{
   if(tracked.has(el))return;tracked.add(el);
   if(el.getBoundingClientRect().top<view.innerHeight*.92){el.dataset.om143Reveal='visible';return;}
   el.dataset.om143Reveal='pending';observer.observe(el);
  });
  const badge=doc.querySelector('.header .cart-button b'),count=badge?.textContent;
  if(lastCount!==null&&count!==lastCount&&badge?.animate){const pulse=badge.animate([{transform:'scale(1)'},{transform:'scale(1.35)'},{transform:'scale(1)'}],{duration:340,easing:'cubic-bezier(.2,.8,.2,1)'});pulses.add(pulse);pulse.finished.then(()=>pulses.delete(pulse),()=>pulses.delete(pulse));}
  lastCount=count;
 };
 const schedule=()=>{if(!frame&&!stopped)frame=view.requestAnimationFrame(scan);};
 const focus=e=>{const el=e.target?.closest('[data-om143-reveal="pending"]');if(el)reveal(el);};
 const changes=new view.MutationObserver(schedule);changes.observe(doc.getElementById('root')||doc.body,{childList:true,subtree:true,characterData:true});
 doc.addEventListener('focusin',focus);scan();
 return ()=>{stopped=true;observer.disconnect();changes.disconnect();if(frame)view.cancelAnimationFrame(frame);for(const pulse of pulses)pulse.cancel();pulses.clear();doc.removeEventListener('focusin',focus);for(const el of tracked)delete el.dataset.om143Reveal;tracked.clear();};
}
export function createStorefrontComponents({React,products,categoryOf,pathOf,navigateProduct,ProductPhoto}){
 const h=React.createElement;
 const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(value);
 const priced=p=>{const r=priceInfo(p);return r.value===null?'Consultar precio':(r.from?'Desde ':'')+money(r.value);};
 const browse=(e,options)=>{
  if(e&&(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey))return;e?.preventDefault();
  history.pushState({omCatalog:true},'',catalogUrl(options));window.dispatchEvent(new Event('om:navigate'));window.dispatchEvent(new Event('hashchange'));window.scrollTo({top:0,behavior:'instant'});
 };
 const catalogLink=(label,options,className='')=>h('a',{href:catalogUrl(options),className,onClick:e=>browse(e,options)},label);
 const visibleProducts=products.filter(p=>categoryOf(p)!=='Combos');
 function StoreSearch(){
  const [query,setQuery]=React.useState(''),[open,setOpen]=React.useState(false),[selected,setSelected]=React.useState(-1);
  const wrapper=React.useRef(null),input=React.useRef(null),id=React.useId();
  React.useEffect(()=>{const pref=window.matchMedia('(prefers-reduced-motion: reduce)');let stop=()=>{};const sync=()=>{stop();stop=installStoreMotion();};sync();pref.addEventListener('change',sync);return()=>{stop();pref.removeEventListener('change',sync);};},[]);
  const hits=query.trim().length>=2?visibleProducts.filter(p=>matchesSearch(p,query,categoryOf(p))):[],shown=hits.slice(0,5);
  React.useEffect(()=>{const close=e=>{if(!wrapper.current?.contains(e.target))setOpen(false);};const shortcut=e=>{
   if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target?.closest('input,textarea,select,[contenteditable=true]')){e.preventDefault();input.current?.focus();}
  };document.addEventListener('pointerdown',close);document.addEventListener('keydown',shortcut);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',shortcut);};},[]);
  const send=e=>{e?.preventDefault();setOpen(false);browse(null,{query});};
  const keyDown=e=>{
   if(e.key==='Escape'){setOpen(false);setSelected(-1);return;}
   if(e.key==='ArrowDown'&&shown.length){e.preventDefault();setOpen(true);setSelected(s=>(s+1)%shown.length);}
   if(e.key==='ArrowUp'&&shown.length){e.preventDefault();setOpen(true);setSelected(s=>s<=0?shown.length-1:s-1);}
   if(e.key==='Enter'&&open&&selected>=0&&shown[selected]){e.preventDefault();setOpen(false);navigateProduct(null,shown[selected]);}
  };
  return h('div',{className:'om143-search',ref:wrapper},h('form',{role:'search',onSubmit:send},
   h('label',{className:'om143-sr',htmlFor:id},'Buscar producto, marca o sabor'),
   h('span',{'aria-hidden':true,className:'om143-search-mark'},'⌕'),
   h('input',{id,ref:input,type:'search',maxLength:100,value:query,autoComplete:'off',placeholder:'Buscá producto, marca o sabor',role:'combobox','aria-autocomplete':'list','aria-expanded':open&&query.trim().length>=2,'aria-controls':id+'-results','aria-activedescendant':open&&selected>=0?id+'-hit-'+selected:undefined,onFocus:()=>setOpen(true),onChange:e=>{setQuery(e.target.value);setOpen(true);setSelected(-1);},onKeyDown:keyDown}),
   h('button',{type:'submit','aria-label':'Buscar en todo el catálogo'},'Buscar')),
   open&&query.trim().length>=2&&h('div',{className:'om143-search-panel'},
    h('p',{className:'om143-search-caption',role:'status'},hits.length?`${hits.length} productos encontrados`:'No encontramos productos con esa búsqueda.'),
    h('ul',{id:id+'-results',role:'listbox','aria-label':'Sugerencias de productos'},shown.map((p,i)=>h('li',{key:p.id,id:id+'-hit-'+i,role:'option','aria-selected':i===selected},
     h('a',{href:pathOf(p),onClick:e=>{setOpen(false);navigateProduct(e,p);}},
      h('span',{className:'om143-result-image'},h(ProductPhoto,{product:p})),
      h('span',{className:'om143-result-copy'},h('small',null,p.brand),h('strong',null,p.name),h('small',null,p.displaySize||p.size)),
      h('span',{className:'om143-result-price'},priced(p)))))),
    h('button',{type:'button',className:'om143-results-all',onClick:hits.length?send:()=>{setOpen(false);setQuery('');browse(null,{});}},hits.length?'Ver resultados en el catálogo →':'Explorar todo el catálogo →')));
 }
 function CommerceHero(){
  const [selection,setSelection]=React.useState(0);
  const choices=heroSelections(visibleProducts,categoryOf),active=choices[selection%Math.max(1,choices.length)];
  const p=active?.product;
  return h('section',{className:'hero om143-hero om144-hero','aria-label':'Tu próximo +1'},
   h('div',{className:'hero-copy'},h('div',{className:'eyebrow'},h('span',{className:'orange'},'+1'),' PARA LOS QUE SIGUEN.'),
    h('h1',null,'TU PRÓXIMO',h('br'),h('em',null,'+1'),h('br'),'EMPIEZA ACÁ.'),
    h('p',null,'Una repetición más. Una versión mejor. Encontrá suplementos y accesorios para acompañar tu entrenamiento.'),
    h('div',{className:'om143-hero-actions'},catalogLink('EXPLORAR CATÁLOGO ↗',{},'button dark'),h('a',{href:'/#combos',className:'hero-secondary'},'VER COMBOS')),
    h('span',{className:'hero-note'},'Retiro gratis en Hurlingham · Entregas coordinadas')),
   p&&h('div',{className:'om144-showcase'},
    h('div',{className:'om144-showcase-top'},h('span',null,'ENCONTRÁ TU PRÓXIMO +1'),h('span',null,String(selection%choices.length+1).padStart(2,'0')+' / '+String(choices.length).padStart(2,'0'))),
    h('div',{className:'om144-selectors',role:'group','aria-label':'Explorar productos por categoría'},choices.map((c,i)=>h('button',{key:c.category,type:'button','aria-pressed':selection%choices.length===i,onClick:()=>setSelection(i)},c.label))),
    h('div',{className:'om144-product-scene',key:p.id},
     h('span',{className:'om144-background-mark','aria-hidden':true},'+1'),
     h('a',{href:pathOf(p),onClick:e=>navigateProduct(e,p),className:'om144-product-image','aria-label':'Ver '+p.name},h(ProductPhoto,{product:p})),
     h('div',{className:'om144-product-info','aria-live':'polite','aria-atomic':true},
      h('small',{className:'om144-brand'},p.brand),h('h2',null,p.name),h('p',{className:'om144-size'},p.displaySize||p.size),
      h('p',{className:'om144-caption'},active.caption),h('strong',{className:'om144-price'},priced(p)),
      h('a',{href:pathOf(p),onClick:e=>navigateProduct(e,p),className:'om144-product-cta'},p.variants?'ELEGIR SABOR ↗':'VER PRODUCTO ↗'))),
    h('div',{className:'om144-showcase-footer'},catalogLink('Ver '+active.label.toLowerCase()+' →',{category:active.category}),h('span',null,'Disponibilidad a confirmar'))));
 }
 function BrowseCategories(){
  const categories=[['Creatinas','Creatina'],['Proteínas','Proteína'],['Pre-entrenos','Pre-entreno'],['Accesorios','Accesorios']];
  return h('section',{className:'section om143-categories','aria-label':'Encontrá tu categoría'},
   h('div',{className:'om143-category-head'},h('h2',null,'¿Qué estás buscando?'),catalogLink('Ver todo ↗',{},'text-link')),
   h('div',{className:'om143-category-grid'},categories.map(([label,category])=>{
    const list=visibleProducts.filter(p=>categoryOf(p)===category),photo=list.find(p=>p.catalogImage||p.cardImage)||list[0];
    return h('a',{key:category,href:catalogUrl({category}),onClick:e=>browse(e,{category}),className:'om143-category-card'},h('span',null,h('strong',null,label),h('small',null,list.length?`${list.length} opciones en el catálogo`:'Explorar categoría'),h('span',{className:'om143-category-arrow','aria-hidden':true},'↗')),photo&&h('div',{className:'om143-category-photo'},h(ProductPhoto,{product:photo})));
   })));
 }
 return {StoreSearch,CommerceHero,BrowseCategories};
}
