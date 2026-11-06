import {json} from './_utils.js';
import {deploymentOnly,databaseGuard} from './_deployment.js';
export class InputError extends Error {constructor(message,status=400){super(message);this.status=status}}
export const fail=(message,status=400)=>{throw new InputError(message,status)};
export const txt=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail('Revisá '+label+'.');return v.trim()};
export const fields=(b,allowed)=>{if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k)))fail('Campos no admitidos.')};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v)))))].map(n=>n.toString(16).padStart(2,'0')).join('');
export const eligibility=`EXISTS(SELECT 1 FROM partners p JOIN customers c ON c.id=p.customer_id JOIN partner_programs g ON g.id=p.program_id WHERE p.id=? AND p.code=? COLLATE NOCASE AND p.status='active' AND c.status='active' AND g.id='partners' AND g.benefits_enabled=0 AND EXISTS(SELECT 1 FROM partner_agreements a JOIN partner_program_versions v ON v.id=a.version_id WHERE a.partner_id=p.id AND a.status='confirmed' AND a.unresolved=0 AND v.program_id=p.program_id))`;
export const readiness=`EXISTS(SELECT 1 FROM deployment_identity WHERE id=1 AND database_id='00000000-0000-0000-0000-000000000000' AND project='one-more-suplementos') AND EXISTS(SELECT 1 FROM partner_inquiries_schema WHERE id=1 AND version=160) AND EXISTS(SELECT 1 FROM partner_programs WHERE id='partners' AND benefits_enabled=0)`;
export function assertion(env,condition,args=[]){const id=crypto.randomUUID();return env.DB.prepare('INSERT INTO management_assertions(id,ok) VALUES(?,CASE WHEN ('+condition+') THEN 1 ELSE 0 END)').bind(id,...args)}
export async function ready(request,env){
 const denied=deploymentOnly(request)||await databaseGuard(request,env);if(denied)return denied;
 if(env.PARTNERS_PHASE1!=='true'||env.PARTNERS_INQUIRIES_V160!=='true')return json({error:'Consultas Partners deshabilitadas en producción.'},503);
 try{if(!(await env.DB.prepare('SELECT '+readiness+' AS ok').first())?.ok)throw Error()}catch{return json({error:'Falta verificar V160 con beneficios desactivados.'},503)}
 return null;
}
export async function body(request){
 if(!request.headers.get('content-type')?.includes('application/json'))fail('Formato inválido.',415);
 // Read bounded bytes instead of trusting Content-Length, which may be absent.
 const reader=request.body?.getReader();if(!reader)fail('Solicitud vacía.');const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>18000){await reader.cancel();fail('Consulta demasiado grande.',413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{fail('JSON inválido.')}
}
export const errorResponse=e=>json({error:e instanceof InputError?e.message:'No se completó la operación. Reintentá con los mismos datos.'},e instanceof InputError?e.status:503);
