import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseInvoiceDate, invoiceDateInPdf, printedInvoiceAmount, normalizeInvoiceVat } from '../shared/supplierInvoiceEvidence.ts';
import { correctedReview, reviewFingerprint, exceptionRequestError, vatAbsenceConfirmed } from '../backend/supplierInvoices/reviewCorrections.ts';
import { verifyInvoiceForAutomation } from '../backend/supplierInvoices/autoVerifier.ts';
import { DocumentInboxService } from '../backend/supplierInvoices/documentInbox.ts';
import { registerSupplierInvoicesPhase2Routes } from '../backend/supplierInvoices/phase2Routes.ts';
import { DriveClient } from '../backend/supplierInvoices/driveClient.ts';

for(const date of ['13 October 2026','October 13, 2026','13th Oct 2026','13/10/2026','2026-10-13'])assert.equal(parseInvoiceDate(date),'2026-10-13');
for(const date of ['31 February 2026','2026-02-29','2026-13-01','10/30/2026'])assert.equal(parseInvoiceDate(date),null);
assert.equal(parseInvoiceDate('29 February 2024'),'2024-02-29');
assert.equal(invoiceDateInPdf('2026-10-13','Issue date13 October 2026\nDue date14 October 2026'),true);
assert.equal(invoiceDateInPdf('2026-10-14','Issue date13 October 2026\nDue date14 October 2026'),false);
for(const value of [false, null, 'FALSE','null','undefined']) assert.equal(normalizeInvoiceVat(value),'');
for(const text of ['Subtotal€45.00\nTotal due€45.00','Subtotal EUR 45,00\nTotal EUR 45,00']) {
 assert.equal(printedInvoiceAmount(text,'base','EUR'),45);assert.equal(printedInvoiceAmount(text,'total','EUR'),45);
}
assert.equal(printedInvoiceAmount('Subtotal $1,234.56\nGrand total USD 1,234.56','total','USD'),1234.56);
assert.equal(printedInvoiceAmount('Total €45.00\nTotal €46.00','total','EUR'),null);
assert.equal(printedInvoiceAmount('Total €45.00','total','USD'),null);
assert.equal(printedInvoiceAmount('Total tax €45.00','total','EUR'),null);
assert.equal(printedInvoiceAmount('Total 1,234','total','EUR'),null);
const pdf='Muhammad Shoaib\nINVOICE\nInvoice NoMS-2026-1013\nIssue date13 October 2026\nFROM Muhammad Shoaib\nBILL TO Client CIF B54685144\nSupport services 1€45.00€45.00\nSubtotal€45.00\nVAT€0.00\nTotal due€45.00';
const doc:any={driveFileId:'test_pdf',name:'invoice.pdf',sourcePresent:true,modifiedTime:'v1',invoiceBranch:'services',pdfLinesAccepted:true,confirmedOdooPartnerId:42,status:'PENDIENTE_COTEJO',assignedPurchaseOrderIds:[],
 extracted:{supplier:'Muhammad Shoaib',supplierVat:'FALSE',country:'PAKISTAN',docType:'factura',needsOcr:false,invoiceNumber:'MS-2026-1013',invoiceDate:'2026-10-13',currency:'EUR',base:45,taxes:0,total:45,
 lines:[{description:'Support services',quantity:1,priceUnit:45,total:45,taxId:14,taxAmount:0,accountId:383}]}};
