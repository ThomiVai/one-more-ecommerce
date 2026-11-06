// Adaptación JS/CSS del patrón CardContainer / CardBody / CardItem de Aceternity UI.
// Referencia: https://ui.aceternity.com/components/3d-card-effect
export function tiltAngles(rect, x, y, limit=5) {
  if (!(rect.width>0 && rect.height>0) || !Number.isFinite(x) || !Number.isFinite(y)) return {x:0,y:0};
  const clamp=v=>Math.max(-1,Math.min(1,v));
  return {x:-clamp((y-rect.top)/rect.height*2-1)*limit,
    y:clamp((x-rect.left)/rect.width*2-1)*limit};
}
export function attachCard3D({card,stage,view,doc}) {
  const reduced=view.matchMedia('(prefers-reduced-motion: reduce)');
  const mouse=view.matchMedia('(hover: hover) and (pointer: fine)');
  let frame=0,point=null,disposed=false;
  const home=stage.closest('.om144-home');
  const allowed=()=>!disposed&&!reduced.matches&&mouse.matches&&!doc.hidden&&
    !home?.classList.contains('paused')&&!doc.querySelector('[role="dialog"],dialog[open]');
  function reset(){
    if(frame)view.cancelAnimationFrame(frame);
    frame=0;point=null;
    card.style.removeProperty('--om147-rx');card.style.removeProperty('--om147-ry');
    card.removeAttribute('data-om147-tilted');
  }
  function move(event){
    if(event.pointerType!=='mouse'||!allowed()){reset();return;}
    point={x:event.clientX,y:event.clientY};
    if(frame)return;
    frame=view.requestAnimationFrame(()=>{
      frame=0;if(!point||!allowed()){reset();return;}
      const angle=tiltAngles(stage.getBoundingClientRect(),point.x,point.y);
      card.style.setProperty('--om147-rx',angle.x.toFixed(3)+'deg');
      card.style.setProperty('--om147-ry',angle.y.toFixed(3)+'deg');
      card.setAttribute('data-om147-tilted','true');
    });
  }
  const observer=new view.MutationObserver(()=>{if(!allowed())reset();});
  if(home)observer.observe(home,{attributes:true,attributeFilter:['class']});
  reduced.addEventListener('change',reset);mouse.addEventListener('change',reset);
  doc.addEventListener('visibilitychange',reset);view.addEventListener('blur',reset);
  return {move,reset,dispose(){disposed=true;reset();observer.disconnect();
    reduced.removeEventListener('change',reset);mouse.removeEventListener('change',reset);
    doc.removeEventListener('visibilitychange',reset);view.removeEventListener('blur',reset);}};
}
export function createCard3D(React) {
  const h=React.createElement;
  return function Card3D({children,className='',...props}) {
    const card=React.useRef(null),stage=React.useRef(null),controller=React.useRef(null);
    React.useEffect(()=>{
      const c=attachCard3D({card:card.current,stage:stage.current,view:window,doc:document});
      controller.current=c;return()=>{c.dispose();controller.current=null;};
    },[]);
    return h('div',{className:'om147-perspective',ref:stage,
      onPointerMove:e=>controller.current?.move(e),
      onPointerLeave:()=>controller.current?.reset(),
      onPointerCancel:()=>controller.current?.reset(),
      onFocusCapture:()=>controller.current?.reset()},
      h('article',{...props,ref:card,className:className+' om147-card'},children));
  };
}
