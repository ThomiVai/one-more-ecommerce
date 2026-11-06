// Lectura de PDF: propone renglones; nunca asigna variantes automáticamente.
const money=x=>{let a=String(x||'').replace(/[^0-9,.]/g,'');if(a.includes(',')&&a.includes('.'))a=a.replaceAll('.','').replace(',','.');else if(a.includes(','))a=a.replace(',','.');else if(/^\d{1,3}(\.\d{3})+$/.test(a))a=a.replaceAll('.','');return Number(a)||0};
export async function parsePdf(file){
 const mod=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
 mod.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
 const doc=await mod.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
 let extracted=[],all='';
 for(let n=1;n<=Math.min(8,doc.numPages);n++){
  const pg=await doc.getPage(n), cont=await pg.getTextContent();
  const parts=cont.items.filter(x=>x.str?.trim()).map(x=>({x:x.transform[4],y:x.transform[5],str:x.str.replace(/\s+/g,' ').trim()}));
  all+=' '+parts.map(x=>x.str).join(' ');
  // Identificamos cada renglón por la pareja cantidad/código en sus columnas.
  const codes=parts.filter(p=>p.x>=73&&p.x<115&&/^[A-Za-z0-9_-]{1,20}$/.test(p.str) && p.y<pg.view[3]-70)
   .map(p=>({...p,q:parts.find(a=>a.x>=22&&a.x<70&&Math.abs(a.y-p.y)<3.8&&/^\d{1,4}$/.test(a.str))}))
   .filter(p=>p.q&&p.y<pg.view[3]-70);
  for(let i=0;i<codes.length;i++){
   const r=codes[i],previous=i?codes[i-1].y:Infinity,next=i+1<codes.length?codes[i+1].y:-Infinity;
   const upper=i? (previous+r.y)/2: r.y+15, lower=i+1?(next+r.y)/2:r.y-14;
   const cells=parts.filter(p=>p.y>=lower&&p.y<=upper);
   const descriptions=cells.filter(p=>p.x>=125&&p.x<302).sort((a,b)=>b.y-a.y||a.x-b.x).map(p=>p.str);
   // Si el proveedor cortó una palabra entre renglones (CHOCO/LATE, POT/E), unirla sin inventar nombres.
   let description='';for(const word of descriptions){if(!description){description=word;continue}
     if(word.split(' ')[0].length<=5&&/[A-Za-zÁÉÍÓÚáéíóú]$/.test(description)) description+=word.split(' ')[0]+(word.includes(' ')?' '+word.split(' ').slice(1).join(' '):'');
     else description+=' '+word;
   }
   const amount=cells.filter(p=>p.x>=307&&p.x<376).sort((a,b)=>Math.abs(a.y-r.y)-Math.abs(b.y-r.y)).find(p=>/[0-9]/.test(p.str));
   if(!amount||!description)continue;
   extracted.push({supplier_code:r.str,description,quantity:Number(r.q.str),unit_cost:money(amount.str),web:''});
  }
 }
 const number=all.match(/Nro[:\s]+([0-9]{5,})/i),date=all.match(/Fecha Emisi[oó]n[:\s]*(\d{2})\/(\d{2})\/(\d{4})/i),total=all.match(/Importe Total[:\s]*\$?\s*([0-9.,]+)/i);
 return {rows:extracted,number:number?.[1]||'',date:date?`${date[3]}-${date[2]}-${date[1]}`:'',total:money(total?.[1])};
}
