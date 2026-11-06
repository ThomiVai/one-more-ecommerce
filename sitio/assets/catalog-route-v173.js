// Cloudflare Pages normaliza /catalogo.html a /catalogo.
export function isCatalogPath(pathname){
 return ['/catalogo','/catalogo.html'].includes(String(pathname).replace(/\/+$/,''));
}
