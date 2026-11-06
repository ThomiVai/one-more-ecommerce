// Claves personales aleatorias de 256 bits. No acepta contraseñas elegidas.
// Solo se guardan hashes SHA-256 de claves y tokens; el texto se muestra una vez.
const encoder=new TextEncoder();
const cache=new WeakMap();
export const USER_FIELDS='id,username,name,role,active,revision,created_at,updated_at';
export const COOKIE='om_admin';
export const SESSION_MS=8*3600*1000;
export const randomToken=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function digest(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export const personalHash=(id,key)=>digest('one-more-personal-key-v1:'+id+':'+key);
export const sessionHash=token=>digest('one-more-session-v2:'+token);
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let n=0;n<a.length;n++)diff|=a.charCodeAt(n)^b.charCodeAt(n);return diff===0}
async function signingKey(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
export async function signSession(secret,expiration){const data=String(expiration);const sig=await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(data));return data+'.'+[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function verifySession(secret,cookie){if(!secret||!cookie)return false;const [exp,sig,...rest]=cookie.split('.');if(rest.length||!/^\d{10,15}$/.test(exp)||!/^[a-f0-9]{64}$/.test(sig))return false;const limit=Number(exp);if(!Number.isSafeInteger(limit)||Date.now()>limit||limit>Date.now()+9*3600000)return false;return crypto.subtle.verify('HMAC',await signingKey(secret),new Uint8Array(sig.match(/.{2}/g).map(h=>parseInt(h,16))),encoder.encode(exp))}
export function cookieValue(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||''}
export function setCookie(res,value,maxAge=28800){res.headers.append('Set-Cookie',`${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${maxAge}`);return res}
export async function principal(req,env){
 if(cache.has(req))return cache.get(req);
 const pending=(async()=>{
  if(!env.DB)return null;
  const cookie=cookieValue(req);
  if(/^v2\.[\w-]{43}$/.test(cookie)){
   const hash=await sessionHash(cookie.slice(3));
   const row=await env.DB.prepare('SELECT u.id,u.username,u.name,u.role,u.revision,s.expires_at FROM team_sessions s JOIN team_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND s.revision=u.revision').bind(hash,Date.now()).first();
   return row?{type:'user',id:row.id,username:row.username,name:row.name,role:row.role,revision:row.revision,sessionHash:hash,expires_at:row.expires_at}:null;
  }
  const expected=env.ADMIN_API_KEY,header=req.headers.get('authorization')||'';
  const supplied=header.startsWith('Bearer ')?header.slice(7):'';
  const valid=expected&&(supplied&&equal(await digest(supplied),await digest(expected))||await verifySession(expected,cookie));
  if(!valid)return null;
  const settings=await env.DB.prepare('SELECT shared_access FROM team_settings WHERE id=1').first();
  return settings?.shared_access===1?{type:'shared',id:'shared-admin',name:'Acceso compartido',username:'',role:'admin'}:null;
 })();cache.set(req,pending);return pending;
}
export const publicIdentity=p=>p?{id:p.id,name:p.name,username:p.username,role:p.role,shared:p.type==='shared'}:null;
export const actorId=p=>p.type==='user'?'user:'+p.id:'shared-admin';
export function permits(p,req){
 if(!p)return false;if(p.role==='admin'||['GET','HEAD','OPTIONS'].includes(req.method))return true;
 const path=new URL(req.url).pathname;
 return req.method==='POST'&&['/api/admin/sales','/api/admin/purchases','/api/orders','/api/admin/personal-key'].includes(path)||req.method==='PATCH'&&/^\/api\/orders\/[\w-]+$/.test(path);
}
function assertion(env,sql,args){return env.DB.prepare(`INSERT INTO management_assertions(id,ok) VALUES(?,CASE WHEN (${sql}) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(),...args)}
// La autorización vuelve a verificarse dentro del mismo batch que la escritura.
export function accessGuard(env,p,req){
 if(!permits(p,req))throw Error('Acceso no permitido');
 return p.type==='shared'
  ?assertion(env,'EXISTS(SELECT 1 FROM team_settings WHERE id=1 AND shared_access=1)',[])
  :assertion(env,'EXISTS(SELECT 1 FROM team_users u JOIN team_sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=1 AND u.role=? AND u.revision=? AND s.revision=u.revision AND s.token_hash=? AND s.expires_at>?)',[p.id,p.role,p.revision,p.sessionHash,Date.now()]);
}
export function event(env,p,action,target='',detail=''){
 return env.DB.prepare('INSERT INTO team_access_events(id,actor_id,actor_name,action,target_id,detail) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actorId(p),p.name,action,String(target),String(detail).slice(0,300));
}
export async function authorizedBatch(request,env,statements,action,target='',detail=''){
 const p=await principal(request,env);return env.DB.batch([accessGuard(env,p,request),...statements,event(env,p,action,target,detail),env.DB.prepare('DELETE FROM management_assertions')]);
}
export async function newSession(env,user){const token=randomToken();return {cookie:'v2.'+token,statement:env.DB.prepare('INSERT INTO team_sessions(token_hash,user_id,revision,expires_at) VALUES(?,?,?,?)').bind(await sessionHash(token),user.id,user.revision,Date.now()+SESSION_MS)}}
export async function loginLimit(request,env,username){
 const now=Date.now(),window=15*60000,ip=request.headers.get('cf-connecting-ip')||'local';
 const buckets=[[await digest('login-ip:'+ip),30],[await digest('login-user:'+username),10]];
 for(const [bucket,max] of buckets){const row=await env.DB.prepare('INSERT INTO team_login_limits(bucket,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts,reset_at').bind(bucket,now+window,now,now).first();if(row.attempts>max)return Math.max(1,Math.ceil((row.reset_at-now)/1000))}
 await env.DB.prepare('DELETE FROM team_login_limits WHERE reset_at<?').bind(now-window).run();return 0;
}
