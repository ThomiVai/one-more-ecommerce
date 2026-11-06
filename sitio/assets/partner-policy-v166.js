// Preparación comercial y simulación local. Sin persistencia ni operaciones de venta.
export const partnerPolicy = Object.freeze({
 version:166, status:'prepared', benefits_enabled:false,
 pricing:Object.freeze({basis:'real_cost',markup_basis_points:500}),
 welcome:Object.freeze({max_units:4,validity_days:30,starts_on:'manual_enablement',requires_prior_referrals:false,eligible_products:'any_available',unused_units:'expire_without_rollover',renewal:'manual_review'}),
 shipping:Object.freeze({hurlingham:'free_to_partner',outside:'quote_before_purchase'}),
 sales_target:null, review:Object.freeze({interval_days:30,mode:'manual',automatic_sales_conditions:false,automatic_suspension:false}), attribution_conflict_rule:null
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
 <h3>Revisión cada 30 días, sin metas de ventas obligatorias</h3><p>Conversar con cada entrenador sobre recomendaciones realizadas, consultas recibidas, ventas efectivas y dificultades. Los números sirven para aprender; no hay un importe ni una cantidad mínima exigida.</p><p>El cupo vence a los 30 días y las unidades sin usar no se acumulan. La continuidad o renovación se decide manualmente en cada revisión. No se suspende por no alcanzar una meta de ventas. Los próximos parámetros se definirán según lo aprendido en el piloto.</p><p class="hint">Beneficios desactivados. Estas condiciones no asignan un cupo ni modifican precios del catálogo, acuerdos históricos, compras, ventas o stock. V166 permite registrar períodos internos de prueba desde la ficha del entrenador; no son beneficios activos.</p>
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
 <h3>Para empezar de forma simple</h3><ol><li>Elegir 3-4 entrenadores conocidos y explicar las condiciones.</li><li>Registrar lo conversado en su ficha, sin reescribir acuerdos anteriores.</li><li>Antes de ofrecer un enlace, comprobar la versión instalada y probarlo en preproducción.</li><li>En el piloto manual, confirmar precio, unidades y entrega antes de cada compra; registrar las ventas en el circuito habitual.</li><li>Anotar fecha de inicio, compras que consumen unidades y fecha de revisión a los 30 días.</li></ol><p><b>La ficha permite probar el registro de unidades y vencimientos; la tienda todavía no aplica el beneficio.</b> En un piloto manual, ese control lo llevan Feli y Thomi con la guía incluida. La revisión mensual no asigna unidades automáticamente.</p><p>Si dos entrenadores reclaman una misma compra, dejar la atribución pendiente y consultar al comprador antes de decidir. Las ventanas automáticas de atribución y las compras recurrentes siguen sin una regla aprobada.</p></section>`;
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
