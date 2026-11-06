export function calculateQuote(lines,shipping=0){
 if(!Array.isArray(lines)||lines.length<1||lines.length>4)throw Error('Elegí de 1 a 4 variantes.');
 if(!Number.isSafeInteger(shipping)||shipping<0||shipping>99999999999)throw Error('Revisá el envío cobrado aparte.');
 const ids=new Set();let units=0,subtotal=0,cost=0;
 const items=lines.map(l=>{
  if(typeof l.product_id!=='string'||!l.product_id||ids.has(l.product_id))throw Error('No repitas una variante; ajustá su cantidad.');ids.add(l.product_id);
  if(!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>4)throw Error('Ingresá cantidades enteras entre 1 y 4.');
  for(const n of [l.acquisition_cents,l.other_cents])if(!Number.isSafeInteger(n)||n<0||n>99999999999)throw Error('Costos inválidos.');
  if(!l.acquisition_cents)throw Error('Confirmá un costo de compra mayor que cero.');
  const real=l.acquisition_cents+l.other_cents,price=Number((BigInt(real)*103n+99n)/100n);
  units+=l.quantity;subtotal+=price*l.quantity;cost+=real*l.quantity;
  return {...l,unit_price_cents:price,line_total_cents:price*l.quantity};
 });
 if(units>4)throw Error('La cotización admite hasta 4 unidades en total.');
 return {items,units,real_cost_cents:cost,subtotal_cents:subtotal,shipping_cents:shipping,total_cents:subtotal+shipping,benefits_enabled:false};
}
export const quoteMoney=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(n/100);
export function quoteSummary(q,lines,name){return ['ONE MORE Partners - cotización interna de prueba',`Entrenador: ${name}`,...lines.map(l=>`${l.quantity} × ${l.brand} ${l.name} ${l.size}: ${quoteMoney(l.unit_price_cents)} por unidad · ${quoteMoney(l.line_total_cents)}`),`Productos: ${quoteMoney(q.subtotal_cents)}`,`Envío aparte: ${quoteMoney(q.shipping_cents)}`,`Total: ${quoteMoney(q.total_cents)}`,'Borrador de prueba. Confirmar precio y disponibilidad antes de ofrecerlo. No confirma pedido ni reserva productos.'].join('\n')}
