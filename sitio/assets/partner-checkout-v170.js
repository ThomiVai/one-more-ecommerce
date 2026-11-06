// No guarda datos del comprador. Confirmación siempre explícita en el checkout actual.
export function partnerStorage(target=globalThis){
 try{return target.localStorage}catch{return null}
}
export function initialPartnerCode(search,storage,now=Date.now()){
 const p=new URLSearchParams(search);const raw=p.has('partner')?p.get('partner'):null;
 if(raw!==null){const code=raw.trim().toUpperCase();if(!code)return '';return /^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code)?code:''}
 try{const saved=JSON.parse(storage.getItem('om-partner-v160')||'null');return saved&&now>=saved.saved_at&&now-saved.saved_at<7*86400000&&/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(saved.code)?saved.code:''}catch{return ''}
}
export function savePartnerCode(storage,value,now=Date.now()){
 try{const code=value.trim().toUpperCase();if(/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code))storage.setItem('om-partner-v160',JSON.stringify({code,saved_at:now}));else storage.removeItem('om-partner-v160')}catch{}
}
export function inquiryMessage(summary,code,confirmed,id){
 return summary+'\n\nConsulta Partners: '+id+'\nCódigo Partners declarado: '+(code||'sin código')+'\nRecomendación confirmada por comprador: '+(code&&confirmed?'SÍ':'PENDIENTE / sin atribución')+'\nSin descuento ni beneficio. Consulta sujeta a recepción y revisión manual.';
}
export async function prepareInquiry(fetcher,payload){
 const r=await fetcher('/api/partner-inquiries',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
 let d;try{d=await r.json()}catch{throw Error('No se pudo verificar el registro. Reintentá sin cambiar los datos.')}
 if(!r.ok)throw Error(d.error||'No se pudo preparar la consulta.');if(!d.id)throw Error('Respuesta incompleta. Reintentá sin cambiar los datos.');return d;
}
