export const CONTACT_NUMBER='5491138298246';
export const CONTACT_MESSAGE='Hola ONE MORE, tengo una consulta.';
export const contactHref=()=>`https://wa.me/${CONTACT_NUMBER}?text=${encodeURIComponent(CONTACT_MESSAGE)}`;
// Un enlace de consulta. No registra pedidos ni modifica carrito o stock.
export function createContactDock(React){
 const h=React.createElement;
 return function ContactDock({hidden=false,children}){
  return h('div',{className:'om148-dock',hidden,'aria-label':'Atención y acceso al pedido'},
   h('a',{className:'om148-whatsapp',href:contactHref(),target:'_blank',rel:'noopener noreferrer',
     'aria-label':'Consultar por WhatsApp a ONE MORE (abre otra pestaña)'},
    h('span',{className:'om148-whatsapp-icon','aria-hidden':true},
     h('svg',{width:26,height:26,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round'},
      h('path',{d:'M21 11.5a9 9 0 0 1-13.5 7.8L3 21l1.7-4.5A9 9 0 1 1 21 11.5Z'}),
      h('path',{d:'M8.2 7.1c-.8.3-1 1-.9 1.8.5 3.4 3.5 6.4 6.9 6.9.8.1 1.5-.1 1.8-.9l.5-1.2-2.5-1.2-.9.9c-1.5-.7-2.7-1.9-3.4-3.4l.9-.9-1.2-2.5-1.2.5Z'}))),
    h('span',{className:'om148-whatsapp-copy'},h('strong',null,'WhatsApp'),h('small',null,'¿Tenés una consulta?'))),children);
 };
}
