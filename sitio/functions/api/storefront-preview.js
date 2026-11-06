import {json} from './_utils.js';
import {loadCatalog,publicCatalog} from './_catalog.js';
export async function onRequestGet({request,env}){
 if(!env.DB||!env.ASSETS)return json({error:'Configuración incompleta'},503);
 try{const data=await loadCatalog(request,env),items=publicCatalog(data.items);
  return json({items,version:'v129',stats:{original:data.original,visible:items.length,modified:data.modified,inventoryOnlyExcluded:true}});
 }catch{return json({error:'No se pudo construir el catálogo unificado'},503)}
}
