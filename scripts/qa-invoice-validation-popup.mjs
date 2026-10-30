import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const { chromium }=createRequire('/usr/lib/node_modules/openclaw/package.json')('playwright-core');
const root=process.cwd();const evidence=resolve(process.env.INVOICE_QA_EVIDENCE||'/tmp/invoice-corrections-evidence');mkdirSync(evidence,{recursive:true});
const publicAssets=process.argv.includes('--public-assets');const origin='https://dashboard.todoelectrico.net';
let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1365,height:950}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 let doc={driveFileId:'test_pdf',name:'Invoice_MS-2026-1013_Todoelectrico.pdf',invoiceBranch:'services',pdfLinesAccepted:true,confirmedOdooPartnerId:42,status:'PENDIENTE_COTEJO',assignedPurchaseOrderIds:[],odooDraftMoveId:null,match:null,
  extracted:{supplier:'Muhammad Shoaib',supplierVat:'FALSE',invoiceNumber:'MS-2026-1013',invoiceDate:'2026-10-13',dueDate:null,country:'PAKISTAN',currency:'EUR',base:45,taxes:0,total:45,docType:'factura',warnings:[],lines:[{description:'Support services – checkout and payment module fixing',quantity:1,priceUnit:45,total:45,discount:null,reference:null,taxNames:[],taxId:null,accountId:null,taxAmount:null}]}};
 let verifyMode='normal',releaseVerify=null,fieldsCount=0,linesCount=0,editorFailure='fields';
 let saveCount=0,sendCount=0,failSave=true,releaseSave=null,sendMode='normal',releaseSend=null,reconcileCount=0;let verification={ready:false,blockers:['NIF del emisor sin evidencia en el PDF.','Línea 1: impuesto o cuenta contable sin confirmar.']};
 const requests=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(url.origin!==origin)return route.abort();
  if(!path.startsWith('/api/')){
   if(!['GET','HEAD'].includes(req.method()))return route.abort();
   if(publicAssets)return route.continue();
   const f=resolve('dist',path==='/'?'index.html':path.slice(1));let bytes;try{bytes=readFileSync(f);}catch{return route.fulfill({status:404,body:''});}
   return route.fulfill({body:bytes,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'application/octet-stream'});
  }
  requests.push({path,method:req.method()});let body={};
  if(path==='/api/auth/me')return route.fulfill({json:{authenticated:true,user:{id:'qa',name:'QA',role:'admin',permissions:['supplierBilling','purchases','products','dashboard','odooWrite']}}});
  if(path.endsWith('/verification')){
   if(verifyMode==='slow')await new Promise(r=>{releaseVerify=r;});
   if(verifyMode==='error')return route.fulfill({status:502,json:{message:'No se pudo comprobar Odoo; reintenta'}});
   body={verification,fingerprint:'fingerprint'};
  } else if(path.endsWith('/fields')){
   fieldsCount++;await new Promise(r=>setTimeout(r,120));
   if(editorFailure==='fields')return route.fulfill({status:500,json:{message:'No se pudieron guardar los campos'}});
   const data=req.postDataJSON();doc={...doc,extracted:{...doc.extracted,...data.fields}};body={document:doc};
  } else if(path.endsWith('/lines')){
   linesCount++;if(editorFailure==='lines')return route.fulfill({status:500,json:{message:'Fallo guardando líneas'}});
   doc={...doc,extracted:{...doc.extracted,lines:req.postDataJSON().lines}};body={document:doc};
  }
  else if(path.endsWith('/review-corrections')){
   saveCount++;await new Promise(r=>{releaseSave=r;});
   if(failSave)return route.fulfill({status:500,json:{message:'Fallo de disco simulado'}});
   const data=req.postDataJSON();doc={...doc,extracted:{...doc.extracted,...data.fields,lines:doc.extracted.lines.map((l,i)=>({...l,...data.lineCorrections[i]}))},issuerVatAbsence:{by:'Operario',reason:data.reason}};
   body={document:doc,fingerprint:'fingerprint'};verification={ready:false,blockers:['Línea 1: impuesto o cuenta contable sin confirmar.']};
  }else if(path.endsWith('/odoo-draft-reconcile')){reconcileCount++;body=reconcileCount===1?{status:'in_progress',message:'El servidor sigue procesando; no repitas.'}:{status:'not_found',safeToRetry:false,message:'Odoo no muestra una coincidencia. Compruébalo manualmente antes de reintentar.'};}
  else if(path.endsWith('/odoo-draft')){sendCount++;if(sendMode==='hold')await new Promise(r=>{releaseSend=r;});else await new Promise(r=>setTimeout(r,30));body={document:{...doc,odooDraftMoveId:91},result:{moveId:91}};try{await route.fulfill({json:body});}catch{}return;}
  else if(path.endsWith('/line-options'))body={taxes:[{id:14,name:'Servicios extracomunitarios',rate:21,type:'percent'}],accounts:[{id:383,code:'629000',name:'Otros servicios'}]};
  else if(path.endsWith('/purchase-orders'))body={orders:[],candidates:[]};
  else if(path.endsWith('/supplier-invoices/inbox'))body={mode:'live',total:1,items:[doc],kpis:{sinRevisar:1,pendientesCotejo:1,pedidosSinFacturar:0,importePedidosSinFacturar:0,importePendienteCotejo:45,sinCoincidenciaOdoo:0}};
  else if(path.endsWith('/preview'))return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF')});
  else body={items:[],orders:[],candidates:[],suggestions:[],total:0,options:{},kpis:{},charts:{}};
  await route.fulfill({json:body});
 });
 await page.goto(origin+'/#/facturas-proveedor');
 await page.getByText(doc.name,{exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'Completar datos de la factura'});
 const validate=()=>page.getByRole('button',{name:'Validar y revisar borrador Odoo',exact:true}).click();
 verifyMode='slow';await validate();await dialog.waitFor();
 await dialog.getByText('Comprobando los problemas de la factura…',{exact:true}).waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).isDisabled(),true);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});releaseVerify();await page.waitForTimeout(180);
 assert.equal(await dialog.count(),0,'Late verification must not reopen modal');
 verifyMode='error';await validate();await dialog.getByText('No se pudo comprobar Odoo; reintenta',{exact:true}).waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).isDisabled(),true);
 verifyMode='normal';await dialog.getByRole('button',{name:'Reintentar comprobación',exact:true}).click();
 await dialog.getByText('Problemas que impiden validar',{exact:true}).waitFor();
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByLabel('Nº factura',{exact:true}).fill('MS-2026-1013-EDITADO');
 await page.getByLabel('País',{exact:true}).fill('PK');
 await validate();await dialog.getByText(/Hay cambios del editor sin guardar/).waitFor();
 const saveEditor=dialog.getByRole('button',{name:'Guardar cambios del editor y comprobar',exact:true});
 await saveEditor.click();await dialog.getByRole('alert').filter({hasText:'No se pudieron guardar los campos'}).waitFor();
 assert.equal(fieldsCount,1);assert.equal(linesCount,0);assert.equal(await saveEditor.isVisible(),true);
 editorFailure='lines';await saveEditor.click();await dialog.getByRole('alert').filter({hasText:'Proveedor guardado, pero no las líneas'}).waitFor();
 assert.equal(await saveEditor.isVisible(),true);assert.equal(sendCount,0);
 editorFailure='';await saveEditor.evaluate(b=>{b.click();b.click();});
 await dialog.getByText('Cambios del editor guardados en Dashboard. No se ha enviado nada a Odoo.',{exact:true}).waitFor();await dialog.getByLabel('Referencia de factura',{exact:true}).waitFor();assert.equal(fieldsCount,3);assert.equal(linesCount,2);
 assert.equal(await dialog.getByLabel('Referencia de factura',{exact:true}).inputValue(),'MS-2026-1013-EDITADO');
 assert.equal(doc.extracted.country,'PK');assert.equal(sendCount,0);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await validate();await dialog.waitFor();
 assert.equal(await dialog.getByText(/Hay cambios del editor sin guardar/).count(),0,'Saved editor should not stay falsely dirty');
 assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'initial focus inside modal');
 for(const key of ['Tab','Shift+Tab']){
  for(let n=0;n<30;n++){
   const before=await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,250));
   await page.keyboard.press(key);
   assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),`keyboard focus stays inside modal (${key} #${n}, before=${before}, after=${await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,250))})`);
  }
 }
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.equal(saveCount,0);assert.equal(sendCount,0);
 await page.getByRole('button',{name:'Completar datos o enviar con pendientes',exact:true}).click();await dialog.waitFor();
 assert.equal(await dialog.getByLabel('NIF / identificador del emisor',{exact:true}).inputValue(),'');
 await dialog.getByLabel('Confirmo que el emisor no aporta identificador fiscal;', {exact:false}).check();
 await dialog.getByLabel('Motivo / datos que se terminarán en Odoo',{exact:true}).fill('Particular extranjero: sin NIF; completar contabilidad en Odoo');
 const form=dialog.locator('form');await form.evaluate(f=>{f.requestSubmit();f.requestSubmit();});
 await page.waitForFunction(()=>document.querySelector('dialog')?.getAttribute('aria-busy')==='true');
 assert.equal(saveCount,1);assert.equal(await dialog.getByRole('button',{name:'Cerrar',exact:true}).isDisabled(),true);
 releaseSave();await dialog.getByText('Fallo de disco simulado',{exact:true}).waitFor();assert.match(await dialog.getByLabel('Motivo / datos que se terminarán en Odoo').inputValue(),/Particular/);
 failSave=false;verifyMode='error';await dialog.getByRole('button',{name:'Guardar datos en Dashboard',exact:true}).click();
 await page.waitForTimeout(60);releaseSave();await dialog.getByText('Datos guardados en el borrador del Dashboard. No se ha enviado nada a Odoo.',{exact:true}).waitFor();
 await dialog.getByRole('alert').filter({hasText:'No se pudo comprobar Odoo; reintenta'}).first().waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).isDisabled(),true);
 verifyMode='normal';await dialog.getByRole('button',{name:'Reintentar comprobación',exact:true}).click();
 await dialog.getByText('Problemas que impiden validar',{exact:true}).waitFor();assert.equal(await dialog.getByRole('alert').count(),0,'Successful retry clears obsolete errors');assert.equal(saveCount,2,'Rechecking after saved data must not save again');
 assert.equal(saveCount,2);await dialog.getByLabel('Fecha contable',{exact:true}).fill('2026-10-30');
 assert.equal(await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).isDisabled(),true,'No send without explicit checkbox');
 await dialog.getByLabel('He revisado estos pendientes y autorizo crear el borrador para corregirlos en Odoo.',{exact:true}).check();
 await dialog.screenshot({path:join(evidence,'desktop.png')});
 await page.setViewportSize({width:390,height:844});
 const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390.5);
 assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));
 await dialog.evaluate(el=>el.scrollTop=0);await dialog.screenshot({path:join(evidence,'mobile.png')});
 await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).scrollIntoViewIfNeeded();
 for(const button of await dialog.locator('.si-draft-confirm-actions button').all()){
  const b=await button.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=390.5&&b.y>=0&&b.y+b.height<=844.5,'mobile actions visible and reachable');
 }
 await dialog.screenshot({path:join(evidence,'mobile-actions.png')});
 await page.evaluate(()=>{const original=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=()=>original(180);});
 sendMode='hold';await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).click();
 await dialog.getByRole('alert').filter({hasText:'El borrador podría haberse creado'}).waitFor();assert.equal(sendCount,1,'timeout must not auto-submit a second create');
 const send=dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true});assert.equal(await send.isDisabled(),true,'uncertain timeout keeps send blocked');
 await dialog.getByRole('button',{name:'Comprobar estado en Odoo',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'El servidor aún procesa'}).waitFor();assert.equal(sendCount,1,'in-progress status must not retry');
 await new Promise(r=>setTimeout(r,220));releaseSend();
 await dialog.getByRole('button',{name:'Comprobar estado en Odoo',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Compruébalo manualmente antes de reintentar'}).waitFor();assert.equal(await send.isDisabled(),true,'not-found response alone does not authorize retry');
 await dialog.getByLabel('He comprobado en Odoo que no existe esta factura y autorizo reintentar.',{exact:true}).check();assert.equal(await send.isDisabled(),false,'manual Odoo attestation is required to unlock retry');
 sendMode='normal';await send.click();await dialog.waitFor({state:'hidden'});assert.equal(sendCount,2);assert.equal(reconcileCount,2);
 assert.equal(requests.filter(x=>/drive\/move|\/status$/.test(x.path)&&x.method==='POST').length,0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',saveCount,sendCount,reconcileCount,evidence,checks:['Validate opens popup before slow read','Escape suppresses late response','verification error and retry in modal','unsaved editor saved in modal','field and line failures keep pending state','double save once','real SupplierInvoicesView parent','popup fields','double submit','slow save','failure preserves edits','save local','explicit incomplete draft','lost response shows uncertain state','in-progress prevents duplicate retry','not-found requires manual Odoo attestation','desktop/mobile overflow','no Drive move/status validation','no page errors']}));
}catch(error){if(browser){const p=browser.contexts()[0]?.pages()[0];if(p){console.error((await p.locator('body').innerText()).slice(-2500));await p.screenshot({path:join(evidence,'failure.png')});}}throw error;}finally{await browser?.close();}
