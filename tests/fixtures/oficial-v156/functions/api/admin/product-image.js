import {check,allowOrigin,json} from '../_utils.js';
import {authorizedBatch} from '../_access.js';
const MAX=3*1024*1024;
function typeOf(buf){const a=new Uint8Array(buf);if(a.length<12)return null;if(a[0]===255&&a[1]===216&&a[2]===255)return 'image/jpeg';if(a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71&&a[4]===13&&a[5]===10)return 'image/png';if(String.fromCharCode(...a.slice(0,4))==='RIFF'&&String.fromCharCode(...a.slice(8,12))==='WEBP')return 'image/webp';return null;}
export async function onRequestPost({request,env}){
 const bad=await check(request,env);if(bad)return bad;
 if(!allowOrigin(request,env))return json({error:'Origen no permitido'},403);
 if(!env.PRODUCT_IMAGES)return json({error:'Falta vincular el bucket R2 con el nombre PRODUCT_IMAGES en Cloudflare Pages.'},503);
 const len=Number(request.headers.get('content-length')||0);if(len>MAX+100000)return json({error:'Imagen demasiado grande. Máximo 3 MB.'},413);
 let form;try{form=await request.formData()}catch{return json({error:'Formulario inválido'},400)}
 const file=form.get('image');if(!file||typeof file.arrayBuffer!=='function')return json({error:'Seleccioná una imagen'},400);
 if(file.size>MAX||file.size<16)return json({error:'La imagen debe pesar entre 16 bytes y 3 MB.'},413);
 const buf=await file.arrayBuffer(),mime=typeOf(buf);if(!mime)return json({error:'Solo JPG, PNG o WebP válidos'},415);
 const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];const key=crypto.randomUUID()+'.'+ext;
 try{await env.PRODUCT_IMAGES.put(key,buf,{httpMetadata:{contentType:mime},customMetadata:{source:'one-more-admin'}});await authorizedBatch(request,env,[],'image-upload',key);return json({ok:true,image_url:'/api/product-image/'+key})}
 catch{try{await env.PRODUCT_IMAGES.delete(key)}catch{}return json({error:'No se pudo guardar la imagen. Actualizá tu sesión y volvé a intentar.'},503)}
}
