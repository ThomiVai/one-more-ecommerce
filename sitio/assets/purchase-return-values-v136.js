// Importes exactos en centavos. Compartido por el formulario y el servidor.
const whole=(v)=>Number.isSafeInteger(v)&&v>=0;
const part=(total,n,d)=>Number((2n*BigInt(total)*BigInt(n)+BigInt(d))/(2n*BigInt(d)));
export function purchaseReturnAllocation(lines,documentTotal){
 if(!whole(documentTotal)||!Array.isArray(lines)||!lines.length||lines.some(l=>!whole(l.line_total_cents)||!Number.isSafeInteger(l.quantity)||l.quantity<1))throw Error('Los importes históricos requieren revisión antes de devolver esta compra.');
 const sum=lines.reduce((n,l)=>n+l.line_total_cents,0),weights=lines.map(l=>sum?l.line_total_cents:l.quantity),den=weights.reduce((n,w)=>n+w,0);
 if(!Number.isSafeInteger(den)||den<1)throw Error('No se puede distribuir el importe histórico.');
 let cursor=0,previous=0;const totals=new Map();
 for(let i=0;i<lines.length;i++){cursor+=weights[i];const next=part(documentTotal,cursor,den);totals.set(lines[i].id,next-previous);previous=next}
 return totals;
}
export function purchaseCredit(lineTotal,originalQuantity,returnedQuantity,quantity,creditedCents){
 if(!whole(lineTotal)||!Number.isSafeInteger(originalQuantity)||originalQuantity<1||!whole(returnedQuantity)||!Number.isSafeInteger(quantity)||quantity<1||returnedQuantity+quantity>originalQuantity)throw Error('Revisá las cantidades pendientes de devolución.');
 if(creditedCents!==undefined){if(!whole(creditedCents)||creditedCents>lineTotal)throw Error('Revisá los créditos históricos de este renglón.');return part(lineTotal-creditedCents,quantity,originalQuantity-returnedQuantity)}
 return part(lineTotal,returnedQuantity+quantity,originalQuantity)-part(lineTotal,returnedQuantity,originalQuantity);
}
