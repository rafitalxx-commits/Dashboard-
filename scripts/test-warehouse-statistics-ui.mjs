import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium}=createRequire('/usr/lib/node_modules/openclaw/package.json')('playwright-core');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,base='/expeditions-redesign-lab/';
const temp=mkdtempSync(join(tmpdir(),'warehouse-statistics-ui-'));
const evidence='/root/.openclaw/workspace/qa/warehouse-statistics-daily-20261028';mkdirSync(evidence,{recursive:true});
for(const file of ['warehouse-worker-activity.json','warehouse-workers.json'])copyFileSync(join('/var/lib/odoo-v18-dashboard-expeditions-navigation-lab',file),join(temp,file));
const ledgerBefore=readFileSync(join(temp,'warehouse-worker-activity.json'),'utf8');
let serverLog='';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort','--base',base],{cwd:process.cwd(),detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_CACHE_DIR:join(temp,'vite'),DASHBOARD_DATA_DIR:temp,DASHBOARD_AUTH_STORE:join(temp,'auth.json'),DASHBOARD_DEV_BYPASS_AUTH:'true',ODOO_WRITE_ENABLED:'false',ODOO_DELIVERY_WRITE_ENABLED:'false',INCIDENTS_ODOO_WRITE_ENABLED:'false',DASHBOARD_AUTO_LOCATION_MOVEMENTS:'false',AMAZON_MESSAGES_AGENT_DRAFT_WORKER_ENABLED:'false',AMAZON_MESSAGES_GMAIL_SYNC_ENABLED:'false'}});
for(const stream of [vite.stdout,vite.stderr])stream.on('data',b=>{serverLog=(serverLog+b).slice(-8000)});
let browser,page;
const errors=[],consoleErrors=[],writes=[],checks=[],failedResources=[];
try{
 let ready=false;
 for(let i=0;i<160;i++){if(vite.exitCode!==null)throw Error('Vite exited '+serverLog);try{const r=await fetch(origin+base);if(r.ok&&(await r.text()).includes('/src/main.tsx')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(ready,'QA Vite readiness '+serverLog);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Tokyo',locale:'es-ES'});
 page=await context.newPage();page.setDefaultTimeout(12000);
 await page.addInitScript(()=>{const OriginalDate=Date;const fixed=OriginalDate.parse('2026-10-28T15:40:00Z');window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};});
 await page.route('**/te-panel-rayo-192.png',r=>r.fulfill({body:readFileSync('public/te-panel-rayo-192.png'),contentType:'image/png'}));
 page.on('response',r=>{if(r.status()>=400){failedResources.push({url:r.url(),status:r.status()});console.error('HTTP',r.status(),r.url())}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
 const a=(id,ref,createdAt,workerId='a',result='label-created')=>({id,orderRef:ref,createdAt,workerId,workerName:'Mismo nombre',workerCode:workerId==='a'?'OP001':'OP002',result,carrier:'QA',tracking:id});
 let activities=[a('1','S001','2026-10-01T08:00:00Z'),a('2','S002','2026-10-22T08:00:00Z'),a('3','S003','2026-10-27T09:00:00Z','b'),a('4','S004','2026-10-28T09:00:00Z'),a('5','S005','2026-10-28T09:30:00Z','b'),a('6','S006','2026-10-28T11:00:00Z','b'),a('7',' s001 ','2026-10-28T12:00:00Z','b'),a('8','SIM','2026-10-28T10:00:00Z','a','simulated-label'),a('9','FUTURE','2026-10-28T23:59:59Z'),a('10','BAD','not-a-date')];
 let people=[{id:'a',code:'OP001',name:'Mismo nombre',active:true}];
 let failing=false,interceptStats=true;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace(base,'/');
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(path);return route.abort();}
  if(path==='/api/auth/me')return route.fulfill({json:{authenticated:true,user:{id:'qa',name:'QA',role:'admin',permissions:['expeditions']}}});
  if(path==='/api/warehouse-workers/statistics'||path==='/api/warehouse-workers/statistics/workers'){
   assert(url.pathname.startsWith(base),'feature request escaped LAB prefix');
   if(!interceptStats)return route.continue();
   if(failing)return route.fulfill({status:503,json:{message:'QA unavailable'}});
   return route.fulfill({json:path.endsWith('/workers')?{workers:people}:{activities}});
  }
  return route.fulfill({json:{orders:[],items:[],workers:[],rules:[],labels:[],shipments:[],incidents:[],entries:[],receipts:[],submissions:[],notifications:[],events:[],tasks:[],settings:{},total:0,mode:'live'}});
 });
 await page.goto(origin+base+'#/expediciones/estadisticas');await page.locator('.warehouse-stats-v2').waitFor();
 const total=page.getByTestId('orders-total');await page.waitForFunction(()=>document.querySelector('[data-testid="orders-total"]')?.textContent==='3');
 assert.equal(await total.innerText(),'3');assert.equal(await page.getByTestId('labels-total').innerText(),'4');
 assert.equal(await page.getByRole('button',{name:'Por horas',exact:true}).count(),0);
 assert.equal(await page.locator('.warehouse-order-plot [role="button"]').count(),24);
 const legend=page.locator('.warehouse-share-legend');assert.equal(await legend.locator('li').count(),2);
 assert.match(await legend.locator('[data-worker-id="b"]').innerText(),/66,7/);assert.match(await legend.locator('[data-worker-id="a"]').innerText(),/33,3/);
 const color=await legend.locator('[data-worker-id="a"]>i').evaluate(el=>el.style.background);
 checks.push('Today: 3 unique orders / 4 labels; duplicate, test, future and invalid rows excluded; same-name workers split 1/3 and 2/3');
 await page.getByRole('button',{name:'7 días',exact:true}).click();assert.equal(await total.innerText(),'5');assert.equal(await page.locator('.warehouse-week-row').count(),5);
 assert.equal(await legend.locator('[data-worker-id="a"]>i').evaluate(el=>el.style.background),color);
 await page.getByRole('button',{name:'28 de octubre, 10:00: 2 pedidos',exact:true}).click();assert.equal(await total.innerText(),'2');await page.getByRole('button',{name:'Ver todas las horas',exact:true}).click();assert.equal(await total.innerText(),'3');await page.getByRole('button',{name:'Volver a los 7 días',exact:true}).click();assert.equal(await total.innerText(),'5');
 assert.equal(await page.locator('.warehouse-week-row[data-day="2026-10-24"]').count(),0);assert.equal(await page.locator('.warehouse-week-row[data-day="2026-10-25"]').count(),0);
 assert.equal(await page.locator('.warehouse-week-row').evaluateAll(rows=>rows.reduce((sum,r)=>sum+Number(r.dataset.total),0)),5);
 checks.push('7 calendar days: separate daily hourly rows, five weekdays, no empty weekend, day+hour click/reset, reconciled sum, stable worker colors');
 await page.getByRole('button',{name:'Mes',exact:true}).click();assert.equal(await total.innerText(),'6');
 assert.equal(await page.getByTestId('month-total').innerText(),'6 pedidos en el mes');assert.equal(await page.locator('.warehouse-month-table tbody tr').count(),28);
 const daySum=await page.locator('.warehouse-month-table tbody tr').evaluateAll(rows=>rows.reduce((sum,row)=>sum+Number(row.cells[1].textContent),0));assert.equal(daySum,6);
 await page.getByRole('button',{name:'28 de octubre',exact:true}).click();assert.equal(await total.innerText(),'3');assert.equal(await page.locator('.warehouse-order-plot [role="button"]').count(),24);assert.equal(await page.locator('.warehouse-detail tbody tr').count(),3);
 assert.equal(await page.getByTestId('month-total').innerText(),'6 pedidos en el mes');
 await page.getByRole('button',{name:'Volver al mes completo',exact:true}).click();assert.equal(await total.innerText(),'6');
 await page.getByRole('button',{name:'1 de octubre: 1 pedidos',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await total.innerText(),'1');await page.getByRole('button',{name:'Volver al mes completo',exact:true}).click();
 checks.push('Month: daily zero rows, exact monthly sum, click row and keyboard chart day drilldown, return preserves month context');
 await page.getByLabel('Filtrar por operario',{exact:true}).selectOption('a');assert.equal(await total.innerText(),'3');assert.equal(await legend.locator('li').count(),1);assert.match(await legend.innerText(),/100/);await page.locator('.warehouse-worker-qr img').waitFor();await page.waitForFunction(()=>document.querySelector('.warehouse-worker-qr img')?.naturalWidth>0);
 assert.equal(await legend.locator('[data-worker-id="a"]>i').evaluate(el=>el.style.background),color);
 await page.getByLabel('Filtrar por operario',{exact:true}).selectOption('b');assert.equal(await total.innerText(),'3');
 assert.match(await page.getByLabel('Filtrar por operario',{exact:true}).locator('option[value="b"]').innerText(),/histórico/);
 await page.getByLabel('Mes de estadísticas',{exact:true}).fill('2026-09');assert.equal(await total.innerText(),'0');assert.equal(await page.locator('.warehouse-month-table tbody tr').count(),30);assert.equal(await legend.locator('li').count(),0);assert.match(await page.locator('.warehouse-donut').getAttribute('aria-label'),/Sin actividad/);
 await page.getByLabel('Mes de estadísticas',{exact:true}).fill('2026-10');await page.getByLabel('Filtrar por operario',{exact:true}).selectOption('all');
 checks.push('Worker-only 100%, historical worker selectable, QR still decodes; previous month/empty without NaN');
 await page.screenshot({path:join(evidence,'fixture-desktop.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});const collapse=page.getByRole('button',{name:'Recoger menu lateral',exact:true});if(await collapse.isVisible())await collapse.click();
 const geometry=async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));for(const selector of ['.expeditions-subnav','.warehouse-stats','.warehouse-stats-hero','.warehouse-stats-controls','.warehouse-kpis','.warehouse-charts','.warehouse-order-plot','.warehouse-share-card','.warehouse-monthly','.warehouse-detail']){const box=await page.locator(selector).boundingBox();assert(box.x>=-1&&box.x+box.width<=391,selector+' clipped: '+JSON.stringify(box));}};
 await geometry();await page.screenshot({path:join(evidence,'fixture-mobile.png'),fullPage:false});
 await page.getByRole('button',{name:'28 de octubre',exact:true}).click();await geometry();assert.equal(await total.innerText(),'3');
 await page.getByRole('button',{name:'Volver al mes completo',exact:true}).click();
 failing=true;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByRole('alert').filter({hasText:'No se pudieron cargar'}).waitFor();assert.equal(await total.innerText(),'—');assert.equal(await page.locator('.warehouse-detail tbody tr').count(),1);
 failing=false;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="orders-total"]')?.textContent==='6');
 checks.push('Real parent/mobile bounding boxes and day touch; API error is not zero/success; refresh recovery');
 // Regression: locale format must not be used as an ISO day key.
 await page.addInitScript(()=>{const original=Date.prototype.toLocaleDateString;Date.prototype.toLocaleDateString=function(locale,options){if(locale==='en-CA')return '10/28/2026';return original.call(this,locale,options);};});await page.reload();await page.waitForFunction(()=>document.querySelector('[data-testid="orders-total"]')?.textContent==='3');
 await page.getByRole('button',{name:'Mes',exact:true}).click();assert.equal(await total.innerText(),'6');checks.push('Locale/date regression in non-Madrid browser timezone');
 await page.getByRole('button',{name:'7 días',exact:true}).click();
 activities.push(a('weekend-exception','WKEND','2026-10-24T12:00:00Z'),a('early-edge','EARLY','2026-10-27T23:15:00Z'),a('late-edge','LATE','2026-10-22T21:59:59Z'));
 await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="orders-total"]')?.textContent==='8');
 assert.equal(await page.locator('.warehouse-week-row[data-day="2026-10-24"]').count(),1);assert.match(await page.locator('.warehouse-week-row[data-day="2026-10-24"]').innerText(),/Excepcional/);
 assert.equal(await page.locator('.warehouse-week-row').evaluateAll(rows=>rows.reduce((sum,r)=>sum+Number(r.dataset.total),0)),8);
 assert.equal(await page.locator('.warehouse-week-row[data-day="2026-10-28"] [data-hour="00"]').getAttribute('data-total'),'1');
 assert.equal(await page.locator('.warehouse-week-row[data-day="2026-10-22"] [data-hour="23"]').getAttribute('data-total'),'1');
 const saved=activities;activities=[];await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="orders-total"]')?.textContent==='0');assert.equal(await page.locator('.warehouse-week-row').count(),5);assert.equal(await page.locator('.warehouse-week-row [data-hour="00"]').count(),5);
 activities=saved;await page.getByRole('button',{name:'Mes',exact:true}).click();
 checks.push('Exceptional weekend and out-of-office edge hours remain visible; empty working days and all-zero week render safely');

 // Unintercepted application reader over the disposable snapshot; not public auth acceptance.
 interceptStats=false;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('[data-testid="orders-total"]')?.textContent.replaceAll('.',''))>100);
 const realToday=new Date();const madridParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(realToday).map(p=>[p.type,p.value]));const key=`${madridParts.year}-${madridParts.month}-${madridParts.day}`;
 const source=JSON.parse(ledgerBefore),seen=new Set();const expected=source.filter(a=>a.result==='label-created'&&Date.parse(a.createdAt)<=Date.parse('2026-10-28T15:40:00Z')).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id)).filter(a=>{const k=(a.resolvedOrderRef||a.orderRef).trim().toUpperCase();if(!k||seen.has(k))return false;seen.add(k);return true;}).filter(a=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(a.createdAt)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}`==='2026-10';}).length;
 assert.equal(Number((await total.innerText()).replaceAll('.','')),expected);assert.equal(readFileSync(join(temp,'warehouse-worker-activity.json'),'utf8'),ledgerBefore);
 await geometry();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(evidence,'snapshot-mobile.png'),fullPage:false});await page.locator('.warehouse-charts').screenshot({path:join(evidence,'snapshot-mobile-charts.png')});await page.locator('.warehouse-monthly').screenshot({path:join(evidence,'snapshot-mobile-month.png')});await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(evidence,'snapshot-desktop.png'),fullPage:false});await page.locator('.warehouse-charts').screenshot({path:join(evidence,'snapshot-desktop-charts.png')});
 const detailNav=page.getByRole('navigation',{name:'Páginas del detalle de pedidos'});assert.equal(await page.locator('.warehouse-detail tbody tr').count(),50);const firstRef=await page.locator('.warehouse-detail tbody tr').first().locator('td').nth(2).innerText();await detailNav.getByRole('button',{name:'Siguiente',exact:true}).click();assert.notEqual(await page.locator('.warehouse-detail tbody tr').first().locator('td').nth(2).innerText(),firstRef);await detailNav.getByRole('button',{name:'Anterior',exact:true}).click();assert.equal(await page.locator('.warehouse-detail tbody tr').first().locator('td').nth(2).innerText(),firstRef);checks.push('50-row detail pagination on large snapshot, next/previous retain filters and totals');
 checks.push('Unintercepted local HTTP reader + copied real activity: '+expected+' monthly unique orders, source ledger unchanged');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const report={passed:true,checks,pageErrors:errors,unexpectedWrites:writes,expectedFailureConsoleErrors:consoleErrors.filter(x=>x.includes('503')).length,otherConsoleErrors:consoleErrors.filter(x=>!x.includes('503')),realSnapshotMonthTotal:expected,publicAuthenticated:false,temporaryBypassOnly:true};
 assert.deepEqual(report.otherConsoleErrors,[]);writeFileSync(join(evidence,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error('URL',page?.url());if(page){console.error((await page.locator('body').innerText()).slice(-2200));await page.screenshot({path:join(evidence,'failure.png'),fullPage:false}).catch(()=>{});}console.error('SERVER',serverLog.slice(-2000));throw error;}
finally{await browser?.close();try{process.kill(-vite.pid,'SIGTERM')}catch{}await new Promise(r=>setTimeout(r,400));const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve)});await new Promise(r=>probe.close(r));rmSync(temp,{recursive:true,force:true});console.log('QA listener stopped:',port);}
