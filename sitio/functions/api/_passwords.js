// Contraseñas humanas: PBKDF2 + sal individual + HMAC con secreto fuera de D1.
// Workers limita PBKDF2 a 100000; no usar un simple SHA-256 de la contraseña.
import {randomToken,personalHash,equal} from './_access.js';
const encoder=new TextEncoder(),FORMAT='pbkdf2-sha256-pepper-v1',ITERATIONS=100000;
export function passwordError(value){return typeof value!=='string'||value.trim().length<10||value.length>128?'Elegí una contraseña de 10 a 128 caracteres. No hace falta usar símbolos.':null}
async function tag(id,password,salt,env){
 const secret=env.PASSWORD_PEPPER||env.ADMIN_API_KEY;if(!secret)throw Error('Falta secreto para proteger contraseñas');
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode('one-more-password-v1:'+id+':'+salt),iterations:ITERATIONS,hash:'SHA-256'},key,256);
 const pepper=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const prefix=encoder.encode('one-more-password-tag-v1:'+id+':'+salt+':'),message=new Uint8Array(prefix.length+32);message.set(prefix);message.set(new Uint8Array(bits),prefix.length);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',pepper,message))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function hashPassword(id,password,env){const error=passwordError(password);if(error)throw Error(error);const salt=randomToken();return [FORMAT,ITERATIONS,salt,await tag(id,password,salt,env)].join('$')}
export async function verifyCredential(id,value,stored,env){
 if(typeof value!=='string'||value.length>200||typeof stored!=='string')return false;
 if(stored.startsWith(FORMAT+'$')){const [format,iterations,salt,expected,...rest]=stored.split('$');if(rest.length||iterations!==String(ITERATIONS)||!/^[-\w]{43}$/.test(salt)||!/^[a-f0-9]{64}$/.test(expected))return false;return equal(await tag(id,value,salt,env),expected)}
 // Compatibilidad con las claves aleatorias de V132. No genera contraseñas nuevas con este formato.
 return /^[a-f0-9]{64}$/.test(stored)&&equal(await personalHash(id,value),stored);
}
