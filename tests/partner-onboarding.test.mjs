import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotAgreementTemplate} from '../sitio/assets/partner-onboarding-v170.js';
test('Plantilla del piloto conserva las condiciones y no inicia ni confirma beneficios',()=>{
 const text=pilotAgreementTemplate();
 assert.ok(text.length<4000);assert.match(text,/4 unidades/);assert.match(text,/costo real completo \+ 3%/);
 assert.match(text,/30 días/);assert.match(text,/Sin metas obligatorias/);assert.match(text,/no inicia el plazo ni habilita descuentos/);
 assert.match(text,/no se acumulan/);assert.doesNotMatch(text,/80\.000|60 días/);
});