const next=correctedReview(doc,{fields:{supplierVat:''},vatAbsent:true,reason:'Particular extranjero sin identificador fiscal impreso'},'Operario');
assert.equal(next.extracted.supplierVat,null);assert.equal(doc.extracted.supplierVat,'FALSE');assert.ok(vatAbsenceConfirmed(next));
const changed=structuredClone(next);changed.confirmedOdooPartnerId=41;assert.equal(vatAbsenceConfirmed(changed),false);
const reads:any={read:async(model:string)=>model==='res.partner'?[{id:42,name:'Muhammad Shoaib',active:true,vat:false}]:model==='account.tax'?[{active:true,type_tax_use:'purchase',amount:21,invoice_repartition_line_ids:[1,2]}]:model==='account.tax.repartition.line'?[{repartition_type:'tax',factor_percent:100},{repartition_type:'tax',factor_percent:-100}]:model==='account.account'?[{deprecated:false}]:[],search:async()=>[]};
assert.equal((await verifyInvoiceForAutomation(next,pdf,reads)).ready,true,'named invoice evidence passes after explicit absence attestation');
assert.equal((await verifyInvoiceForAutomation(doc,pdf,reads)).ready,false,'no automatic no-VAT exemption');
const missing=correctedReview(next,{fields:{base:null,taxes:null,total:null},lineCorrections:[{taxId:null,accountId:null,taxAmount:null}]},'Operario');
const fingerprint=reviewFingerprint(missing,'digest');const blockers=['Base, IVA o total ausentes.'];
const exception={acknowledged:true,reason:'Terminar clasificación fiscal en Odoo',fingerprint,blockers};
assert.equal(exceptionRequestError(missing,exception,fingerprint,blockers),null);
assert.ok(exceptionRequestError(missing,{...exception,acknowledged:false},fingerprint,blockers));
assert.ok(exceptionRequestError(missing,exception,'changed-pdf',blockers));
assert.ok(exceptionRequestError(missing,exception,fingerprint,['Otro pendiente']));

