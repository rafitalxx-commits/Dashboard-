import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerIncidentRoutes} from '../backend/incidents/routes.ts';
let handler:any;let user:any;let network=0;const originalFetch=globalThis.fetch;globalThis.fetch=(async()=>{network++;throw Error('External network forbidden in isolated route tests');}) as any;
const deps={catalog:async(q:string)=>({products:[{productId:7,sku:q,name:'Catálogo real simulado',barcode:'840007'}],hasMore:false}),lookup:async(q:string)=>({source:'odoo' as const,order:{odooReference:q,channel:'Website',customerName:'Ficticio'},products:[]}),statistics:async()=>({salesWithoutTax:100}),image:async()=>Buffer.from([137,80,78,71,13,10,26,10])};
registerIncidentRoutes({middlewares:{use:(_p:any,fn:any)=>handler=fn}},{getSessionUser:()=>user},{DASHBOARD_DATA_DIR:mkdtempSync(join(tmpdir(),'incidents-routes-')),INCIDENTS_ODOO_WRITE_ENABLED:'false'},deps);
async function call(method:string,path:string,body?:unknown){const request=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(request,{method,url:path,headers:{}});const response:any={statusCode:200,setHeader:()=>{},end:(data:any)=>{response.body=data;}};await handler(request,response);return response;}
try{
 assert.equal((await call('GET','/catalog?q=ABC')).statusCode,401);assert.equal((await call('GET','/reshipments/resolve?reference=REX-2026-00024-01')).statusCode,401);assert.equal((await call('GET','/status')).statusCode,401);user={id:'tester',name:'Tester',role:'viewer',permissions:[]};assert.equal((await call('GET','/catalog?q=ABC')).statusCode,403);assert.equal((await call('GET','/status')).statusCode,403);
 user={id:'warehouse',role:'viewer',permissions:['expeditions']};assert.equal((await call('GET','/product-image?id=7')).statusCode,200);assert.equal((await call('POST','/reshipments/REX-2026-00031-01/demo-label-created',{operatorCode:'OP001'})).statusCode,403);assert.equal((await call('GET','/reshipments/resolve?reference=REX-2026-00024-01')).statusCode,400);assert.equal((await call('GET','/')).statusCode,403);assert.equal((await call('POST','/reshipments/resolve')).statusCode,403);
 user={id:'tester',name:'Tester',role:'admin',permissions:['products']};const status=JSON.parse((await call('GET','/status')).body);assert.equal(status.odooWritable,false);assert.equal(status.writable,false);assert.equal((await call('GET','/reshipments/resolve?reference=REX-2026-00024-01')).statusCode,400);assert.equal(network,0);
 for(const path of ['/','/uploads/init','/uploads/complete']){const r=await call('POST',path,{incidentId:'INC-2026-00001'});assert(r.statusCode>=400);}
 for(const kind of ['return','review_return','assume_return']){const rejected=await call('POST','/INC-2026-00001/actions',{action:{kind}});assert.equal(rejected.statusCode,400);assert.match(JSON.parse(rejected.body).message,/Recepciones/);}
 const noWorker=await call('POST','/receipts/INC-2026-00001/actions',{action:{kind:'return'}});assert.equal(noWorker.statusCode,400);assert.match(JSON.parse(noWorker.body).message,/QR/);
 assert.equal((await call('GET','/product-image?id=-1')).statusCode,400);assert.equal((await call('GET','/orders?q=AB')).statusCode,400);assert.equal(JSON.parse((await call('GET','/orders?q=TEST-001')).body).source,'odoo');assert.equal((await call('GET','/statistics?from=bad')).statusCode,400);
 assert.equal((await call('GET','/catalog?q=A')).statusCode,400);assert.equal((await call('GET','/catalog?q='+ 'x'.repeat(121))).statusCode,400);assert.equal(JSON.parse((await call('GET','/catalog?q=EAN')).body).products[0].sku,'EAN');
 const rules=JSON.parse((await call('GET','/rules')).body);assert.equal(rules.rules[0].hours,72);const saved=await call('POST','/rules',{rules:[{carrier:'MRW',hours:80,enabled:true,suggestion:'Test interno'}]});assert.equal(saved.statusCode,200);assert.equal(JSON.parse((await call('GET','/rules')).body).rules[0].hours,80);
 user.role='viewer';assert.equal((await call('POST','/rules',{rules:[]})).statusCode,403);assert.equal(network,0);console.log('PASS controles HTTP (incluido acceso REX restringido): autenticación, permiso, escritura Sheets/Drive/stock cerrada, validación de entradas, lectura Odoo, configuración por rol. Cero llamadas externas.');
}finally{globalThis.fetch=originalFetch;}
