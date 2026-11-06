// Identidad compartida por interfaz y servidor. Solo calcula; no escribe datos.
import {matchInfo,flavorOf} from './stock-matching-v1282.js';
export const identityText=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
export function flavorKey(p){const known=flavorOf(p);if(known)return known;const parts=String(p.size||'').split('·').map(x=>x.trim());const last=parts.at(-1);return parts.length>1&&!/^(pote|doypack|frasco|bolsa|sachet|pack|capsulas|caps)$/i.test(last)?identityText(last):''}
export function packageKey(p){return identityText(p.packaging||(/doy\s*pack/i.test((p.name||'')+' '+p.size)?'doypack':/pote|frasco/i.test((p.name||'')+' '+p.size)?'pote':''))}
export function samePresentation(a,b){
 const ka=packageKey(a),kb=packageKey(b);if(ka&&kb&&ka!==kb)return false;
 const neutral=p=>({...p,name:p.name,size:String(p.size||'').split('·')[0]+' · Neutro'});
 return matchInfo(neutral(a),neutral(b)).ok||identityText(String(a.size||'').split('·')[0])===identityText(String(b.size||'').split('·')[0]);
}
export function sameVariant(a,b){return identityText(a.brand)===identityText(b.brand)&&identityText(a.name)===identityText(b.name)&&samePresentation(a,b)&&flavorKey(a)===flavorKey(b)}
export function buildPurchaseVariant(parent,flavor){
 const f=String(flavor||'').trim();if(f.length<2||f.length>80||/[\n\r·<>]/.test(f)||/por verificar|por definir|a confirmar|surtid|variad/i.test(f))throw Error('Escribí el sabor exacto que figura en el envase.');
 if(!parent||String(parent.id||'').startsWith('combo-'))throw Error('Elegí un producto individual existente.');
 const parts=String(parent.size||'').split('·').map(x=>x.trim()).filter(Boolean);if(!parts.length)throw Error('Esta ficha no tiene una presentación verificable. Revisala en Productos.');
 if(parts.length===1&&flavorOf({name:'',size:parts[0]}))throw Error('La presentación de esa ficha requiere revisión antes de agregar sabores.');
 const base=parts.length>1&&flavorKey(parent)?parts.slice(0,-1).join(' · '):parts.join(' · ');
 return {...parent,id:'pending-variant',commercialId:null,physicalId:null,size:base+' · '+f,status:'draft',price:null,image_url:'',catalogImage:'',cardImage:'',quantity:0,cost_cents:null,registered:false,newProduct:true,variantGroup:parent.variantGroup||parent.group_id||'parent:'+parent.id};
}
export function compatibleHistorical(physical,variant){
 if(identityText(physical.brand)!==identityText(variant.brand)||!samePresentation(physical,variant))return false;
 const f=flavorKey(physical),v=flavorKey(variant);
 if(f&&f!=='unknown'&&v&&f!==v)return false;
 // La heurística anterior controla fórmulas conocidas; el nombre exacto habilita otras categorías.
 const effective=f==='unknown'?{...physical,size:String(physical.size).replace(/sabor por verificar|sabor a confirmar|por definir/i,String(variant.size).split('·').at(-1))}:physical;
 return matchInfo(effective,variant).ok||identityText(physical.name)===identityText(variant.name);
}
export function historicalCandidates(items,variant){return items.filter(p=>p.physicalId&&!p.commercialId&&compatibleHistorical(p,variant))}
export function purchaseSuggestions(description,items){
 const text=identityText(description).replace(/[^a-z0-9]+/g,' '),tokens=new Set(text.split(' ').filter(t=>t.length>2));if(!tokens.size)return [];
 return items.filter(p=>p.commercialId&&!p.archived).map(p=>{const brand=identityText(p.brand).split(/\W+/).filter(t=>t.length>2&&!['nutrition','sport'].includes(t));const words=identityText(p.name+' '+p.size).split(/\W+/).filter(t=>t.length>2);const score=brand.some(w=>tokens.has(w))?5:0;return {product:p,score:score+words.filter(w=>tokens.has(w)).length}}).filter(x=>x.score>=4).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.product);
}

export const identityStamp=p=>[identityText(p.brand),identityText(p.name),identityText(p.size),packageKey(p)].join('|');
