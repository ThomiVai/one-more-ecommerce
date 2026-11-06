const paths={upRight:'M7 17 17 7M7 7h10v10',right:'M4 12h16m-7-7 7 7-7 7',down:'M12 4v16m-7-7 7 7 7-7'};
const kind=s=>s[0]==='↗'?'upRight':s[0]==='→'?'right':'down';
const parts=text=>text.split(/(↗\uFE0F?|→\uFE0F?|↓\uFE0F?)/gu);
export function arrowMarkup(text){
 return String(text).split(/(<[^>]+>)/g).map(piece=>piece.startsWith('<')?piece:parts(piece).map(s=>/^[↗→↓]/u.test(s)?'<svg class="om173-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="'+paths[kind(s)]+'"></path></svg>':s).join('')).join('');
}
export function withArrowIcons(React){
 const iconify=text=>typeof text!=='string'||!/[↗→↓]/u.test(text)?text:parts(text).map((s,i)=>/^[↗→↓]/u.test(s)?React.createElement('svg',{key:'arrow-'+i,className:'om173-arrow',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},React.createElement('path',{d:paths[kind(s)]})):s);
 return (type,props,...children)=>React.createElement(type,props,...children.map(iconify));
}
