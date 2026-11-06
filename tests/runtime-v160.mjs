import * as visits from '../sitio/functions/api/partner-visits.js';
import * as partnerCatalog from '../sitio/functions/api/admin/partner-catalog.js';
import * as periods from '../sitio/functions/api/admin/partner-periods.js';
import * as activity from '../sitio/functions/api/admin/partner-activity.js';
import * as ownStock from '../sitio/functions/api/admin/own-stock.js';
import * as catalog from '../sitio/functions/api/admin/catalog.js';
import * as purchases from '../sitio/functions/api/admin/purchases.js';
import * as orders from '../sitio/functions/api/orders/index.js';
import * as summary from '../sitio/functions/api/admin/summary.js';
// Servidor de pruebas de Node + SQLite en memoria. Sin conexiones remotas.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {environment,root,seed} from './helpers.mjs';
import {personalHash} from '../sitio/functions/api/_access.js';
import {onRequest as middleware} from '../sitio/functions/_middleware.js';
import * as session from '../sitio/functions/api/admin/session.js';
import * as partners from '../sitio/functions/api/admin/partners.js';
import * as inquiries from '../sitio/functions/api/partner-inquiries.js';
import * as adminInquiries from '../sitio/functions/api/admin/partner-inquiries.js';
import * as referrals from '../sitio/functions/api/admin/partner-referrals.js';
import * as sales from '../sitio/functions/api/admin/sales.js';
import * as preview from '../sitio/functions/api/storefront-preview.js';
import * as outreach from '../sitio/functions/api/admin/partner-outreach.js';
const modules={'/api/partner-visits':visits,'/api/admin/partner-catalog':partnerCatalog,'/api/admin/partner-periods':periods,'/api/admin/partner-activity':activity,'/api/admin/own-stock':ownStock,'/api/admin/catalog':catalog,'/api/admin/purchases':purchases,'/api/orders':orders,'/api/admin/summary':summary,'/api/admin/session':session,'/api/admin/partners':partners,'/api/partner-inquiries':inquiries,'/api/admin/partner-inquiries':adminInquiries,'/api/admin/partner-referrals':referrals,'/api/admin/sales':sales,'/api/storefront-preview':preview,'/api/admin/partner-outreach':outreach};
export async function start(){
 const e=environment(),mime={'.html':'text/html','.json':'application/json','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
 for(const f of ['schema-v142-referrals-production.sql','schema-v159-captacion-production.sql','schema-v160-consultas-production.sql','schema-v166-cupos-production.sql','schema-v167-cotizaciones-production.sql','schema-v169-trafico-production.sql'])e.db.exec(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
 e.env.PARTNERS_TRAFFIC_V169='true';e.env.PARTNERS_QUOTES_V167='true';e.env.PARTNERS_PERIODS_V166='true';e.env.PARTNERS_PHASE1='true';e.env.PARTNERS_INQUIRIES_V160='true';
 e.db.prepare('INSERT INTO team_users(id,username,name,role,key_hash) VALUES(?,?,?,?,?)').run('qa-admin','qa-admin','QA administrador','admin',await personalHash('qa-admin','solo-qa-local'));
 seed(e.db,'bulk-star-24',20,100);
 async function assets(request){let url=new URL(typeof request==='string'||request instanceof URL?request:request.url),file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(path.resolve(root)+path.sep))return new Response('Forbidden',{status:403});
  if(!fs.existsSync(file)&&url.pathname.startsWith('/productos/'))file=path.join(root,'index.html');
  try{return new Response(fs.readFileSync(file),{headers:{'content-type':mime[path.extname(file)]||'application/octet-stream'}})}catch{return new Response('Not found',{status:404})}
 }
 e.env.ASSETS={fetch:assets};
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const request=new Request('https://one-more.com.ar'+req.url,{method:req.method,headers:req.headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
  const context={request,env:e.env,next:async()=>{const mod=modules[new URL(request.url).pathname];if(mod){const handler=mod['onRequest'+req.method[0]+req.method.slice(1).toLowerCase()];return handler?handler(context):new Response('Method Not Allowed',{status:405})}if(new URL(request.url).pathname.startsWith('/api/'))return new Response('{}',{status:404,headers:{'content-type':'application/json'}});return assets(request)}};
  const response=await middleware(context);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error);res.writeHead(500);res.end('QA runtime error')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {...e,url:'http://127.0.0.1:'+server.address().port,async close(){await new Promise(resolve=>server.close(resolve));e.db.close()}};
}
