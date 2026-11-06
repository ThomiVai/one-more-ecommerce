// Una visita por código/pestaña cada 30 minutos. Sin cookies ni datos de contacto.
export async function recordPartnerVisit({url,storage,fetcher,uuid,now=Date.now()}){
 const codes=new URL(url).searchParams.getAll('partner');
 if(codes.length!==1)return {skipped:true};const code=codes[0].trim().toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code))return {skipped:true};
 const key='om_partner_visit_v169:'+code;let visit;
 try{visit=JSON.parse(storage.getItem(key)||'null')}catch{return {skipped:true}}
 if(!visit||typeof visit.id!=='string'||!Number.isFinite(visit.at)||now<visit.at||now-visit.at>=1800000){
  visit={id:uuid(),at:now,sent:false};try{storage.setItem(key,JSON.stringify(visit))}catch{return {skipped:true}}
 }
 if(visit.sent)return {skipped:true};
 try{
  const response=await fetcher('/api/partner-visits',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({visit_id:visit.id,code}),keepalive:true});
  if(response.ok){visit.sent=true;try{storage.setItem(key,JSON.stringify(visit))}catch{}return {recorded:true}}
 }catch{}
 return {recorded:false};
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 let attempted=false;
 const record=()=>{if(attempted||document.visibilityState!=='visible')return;attempted=true;
  try{if(navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true)return;
   const uuid=()=>{if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
   void recordPartnerVisit({url:location.href,storage:sessionStorage,fetcher:fetch.bind(window),uuid});
  }catch{}
 };
 document.addEventListener('visibilitychange',record);record();
}
