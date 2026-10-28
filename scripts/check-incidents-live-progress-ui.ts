import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {reshipmentPrerequisites} from '../backend/incidents/reshipment.ts';
import {buildIncident,applyAction} from '../backend/incidents/workflow.ts';
import type {WizardDraft} from '../backend/incidents/types.ts';
const {chromium}=createRequire('/usr/lib/node_modules/openclaw/package.json')('playwright-core');
const temp=mkdtempSync(join(tmpdir(),'incidents-confirmation-')),base='http://127.0.0.1:5297',prefix='/live-progress-qa/';
const env={...process.env,DASHBOARD_DATA_DIR:temp,DASHBOARD_AUTH_STORE:join(temp,'auth.json'),DASHBOARD_DEV_BYPASS_AUTH:'true',ODOO_WRITE_ENABLED:'false',INCIDENTS_ODOO_MODE:'test',INCIDENTS_REX_WRITE_ENABLED:'false',INCIDENTS_ODOO_READ_ENABLED:'false',INCIDENTS_ODOO_WRITE_ENABLED:'false',INCIDENTS_SHEETS_WRITE_ENABLED:'false',INCIDENTS_DRIVE_WRITE_ENABLED:'false',DASHBOARD_AUTO_LOCATION_MOVEMENTS:'false',SUPPLIER_INVOICES_ODOO_WRITE_ENABLED:'false',SUPPLIER_INVOICES_DRIVE_WRITE_ENABLED:'false',VITE_CACHE_DIR:join(temp,'cache')};
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5297','--strictPort',`--base=${prefix}`],{env,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const context={source:'odoo' as const,order:{shippingDestination:{name:'QA',address:'Calle QA',postalCode:'00000',city:'QA',country:'ES'},odooReference:'QA-S-001',customerName:'Cliente técnico ficticio',channel:'LAB'},products:[{productId:10,sku:'QA-A',name:'Producto correcto',orderedQuantity:1,affectedQuantity:1,unitCostSnapshot:3}]};
const draft:WizardDraft={requestId:'isolated-confirmation-001',origin:'warehouse',type:'wrong_product',solution:'resend_recover',context,products:context.products,wrongReceivedProduct:{productId:11,sku:'QA-B',name:'Producto recibido',barcode:''},wrongReceived:'QA-B'};

