import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium}=createRequire('/usr/lib/node_modules/openclaw/package.json')('playwright-core');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`;const base="/replenishment-test-lab/";
const temp=mkdtempSync(join(tmpdir(),'replenishment-ui-'));
const snapshotDir=process.env.REPLENISHMENT_QA_SNAPSHOT_DIR;
if(snapshotDir)for(const file of ['product-locations.json','products-catalog.json','expedition-replenishment-lab-preview.json'])copyFileSync(join(snapshotDir,file),join(temp,file));
const html=join(process.cwd(),'.replenishment-qa.html');
const evidence=process.env.REPLENISHMENT_QA_EVIDENCE_DIR || mkdtempSync(join(tmpdir(),'replenishment-evidence-'));mkdirSync(evidence,{recursive:true});
writeFileSync(html,`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:20px;background:#f4f6fa;font-family:Arial"><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{ReplenishmentAlerts}from'/src/modules/expeditions/ReplenishmentAlerts.tsx';import'/src/modules/expeditions/expeditions.css';window.qaReact=React;window.qaRoot=createRoot(document.getElementById('root'));window.qaRoot.render(React.createElement(ReplenishmentAlerts));</script></body></html>`);
let serverLog='';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort','--base',base],{cwd:process.cwd(),detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_CACHE_DIR:join(temp,'vite'),DASHBOARD_DATA_DIR:temp,DASHBOARD_AUTH_STORE:join(temp,'auth.json'),DASHBOARD_DEV_BYPASS_AUTH:'true',ODOO_WRITE_ENABLED:'false',ODOO_DELIVERY_WRITE_ENABLED:'false',INCIDENTS_ODOO_WRITE_ENABLED:'false',DASHBOARD_AUTO_LOCATION_MOVEMENTS:'false',AMAZON_MESSAGES_AGENT_DRAFT_WORKER_ENABLED:'false',AMAZON_MESSAGES_GMAIL_SYNC_ENABLED:'false'}});
for(const stream of [vite.stdout,vite.stderr])stream.on('data',b=>serverLog=(serverLog+b).slice(-6000));
let browser;let page;
try{
 let ready=false;for(let i=0;i<150;i++){if(vite.exitCode!==null)throw Error('QA Vite exited: '+serverLog);try{const r=await fetch(origin+base);if(r.ok&&(await r.text()).includes('src/main.tsx')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Wrong or missing QA listener: '+serverLog);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(10000);
 await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
 await page.route('**/te-panel-rayo-192.png',r=>r.fulfill({body:readFileSync('public/te-panel-rayo-192.png'),contentType:'image/png'}));
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR',e.message)});page.on('console',msg=>{if(msg.type()==='error')console.error('CONSOLE',msg.text())});
 // A real decodable raster fixture, not a broken image element.
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const item=n=>({productId:n,reference:`TEST${n}`,name:`Producto de prueba ${n}`,uom:'uds',preferred:{code:'A101',quantity:n===1?-3:0,active:true},sources:[{code:'B202',quantity:8,active:true},{code:'C303',quantity:3,active:true}]});
 let items=Array.from({length:10},(_,i)=>item(i+1));let writes=[];let fail=false;let failList=false;let pendingRelease;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());url.pathname=url.pathname.replace(base,'/');
  if(!url.pathname.startsWith('/api/expeditions/replenishment'))throw Error('Unexpected API '+url.pathname);
  if(url.pathname.endsWith('/images'))return route.fulfill({json:Object.fromEntries(url.searchParams.get('ids').split(',').map(id=>[id,photo]))});
  if(req.method()==='GET')return route.fulfill({status:failList?503:200,json:failList?{message:'Lectura temporalmente no disponible'}:{items}});
  writes.push(req.postDataJSON());
  if(fail)return route.fulfill({status:400,json:{message:'No hay cantidad suficiente en la ubicación de origen'}});
  await new Promise(r=>{pendingRelease=r;});
  const input=req.postDataJSON();items=items.filter(i=>i.productId!==input.productId);
  return route.fulfill({json:{items}});
 });
 const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Condition timed out');};
 await page.goto(origin+base+'.replenishment-qa.html');
 await page.getByRole('heading',{name:'Reponer ubicación preferente · 10 productos',exact:true}).waitFor();
 await until(()=>page.locator('.replenishment-photo img').first().evaluate(el=>el.naturalWidth>0));
 assert.equal(await page.getByRole('article').count(),8);
 await page.getByRole('button',{name:'Siguiente',exact:true}).click();
 await page.getByRole('article',{name:'Reponer TEST9',exact:true}).waitFor();
 assert.equal(await page.getByRole('article').count(),2);
 await page.getByRole('button',{name:'Anterior',exact:true}).click();
 await page.getByRole('article',{name:'Reponer TEST1',exact:true}).waitFor();
 await page.getByLabel('Buscar producto o ubicación',{exact:true}).fill('TEST10');
 await until(async()=>await page.getByRole('article').count()===1);
 await page.getByLabel('Buscar producto o ubicación',{exact:true}).fill('');
 let card=page.getByRole('article',{name:'Reponer TEST1',exact:true});
 await card.getByRole('button',{name:'Reponer',exact:true}).click();
 const input=page.getByLabel('Cantidad a reponer',{exact:true});
 await input.fill('99');assert.equal(await page.getByRole('button',{name:'Confirmar traspaso',exact:true}).isDisabled(),true);
 await input.fill('2');await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(writes.length,0);
 await card.getByRole('button',{name:'Reponer',exact:true}).click();await input.fill('2');
 fail=true;await page.getByRole('button',{name:'Confirmar traspaso',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'No hay cantidad suficiente'}).waitFor();
 assert.equal(await input.inputValue(),'2');assert.equal(await page.getByText(/Reposición registrada/).count(),0);
 fail=false;
 await page.getByRole('form',{name:'Traspaso de TEST1',exact:true}).evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await page.getByRole('button',{name:'Registrando…',exact:true}).waitFor();
 await until(()=>!!pendingRelease);assert.equal(writes.length,2,'one failure + one in-flight request, no duplicate');
 assert.equal(await input.isDisabled(),true);pendingRelease();
 await page.getByRole('status').filter({hasText:'Reposición registrada: TEST1'}).waitFor();
 assert.equal(await page.getByRole('form').count(),0);assert.equal(await card.count(),0);
 assert.deepEqual(writes[0],writes[1],'retry identity stays stable');
 failList=true;await page.getByRole('button',{name:'Actualizar avisos',exact:true}).click();await page.getByRole('alert').filter({hasText:'Lectura temporalmente'}).waitFor();
 failList=false;await page.getByRole('button',{name:'Actualizar avisos',exact:true}).click();await until(async()=>await page.getByRole('alert').count()===0);
 await page.screenshot({path:join(evidence,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 card=page.getByRole('article',{name:'Reponer TEST2',exact:true});await card.getByRole('button',{name:'Reponer',exact:true}).click();await input.fill('1,5');
 await page.getByLabel('Ubicación de origen',{exact:true}).selectOption('C303');await input.fill('1,5');
 assert.equal(await page.getByRole('button',{name:'Confirmar traspaso',exact:true}).isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),true);
 for(const selector of ['.replenishment-alerts','.replenishment-form','.replenishment-actions']){
  const box=await page.locator(selector).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390,selector+' fits mobile');
 }
 await page.screenshot({path:join(evidence,'mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(writes.length,2);
 // Resolving the last product removes the card immediately, without requiring reload.
 items=[item(99)];await page.reload();
 await page.getByRole('article',{name:'Reponer TEST99',exact:true}).getByRole('button',{name:'Reponer',exact:true}).click();
 await input.fill('1');pendingRelease=undefined;
 await page.getByRole('button',{name:'Confirmar traspaso',exact:true}).click();
 await until(()=>!!pendingRelease);pendingRelease();
 await page.getByRole('status').filter({hasText:'Reposición registrada: TEST99'}).waitFor();
 assert.equal(await page.locator('.replenishment-alerts').count(),0,'last transfer leaves no empty card');
 await page.reload();await until(async()=>await page.locator('.replenishment-alerts').count()===0);
 // A second, independent proof uses the real HTTP routes + copied ledger + images, read-only.
 if(snapshotDir){
 const unchanged=readFileSync(join(temp,'product-locations.json'),'utf8');
 await page.unroute('**/api/**');await page.setViewportSize({width:1280,height:900});await page.reload();
 await page.getByRole('heading',{name:/Reponer ubicación preferente · [1-9][0-9]* productos/}).waitFor();
 await page.getByText(/LAB · Copia aislada/).waitFor();
 await until(()=>page.locator('.replenishment-photo img').first().evaluate(el=>el.naturalWidth>1));
 const response=await page.evaluate(async()=>{const path=location.pathname.replace('.replenishment-qa.html','')+'api/expeditions/replenishment';const r=await fetch(path);return{status:r.status,count:(await r.json()).items.length}});
 assert.equal(response.status,200);assert.ok(response.count>0);
 assert.equal(readFileSync(join(temp,'product-locations.json'),'utf8'),unchanged);
 await page.screenshot({path:join(evidence,'local-snapshot-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('article').first().getByRole('button',{name:'Reponer',exact:true}).click();
 await page.getByLabel('Cantidad a reponer',{exact:true}).fill('1');
 assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(evidence,'local-snapshot-mobile.png'),fullPage:true});
 assert.equal(readFileSync(join(temp,'product-locations.json'),'utf8'),unchanged);
 // Mount the real Expeditions parent to verify the scanner remains accessible.
 let unexpectedWrites=0, allowIsolatedTransfer=false, submitted;
 await page.route('**/api/**',async route=>{
   if(route.request().method()!=='GET'){if(allowIsolatedTransfer&&route.request().url().endsWith('/api/expeditions/replenishment/transfer')){submitted=route.request().postDataJSON();return route.continue();}unexpectedWrites++;return route.abort();}
   if(route.request().url().includes('/api/expeditions/replenishment'))return route.continue();
   return route.fulfill({json:{workers:[],rules:[],connectors:[],shipments:[],labels:[],total:0,returned:0}});
 });
 await page.evaluate(async()=>{const path=location.pathname.replace('.replenishment-qa.html','')+'src/modules/expeditions/ExpeditionsView.tsx';const{ExpeditionsView}=await import(path);window.qaRoot.render(window.qaReact.createElement(ExpeditionsView));});
 await page.getByPlaceholder('QR de operario (OP001)',{exact:true}).waitFor();
 await page.getByRole('heading',{name:/Reponer ubicación preferente · [1-9][0-9]* productos/}).waitFor();
 const assertPosition=async()=>{
  const nav=await page.locator('.expeditions-subnav').boundingBox(),alert=await page.locator('.replenishment-alerts').boundingBox(),toolbar=await page.locator('.expeditions-toolbar').boundingBox();
  assert.ok(nav.y+nav.height<=alert.y && alert.y+alert.height<=toolbar.y,'card is below section buttons and before operation controls');
  assert.equal(await page.locator('.expeditions-subnav').evaluate(nav=>nav.nextElementSibling.classList.contains('replenishment-alerts')),true);
 };
 await assertPosition();
 assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(evidence,'expeditions-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await assertPosition();await page.screenshot({path:join(evidence,'expeditions-desktop.png'),fullPage:true});
 assert.equal(unexpectedWrites,0);assert.equal(readFileSync(join(temp,'product-locations.json'),'utf8'),unchanged);
 // Real component -> real Vite route -> real local engine, on this disposable copy only.
 const actualBefore=JSON.parse(readFileSync(join(temp,'product-locations.json'),'utf8'));
 allowIsolatedTransfer=true;
 await page.locator('.replenishment-product:has(> button:not(:disabled))').first().getByRole('button',{name:'Reponer',exact:true}).click();
 await page.getByLabel('Cantidad a reponer',{exact:true}).fill('1');
 const completed=page.waitForResponse(r=>r.url().endsWith('/api/expeditions/replenishment/transfer')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Confirmar traspaso',exact:true}).click();assert.equal((await completed).status(),200);
 await page.getByRole('status').filter({hasText:'Reposición registrada:'}).waitFor();assert(submitted);
 const stored=readFileSync(join(temp,'product-locations.json'),'utf8'),actualAfter=JSON.parse(stored);
 const total=(source,id)=>source.locations.filter(l=>l.productId===id).reduce((sum,l)=>sum+l.quantity,0);
 assert.equal(total(actualBefore,submitted.productId),total(actualAfter,submitted.productId));
 const balances=(source,code)=>source.locations.find(l=>l.productId===submitted.productId&&l.code===code).quantity;
 assert.equal(balances(actualAfter,submitted.fromCode),balances(actualBefore,submitted.fromCode)-1);
 assert.equal(balances(actualAfter,submitted.toCode),balances(actualBefore,submitted.toCode)+1);
 assert(actualAfter.transferRequests[submitted.requestId]);
 const repeated=await page.evaluate(async input=>{const root=location.pathname.replace('.replenishment-qa.html','');const r=await fetch(root+'api/expeditions/replenishment/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return r.status;},submitted);
 assert.equal(repeated,200);assert.equal(readFileSync(join(temp,'product-locations.json'),'utf8'),stored);
 await page.reload();await page.locator('.replenishment-alerts').waitFor();assert.equal(readFileSync(join(temp,'product-locations.json'),'utf8'),stored);
 assert.equal(unexpectedWrites,0);
 console.log('PASS integrated isolated transfer: real UI/HTTP/engine, persisted debit+credit and request ID, total preserved, retry and reload unchanged; production untouched');

 }
 assert.deepEqual(errors,[]);console.log('PASS UI: photos loaded, 10 items/pagination/search, cancel, limits, failure draft, slow duplicate submit, stable retry, success removal, read recovery, mobile layout, empty state, zero page errors');
}catch(error){if(page){console.error('BODY',await page.locator('body').innerText());await page.screenshot({path:join(evidence,'failure.png'),fullPage:true});}throw error;}finally{
 if(browser)await browser.close();try{process.kill(-vite.pid,'SIGTERM');}catch{}
 for(let i=0;i<60&&vite.exitCode===null;i++)await new Promise(r=>setTimeout(r,50));
 const closeProbe=createServer();await new Promise((resolve,reject)=>{closeProbe.once('error',reject);closeProbe.listen(port,'127.0.0.1',resolve)});await new Promise(r=>closeProbe.close(r));
 rmSync(html,{force:true});rmSync(temp,{recursive:true,force:true});
}
