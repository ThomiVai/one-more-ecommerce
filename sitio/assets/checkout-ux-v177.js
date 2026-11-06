// Helpers independientes de stock, caja, ventas y reglas de Partners.
export function postalState(value){
 const draft=String(value??'').replace(/\D/g,'').slice(0,4);
 return {draft,cp:/^\d{4}$/.test(draft)?draft:''};
}
export function reserveWhatsApp(target){
 try{
  const popup=target.open('about:blank','_blank');
  if(popup){popup.opener=null;try{popup.document.title='Preparando tu consulta · ONE MORE';popup.document.body.textContent='Preparando tu consulta de ONE MORE… Si no continúa automáticamente, volvé a la tienda y tocá Abrir WhatsApp.'}catch{}}
  return popup;
 }catch{return null}
}
export function closeReservedWhatsApp(popup){try{if(popup&&!popup.closed)popup.close()}catch{}}
export function finishWhatsApp(popup,url){
 try{
  const destination=new URL(url);
  if(destination.protocol!=='https:'||destination.hostname!=='wa.me'){closeReservedWhatsApp(popup);return false}
  if(!popup||popup.closed)return false;
  popup.location.replace(destination.href);return true;
 }catch{closeReservedWhatsApp(popup);return false}
}

export function buyerInquiryMessage(summary,code,confirmed,id){
 return summary+'\n\nReferencia de consulta: '+id+(code?'\nCódigo de entrenador declarado: '+code+'\nRecomendación confirmada por comprador: '+(confirmed?'SÍ':'NO'):'')+'\nLa solicitud se confirma al recibir este mensaje. No se realizó ningún pago.';
}