let incident=buildIncident({...draft,solution:'wait_resend'},'INC-2026-99996','DEV-2026-99996','QA');
const reference='REX-2026-99996-01';
incident.odooOperations=[{key:'rex',kind:'reshipment',dispatchReference:reference,pickingId:4242,status:'ready_for_expedition',digest:'qa',confirmedAt:new Date().toISOString(),lines:[{productId:10,sku:'QA-A',quantity:1,uomId:1,sourceId:8,destinationId:5}]}];
let browser:any;const errors:string[]=[],writes:string[]=[];let offline=false,reads=0,stale:any=null;
try{
 for(let n=0;n<100;n++){try{if((await fetch(base+'/api/auth/me')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',(e:any)=>errors.push(e.message));
 await page.route('**/*',async(r:any)=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(!u.pathname.includes('/api/'))return r.continue();const path=u.pathname.split('/api/incidents')[1];if(path===undefined)return r.continue();const reply=(body:any)=>r.fulfill({json:body});
 if(!['GET','HEAD'].includes(r.request().method())){writes.push(path);if(path.endsWith('/actions')){const body=r.request().postDataJSON();incident=applyAction(incident,body.action,'QA');return reply({incident});}throw Error('Unexpected mutation '+path);}
 if(path==='/status')return reply({configured:true,writable:true,documentsWritable:false,odooMode:'test'});
 if(path==='/submissions')return reply({submissions:[]});if(path==='/rules')return reply({rules:[]});
 if(path==='/'||path===''){reads++;if(offline)return r.fulfill({status:503,json:{message:'QA offline'}});return reply({incidents:[stale||incident]});}return reply({});});
 await page.goto(base+prefix+'#/incidencias?incident='+incident.id,{waitUntil:'networkidle'});
 const tasks=page.locator('.ip-tasks');await tasks.getByText('Recibir devolución DEV-2026-99996',{exact:true}).waitFor();
 // Saved elsewhere: same mounted detail, no navigation, no click on Actualizar.
 Object.assign(incident.returns[0],{state:'arrived',warehouseConfirmedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),receivedBy:{id:'qa',code:'OPQA',name:'QA'},condition:'perfect',destination:'stock',odooSyncError:'QA: conciliar entrada guardada'});incident.revision++;
 for(const p of incident.processes.filter(p=>p.kind==='reception'))p.state='resolved';
 await tasks.getByText('Finalizando devolución DEV-2026-99996',{exact:true}).waitFor({timeout:12000});
 await tasks.getByText('REX bloqueado · conciliación Odoo pendiente',{exact:true}).waitFor();assert.equal(await tasks.getByText(/esperamos recibir/).count(),0);await tasks.getByText(/Error de sincronización: QA: conciliar entrada guardada/).waitFor();
 await page.screenshot({path:'/root/.openclaw/workspace/releases/incidents-production-20261027/live-progress-odoo-pending-20261026.png',fullPage:true});
 // Completing Odoo elsewhere removes the receive gate, but does not claim dispatch.
 incident.returns[0].state='processed';delete incident.returns[0].odooSyncError;incident.revision++;
 incident.odooOperations!.push({key:'dev',kind:'return',returnId:incident.returns[0].id,pickingId:4343,status:'done',digest:'qa',confirmedAt:new Date().toISOString()});
 await tasks.getByText('Expedir '+reference,{exact:true}).waitFor({timeout:12000});assert.equal(await tasks.getByText(/REX bloqueado|Recibir devolución|Finalizando devolución/).count(),0);
 // Preserve an unfinished cost form while polling. Submit updates the same checklist.
 await page.getByRole('button',{name:'Costes',exact:true}).click();await page.getByLabel('Importe (€)',{exact:true}).fill('7.50');await page.getByLabel('Observaciones (opcional)',{exact:true}).fill('Borrador preservado');
 const before=reads;await page.waitForFunction(()=>false,null,{timeout:5500}).catch(()=>{});assert(reads>before);assert.equal(await page.getByLabel('Importe (€)',{exact:true}).inputValue(),'7.50');assert.equal(await page.getByLabel('Observaciones (opcional)',{exact:true}).inputValue(),'Borrador preservado');
 stale=structuredClone(incident);await page.getByRole('button',{name:'Añadir coste',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.ip-tasks')?.textContent?.includes('Registrar un coste'));
 // An older list after this acknowledgement must not restore the task.
 const afterCost=reads;for(let n=0;n<120&&reads===afterCost;n++)await new Promise(r=>setTimeout(r,100));assert(reads>afterCost);assert.equal(await tasks.getByText('Registrar un coste',{exact:true}).count(),0);stale=null;
 // Shipping completion elsewhere removes the REX task, not client confirmation.
 Object.assign(incident.odooOperations![0],{status:'done',shipmentCode:'QA-LABEL',shippedBy:'QA',shippedAt:new Date().toISOString()});for(const p of incident.processes.filter(p=>p.kind==='reshipment'))p.state='resolved';incident.revision++;
 await page.waitForFunction(()=>!document.querySelector('.ip-tasks')?.textContent?.includes('Expedir REX'),null,{timeout:12000});await tasks.getByText('Confirmar la solución al cliente',{exact:true}).waitFor();
 await page.getByRole('button',{name:'General',exact:true}).click();await page.getByLabel('Estado del cliente',{exact:true}).selectOption('Solucionado');await page.getByRole('button',{name:'Aceptar estado del cliente',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.ip-tasks')?.textContent?.includes('Confirmar la solución al cliente'));
 // Failed refresh is explicit, then recovers automatically.
 offline=true;await page.getByText(/No se pudo actualizar la incidencia/).waitFor({timeout:12000});offline=false;await page.waitForFunction(()=>!document.body.textContent?.includes('No se pudo actualizar la incidencia'),null,{timeout:12000});
 await page.setViewportSize({width:390,height:844});const menu=page.getByRole('button',{name:'Recoger menu lateral',exact:true});if(await menu.isVisible())await menu.click();
 assert(await page.locator('.ip-overview').evaluate((el:HTMLElement)=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1;}));await page.screenshot({path:'/root/.openclaw/workspace/releases/incidents-production-20261027/live-progress-mobile-20261026.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.equal(writes.length,2);writeFileSync('/root/.openclaw/workspace/releases/incidents-production-20261027/live-progress-ui-20261026.json',JSON.stringify({scope:'isolated fixture only; external network blocked',autoRefreshWithoutNavigation:true,receiptOdooErrorReason:true,odooRelease:true,shippingCompletion:true,costAndClientImmediate:true,staleReadDoesNotRollback:true,draftPreserved:true,refreshFailureAndRecovery:true,mobileBounds:true,errors,interceptedWrites:writes.length,externalWrites:0},null,2));console.log('PASS live incident progress: DEV/Odoo/REX/cost/client; polling, drafts, stale snapshots, failure recovery, mobile; no external writes');
}finally{await browser?.close();server.kill('SIGTERM');}
