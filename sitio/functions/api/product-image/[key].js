export async function onRequestGet({params,env,request}){
 const key=String(params.key||'');if(!/^[0-9a-f-]{36}\.(png|webp|jpg)$/.test(key))return new Response('No encontrado',{status:404});
 const o=env.PRODUCT_IMAGES?await env.PRODUCT_IMAGES.get(key):null;
 if(!o){if(env.ASSETS){const r=await env.ASSETS.fetch(new URL('/images/migradas/'+key,request.url));if(r.ok&&(r.headers.get('content-type')||'').startsWith('image/'))return new Response(r.body,{headers:{'Content-Type':r.headers.get('content-type'),'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}})}return new Response('No encontrado',{status:404})}
 return new Response(o.body,{headers:{'Content-Type':o.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
}