// Real route composition, disposable disk, external RPC mocked (no credentials / network).
const dir=mkdtempSync(join(tmpdir(),'invoice-corrections-'));const store=new DocumentInboxService({dataDir:dir});store.getStore().documents.push(missing);assert.ok(store.save());
mkdirSync(join(dir,'supplier-invoices/inbox'),{recursive:true});writeFileSync(join(dir,'supplier-invoices/inbox/test_pdf.pdf'),'%PDF-synthetic');
const env:any={ODOO_URL:'http://synthetic.invalid',ODOO_DATABASE:'synthetic',ODOO_USERNAME:'test',ODOO_API_KEY:'test',SUPPLIER_INVOICES_DRIVE_FOLDER_ID:'folder',SUPPLIER_INVOICES_ODOO_DRAFT_CREATE_ENABLED:'true'};
const routes=new Map<string,any>();let human=true;let duplicate=false;let creates=0;let payload:any;let pause:Promise<void>|null=null;
const originalFetch=globalThis.fetch, originalMeta=DriveClient.prototype.getFileMeta;
DriveClient.prototype.getFileMeta=async()=>({id:'test_pdf',name:'invoice.pdf',parents:['folder']}) as any;
globalThis.fetch=async(_url,init)=>{
 const call=JSON.parse(String(init?.body));const a=call.params.args;
 let result:any=1;
 if(call.params.service==='object'){
  const [,,,model,method,args]=a;
  if(model==='res.partner')result=[{id:42,active:true,name:'Muhammad Shoaib',vat:false}];
  else if(model==='res.currency')result=[{id:1}];
  else if(model==='account.move'&&method==='search_read')result=duplicate?[{id:90,name:'DUPLICATE'}]:[];
  else if(model==='account.move'&&method==='create'){creates++;payload=args[0];if(pause)await pause;result=91;}
  else if(model==='account.move'&&method==='read')result=[{id:91,name:'draft',state:'draft',ref:'MS-2026-1013',amount_untaxed:45,amount_tax:0,amount_total:45,invoice_line_ids:[92]}];
  else if(model==='account.move.line')result=[{id:92,name:'Support services',quantity:1,price_unit:45,price_subtotal:45,price_total:45}];
  else throw new Error(`Unexpected RPC ${model}.${method}`);
 }
 return new Response(JSON.stringify({result}));
};
registerSupplierInvoicesPhase2Routes({middlewares:{use:(path,handler)=>routes.set(path,handler)}},{getSessionUser:()=>human?{id:'op',name:'Operario',role:'admin',permissions:['supplierBilling']}:undefined},{env,dataDir:dir,readPdfText:async()=>({text:pdf})});
const root='/api/odoo/supplier-invoices/inbox';
async function call(path:string,body:any={},method='POST',url='/'){
 const req=Object.assign(Readable.from([JSON.stringify(body)]),{headers:{},method,url});let value='';
 const res={statusCode:200,writableEnded:false,setHeader(){},end(v:string){value=v;this.writableEnded=true;}};
 await routes.get(root+path)(req,res);return{status:res.statusCode,body:JSON.parse(value)};
}
try{
 human=false;assert.equal((await call('/review-corrections')).status,401);human=true;
 let check=(await call('/verification',{},'GET','/?id=test_pdf')).body;
 const save=await call('/review-corrections',{id:'test_pdf',fingerprint:check.fingerprint,fields:{invoiceDate:'13 October 2026'},vatAbsent:true,reason:'Particular extranjero sin NIF en documento'});
 assert.equal(save.status,200);assert.equal(new DocumentInboxService({dataDir:dir}).getDocument('test_pdf')?.issuerVatAbsence?.by,'Operario');
 assert.equal((await call('/review-corrections',{id:'test_pdf',fingerprint:check.fingerprint,fields:{total:88}})).status,409,'stale edit rejected');
 check=(await call('/verification',{},'GET','/?id=test_pdf')).body;
 const body={id:'test_pdf',accountingDate:'2026-10-30',exception:{...exception,fingerprint:check.fingerprint,blockers:check.verification.blockers}};
 assert.equal((await call('/odoo-draft',{...body,exception:{...body.exception,acknowledged:false}})).status,409);
 assert.equal((await call('/odoo-draft',{id:'test_pdf',accountingDate:'2026-10-30'})).status,400,'no silent validation bypass');
 env.SUPPLIER_INVOICES_ODOO_DRAFT_CREATE_ENABLED='false';assert.equal((await call('/odoo-draft',body)).status,403);env.SUPPLIER_INVOICES_ODOO_DRAFT_CREATE_ENABLED='true';
 duplicate=true;assert.equal((await call('/odoo-draft',body)).status,400);assert.equal(creates,0);duplicate=false;
 let release!:()=>void;pause=new Promise(r=>release=r);const pending=call('/odoo-draft',body);
 await new Promise(r=>setTimeout(r,20));assert.equal((await call('/odoo-draft',body)).status,409);
 assert.equal((await call('/status',{id:'test_pdf',status:'INCIDENCIA'})).status,409);
 assert.equal(new DocumentInboxService({dataDir:dir}).getDocument('test_pdf')?.status,'PENDIENTE_COTEJO','blocked status must not mutate persisted state');
 release();
 const sent=await pending;assert.equal(sent.status,200);assert.equal(creates,1);assert.equal(payload.move_type,'in_invoice');
 assert.deepEqual(payload.invoice_line_ids[0][2].tax_ids,[[6,0,[]]],'no invented tax or implicit defaults');
 assert.equal(payload.invoice_line_ids[0][2].account_id,undefined);assert.match(payload.narration,/Pendiente de completar/);
 const fresh=new DocumentInboxService({dataDir:dir}).getDocument('test_pdf')!;
 assert.equal(fresh.status,'PENDIENTE_COTEJO');assert.equal(fresh.odooDraftMoveId,91);assert.equal(fresh.draftExceptions?.at(-1)?.by,'Operario');assert.equal(fresh.draftExceptions?.at(-1)?.outcome,'created');assert.equal(fresh.movedTo,undefined);
 assert.equal((await call('/odoo-draft',body)).status,400,'repeat blocked after durable success');
 console.log('PASS: dates/amounts/VAT, attestation, local save/reopen, stale edits, auth, gates, duplicate, double submit, mocked incomplete Odoo draft, audit and no Drive move.');
}finally{globalThis.fetch=originalFetch;DriveClient.prototype.getFileMeta=originalMeta;}
