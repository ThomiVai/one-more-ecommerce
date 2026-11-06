// ONE MORE V156: una misma fuente de catálogo en inicio y enlaces directos.
window.OM_STAGING_MODE=false;
window.OM_BULK_PRODUCTS=[];
window.OM_CATALOG_ALL=null;
window.OM_CATALOG_MANAGED=false;
window.OM_CATALOG_STATUS='fallback';
try {
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),8000);
 let catalog=null;
 try {
  const r=await fetch('/api/storefront-preview',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
  if(r.ok){const body=await r.json();if(Array.isArray(body.items)){
   catalog=body.items;window.OM_CATALOG_ALL=catalog;window.OM_CATALOG_MANAGED=true;window.OM_CATALOG_STATUS='managed';
  }}
 }catch(e){console.warn('ONE MORE: catálogo administrado no disponible; usando respaldo.');}finally{clearTimeout(timer);}
 if(catalog===null){const r=await fetch('/data/products.json?v=156',{cache:'no-store'});if(r.ok){const body=await r.json();if(Array.isArray(body))catalog=body;}}
 window.OM_BULK_PRODUCTS=catalog||[];
}catch(e){console.warn('ONE MORE: no se pudo cargar el catálogo.');}
await import('./index-onemore-v158-editorial.js');
