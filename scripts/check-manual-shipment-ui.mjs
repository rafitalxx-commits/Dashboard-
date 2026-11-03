import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const ts=(await import('typescript')).default;
const {preserveConcurrentShipmentConfirmations}=await import('../backend/deliveryIncidentResolution.ts');
const {chromium}=createRequire('/usr/lib/node_modules/openclaw/package.json')('playwright-core');
const temp=mkdtempSync(join(tmpdir(),'shipped-confirm-qa-'));
const evidence=process.env.QA_EVIDENCE_DIR || join(temp,'evidence');mkdirSync(evidence,{recursive:true});
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,endpoint='/api/odoo/orders/delivery-incidents/confirm-shipped';
const target={id:'qa-incident',orderId:900001,orderName:'QA-S-900001',tracking:'QA-TRACK-001',reason:'No hay albaran asociado en Odoo.',lastAttemptAt:'2026-11-03T07:00:00Z'};
const missing={...target,id:'qa-no-tracking',orderId:900002,orderName:'QA-S-900002',tracking:''};
const store={version:1,updatedAt:'',sync:{status:'never'},orders:[],incidents:[target,missing],audit:[],metrics:[]};
writeFileSync(join(temp,'orders-cache.json'),JSON.stringify(store));
const user={id:'qa-operator',username:'qa',name:'Operario QA',active:true,role:'viewer',permissions:['orders'],passwordHash:'unused',passwordSalt:'unused'};
writeFileSync(join(temp,'auth.json'),JSON.stringify({users:[user,{...user,id:'qa-unrelated',permissions:['products']}],sessions:[{id:'qa-session',userId:user.id,expiresAt:Date.now()+3600000},{id:'qa-unrelated-session',userId:'qa-unrelated',expiresAt:Date.now()+3600000}]}));
const env={PATH:process.env.PATH,HOME:temp,NODE_ENV:'development',DASHBOARD_DATA_DIR:temp,DASHBOARD_AUTH_STORE:join(temp,'auth.json'),DASHBOARD_DEV_BYPASS_AUTH:'false',VITE_CACHE_DIR:join(temp,'vite-cache'),ODOO_WRITE_ENABLED:'false',DASHBOARD_AUTO_LOCATION_MOVEMENTS:'false',INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_READ_ENABLED:'false',INCIDENTS_ODOO_WRITE_ENABLED:'false',INCIDENTS_REX_WRITE_ENABLED:'false',INCIDENTS_DOCUMENTS_WRITE_ENABLED:'false',INCIDENTS_OPERATIONAL_WORKFLOW_ENABLED:'false',INCIDENTS_SHEETS_WRITE_ENABLED:'false',INCIDENTS_DRIVE_WRITE_ENABLED:'false',SUPPLIER_INVOICES_ODOO_WRITE_ENABLED:'false',SUPPLIER_INVOICES_DRIVE_WRITE_ENABLED:'false'};
let page;let server,browser,log='',exited=false;
const errors=[],checks=[];
const request=(body,cookie='qa-session',method='POST')=>fetch(origin+endpoint,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie:`dashboard_session=${cookie}`}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
try {
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});server.on('exit',()=>exited=true);server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 for(let i=0;i<100;i++){if(exited)throw Error(log);try {const r=await fetch(origin);if(r.ok&& (await r.text()).includes('/src/main.tsx'))break;}catch{}if(i===99)throw Error(log);await new Promise(r=>setTimeout(r,150));}
 const valid={incidentId:target.id,tracking:target.tracking,reason:'Salida física comprobada',confirmed:true};
 assert.equal((await request(valid,'')).status,401);assert.equal((await request(valid,'qa-unrelated-session')).status,401);assert.equal((await request(undefined,'qa-session','GET')).status,405);
 for(const patch of [{confirmed:false},{tracking:'DIFFERENT'},{reason:''},{incidentId:missing.id,tracking:''},{incidentId:'missing'}])assert.equal((await request({...valid,...patch})).status,400);
 assert.deepEqual(JSON.parse(readFileSync(join(temp,'orders-cache.json'))),store);checks.push('HTTP authentication, permissions, method, validation; zero writes on rejection');
 browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addCookies([{name:'dashboard_session',value:'qa-session',url:origin}]);page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack || e.message));
 let fixtures=[target,missing],posts=0,phase='failure',release,received;
 await page.route('**/*',async r=>{const u=new URL(r.request().url()),method=r.request().method();
  if(u.origin!==origin)return r.abort();
  if(!u.pathname.startsWith('/api/')) {
    if (!process.env.QA_STATIC_DIR) return r.continue();
    const asset=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,'');
    if(asset.includes('..'))return r.abort();
    const file=join(process.env.QA_STATIC_DIR,asset);
    const contentType=asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.html')?'text/html':'application/octet-stream';
    try {return r.fulfill({status:200,contentType,body:readFileSync(file)});} catch {return r.fulfill({status:404,body:''});}
  }
  if(u.pathname==='/api/auth/me')return r.continue();
  const reply=(body,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname===endpoint){posts++;const input=r.request().postDataJSON();assert.equal(input.tracking,target.tracking);assert.equal(input.confirmed,true);received?.();if(phase==='slow')await new Promise(res=>release=res);if(phase==='failure')return reply({message:'Fallo de prueba: vuelve a intentar'},400);const incident={...target,resolvedAt:'2026-11-03T10:00:00Z',resolvedBy:user.name,manualResolution:{kind:'shipment-confirmed',tracking:target.tracking,reason:input.reason,confirmedAt:'2026-11-03T10:00:00Z',confirmedBy:user.name,confirmedById:user.id}};fixtures=[incident,missing];return reply({ok:true,incident});}
  if(method!=='GET'&&method!=='HEAD')throw Error('Unexpected mutation '+u.pathname);
  if(u.pathname==='/api/odoo/orders/delivery-incidents')return reply(fixtures);
  if(u.pathname==='/api/odoo/orders')return reply({mode:'configured',orders:[],total:0});
  if(u.pathname==='/api/odoo/orders/v2')return reply({mode:'configured',orders:[],total:0,performance:{}});
  return reply({mode:'live',orders:[],alerts:[],total:0});
 });
 await page.goto(origin+'/#/pedidos');const buttons=page.getByRole('button',{name:'Resolver · enviado confirmado',exact:true});await buttons.first().waitFor();assert.equal(await buttons.count(),2);assert(await buttons.nth(1).isDisabled());
 await buttons.first().click();let dialog=page.getByRole('dialog',{name:'Confirmar pedido enviado'});await dialog.waitFor();const submit=dialog.getByRole('button',{name:'Confirmar envío y resolver',exact:true});assert(await submit.isDisabled());
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(posts,0);checks.push('No tracking disabled; Escape no mutation');
 await buttons.first().click();dialog=page.getByRole('dialog');await dialog.getByLabel('Motivo de la confirmación').fill('Salida comprobada en almacén');assert(await submit.isDisabled());await dialog.getByRole('checkbox').check();
 for(let i=0;i<10;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)));}
 await submit.click();await dialog.getByRole('alert').waitFor();assert.equal(posts,1);assert.equal(await dialog.getByLabel('Motivo de la confirmación').inputValue(),'Salida comprobada en almacén');checks.push('Required checkbox/reason, keyboard focus, failed write retains draft');
 phase='slow';const incoming=new Promise(r=>received=r);await dialog.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});await incoming;assert.equal(posts,2);assert(await dialog.getByRole('button',{name:'Guardando confirmación…',exact:true}).isDisabled());assert(await dialog.getByRole('button',{name:'Cancelar',exact:true}).isDisabled());await page.keyboard.press('Escape');assert(await dialog.isVisible());release();await dialog.waitFor({state:'hidden'});await page.getByRole('status').filter({hasText:'enviado confirmado manualmente'}).waitFor();assert.equal(await buttons.count(),1);checks.push('Double-submit once, pending locks/Escape, success authoritative and target removed');
 await page.reload();await buttons.first().waitFor();assert.equal(await buttons.count(),1);checks.push('Reload uses resolved reader state');
 // Reopen fixture for geometry checks in the real Orders parent.
 fixtures=[target,missing];await page.reload();await buttons.first().click();dialog=page.getByRole('dialog');await dialog.waitFor();
 for(const size of [{width:1280,height:900},{width:390,height:844}]){await page.setViewportSize(size);const b=await dialog.boundingBox();assert(b.x>=0&&b.x+b.width<=size.width+1);assert(b.y>=0&&b.y+b.height<=size.height+1);const actions=await dialog.locator('.shipment-confirm-actions').boundingBox();assert(actions.x>=0&&actions.x+actions.width<=size.width+1);assert(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));await page.screenshot({path:join(evidence,`confirm-${size.width}.png`)});}
 await page.keyboard.press('Escape');assert.equal(posts,2);assert.deepEqual(errors,[]);checks.push('Desktop/mobile dialog and action bounds; no page errors');
 // Now exercise the real local route and store, not the UI interception.
 const real=await request(valid);assert.equal(real.status,200);const saved=(await real.json()).incident;assert.equal(saved.manualResolution.confirmedById,user.id);assert.equal(saved.manualResolution.tracking,target.tracking);
 const snapshot=readFileSync(join(temp,'orders-cache.json'),'utf8');assert.equal((await request(valid)).status,200);assert.equal(readFileSync(join(temp,'orders-cache.json'),'utf8'),snapshot);checks.push('Real route persists audit; repeated POST byte-identical store');
 // Compose the deployed cache writer with a deliberately stale sync snapshot.
 const source=readFileSync('vite.config.ts','utf8');const start=source.indexOf('function writeOrdersCache('),end=source.indexOf('\ntype CachedOrderSearchIndex',start);
 assert(start>0&&end>start);
 const writerCode=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const writerPath=join(temp,'writer-race.json');writeFileSync(writerPath,snapshot);
 const writer=new Function('preserveConcurrentShipmentConfirmations','readOrdersCache','getOrdersCachePath','mkdirSync','dirname','writeFileSync',writerCode+';return writeOrdersCache;')(preserveConcurrentShipmentConfirmations,()=>JSON.parse(readFileSync(writerPath,'utf8')),()=>writerPath,mkdirSync,()=>temp,writeFileSync);
 writer({},store);let race=JSON.parse(readFileSync(writerPath));assert.equal(race.incidents.find(x=>x.id===target.id).manualResolution.confirmedById,user.id);assert.equal(race.audit.filter(x=>x.manualShipmentResolution).length,1);
 writer({},{...store,incidents:[{...target,tracking:'NEW-SHIPMENT'},missing]});race=JSON.parse(readFileSync(writerPath));assert.equal(race.incidents[0].resolvedAt,undefined);assert.equal(race.audit.filter(x=>x.manualShipmentResolution).length,1);
 checks.push('Actual cache writer + stale snapshot preserves closure and audit; changed shipment reopens without losing audit');

 await new Promise(r=>{server.once('exit',r);server.kill('SIGTERM');});exited=false;
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});server.on('exit',()=>exited=true);server.stderr.on('data',b=>log+=b);
 let fresh;for(let i=0;i<100;i++){try {const r=await fetch(origin+'/api/odoo/orders/delivery-incidents',{headers:{cookie:'dashboard_session=qa-session'}});if(r.ok){fresh=await r.json();break;}}catch{}if(i===99)throw Error(log);await new Promise(r=>setTimeout(r,150));}assert.equal(fresh.find(x=>x.id===target.id).manualResolution.confirmedById,user.id);assert.equal(fresh.find(x=>x.id===missing.id).resolvedAt,undefined);checks.push('Server restart/fresh HTTP reader retains target confirmation and untouched second incident');
 writeFileSync(join(evidence,'result.json'),JSON.stringify({checks,errors,uiPosts:posts,scope:'Synthetic isolated data; local auth, no bypass; no external credentials or writes',temp},null,2));console.log(JSON.stringify({checks,evidence}));
} catch(e){console.error(log.slice(-2000));if(page){console.error('PAGE',page.url(),(await page.locator('body').innerText()).slice(-4500),errors);await page.screenshot({path:join(evidence,'failure.png')});}throw e;}
finally {await browser?.close();if(server&&!exited)await new Promise(r=>{server.once('exit',r);server.kill('SIGTERM');});try {await fetch(origin);throw Error('QA listener still alive');}catch(e){if(e.message==='QA listener still alive')throw e;}}
