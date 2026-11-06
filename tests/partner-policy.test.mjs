import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {partnerPolicy,parseMoney,simulatePartnerPrice,mountPartnerPolicy} from '../sitio/assets/partner-policy-v170.js';

test('Condiciones aprobadas y pendientes conservan los beneficios apagados',()=>{
 assert.equal(partnerPolicy.pricing.markup_basis_points,300);
 assert.equal(partnerPolicy.welcome.max_units,4);assert.equal(partnerPolicy.welcome.validity_days,30);
 assert.equal(partnerPolicy.welcome.requires_prior_referrals,false);assert.equal(partnerPolicy.welcome.eligible_products,'any_available');
 assert.equal(partnerPolicy.welcome.renewal,'manual_review');assert.equal(partnerPolicy.sales_target,null);assert.equal(partnerPolicy.attribution_conflict_rule,null);
 assert.equal(partnerPolicy.benefits_enabled,false);assert.ok(Object.isFrozen(partnerPolicy.welcome));
});
test('Costo de proveedor más gastos por unidad y entrega absorbida reciben el 3%',()=>{
 const result=simulatePartnerPrice({purchase:2000000,extra:50000,quantity:4,absorbedDelivery:200000});
 assert.deepEqual(result,{quantity:4,realCost:8400000,price:8652000,contribution:252000,benefits_enabled:false});
 assert.equal(simulatePartnerPrice({purchase:2000000,extra:0,quantity:1,absorbedDelivery:0}).price,2060000);
});
test('Centavos se redondean sin perder el recargo y los límites no desbordan',()=>{
 assert.equal(simulatePartnerPrice({purchase:1,extra:0,quantity:1,absorbedDelivery:0}).price,2);
 for(const purchase of [1,19,101,99999999999]){
  const r=simulatePartnerPrice({purchase,extra:purchase,quantity:4,absorbedDelivery:purchase});
  assert.ok(Number.isSafeInteger(r.price));assert.ok(BigInt(r.price)*100n>=BigInt(r.realCost)*103n);
 }
});
test('Importes argentinos con coma o punto decimal; sin miles ambiguos ni coerciones',()=>{
 for(const [input,want]of [['20000',2000000],['20,50',2050],['20.5',2050],['0',0],[' 1,01 ',101]])assert.equal(parseMoney(input),want);
 for(const input of ['', '-1','1.000','1.000,50','NaN','Infinity','1e5','<img>','9999999999','1,234'])assert.throws(()=>parseMoney(input));
});
test('El cálculo rechaza costos nulos, negativos, fraccionarios y más de cuatro unidades',()=>{
 const ok={purchase:100,extra:0,quantity:1,absorbedDelivery:0};
 for(const patch of [{purchase:0},{purchase:-1},{extra:-1},{absorbedDelivery:-1},{purchase:1.5},{extra:Infinity},{quantity:0},{quantity:5},{quantity:1.5},{purchase:100000000000}])assert.throws(()=>simulatePartnerPrice({...ok,...patch}));
});
test('El formulario muestra el resultado, invalida valores viejos y no persiste ni hace peticiones',()=>{
 const listeners={},fields=Object.fromEntries(['pp-purchase','pp-extra','pp-quantity','pp-delivery','pp-result'].map(id=>[id,{value:'0',textContent:''}]));
 fields['pp-purchase'].value='20000';fields['pp-quantity'].value='1';
 fields['pp-simulator']={addEventListener:(type,fn)=>listeners[type]=fn};
 const target={innerHTML:'',querySelector:selector=>fields[selector.slice(1)]};
 mountPartnerPolicy(target);let prevented=false;listeners.submit({preventDefault(){prevented=true}});
 assert.equal(prevented,true);assert.match(fields['pp-result'].textContent,/20\.600/);assert.match(fields['pp-result'].textContent,/Beneficios desactivados/);
 listeners.input();assert.match(fields['pp-result'].textContent,/Volvé a calcular/);
 fields['pp-quantity'].value='5';listeners.submit({preventDefault(){}});assert.match(fields['pp-result'].textContent,/1 a 4/);assert.doesNotMatch(fields['pp-result'].textContent,/20\.600/);
 const source=fs.readFileSync(new URL('../sitio/assets/partner-policy-v170.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|localStorage|sessionStorage|\.innerHTML\s*\+=/);
});

test('Piloto sin metas obligatorias ni suspensión por resultados; revisión humana cada 30 días',()=>{
 assert.equal(partnerPolicy.review.interval_days,30);assert.equal(partnerPolicy.review.mode,'manual');
 assert.equal(partnerPolicy.review.automatic_sales_conditions,false);assert.equal(partnerPolicy.review.automatic_suspension,false);
 assert.equal(partnerPolicy.welcome.unused_units,'expire_without_rollover');assert.equal(partnerPolicy.sales_target,null);
 assert.equal(partnerPolicy.benefits_enabled,false);assert.ok(Object.isFrozen(partnerPolicy.review));
});
