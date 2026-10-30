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
const probe=netServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const html=resolve('__invoice-corrections-qa.html'),entry=resolve('__invoice-corrections-qa.tsx');
writeFileSync(html,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/__invoice-corrections-qa.tsx"></script></body></html>');
writeFileSync(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{SupplierInvoicesView}from'./src/modules/supplierInvoices/SupplierInvoicesView';import'./src/modules/supplierInvoices/supplierInvoices.css';createRoot(document.getElementById('root')!).render(<SupplierInvoicesView/>);`);
const server=await createServer({configFile:false,root,envFile:false,plugins:[react()],cacheDir:mkdtempSync(join(tmpdir(),'invoice-vite-cache-')),server:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium-browser',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1365,height:950}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 let doc={driveFileId:'test_pdf',name:'Invoice_MS-2026-1013_Todoelectrico.pdf',invoiceBranch:'services',pdfLinesAccepted:true,confirmedOdooPartnerId:42,status:'PENDIENTE_COTEJO',assignedPurchaseOrderIds:[],odooDraftMoveId:null,match:null,
  extracted:{supplier:'Muhammad Shoaib',supplierVat:'FALSE',invoiceNumber:'MS-2026-1013',invoiceDate:'2026-10-13',dueDate:null,country:'PAKISTAN',currency:'EUR',base:45,taxes:0,total:45,docType:'factura',warnings:[],lines:[{description:'Support services – checkout and payment module fixing',quantity:1,priceUnit:45,total:45,discount:null,reference:null,taxNames:[],taxId:null,accountId:null,taxAmount:null}]}};
 let saveCount=0,sendCount=0,failSave=true,releaseSave=null;let verification={ready:false,blockers:['NIF del emisor sin evidencia en el PDF.','Línea 1: impuesto o cuenta contable sin confirmar.']};
 const requests=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;requests.push({path,method:req.method()});let body={};
  if(path.endsWith('/verification'))body={verification,fingerprint:'fingerprint'};
  else if(path.endsWith('/review-corrections')){
   saveCount++;await new Promise(r=>{releaseSave=r;});
   if(failSave)return route.fulfill({status:500,json:{message:'Fallo de disco simulado'}});
   const data=req.postDataJSON();doc={...doc,extracted:{...doc.extracted,...data.fields,lines:doc.extracted.lines.map((l,i)=>({...l,...data.lineCorrections[i]}))},issuerVatAbsence:{by:'Operario',reason:data.reason}};
   body={document:doc,fingerprint:'fingerprint'};verification={ready:false,blockers:['Línea 1: impuesto o cuenta contable sin confirmar.']};
  }else if(path.endsWith('/odoo-draft')){sendCount++;await new Promise(r=>setTimeout(r,150));body={document:{...doc,odooDraftMoveId:91},result:{moveId:91}};}
  else if(path.endsWith('/line-options'))body={taxes:[{id:14,name:'Servicios extracomunitarios',rate:21,type:'percent'}],accounts:[{id:383,code:'629000',name:'Otros servicios'}]};
  else if(path.endsWith('/purchase-orders'))body={orders:[],candidates:[]};
  else if(path.endsWith('/supplier-invoices/inbox'))body={mode:'live',total:1,items:[doc],kpis:{sinRevisar:1,pendientesCotejo:1,pedidosSinFacturar:0,importePedidosSinFacturar:0,importePendienteCotejo:45,sinCoincidenciaOdoo:0}};
  else if(path.endsWith('/preview'))return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF')});
  else body={items:[],orders:[],candidates:[],suggestions:[],total:0,options:{},kpis:{},charts:{}};
  await route.fulfill({json:body});
 });
 await page.goto(`http://127.0.0.1:${port}/__invoice-corrections-qa.html`);
 await page.getByText(doc.name,{exact:true}).first().click();
 await page.getByRole('button',{name:'Completar datos o enviar con pendientes',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Completar datos de la factura'});await dialog.waitFor();
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
 failSave=false;await dialog.getByRole('button',{name:'Guardar datos en Dashboard',exact:true}).click();
 await page.waitForTimeout(60);releaseSave();await dialog.getByText('Datos guardados en el borrador del Dashboard. No se ha enviado nada a Odoo.',{exact:true}).waitFor();
 assert.equal(saveCount,2);await dialog.getByLabel('Fecha contable',{exact:true}).fill('2026-10-30');
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
 await dialog.getByRole('button',{name:'Confirmar envío con pendientes',exact:true}).dblclick();
 await dialog.waitFor({state:'hidden'});assert.equal(sendCount,1);
 assert.equal(requests.filter(x=>/drive\/move|\/status$/.test(x.path)&&x.method==='POST').length,0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',saveCount,sendCount,evidence,checks:['real SupplierInvoicesView parent','popup fields','double submit','slow save','failure preserves edits','save local','explicit incomplete draft','desktop/mobile overflow','no Drive move/status validation','no page errors']}));
}finally{await browser?.close();await server.close();unlinkSync(html);unlinkSync(entry);}
