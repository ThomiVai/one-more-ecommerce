// Preparación comercial y simulación local. Sin persistencia ni operaciones de venta.
export const partnerPolicy = Object.freeze({
 version:163, status:'prepared', benefits_enabled:false,
 pricing:Object.freeze({basis:'real_cost',markup_basis_points:500}),
 welcome:Object.freeze({max_units:4,validity_days:30,starts_on:'manual_enablement',requires_prior_referrals:false,eligible_products:'any_available',renewal:null}),
 shipping:Object.freeze({hurlingham:'free_to_partner',outside:'quote_before_purchase'}),
 sales_target:null, attribution_conflict_rule:null
});

export function parseMoney(value){
 const text=String(value).trim();
 if(!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(text))throw Error('Ingresá un importe positivo o cero, sin separadores de miles y con hasta dos decimales.');
 const [whole,fraction='']=text.replace(',','.').split('.');
 return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}

export function simulatePartnerPrice({purchase,extra,quantity,absorbedDelivery}){
 for(const n of [purchase,extra,absorbedDelivery])if(!Number.isSafeInteger(n)||n<0||n>99999999999)throw Error('Costo inválido.');
 if(purchase===0)throw Error('El costo de compra debe ser mayor que cero.');
 if(!Number.isInteger(quantity)||quantity<1||quantity>partnerPolicy.welcome.max_units)throw Error('El cupo de bienvenida permite de 1 a 4 unidades.');
 const realCost=(purchase+extra)*quantity+absorbedDelivery;
 // Redondeo hacia arriba al centavo para conservar al menos el recargo elegido.
 const price=Number((BigInt(realCost)*105n+99n)/100n);
 return Object.freeze({quantity,realCost,price,contribution:price-realCost,benefits_enabled:false});
}

const money=cents=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(cents/100);
export function mountPartnerPolicy(target){
 target.innerHTML=`<section class="card p-card"><h2>Partners · condiciones preparadas</h2>
 <p><b>Costo real + 5%</b>. El costo real incluye compra al proveedor y todos los gastos variables que absorba ONE MORE.</p>
 <p>Bienvenida: <b>hasta 4 unidades en total</b>, de cualquier producto disponible, repetidas o combinadas, aunque el entrenador todavía no haya conseguido referidos. El cupo vence <b>30 días después de su habilitación</b>.</p>
 <p>Entrega gratis para el entrenador dentro de <b>Hurlingham</b>. Fuera de Hurlingham se cotiza y confirma el costo antes de aceptar la compra.</p>
 <p class="hint">Beneficios desactivados. Estas condiciones no asignan un cupo ni modifican precios del catálogo, acuerdos históricos, compras, ventas o stock. La habilitación real todavía no está implementada.</p>
 <h3>Simular precio partner</h3><p>Ejemplo para unidades del mismo costo. Para productos diferentes, simulá cada uno y repartí los gastos sin duplicarlos. Los importes no se guardan.</p>
 <form id="pp-simulator" class="p-form">
 <label for="pp-purchase">Costo de compra por unidad ($)</label><input id="pp-purchase" name="purchase" inputmode="decimal" placeholder="Ej.: 20000" required>
 <label for="pp-extra">Otros costos reales por unidad ($)</label><input id="pp-extra" name="extra" inputmode="decimal" value="0" required>
 <p class="hint">Incluí embalaje, comisiones, impuestos variables y otros gastos absorbidos. Si una comisión depende del precio final, calculala e incorporala antes de usar el resultado.</p>
 <label for="pp-quantity">Unidades del mismo costo (1 a 4)</label><input id="pp-quantity" name="quantity" type="number" min="1" max="4" step="1" value="1" required>
 <label for="pp-delivery">Costo de entrega que absorbe ONE MORE por todo este pedido ($)</label><input id="pp-delivery" name="delivery" inputmode="decimal" value="0" required>
 <p class="hint">Gratis para el entrenador no significa costo cero para ONE MORE. Cargá el gasto de entrega que absorben. Un envío cobrado aparte al comprador no está incluido en este precio.</p>
 <button class="button secondary" type="submit">Calcular costo + 5%</button>
 <div id="pp-result" role="status" aria-live="polite"></div></form>
 <h3>Pendiente de aprobación</h3><ul><li>Meta de ventas referidas y condiciones de renovación, pausa y reactivación.</li><li>Regla de atribución cuando dos entrenadores recomiendan al mismo comprador.</li></ul>
 <p>Las sugerencias anteriores de meta y atribución no se consideran aprobadas. El cupo inicial no se renueva automáticamente.</p></section>`;
 const field=id=>target.querySelector('#'+id);
 const result=field('pp-result'),form=field('pp-simulator');
 form.addEventListener('input',()=>{result.textContent='Los valores cambiaron. Volvé a calcular.';});
 form.addEventListener('submit',event=>{
  event.preventDefault();
  try{
   const quantityText=field('pp-quantity').value.trim();
   if(!/^[1-4]$/.test(quantityText))throw Error('El cupo de bienvenida permite de 1 a 4 unidades.');
   const r=simulatePartnerPrice({purchase:parseMoney(field('pp-purchase').value),extra:parseMoney(field('pp-extra').value),quantity:Number(quantityText),absorbedDelivery:parseMoney(field('pp-delivery').value)});
   result.textContent=`Simulación para ${r.quantity} unidad(es): costo real total ${money(r.realCost)} · Precio partner total ${money(r.price)} · Diferencia sobre costos cargados ${money(r.contribution)}. No es ganancia neta. No incluye gastos omitidos. Beneficios desactivados.`;
  }catch(error){result.textContent=error.message;}
 });
}
