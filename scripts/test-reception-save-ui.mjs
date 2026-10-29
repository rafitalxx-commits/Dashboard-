import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Entire application mounted from its compiled output. No API reaches a server.
const {chromium}=createRequire('/usr/lib/node_modules/openclaw/package.json')('playwright-core');
const origin='https://dashboard.todoelectrico.net';
const evidence=process.env.RECEPTION_SAVE_EVIDENCE||'/root/.openclaw/workspace/releases/reception-save-highlight-20261029';
mkdirSync(evidence,{recursive:true});
const line=(id,classification='under_order',qty=10)=>({id,productId:id,name:`Producto ${id}`,sku:`SKU-${id}`,barcode:'',expectedQty:qty,processedQty:0,pendingQty:qty,uom:'uds',classification,saleOrderRefs:classification==='replenishment'?[]:['S-QA'],preferredLocation:'A101',...(classification==='mixed'?{pendingShipmentQty:3,warehouseStockQty:7}:{})});
const lines=[line('pedido'),line('stock','replenishment'),line('mixto','mixed'),line('completo','under_order',0)];
const reception={id:'qa-recepcion',ref:'ALM/IN/QA',purchaseRef:'PO-QA',supplier:'Proveedor QA',isImportation:false,scheduledDate:'2026-10-29T10:00:00Z',state:'assigned',status:'Esperando',destination:'ALM/Stock',lines,expectedQty:30,processedQty:0,pendingQty:30};
const session={receptionId:reception.id,receptionRef:reception.ref,purchaseRef:reception.purchaseRef,operator:{id:'qa',name:'Operario QA',code:'QA'},status:'in_progress',startedAt:'2026-10-29T10:00:00Z',updatedAt:'2026-10-29T10:00:00Z'};
const locations=[{code:'A101',label:'A101',kind:'physical',active:true},{code:'PENDIENTE_ENVIO',label:'Pendiente de envío',kind:'dispatch',active:true}];
const checks=[],errors=[],mutations=[],requests=[];
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium-browser',args:['--no-sandbox','--disable-dev-shm-usage']});
let page;
try{
 page=await browser.newPage({viewport:{width:1440,height:1000},locale:'es-ES'});page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname;
  if(!['GET','HEAD'].includes(request.method())){mutations.push(request.method()+' '+p);return route.abort();}
  if(url.origin!==origin)return route.abort();
  if(p.startsWith('/api/')){
   requests.push(p);
   const send=json=>route.fulfill({json});
   if(p==='/api/auth/me')return send({authenticated:true,user:{id:'qa',name:'QA',role:'admin',permissions:['products','dashboard','odooWrite']}});
   if(p==='/api/odoo/inventory-receptions')return send({mode:'live',receptions:[reception],total:1,ready:1,waiting:1,pendingLines:3});
   if(p==='/api/odoo/reception-sessions')return send({sessions:[session]});
   if(p==='/api/odoo/products/location-catalog')return send({locations});
   return send({items:[],orders:[],products:[],rules:[],labels:[],shipments:[],workers:[],incidents:[],entries:[],receipts:[],submissions:[],notifications:[],tasks:[],events:[],settings:{},total:0,mode:'live'});
  }
  const file=resolve('dist',p==='/'?'index.html':p.slice(1));
  let body;try{body=readFileSync(file);}catch{return route.fulfill({status:404,body:''});}
  return route.fulfill({body,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});
 });
 const drawer=()=>page.locator('.inventory-reception-drawer');
 const row=id=>drawer().locator('article.inventory-reception-line').filter({has:page.locator('strong',{hasText:`Producto ${id}`})});
 const toggle=id=>row(id).getByRole('button',{name:`Repartir ubicación de Producto ${id}`,exact:true});
 const plan=id=>row(id).locator('.inventory-location-plan');
 const red=id=>row(id).evaluate(el=>el.classList.contains('inventory-under-order-pending'));
 const open=async()=>{await page.locator('.inventory-reception-summary').filter({hasText:'PO-QA'}).click();await drawer().waitFor();};
 const save=async id=>{await plan(id).getByRole('button',{name:'Guardar reparto',exact:true}).click();await plan(id).waitFor({state:'hidden'});assert.equal(await toggle(id).getAttribute('aria-expanded'),'false');assert(await toggle(id).evaluate(el=>el===document.activeElement));};
 await page.goto(origin+'/#/productos/recepciones');await open();
 assert.equal(await red('pedido'),true);assert.equal(await red('mixto'),true);assert.equal(await red('stock'),false);assert.equal(await red('completo'),false);
 assert.equal(await row('pedido').locator('.inventory-reception-line-main').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 240, 239)');
 await page.screenshot({path:join(evidence,'pending-desktop.png')});
 checks.push('Under-order and mixed pending lines highlighted across whole row; replenishment and zero pending excluded');
 await toggle('pedido').click();await plan('pedido').waitFor();await plan('pedido').getByLabel('Cantidad a recibir').fill('0');await save('pedido');assert.equal(await red('pedido'),true);
 await toggle('pedido').click();assert.equal(await plan('pedido').getByLabel('Cantidad a recibir').inputValue(),'0');
 await plan('pedido').getByLabel('Cantidad a recibir').fill('4');
 // Zero receipt removes allocations by design: add a valid destination again.
 await plan('pedido').getByRole('button',{name:'Añadir otra ubicación'}).click();
 await plan('pedido').getByLabel('Ubicación real').fill('PENDIENTE_ENVIO');await plan('pedido').getByLabel('Cantidad',{exact:true}).fill('4');await save('pedido');
 assert.equal(await red('pedido'),true);assert.match(await row('pedido').innerText(),/Parcial.*4\/10/);
 checks.push('Zero and partial receipts close immediately, keep red and preserve quantities on reopening; focus returns to row');
 await toggle('stock').click();await plan('stock').waitFor();assert.equal(await plan('pedido').count(),0);await save('stock');assert.equal(await red('stock'),false);
 await toggle('pedido').click();assert.equal(await plan('pedido').getByLabel('Cantidad a recibir').inputValue(),'4');
 await plan('pedido').getByLabel('Cantidad a recibir').fill('10');await save('pedido');assert.equal(await red('pedido'),false);assert.match(await row('pedido').innerText(),/Repartido.*10/);
 checks.push('Next product can be selected immediately; a full saved count clears red without validating Odoo');
 await toggle('pedido').click();await plan('pedido').getByLabel('Ubicación real').fill('DESCONOCIDA');
 assert.equal(await plan('pedido').getByRole('button',{name:'Guardar reparto'}).isDisabled(),true);assert.equal(await red('pedido'),true);
 await toggle('pedido').click();await toggle('pedido').click();assert.equal(await plan('pedido').getByLabel('Ubicación real').inputValue(),'DESCONOCIDA');
 await plan('pedido').getByLabel('Ubicación real').fill('PENDIENTE_ENVIO');await save('pedido');
 await drawer().getByRole('button',{name:'Cerrar recepción',exact:true}).click();await open();await toggle('pedido').click();assert.equal(await plan('pedido').getByLabel('Cantidad a recibir').inputValue(),'10');await save('pedido');
 await page.reload();await open();assert.equal(await red('pedido'),false);assert.equal(await red('mixto'),true);assert.match(await row('pedido').innerText(),/Repartido.*10/);
 checks.push('Invalid location prevents save/collapse; editing and persisted drafts survive close/reopen and full page reload');
 await drawer().getByRole('button',{name:'Cerrar recepción',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 const sidebar=page.getByRole('button',{name:'Recoger menu lateral',exact:true});if(await sidebar.isVisible())await sidebar.click();
 await page.waitForFunction(()=>{const el=document.querySelector('.sidebar');return !el||el.getBoundingClientRect().right<=1;});
 await open();
 await toggle('mixto').click();
 const pane=await drawer().boundingBox();assert(pane.x>=-1&&pane.x+pane.width<=391);
 // Existing compact rows intentionally scroll horizontally. Check both ends.
 const scroller=drawer().locator('.inventory-reception-lines');
 await scroller.evaluate(el=>el.scrollLeft=el.scrollWidth);
 await plan('mixto').getByRole('button',{name:'Guardar reparto'}).scrollIntoViewIfNeeded();
 const buttonBox=await plan('mixto').getByRole('button',{name:'Guardar reparto'}).boundingBox();assert(buttonBox.x>=-1&&buttonBox.x+buttonBox.width<=391);
 await page.screenshot({path:join(evidence,'pending-mobile-editor.png')});
 await save('mixto');assert.equal(await red('mixto'),false);
 await scroller.evaluate(el=>el.scrollLeft=0);
 await toggle('pedido').click();await plan('pedido').getByLabel('Cantidad a recibir').fill('2');await save('pedido');assert.equal(await red('pedido'),true);
 await scroller.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});await page.screenshot({path:join(evidence,'pending-mobile.png')});
 checks.push('Mobile: full-width soft-red row and editor, horizontally reachable controls, collapse and focus preserved');
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
 const report={passed:true,checks,allApisIntercepted:true,liveRequests:0,mutations,errors,apiPaths:[...new Set(requests)]};
 writeFileSync(join(evidence,'fixture-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){console.error((await page.locator('body').innerText()).slice(-2000));await page.screenshot({path:join(evidence,'fixture-failure.png')});}throw error;}
finally{await browser.close();}
