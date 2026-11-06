import {createPeriodTools} from './partner-periods-v166.js';
import {pilotAgreementTemplate} from './partner-onboarding-v165.js';
import {mountPartnerPolicy} from './partner-policy-v166.js';
import {createPartnerActivityTools} from './partner-activity-v161.js';
import {createInquiriesTools} from './inquiries-panel-v160.js';
import {createOutreachTools,operationKey} from './partners-outreach-v165.js';
import {createReferralsTools} from './referrals-panel-v142.js';
export function createPartnersTools({$,esc,api,showDrawer,confirmDialog,toast,user,isCurrent}){
 const referrals=createReferralsTools({$,esc,api,showDrawer,confirmDialog,toast,user,isCurrent});
 const inquiries=createInquiriesTools({$,esc,api,showDrawer,toast,user,isCurrent:()=>isCurrent()&&tab==='inquiries',reviewSale:id=>{tab='referrals';redraw();referrals.review(id)}});
 const periods=createPeriodTools({$,esc,api,showDrawer,toast,user,isCurrent,onDone:async id=>{if(tab==='periods')await redraw();return detail(id);},onOpen:id=>detail(id)});
 const activity=createPartnerActivityTools({$,esc,api,toast,user,isCurrent,onInquiry:id=>{tab='inquiries';redraw();inquiries.detail(id)},onSale:id=>{tab='referrals';redraw();referrals.review(id)}});
 let detailToken=0;let token=0,tab='partners',q='',after='',next=null,items=[],selectedPartner=null;
 const outreach=createOutreachTools({$,esc,api,showDrawer,toast,user,isCurrent:()=>isCurrent()&&tab==='summary'});
 const labels={candidate:'Candidato',active:'Activo',paused:'Pausado',closed:'Cerrado'};
 const personal=()=>user()?.role==='admin'&&!user()?.shared;
 const tabs=[['summary','Captación'],['partners','Partners'],['inquiries','Consultas de compra'],['referrals','Ventas y referidos'],['periods','Revisiones mensuales'],['benefits','Beneficios'],['settings','Configuración']];
 const clear=()=>{periods.clear();activity.clear();outreach.reset();referrals.clear();inquiries.clear();token++;detailToken++;items=[];selectedPartner=null;q='';after='';next=null;};
 const title=()=>`<div class="page-head"><div><span class="eyebrow">CRECER CON PERSONAS</span><h1>ONE MORE PARTNERS</h1><p>Entrenadores y acuerdos en un solo lugar.</p></div>${personal()?'<button class="button primary" id="p-add-trainer">Agregar entrenador</button>':''}</div>`;
 function page(){return title()+(personal()?`<div class="tabs p-tabs">${tabs.map(([id,label])=>`<button class="tab ${id===tab?'active':''}" data-p-tab="${id}">${label}</button>`).join('')}</div><p class="hint">Preproducción: ventas vinculadas y revisión manual. Las consultas conservan el código declarado y su confirmación; las ventas requieren revisión manual. Beneficios desactivados.</p><div id="partners-content" aria-live="polite">Cargando…</div>`:'<div class="card p-card"><h2>Usá tu cuenta personal</h2><p>Esta sección requiere un usuario personal administrador. Entrá desde Mi cuenta o cerrá sesión para cambiar de usuario.</p></div>');}
 async function mount(){
  const current=++token,account=user()?.id;
  if($('p-add-trainer'))$('p-add-trainer').onclick=addTrainer;
  document.querySelectorAll('[data-p-tab]').forEach(b=>b.onclick=()=>{periods.clear();referrals.clear();inquiries.clear();tab=b.dataset.pTab;redraw();});
  if(!personal())return;
  const target=$('partners-content');
  if(tab==='summary'){await outreach.mount(target);return;}
  if(tab==='inquiries'){await inquiries.mount();return;}
  if(tab==='referrals'){await referrals.mount();return;}
  if(tab==='periods'){await periods.mountDue(target);return;}
  if(tab==='benefits'){
   mountPartnerPolicy(target);return;
  }
  if(tab==='settings'){
   target.innerHTML='<section class="card p-card"><h2>Un comienzo acotado</h2><p>Un solo programa: ONE MORE PARTNERS. Condiciones comerciales por acuerdo, sin descuentos automáticos.</p><ul><li>Cuentas personales administradoras.</li><li>Códigos únicos que no se reutilizan.</li><li>Acuerdos confirmados conservados sin reescritura.</li><li>Sin cambios de catálogo, caja, ventas ni existencias.</li></ul><p>Condiciones preparadas: hasta 4 unidades de cualquier producto disponible durante 30 días y costo real + 5%. Revisión manual cada 30 días, sin metas obligatorias. Unidades no usadas vencen; continuidad a decidir en la revisión. Beneficios desactivados.</p></section>';return;
  }
  try{
   const data=await api('/api/admin/partners?'+new URLSearchParams({q,after}));
   if(current!==token||!isCurrent()||user()?.id!==account||!$('partners-content'))return;
   items=data.items;next=data.next;
   if(tab==='summary'){
    target.innerHTML='<section class="card p-card"><h2>Prepará tus primeros acuerdos</h2><p>Registrá al cliente, creá su ficha de partner y dejá por escrito qué ofrecieron. Desde Referidos y ventas podés vincular ventas existentes, verificar sus datos y revisar el margen de contribución informado.</p><button class="button primary" id="p-start">Ver partners</button></section>';
    $('p-start').onclick=()=>{tab='partners';redraw();};return;
   }
   target.innerHTML=`<section class="card p-card"><div class="p-toolbar"><form id="p-search"><label class="sr-only" for="p-query">Buscar partner</label><input id="p-query" value="${esc(q)}" maxlength="100" placeholder="Nombre, código o Instagram"><button class="button secondary" type="submit">Buscar</button></form></div><div class="table-wrap"><table class="table"><thead><tr><th>Partner</th><th>Código</th><th>Estado</th><th>Ficha</th></tr></thead><tbody>${items.map(p=>`<tr><td><b>${esc(p.customer_name)}</b><small>${p.instagram?'@'+esc(p.instagram):'Sin Instagram registrado'}</small></td><td>${esc(p.code)}</td><td>${labels[p.status]}</td><td><button class="text-button" data-p-detail="${esc(p.id)}">Abrir</button></td></tr>`).join('')||'<tr><td colspan="4">Todavía no hay partners en esta búsqueda.</td></tr>'}</tbody></table></div><div class="p-actions"><button class="button secondary" id="p-first" ${after?'':'disabled'}>Volver al inicio</button><button class="button secondary" id="p-next" ${next?'':'disabled'}>Siguientes</button></div></section>`;
   $('p-search').onsubmit=e=>{e.preventDefault();q=$('p-query').value.trim();after='';redraw();};
   $('p-first').onclick=()=>{after='';redraw();};$('p-next').onclick=()=>{after=next;redraw();};
   target.querySelectorAll('[data-p-detail]').forEach(b=>b.onclick=()=>detail(b.dataset.pDetail));
  }catch(e){if(current===token&&isCurrent()&&$('partners-content'))$('partners-content').innerHTML=`<section class="card p-card" role="alert"><h2>Revisá la preparación</h2><p>${esc(e.message)}</p><button class="button secondary" id="p-retry">Volver a intentar</button></section>`;if($('p-retry'))$('p-retry').onclick=redraw;}
 }
 function redraw(){if(!isCurrent())return;$('main').innerHTML=page();return mount();}
 function addTrainer(){
  if(!personal()||!isCurrent())return;detailToken++;
  showDrawer('PARTNERS','Agregar entrenador',`<div class="p-form"><p>Elegí el momento de la conversación. No necesitás registrar un cliente por separado.</p><button class="button secondary" id="p-start-contact">Todavía vamos a contactarlo</button><p>Guardá su perfil y seguí la conversación. El código se prepara cuando acuerden sumarlo.</p><button class="button primary" id="p-start-member">Ya acordamos sumarlo</button><p>Buscá si ya está registrado y prepará su ficha, código y condiciones. Los beneficios siguen desactivados.</p></div>`);
  $('p-start-contact').onclick=async()=>{tab='summary';await redraw();await outreach.begin();};
  $('p-start-member').onclick=()=>partnerForm();
 }
 function submit(formId,body,success){
  let key=operationKey(),signature=null;
  $(formId).onsubmit=async e=>{
   e.preventDefault();const account=user()?.id,form=e.currentTarget,btn=form.querySelector('[type="submit"]'),error=form.querySelector('[role="alert"]');
   try{const b=body(),serialized=JSON.stringify(b);if(signature!==null&&signature!==serialized)key=operationKey();signature=serialized;btn.disabled=true;error.textContent='';
    const result=await api('/api/admin/partners',{method:'POST',body:JSON.stringify({...b,operation_key:key})});
    if(!personal()||!isCurrent()||user()?.id!==account||!form.isConnected)return;await success(result);
   }catch(err){if(error?.isConnected)error.textContent=err.message;}finally{if(btn?.isConnected)btn.disabled=false;}
  };
 }
 function customerForm(draft={}){detailToken++;
  showDrawer('PARTNERS','Datos del entrenador',`<form id="p-customer-form" class="p-form"><p>Completá sus datos una sola vez. Después volvés a su incorporación con el código que ya escribiste. Si el contacto es compartido, dejalo pendiente.</p><label for="p-customer-name">Nombre</label><input id="p-customer-name" value="${esc(draft.query||'')}" required minlength="2" maxlength="100" autocomplete="name"><label for="p-contact-kind">Contacto (opcional)</label><select id="p-contact-kind"><option value="">Sin contacto confirmado</option><option value="phone">Teléfono completo</option><option value="email">Email</option></select><label for="p-contact-value">Teléfono con + y país, o email</label><input id="p-contact-value" maxlength="150" placeholder="Ej.: +54911…"><label class="receiving-check"><input id="p-contact-confirm" type="checkbox"><span>Verifiqué el número completo o email con el cliente. Esto no certifica que sea un comprador nuevo.</span></label><p role="alert" class="form-error"></p><button class="button primary" type="submit">Guardar datos y continuar</button></form>`);
  submit('p-customer-form',()=>({action:'customer-create',name:$('p-customer-name').value,contact_kind:$('p-contact-kind').value,contact_value:$('p-contact-value').value,contact_confirmed:$('p-contact-confirm').checked}),r=>{const name=$('p-customer-name').value;toast('Datos guardados. Continuá con la incorporación.');partnerForm({id:r.id,name},draft);});
 }
 async function partnerForm(customer=null,draft={}){detailToken++;
  showDrawer('PARTNERS','Incorporar entrenador',`<form id="p-partner-form" class="p-form"><p>Primero buscá por nombre o contacto. Si ya es cliente, usamos esa misma persona y conservamos sus ventas. Si no existe, podés cargar sus datos desde acá.</p><label for="p-customer-query">Buscar persona por nombre o contacto</label><div class="p-inline"><input id="p-customer-query" value="${esc(draft.query||'')}" maxlength="100"><button type="button" class="button secondary" id="p-find-customer">Buscar</button></div><label for="p-customer-select">Persona registrada</label><select id="p-customer-select" required>${customer?`<option value="${esc(customer.id)}">${esc(customer.name)}</option>`:'<option value="">Buscá y elegí la persona correcta</option>'}</select><button type="button" class="text-button" id="p-create-from-partner" disabled>Buscá primero; si no existe, completá sus datos</button><p class="form-help" id="p-customer-page"></p><button type="button" class="text-button" id="p-customer-more" hidden>Ver más clientes</button><label for="p-code">Código permanente</label><input id="p-code" value="${esc(draft.code||'')}" required minlength="4" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9-]{3,19}" placeholder="Ej.: MICA-ONE" autocapitalize="characters"><small class="form-help">No se cambia ni se reutiliza. Se declara en la consulta; no concede descuentos ni confirma ventas.</small><label for="p-instagram">Instagram (opcional)</label><input id="p-instagram" value="${esc(draft.instagram||'')}" maxlength="31" placeholder="usuario, sin enlace"><p role="alert" class="form-error"></p><button class="button primary" type="submit">Preparar incorporación</button></form>`);
  let customerNext=null,query='',searchVersion=0;const form=$('p-partner-form'),searchAccount=user()?.id;
  const find=async append=>{const version=++searchVersion;try{query=$('p-customer-query').value.trim();const data=await api('/api/admin/partners?'+new URLSearchParams({mode:'customers',q:query,after:append?customerNext||'':''}));if(!form.isConnected||version!==searchVersion||user()?.id!==searchAccount)return;
   const options=data.items.filter(c=>c.status==='active').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
   if(append)$('p-customer-select').insertAdjacentHTML('beforeend',options);else $('p-customer-select').innerHTML='<option value="">Elegí la persona correcta…</option>'+options;
   $('p-create-from-partner').disabled=false;$('p-create-from-partner').textContent='No está en los resultados: completar sus datos';customerNext=data.next;$('p-customer-more').hidden=!customerNext;$('p-customer-page').textContent='Se muestran hasta 30 personas por tanda. Revisá más resultados si hay nombres iguales.';
  }catch(e){if(form.isConnected)form.querySelector('[role="alert"]').textContent=e.message;}};
  $('p-find-customer').onclick=()=>find(false);$('p-customer-more').onclick=()=>find(true);$('p-customer-query').oninput=()=>{searchVersion++;$('p-create-from-partner').disabled=true;};$('p-create-from-partner').onclick=()=>customerForm({query:$('p-customer-query').value.trim(),code:$('p-code').value,instagram:$('p-instagram').value});
  submit('p-partner-form',()=>({action:'partner-create',customer_id:$('p-customer-select').value,code:$('p-code').value,instagram:$('p-instagram').value}),r=>{toast('Incorporación preparada. Revisá y registrá las condiciones del piloto.');redraw();return detail(r.id);});
 }
 async function detail(partnerId){
  periods.clear();activity.clear();
  const currentDetail=++detailToken,account=user()?.id;showDrawer('PARTNERS','Ficha del partner','<p>Cargando…</p>');const drawerToken=$('drawer-body');
  try{const d=await api('/api/admin/partners?'+new URLSearchParams({mode:'detail',id:partnerId}));if(currentDetail!==detailToken||!isCurrent()||!personal()||user()?.id!==account||!$('drawer').open)return;
   selectedPartner=d.partner;const p=d.partner;
   $('drawer-title').textContent=p.customer_name;
   drawerToken.innerHTML=`<div class="p-form"><p><b>Código ${esc(p.code)}</b> · ${labels[p.status]}</p><p>${p.instagram?'Instagram: @'+esc(p.instagram):'Sin Instagram registrado'}</p><div class="hint">Ningún acuerdo de esta etapa habilita descuentos ni descuenta mercadería.</div><section id="p-activity-panel" aria-live="polite"><p>Cargando actividad…</p></section><section id="p-periods-panel" aria-live="polite"><p>Cargando cupo de prueba…</p></section><h3>Contacto</h3>${d.contacts.map(c=>`<p>${esc(c.value)} · confirmado manualmente</p>`).join('')||'<p>Sin contacto confirmado. No cuenta como cliente nuevo verificado.</p>'}<h3>Estado</h3><select id="p-status" ${p.status==='closed'?'disabled':''}>${Object.entries(labels).map(([v,l])=>`<option value="${v}" ${p.status===v?'selected':''}>${l}</option>`).join('')}</select><button class="button secondary" id="p-save-status" ${p.status==='closed'?'disabled':''}>Guardar estado</button><p class="form-help">Para activar la ficha hace falta un acuerdo confirmado. Cerrar es definitivo: el historial y el código se conservan.</p><h3>Acuerdos</h3><button class="button primary" id="p-new-agreement" ${p.status==='closed'?'disabled':''}>Registrar acuerdo</button>${d.agreements.map(a=>`<article class="p-agreement"><strong>${a.kind==='prior_commitment'?'Compromiso anterior':'Acuerdo de piloto'} · ${a.status==='draft'?'Borrador':'Confirmado'}</strong><p class="detail-pre">${esc(a.terms)}</p><small>${a.unresolved?'Tiene condiciones pendientes. No puede confirmarse.':a.confirmed_by?'Confirmado por '+esc(a.confirmed_by):'Términos completos, pendiente de confirmación.'}</small>${a.status==='draft'&&!a.unresolved&&p.status!=='closed'?`<p><button class="button secondary" data-p-confirm="${esc(a.id)}" data-revision="${a.revision}">Confirmar acuerdo</button></p>`:''}</article>`).join('')||'<p>Todavía no hay acuerdos. Registrá exactamente lo que prometieron.</p>'}<small>Se muestran los últimos 100 acuerdos. Los anteriores se conservan en la base.</small><h3>Historial</h3>${d.events.map(e=>`<p><b>${esc(e.action)}</b><br><small>${esc(e.created_at)} UTC · ${esc(e.actor)}</small></p>`).join('')}<small>Se muestran los últimos 100 eventos. No se borran registros anteriores.</small></div>`;
   activity.mount($('p-activity-panel'),p.id);periods.mount($('p-periods-panel'),p,d.agreements);
   $('p-new-agreement').onclick=()=>agreementForm(p);
   $('p-save-status').onclick=()=>{const status=$('p-status').value,key=operationKey();confirmDialog('Confirmar estado',`<p>${esc(p.customer_name)} pasará a <b>${labels[status]}</b>.</p><p>${status==='closed'?'El cierre no se revierte desde esta versión.':'El cambio no habilita descuentos.'}</p>`,'Guardar estado',async()=>{await api('/api/admin/partners',{method:'POST',body:JSON.stringify({action:'partner-update',id:p.id,status,expected_revision:p.revision,operation_key:key})});toast('Estado guardado.');redraw();await detail(p.id);});};
   drawerToken.querySelectorAll('[data-p-confirm]').forEach(b=>b.onclick=()=>{const key=operationKey();confirmDialog('Confirmar lo acordado','<p>Confirmo que estos términos están completos y reflejan lo conversado. Se conservarán sin reescritura. Esto no concede un beneficio.</p>','Confirmar acuerdo',async()=>{await api('/api/admin/partners',{method:'POST',body:JSON.stringify({action:'agreement-confirm',id:b.dataset.pConfirm,expected_revision:Number(b.dataset.revision),confirmed:true,operation_key:key})});toast('Acuerdo confirmado y conservado.');await detail(p.id);});});
  }catch(e){if(currentDetail===detailToken&&$('drawer').open&&isCurrent())$('drawer-body').innerHTML=`<p role="alert">${esc(e.message)}</p>`;}
 }
 function agreementForm(p){detailToken++;
  showDrawer('PARTNERS','Registrar acuerdo',`<form id="p-agreement-form" class="p-form"><p>Partner: <b>${esc(p.customer_name)}</b>. Conservá lo ofrecido originalmente. Para corregir o completar un borrador anterior, registrá otro acuerdo; el previo se conserva.</p><label for="p-agreement-kind">Tipo</label><select id="p-agreement-kind"><option value="prior_commitment">Compromiso anterior</option><option value="pilot">Acuerdo de piloto nuevo</option></select><button class="button secondary" type="button" id="p-use-pilot">Usar condiciones del piloto</button><p class="form-help">Completa un texto vacío con las condiciones actuales. Revisalo con el entrenador; no confirma el acuerdo ni habilita beneficios.</p><label for="p-terms">Qué acordaron exactamente</label><textarea id="p-terms" required minlength="10" maxlength="4000" rows="7" placeholder="Producto/sabor/presentación, unidades, precio o condición, publicación, vigencia y cualquier excepción que hayan conversado."></textarea><label class="receiving-check"><input id="p-unresolved" type="checkbox" checked><span>Quedan condiciones por definir. Guardar como borrador pendiente.</span></label><p role="alert" class="form-error"></p><button class="button primary" type="submit">Guardar borrador</button></form>`);
  $('p-use-pilot').onclick=()=>{if($('p-terms').value.trim()){toast('El texto ya tiene contenido. Conservalo o vacialo antes de usar la plantilla.',true);return;}$('p-agreement-kind').value='pilot';$('p-terms').value=pilotAgreementTemplate();};
  submit('p-agreement-form',()=>({action:'agreement-create',partner_id:p.id,kind:$('p-agreement-kind').value,terms:$('p-terms').value,unresolved:$('p-unresolved').checked}),()=>{toast('Borrador guardado. Se conserva el historial.');return detail(p.id);});
 }
 return {page,mount,clear};
}
