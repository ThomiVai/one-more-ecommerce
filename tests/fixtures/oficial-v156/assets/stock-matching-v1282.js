// ONE MORE V128.3 - Matching only: suggests, NEVER mutates inventory.
// Same module imported by Cloudflare backend and static administrator.
const norm = value => String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function brand(x){return norm(x.brand).replace(/ nutrition| sport| suplementos/g,'').trim()}
function family(x){const s=norm((x.name||'')+' '+(x.category||''));if(s.includes('creatina')||s.includes('creatine'))return 'creatina';if(s.includes('whey')||s.includes('protein')||s.includes('proteina'))return 'proteina';return ''}
function weight(x){
 const s=String(x.size||'').toLowerCase().replace(/,/g,'.');
 const a=[...s.matchAll(/(\d+(?:\.\d+)?)\s*(kg|gr|g|lb)\b/g)].map(m=>Math.round(Number(m[1])*({kg:1000,gr:1,g:1,lb:454}[m[2]])));
 return a.find(w=>w>100)||a[0]||0;
}
function flavors(x){const s=norm((x.size||'')+' '+(x.name||''));if(/sabor por verificar|sabor a confirmar|a verificar|por definir/.test(s))return 'unknown';for(const [regex,n] of [[/frutos rojos/,'frutos-rojos'],[/fruit punch/,'fruit-punch'],[/cookies.*cream/,'cookies'],[/chocolate|choco/,'chocolate'],[/vainilla|vanilla/,'vainilla'],[/frutilla|strawberry/,'frutilla'],[/neutr[oa]|sin sabor/,'neutro'],[/uva/,'uva'],[/naranja/,'naranja'],[/limon/,'limon'],[/banana/,'banana'],[/pistacho/,'pistacho']]){if(regex.test(s))return n}return ''}
function pack(x){const s=norm((x.size||'')+' '+(x.name||'')+' '+(x.packaging||''));if(/doypack|doy pack/.test(s))return 'doypack';if(/pote|frasco/.test(s))return 'pote';return ''}
function line(x){const s=norm(x.name);if(/platinum/.test(s))return 'platinum';if(/truemade|true made/.test(s))return 'truemade';if(/plant|vegetal/.test(s))return 'vegetal';if(/7900/.test(s))return '7900';if(/creatina.*electrolitos|creatine.*whey/.test(s))return 'mezcla';return ''}
export function matchInfo(stock,catalog){
  if(!stock||!catalog||String(catalog.id||'').startsWith('combo-'))return {ok:false,reason:'No se vinculan combos'};
  if(brand(stock)!==brand(catalog))return {ok:false,reason:'Marca diferente'};
  const a=family(stock),b=family(catalog);if(!a||!b||a!==b)return {ok:false,reason:'Tipo de producto diferente'};
  const w1=weight(stock),w2=weight(catalog);if(!w1||!w2||Math.abs(w1-w2)>Math.max(8,w1*.02))return {ok:false,reason:'Gramaje diferente'};
  const k1=pack(stock),k2=pack(catalog);if(k1&&k2&&k1!==k2)return {ok:false,reason:'Envase diferente'};
  const l1=line(stock),l2=line(catalog);if(l1!==l2){if(l1||l2)return {ok:false,reason:'Línea o fórmula diferente'}}
  const f1=flavors(stock),f2=flavors(catalog);if(f1==='unknown'||f2==='unknown')return {ok:false,reason:'Confirmá el sabor antes de vincular'};
  if(f1&&f2&&f1!==f2)return {ok:false,reason:'Sabor diferente'};
  if(f1&&!f2&&f1!=='neutro')return {ok:false,reason:'La ficha comercial no especifica el sabor'};
  let needsReview=!k1||!k2||!f1||!f2;
  if(a==='proteina'&&!l1&&!l2&&norm(stock.name)!==norm(catalog.name))needsReview=true;
  return {ok:true,confidence:needsReview?'review':'exact',reason:needsReview?'Coincidencia posible: confirmá sabor, envase y línea':'Marca, tipo, gramaje, envase y sabor compatibles'};
}
export function rankedMatches(stock,commercial){
 return commercial.filter(x=>!String(x.id||'').startsWith('combo-')).map(p=>({product:p,...matchInfo(stock,p)})).filter(x=>x.ok).sort((a,b)=>(a.confidence==='exact'?-1:0)-(b.confidence==='exact'?-1:0)).slice(0,6);
}
// Only an item with literally unverified flavor can be identified this way.
// This does NOT silently treat an unverified flavor as "Neutro".
export function flavorOf(product){return flavors(product)}
export function confirmableUnknownFlavor(stock,catalog){
 if(!stock||flavors(stock)!=='unknown')return false;
 const confirmed=flavors(catalog);
 if(!confirmed||confirmed==='unknown')return false;
 const effective={...stock,size:String(stock.size||'').replace(/sabor por verificar|sabor a confirmar|por definir/i,confirmed.replace(/-/g,' '))};
 return matchInfo(effective,catalog).ok;
}
export function rankedUnknownFlavorCandidates(stock,commercial){
 if(!stock||flavors(stock)!=='unknown')return [];
 return commercial.filter(p=>confirmableUnknownFlavor(stock,p)).sort((a,b)=>String(a.size).localeCompare(String(b.size),'es')).slice(0,16);
}
