import {json} from './_utils.js';
import {loadCatalog,publicCatalog} from './_catalog.js';
export async function onRequestGet({request,env}){
 if(!env.DB)return json({error:'Catálogo no disponible'},503);
 try{const data=await loadCatalog(request,env);return json({products:publicCatalog(data.items),base_products:data.original,managed_products:data.items.length,version:'v129'})}
 catch{return json({error:'Catálogo no disponible'},503)}
}
