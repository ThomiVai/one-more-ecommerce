// Etiquetas visuales; no modifica productos, IDs, precios ni variantes.
const measurePattern=/(\d+(?:[.,]\d+)?)\s*(kg|gr(?:amos?)?|g|lb|lbs|ml|l|cápsulas?|capsulas?|caps?|tabletas?|comprimidos?|servicios?|unidades?|u)\b/i;
const clean=s=>String(s??'').trim().replace(/\s+/g,' ');
function measure(s){const m=clean(s).match(measurePattern);if(!m)return null;const unit=m[2].toLowerCase().replace(/^gr(?:amos?)?$/,'g').replace(/^lbs$/,'lb');return {value:m[1].replace(',','.'),unit,text:m[1]+' '+unit};}
export function cardTitle(product={}){
 const name=clean(product.name);if(!name)return 'PRODUCTO';
 const size=clean(product.size||product.displaySize).split(/\s*[·•]\s*/)[0];const amount=measure(size);
 // Si ya tiene cantidad, se conserva el nombre sin agregar otra medida.
 if(!amount||measure(name))return name.toLocaleUpperCase('es-AR');
 const packaging=name.match(/\s+(en\s+pote|en\s+bolsa|doypack|en\s+sobre|en\s+frasco)\s*$/i);
 const title=packaging?name.slice(0,packaging.index)+' '+amount.text+' '+packaging[1]:name+' '+amount.text;
 return title.toLocaleUpperCase('es-AR');
}
