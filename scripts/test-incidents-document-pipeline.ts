import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {registerIncidentRoutes} from '../backend/incidents/routes.ts';
import {GoogleApi,SheetsRepository,SHEETS,HEADERS} from '../backend/incidents/repository.ts';
import {IncidentService} from '../backend/incidents/service.ts';
import {IncidentOdooStock,ControlledStockExecutor,StockJournal,TEST_TARGET} from '../backend/incidents/odooStock.ts';
import {operationalOdooTarget,assertOperationalRexRpc} from '../backend/incidents/odooRuntime.ts';
const operationalFixture=process.argv.includes('--operational-fixtures');
const operationalEnv={ODOO_URL:'https://erp.example.invalid',ODOO_DATABASE:'fixture',INCIDENTS_ODOO_MODE:'operational',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_OPERATIONAL_WORKFLOW_ENABLED:'true',ODOO_WRITE_ENABLED:'false'};
const fixtureTarget=operationalFixture?operationalOdooTarget(operationalEnv):TEST_TARGET;
import {IncidentBackgroundQueue} from '../backend/incidents/background.ts';
import {reshipmentPrerequisites} from '../backend/incidents/reshipment.ts';
import {coherentIncident} from '../backend/incidents/coherence.ts';
import {applyAction} from '../backend/incidents/workflow.ts';
import type {Incident,WizardDraft} from '../backend/incidents/types.ts';

// No network, production store or authenticated account can be reached by this harness.
const original={fetch:globalThis.fetch,request:GoogleApi.prototype.request,configured:GoogleApi.prototype.configured};
globalThis.fetch=(async()=>{throw Error('NETWORK FORBIDDEN: isolated document pipeline');}) as any;
GoogleApi.prototype.configured=()=>true;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let active:any;
GoogleApi.prototype.request=async function(url:string,init:any={}){return active.sheets(url,init);};
const relation=(v:any)=>Array.isArray(v)?v[0]:v;
function matches(row:any,domain:any[]){return domain.every(d=>{
 if(!Array.isArray(d))throw Error('Unexpected compound domain');
 const [field,op,wanted]=d;const got=field==='picking_type_id.code'?(relation(row.picking_type_id)===9?'outgoing':'incoming'):relation(row[field]);
 if(op==='=')return got===wanted||(wanted===false&&!got);
 if(op==='!=')return got!==wanted;
 if(op==='in')return wanted.includes(got);
 if(op==='not in')return !wanted.includes(got);
 throw Error(`Unexpected domain ${op}`);
});}
function fixture(options:{kit?:boolean;timeout?:boolean;foreignReturn?:boolean;auditFailure?:boolean;changedBom?:boolean;partialTimeout?:boolean;auditCommittedFailure?:boolean;multipleProducts?:boolean}={}){
 const directory=mkdtempSync(join(tmpdir(),'inc-pipeline-')),sheetFile=join(directory,'sheets.json');
 writeFileSync(sheetFile,JSON.stringify(SHEETS.map(()=>[HEADERS])));
 const products:any[]=[{id:10,default_code:'A',name:'Product A',type:'consu',uom_id:[1,'Units'],tracking:'none',is_storable:true,company_id:false},{id:11,default_code:'B',name:'Component B',type:'consu',uom_id:[1,'Units'],tracking:'none',is_storable:true,company_id:false},{id:12,default_code:'KIT',name:'Manufactured kit',type:'consu',uom_id:[1,'Units'],tracking:'none',is_storable:false,company_id:false}];
 const picking=(id:number,name:string,state:string,origin:string,type:number,source=5,dest=6)=>({id,name,state,origin,picking_type_id:[type,'Type'],location_id:[source,'Source'],location_dest_id:[dest,'Destination'],company_id:[1,'LAB'],partner_id:[2,'Customer'],sale_id:[20,'S-TEST'],return_id:false,move_type:'direct'});
 const move=(id:number,pick:number,product:number,qty:number,source=5,dest=6)=>({id,picking_id:[pick,'Picking'],product_id:[product,'Product'],product_uom:[1,'Units'],product_uom_qty:qty,quantity:qty,location_id:[source,'Source'],location_dest_id:[dest,'Destination'],sale_line_id:[15,'Sale line'],to_refund:false,origin_returned_move_id:false,state:'done',scrapped:false});
 const tables:Record<string,any[]>={
  'uom.uom':[{id:1,rounding:1}],
  'sale.order':[{id:20,name:'S-TEST',company_id:[1,'LAB'],partner_shipping_id:[2,'Customer'],warehouse_id:[3,'Warehouse']}],
  'sale.order.line':[{id:15,order_id:[20,'S-TEST'],product_id:[options.kit?12:10,'Sale product'],product_uom:[1,'Units'],product_uom_qty:2,state:'sale'}],
  'stock.picking':[picking(30,'OUT/30','done','S-TEST',9)],
  'stock.move':options.kit?[move(40,30,10,4),move(41,30,11,2)]:[move(40,30,10,2)],
  'product.product':products,
  'stock.picking.type':[{id:9,code:'outgoing',company_id:[1,'LAB'],return_picking_type_id:[8,'Returns'],default_location_src_id:[5,'Stock'],default_location_dest_id:[6,'Customer']},{id:8,code:'incoming',company_id:[1,'LAB']}],
  'stock.return.picking':[],'stock.return.picking.line':[],
  'mrp.bom':[],'res.partner':[{id:2,name:'Customer',street:'Test Street',zip:'10000',city:'Test',country_id:false}],
 };
 if(options.multipleProducts){tables['sale.order.line'].push({id:16,order_id:[20,'S-TEST'],product_id:[11,'B'],product_uom:[1,'Units'],product_uom_qty:2,state:'sale'});tables['stock.move'].push({...move(41,30,11,2),sale_line_id:[16,'B sale line']});}
 if(options.changedBom){products[0].product_tmpl_id=[110,'Changed recipe'];tables['mrp.bom'].push({id:70,product_tmpl_id:[110,'Changed recipe'],product_id:[10,'A'],product_qty:1,product_uom_id:[1,'Units'],bom_line_ids:[71]});}
 if(options.foreignReturn){tables['stock.picking'].push({...picking(31,'RETURN/31','assigned','MANUAL',8,6,5),return_id:[30,'OUT/30']});tables['stock.move'].push({...move(42,31,10,1,6,5),state:'assigned',quantity:0,origin_returned_move_id:[40,'Original'],to_refund:true});}
 let reads=0;
 let nextId=100,stockDelta=0,returnCreates=0,rexCreates=0,validations=0,timeout=!!options.timeout,auditFailure=!!(options.auditFailure||options.auditCommittedFailure);
 const events:string[]=[];
 const read=async(model:string,method:string,args:any[],kwargs:any={})=>{
  reads++;
  if(model==='stock.return.picking.line'&&method==='fields_get')return {to_refund:{type:'boolean'}};
  const rows=tables[model];if(!rows)throw Error(`Unexpected read ${model}.${method}`);
  const found=method==='read'?rows.filter(row=>args[0].includes(row.id)):method==='search_read'?rows.filter(row=>matches(row,args[0])):undefined;
  if(!found)throw Error(`Unexpected read method ${method}`);
  return structuredClone(found.slice(0,kwargs.limit||Infinity));
 };
 const writeRaw=async(model:string,method:string,args:any[])=>{
  if(model==='stock.return.picking'&&method==='create'){
   const id=nextId++;tables[model].push({id,...args[0]});
   for(const source of tables['stock.move'].filter(m=>relation(m.picking_id)===args[0].picking_id))tables['stock.return.picking.line'].push({id:nextId++,wizard_id:[id,'Wizard'],product_id:source.product_id,move_id:[source.id,'Original'],quantity:source.quantity});
   return id;
  }
  if(model==='stock.return.picking'&&method==='write'){
   for(const [,id,values] of args[1].product_return_moves)Object.assign(tables['stock.return.picking.line'].find(row=>row.id===id),values);return true;
  }
  if(model==='stock.return.picking'&&method==='action_create_returns'){
   returnCreates++;events.push('DEV-create');const wizard=tables[model].find(row=>args[0].includes(row.id));const id=nextId++;
   tables['stock.picking'].push({...picking(id,`RETURN/${id}`,'assigned','Return of OUT/30',8,6,5),return_id:[wizard.picking_id,'OUT/30']});
   for(const row of tables['stock.return.picking.line'].filter(row=>relation(row.wizard_id)===wizard.id&&row.quantity>0)){
    const source=tables['stock.move'].find(m=>m.id===relation(row.move_id));tables['stock.move'].push({...move(nextId++,id,relation(row.product_id),row.quantity,6,5),state:'assigned',quantity:0,sale_line_id:source.sale_line_id,to_refund:row.to_refund,origin_returned_move_id:[source.id,'Original']});
   }
   if(options.partialTimeout)throw Error('timeout after return created, before identity tagged');
   return {res_id:id};
  }
  if(model==='stock.picking'&&method==='create'){
   const values=args[0],id=nextId++;if(values.picking_type_id===8){returnCreates++;events.push('DEV-create');}else{rexCreates++;events.push('REX-create');}tables[model].push({...values,id,name:`OUT/${id}`,company_id:[values.company_id,'LAB'],sale_id:values.sale_id?[values.sale_id,'S-TEST']:false,partner_id:[values.partner_id,'Customer'],picking_type_id:[values.picking_type_id,'Delivery'],location_id:[values.location_id,'Source'],location_dest_id:[values.location_dest_id,'Destination'],backorder_id:false,state:'draft'});
   for(const [, ,line] of values.move_ids)tables['stock.move'].push({...line,id:nextId++,product_id:[line.product_id,'Product'],product_uom:[line.product_uom,'Units'],picking_id:[id,'REX'],location_id:[line.location_id,'Stock'],location_dest_id:[line.location_dest_id,'Customer'],sale_line_id:line.sale_line_id?[line.sale_line_id,'Sale line']:false,to_refund:!!line.to_refund,quantity:0,state:'draft',scrapped:false});return id;
  }
  if(method==='write'&&['stock.picking','stock.move'].includes(model)){for(const row of tables[model].filter(row=>args[0].includes(row.id)))Object.assign(row,args[1]);return true;}
  if(model==='stock.picking'&&['action_confirm','action_assign','button_validate'].includes(method)){
   const row=tables[model].find(row=>args[0].includes(row.id));row.state=method==='action_confirm'?'confirmed':method==='action_assign'?'assigned':'done';
   for(const m of tables['stock.move'].filter(m=>relation(m.picking_id)===row.id)){m.state=row.state;if(row.state==='done'){stockDelta+=m.location_dest_id[0]===5?m.quantity:-m.quantity;}}
   if(method==='button_validate'){validations++;events.push('DEV-validate');if(timeout){timeout=false;throw Error('timeout after committed validation');}}
   return true;
  }
  throw Error(`Unexpected write ${model}.${method}`);
 };
 const env={DASHBOARD_DATA_DIR:directory,INCIDENTS_SPREADSHEET_ID:'fixture',INCIDENTS_GOOGLE_ACCOUNT:'fixture',INCIDENTS_SHEETS_WRITE_ENABLED:'true',INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_DEMO_WORKFLOW_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true',...(operationalFixture?operationalEnv:{})};
 const write:OdooCall=async(model,method,args,kwargs)=>{if(operationalFixture)assertOperationalRexRpc(env,fixtureTarget,model,method,args);return writeRaw(model,method,args as any[]);};
 const context:any={source:'odoo',order:{odooReference:'S-TEST',channel:'LAB',customerName:'Customer',shippingDestination:{name:'Customer',address:'Test street'}},products:[{saleLineId:15,productId:options.kit?12:10,sku:options.kit?'KIT':'A',name:'Sale product',productType:'consu',orderedQuantity:2,affectedQuantity:1,...(options.kit?{kitSource:'original_delivery',kitComponents:[{productId:10,sku:'A',name:'Product A',quantityPerKit:2,uomId:1},{productId:11,sku:'B',name:'Component B',quantityPerKit:1,uomId:1}]}:{})}]};
 if(options.multipleProducts)context.products.push({saleLineId:16,productId:11,sku:'B',name:'Second sale product',productType:'consu',orderedQuantity:2,affectedQuantity:2});
 let handler:any,httpServer:EventEmitter;
 const api=()=>new SheetsRepository(env);
 const sheets=async(url:string,init:any)=>{
  const values=JSON.parse(readFileSync(sheetFile,'utf8'));
  if(url.includes('values:batchGet'))return {valueRanges:values.map((rows:any)=>({values:rows}))};
  if(!init.method)return {sheets:SHEETS.map((title,n)=>({properties:{title,sheetId:n,gridProperties:{rowCount:1000}}}))};
  assert(url.endsWith(':batchUpdate'));const body=JSON.parse(init.body);
  const failAudit=auditFailure&&body.requests.some((r:any)=>{const cell=r.updateCells?.rows[0].values[36]?.userEnteredValue?.stringValue;if(!cell)return false;const value=JSON.parse(cell);return value.id?.startsWith('INC-')&&value.odooOperations?.some((op:any)=>op.kind==='return');});
  if(failAudit&&!options.auditCommittedFailure){auditFailure=false;throw Error('Google API 503. Temporary audit failure');}
  for(const req of body.requests){if(!req.updateCells)continue;const {start,rows}=req.updateCells;values[start.sheetId][start.rowIndex]=rows[0].values.map((cell:any)=>Object.values(cell.userEnteredValue)[0]);}
  writeFileSync(sheetFile,JSON.stringify(values));if(failAudit){auditFailure=false;throw Error('Google API 503 after audit committed');}return {};
 };
 writeFileSync(join(directory,'warehouse-workers.json'),JSON.stringify([{id:'qa-worker',code:'OPQA',name:'QA worker',active:true}]));
 const start=()=>{
  httpServer=new EventEmitter();const executor=new ControlledStockExecutor(read,write,new StockJournal(directory,operationalFixture?'operational':'test'),env);
  registerIncidentRoutes({httpServer,middlewares:{use:(_path:any,fn:any)=>handler=fn}},{getSessionUser:()=>({id:'QA',name:'QA',role:'viewer',permissions:['products','odooWrite']})},env,{lookup:async()=>structuredClone(context),catalog:async(_q,id)=>({products:products.filter(p=>p.id===id).map(p=>({productId:p.id,sku:p.default_code,name:p.name,barcode:'',productType:p.type})),hasMore:false}),statistics:async()=>({}),image:async()=>Buffer.alloc(0),odoo:{target:fixtureTarget,mode:operationalFixture?'operational':'test',read,stock:new IncidentOdooStock(read,fixtureTarget),executor,inspect:async()=>({})}});
 };
 const call=async(method:string,url:string,body?:any)=>{const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method,url,headers:{}});const res:any={statusCode:200,setHeader:()=>{},end:(text:string)=>res.body=JSON.parse(text)};await handler(req,res);return res;};
 const state=()=>existsSync(join(directory,'incidents-background.json'))?JSON.parse(readFileSync(join(directory,'incidents-background.json'),'utf8')).at(-1):undefined;
 const settle=async(queued=false)=>{for(let n=0;n<400;n++){const job=state();if(job&&!['queued','running'].includes(job.state)||queued&&job?.nextAttemptAt)return job;await sleep(10);}throw Error('Queue did not settle');};
 const draft:WizardDraft={requestId:'pipeline-stable-001',origin:'warehouse',type:'missing_product',solution:'resend_missing',context:structuredClone(context),products:[{...structuredClone(context.products[0]),...(options.kit?{selectedKitComponents:[{productId:10,sku:'A',name:'UNTRUSTED',quantity:1},{productId:11,sku:'B',name:'UNTRUSTED',quantity:0}]}:{})}]};
 if(options.multipleProducts)draft.products=structuredClone(context.products);
 return {readCount:()=>reads,directory,context,draft,sheets,start,call,settle,state,api,stop:()=>httpServer?.emit('close'),tables,counts:()=>({stockDelta,returnCreates,rexCreates,validations,events}),restart:()=>{httpServer.emit('close');start();}};
}
let passed=0;
async function test(name:string,options:any,work:(h:ReturnType<typeof fixture>)=>Promise<void>){const h=fixture(options);active=h;try{h.start();await work(h);passed++;console.log(`PASS ${passed} ${name}`);}finally{h.stop();}}
try{
 await test('Nonblocking intake → real route/Sheets/stock pipeline → restart/lost response dedup',{},async h=>{
  const [a,b]=await Promise.all([h.call('POST','/submissions',h.draft),h.call('POST','/submissions',h.draft)]);
  assert.equal(a.statusCode,202);assert.equal(b.statusCode,202);assert.equal(a.body.submission.state,'queued');assert.equal(h.readCount(),0);assert.equal((await h.api().list(true)).length,0);
  for(let n=0;n<400;n++){const result=await h.call('GET','/submissions');if(result.body.submissions[0]?.state==='saved')break;await sleep(10);}
  const submissions=(await h.call('GET','/submissions')).body.submissions;assert.equal(submissions.length,1);assert.equal(submissions[0].state,'saved');assert(!submissions[0].draft);assert.equal((await h.settle()).state,'done');
  const saved=(await h.api().list(true))[0];assert.equal(saved.id,submissions[0].incidentId);const counts=h.counts();assert.equal(counts.validations,1);assert.equal(counts.rexCreates,1);
  h.stop();const path=join(h.directory,'incidents-submissions.json');const jobs=JSON.parse(readFileSync(path,'utf8'));jobs[0].state='running';writeFileSync(path,JSON.stringify(jobs));h.start();
  for(let n=0;n<400;n++){if((await h.call('GET','/submissions')).body.submissions[0].state==='saved')break;await sleep(10);}
  assert.equal((await h.call('GET','/submissions')).body.submissions[0].state,'saved');assert.equal((await h.api().list(true)).length,1);assert.equal((await h.api().list(true))[0].revision,saved.revision);assert.deepEqual(h.counts(),counts);
 });
 await test('Async forged identity remains visible as failed without Sheets or stock mutation',{kit:true},async h=>{
  h.draft.products[0].selectedKitComponents![0].sku='FORGED';assert.equal((await h.call('POST','/submissions',h.draft)).statusCode,202);
  for(let n=0;n<400;n++){if((await h.call('GET','/submissions')).body.submissions[0].state==='failed')break;await sleep(10);}
  assert.equal((await h.call('GET','/submissions')).body.submissions[0].state,'failed');assert.equal((await h.api().list(true)).length,0);assert.equal(h.counts().returnCreates,0);
 });
 await test('Receive-first audited REX is blocked with DEV/operator reason before any Odoo read',{},async h=>{
  h.draft.type='wrong_product';h.draft.solution='wait_resend';h.draft.wrongReceivedUnknown=true;
  const saved=await new IncidentService(h.api()).create(h.draft,'QA');const reference=saved.id.replace('INC-','REX-')+'-01';saved.odooOperations=[{key:saved.id+':reshipment',kind:'reshipment',dispatchReference:reference,target:fixtureTarget,pickingId:99,status:'ready_for_expedition',digest:'qa',confirmedAt:new Date().toISOString(),lines:[{productId:10,sku:'A',quantity:1,uomId:1,sourceId:5,destinationId:6}]}];const revision=saved.revision;saved.revision++;await h.api().save([saved],{[saved.id]:revision});const reads=h.readCount();const result=await h.call('GET','/reshipments/resolve?reference='+reference);assert.equal(result.statusCode,200);assert.equal(result.body.preparation.state,'waiting_dependencies');assert.equal(result.body.preparation.labelCreationEnabled,false);assert.match(result.body.preparation.notice,/operario de almacén/);assert.equal(h.readCount(),reads);assert.equal(h.counts().rexCreates,0);
 });
 await test('Save → original-linked validated DEV → prepared REX → fresh Sheets joins + exact printable lines',{},async h=>{
  const [a,b]=await Promise.all([h.call('POST','/',h.draft),h.call('POST','/',h.draft)]);assert.equal(a.statusCode,201);assert.equal(b.statusCode,201);assert.equal((await h.settle()).state,'done');
  const saved=(await h.api().list(true))[0];assert(saved.documentPreparation);assert.equal(saved.documentPreparationStatus,undefined);assert.equal(saved.returns[0].state,'processed');assert(saved.processes.some(p=>p.kind==='reshipment'));assert.equal(saved.odooOperations?.length,2);
  assert.deepEqual(h.counts(),{stockDelta:1,returnCreates:1,rexCreates:1,validations:1,events:['DEV-create','DEV-validate','REX-create']});
  const rex=saved.odooOperations!.find(op=>op.kind==='reshipment')!;assert.equal(rex.status,'ready_for_expedition');
  const response=await h.call('GET',`/reshipments/${rex.dispatchReference}/document`);assert.equal(response.statusCode,200);assert.deepEqual(response.body.document.lines.map((l:any)=>[l.sku,l.quantity]),[['A',1]]);
  const coherent=coherentIncident(saved,fixtureTarget);assert.equal(coherent.returns[0].state,'processed');assert.equal(coherent.returns[0].receivedBy,undefined);assert.deepEqual(coherentIncident(coherent,fixtureTarget),coherent);
  const pending=structuredClone(saved);pending.returns[0].state='awaiting';assert.throws(()=>applyAction(pending,{kind:'return',id:pending.returns[0].id,operator:{id:'QA',code:'QA',name:'QA'},condition:'perfect',destination:'stock',quantities:{A:1}},'QA'),/no registrar una recepción física/);
  const sent=structuredClone(saved);const dispatch=sent.odooOperations!.find(op=>op.kind==='reshipment')!;Object.assign(dispatch,{status:'done',shipmentCode:'QA-label',shippedBy:'QA',shippedAt:new Date().toISOString()});sent.processes.find(p=>p.kind==='reshipment')!.state='resolved';assert.equal(applyAction(sent,{kind:'client',value:'Solucionado'},'QA').clientStatus,'Solucionado');
  const revision=saved.revision;await h.call('POST','/',h.draft);assert.equal((await h.settle()).state,'done');assert.equal((await h.api().list(true))[0].revision,revision);assert.equal(h.counts().returnCreates,1);assert.equal(h.counts().rexCreates,1);
 });
 await test('Multiple products keep independent quantities in one original-linked DEV and one REX',{multipleProducts:true},async h=>{
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');const saved=(await h.api().list(true))[0];assert.deepEqual(saved.returns[0].products.map(p=>[p.sku,p.expectedQuantity]),[['A',1],['B',2]]);for(const op of saved.odooOperations!)assert.deepEqual(op.lines?.map(l=>[l.sku,l.quantity,l.saleLineId]),[['A',1,15],['B',2,16]]);assert.equal(h.counts().stockDelta,3);assert.equal(h.counts().returnCreates,1);assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,1);
 });
 await test('Direct/manual proposal also blocks REX until the corrective DEV is confirmed',{},async h=>{
  const saved=await new IncidentService(h.api()).create(h.draft,'QA');const response=await h.call('GET',`/${saved.id}/odoo/proposal`);assert.equal(response.statusCode,200);assert(response.body.proposal.operations.find((op:any)=>op.kind==='reshipment').blockers.some((text:string)=>text.includes('DEV correctiva')));assert.equal(h.counts().rexCreates,0);
 });
 await test('Editable kit selections survive HTTP + Sheets and exactly match DEV/REX/Odoo',{kit:true},async h=>{
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');const saved=(await h.api().list(true))[0];assert.deepEqual(saved.products[0].selectedKitComponents?.map(c=>[c.sku,c.name,c.quantity]),[['A','Product A',1],['B','Component B',0]]);
  assert.deepEqual(saved.returns[0].products.map(p=>[p.sku,p.expectedQuantity]),[['A',1]]);for(const op of saved.odooOperations!)assert.deepEqual(op.lines?.map(l=>[l.sku,l.quantity]),[['A',1]]);assert.equal(h.counts().stockDelta,1);
 });
 await test('Recipe drift cannot substitute the confirmed physical kit components',{kit:true,changedBom:true},async h=>{
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');const saved=(await h.api().list(true))[0];for(const op of saved.odooOperations!)assert.deepEqual(op.lines?.map(l=>[l.sku,l.quantity]),[['A',1]]);
 });
 await test('Short quantity also creates corrective DEV for the missing units only',{},async h=>{
  h.draft.type='wrong_quantity';h.draft.products[0].receivedQuantity=1;h.draft.products[0].affectedQuantity=99;assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');assert.equal((await h.api().list(true))[0].returns[0].stockCorrection,true);assert.equal(h.counts().stockDelta,1);
 });
 await test('Timeout after Odoo commits: automatic read-only reconciliation, never revalidate',{timeout:true},async h=>{
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');assert.equal(h.counts().validations,1);assert.equal(h.counts().returnCreates,1);assert.equal(h.counts().rexCreates,1);
 });
 await test('Transient local audit failure persists retry and restarts without repeating stock',{auditFailure:true},async h=>{
  await h.call('POST','/',h.draft);const job=await h.settle(true);assert.equal(job.state,'queued');assert.equal(job.attempts,1);assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,0);
  const path=join(h.directory,'incidents-background.json');const jobs=JSON.parse(readFileSync(path,'utf8'));jobs[0].nextAttemptAt=0;writeFileSync(path,JSON.stringify(jobs));h.restart();assert.equal((await h.settle()).state,'done');assert.equal(h.counts().returnCreates,1);assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,1);
 });
 await test('Lost response after Sheets commits: fresh read repairs status without duplicate audit/stock',{auditCommittedFailure:true},async h=>{
  await h.call('POST','/',h.draft);assert.equal((await h.settle(true)).state,'queued');const stored=(await h.api().list(true))[0];assert.equal(stored.returns[0].state,'processed');assert.equal(stored.odooOperations!.length,1);
  const path=join(h.directory,'incidents-background.json'),jobs=JSON.parse(readFileSync(path,'utf8'));jobs[0].nextAttemptAt=0;writeFileSync(path,JSON.stringify(jobs));h.restart();assert.equal((await h.settle()).state,'done');assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,1);assert.equal((await h.api().list(true))[0].revision,stored.revision+1);
 });
 await test('Foreign return blocks new REX and remains visible after authoritative reload',{foreignReturn:true},async h=>{
  await h.call('POST','/',h.draft);assert.equal((await h.settle()).state,'blocked');assert.equal(h.counts().rexCreates,0);assert.equal(h.counts().returnCreates,0);const list=await h.call('GET','/?refresh=1');assert.equal(list.body.incidents[0].documentPreparationStatus.state,'blocked');assert.match(list.body.incidents[0].documentPreparationStatus.message,/devolución vinculada/);
 });
 await test('Crash after saved incident but before enqueue: durable intent starts work after restart',{},async h=>{
  h.stop();const service=new IncidentService(h.api());const saved=await service.create(h.draft,'QA',async items=>{items[0].documentPreparation={actor:'QA',target:fixtureTarget,requestedAt:new Date().toISOString()};});assert.equal(h.counts().returnCreates,0);h.start();assert.equal((await h.settle()).state,'done');assert.equal((await h.api().list(true))[0].id,saved.id);assert.equal(h.counts().rexCreates,1);
 });
 await test('Legacy records are not silently replayed on startup',{},async h=>{
  h.stop();await new IncidentService(h.api()).create(h.draft,'QA');h.start();await sleep(1200);assert.equal(h.state(),undefined);assert.equal(h.counts().returnCreates,0);
 });
 await test('An outbox intent from another Odoo target is never resumed',{},async h=>{
  h.stop();await new IncidentService(h.api()).create(h.draft,'QA',async items=>{items[0].documentPreparation={actor:'QA',target:'https://other.invalid/database',requestedAt:new Date().toISOString()};});h.start();await sleep(1200);assert.equal(h.state(),undefined);assert.equal(h.counts().returnCreates,0);
 });
 await test('Existing stock audit from another database blocks both reconciliation and creation',{},async h=>{
  const saved=await new IncidentService(h.api()).create(h.draft,'QA');saved.odooOperations=[{key:saved.id+':reshipment',kind:'reshipment',target:'https://other.invalid/database',digest:'foreign',pickingId:100,confirmedAt:new Date().toISOString(),dispatchReference:saved.id.replace('INC-','REX-')+'-01',status:'ready_for_expedition',lines:[{productId:10,sku:'A',quantity:1,uomId:1,sourceId:5,destinationId:6}]}];saved.revision++;await h.api().save([saved],{[saved.id]:saved.revision-1});await h.call('POST',`/${saved.id}/documents/prepare`,{revision:saved.revision});assert.equal((await h.settle()).state,'blocked');assert.match(h.state().message,/otra base Odoo/);assert.equal(h.counts().returnCreates,0);assert.equal(h.counts().rexCreates,0);assert.equal((await h.api().list(true))[0].odooOperations![0].target,'https://other.invalid/database');
 });
 await test('Already-audited corrective DEV repairs local lifecycle without physical receipt or stock replay',{},async h=>{
  await h.call('POST','/',h.draft);assert.equal((await h.settle()).state,'done');const saved=(await h.api().list(true))[0];const damaged=structuredClone(saved);damaged.returns[0].state='arrived';damaged.revision++;await h.api().save([damaged],{[damaged.id]:saved.revision});
  assert.equal((await h.call('POST',`/${damaged.id}/documents/prepare`,{revision:damaged.revision})).statusCode,200);assert.equal((await h.settle()).state,'done');assert.equal((await h.api().list(true))[0].returns[0].state,'processed');assert.equal(h.counts().returnCreates,1);assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,1);
 });
 await test('Solutions without DEV/REX do not call Odoo stock or leave false pending work',{},async h=>{
  h.draft.type='wrong_packaging';h.draft.scope='pack_ok';h.draft.solution='pack_record';h.draft.products=[];assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');assert.equal(h.readCount(),0);assert.equal(h.counts().returnCreates,0);assert.equal(h.counts().rexCreates,0);
 });
 await test('Unknown wrong product is not silently reclassified as an unsent item',{},async h=>{
  h.draft.type='wrong_product';h.draft.wrongReceivedUnknown=true;h.draft.solution='resend_recover';await h.call('POST','/',h.draft);assert.equal((await h.settle()).state,'blocked');const saved=(await h.api().list(true))[0];assert.equal(saved.type,'wrong_product');assert.equal(saved.returns[0].stockCorrection,undefined);assert.equal(saved.returns[0].state,'awaiting');assert.equal(h.counts().returnCreates,0);assert.equal(h.counts().rexCreates,1);
 });
 await test('Unknown DEV → reject unidentified receipt → canonical B in perfect condition → fresh Sheets join and one exact Odoo entry',{},async h=>{
  h.draft.type='wrong_product';h.draft.wrongReceivedUnknown=true;h.draft.solution='wait_resend';
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);await h.settle();let saved=(await h.api().list(true))[0];const r=saved.returns[0];
  assert.equal(r.products[0].sku,'POR_IDENTIFICAR');assert.equal(h.counts().returnCreates,0);assert.equal(h.counts().rexCreates,1);assert.equal(saved.odooOperations?.find(op=>op.kind==='reshipment')?.status,'ready_for_expedition');assert.equal(h.counts().validations,0);
  const path=`/receipts/${saved.id}/actions`,action={kind:'return',id:r.id,operatorCode:'OPQA',condition:'perfect',destination:'stock',quantities:{POR_IDENTIFICAR:1}};
  assert.equal((await h.call('POST',path,{revision:saved.revision,action})).statusCode,400);assert.equal((await h.api().list(true))[0].returns[0].state,'awaiting');
  const itemOverrides=[{expectedSku:'POR_IDENTIFICAR',mode:'catalog',product:{productId:11,sku:'B',name:'FORGED NAME'},quantity:2}];
  const response=await h.call('POST',path,{revision:saved.revision,action:{...action,itemOverrides}});assert.equal(response.statusCode,200,JSON.stringify(response.body));const settled=await h.settle();assert.equal(settled.state,'done');assert.match(settled.message,/ya existe en Odoo/);
  saved=(await h.api().list(true))[0];assert.equal(saved.products[0].sku,'A');assert.equal(saved.returns[0].state,'processed');assert.equal(saved.returns[0].itemOverrides![0].product!.name,'Component B');
  const op=saved.odooOperations!.find(op=>op.kind==='return')!;assert.deepEqual(op.lines!.map(line=>[line.sku,line.quantity,line.productId]),[['B',2,11]]);
  const picking=h.tables['stock.picking'].find(p=>p.id===op.pickingId);assert.equal(picking.sale_id[0],20);assert.equal(picking.state,'done');assert.equal(h.counts().validations,1);
  const movements=h.tables['stock.move'].filter(m=>(Array.isArray(m.picking_id)?m.picking_id[0]:m.picking_id)===op.pickingId);assert.equal(movements.length,1);assert.equal(movements[0].sale_line_id,false);assert.equal(movements[0].quantity,2);
  const count=h.counts().validations;assert.equal((await h.call('POST',path,{revision:saved.revision,action:{...action,itemOverrides}})).statusCode,400);assert.equal(h.counts().validations,count);
 });
 await test('Incomplete uncertain DEV never replays after restart and never prepares REX',{partialTimeout:true},async h=>{
  await h.call('POST','/',h.draft);const job=await h.settle();assert.equal(job.state,'failed');assert.match(job.message,/incierta/);assert.equal(job.nextAttemptAt,undefined);h.restart();await sleep(1200);assert.equal(h.state().state,'failed');assert.equal(h.counts().returnCreates,1);assert.equal(h.counts().validations,0);assert.equal(h.counts().rexCreates,0);
 });
 await test('Restart at retry cap stays blocked; outbox does not reset the cap',{},async h=>{
  const dir=mkdtempSync(join(tmpdir(),'inc-queue-cap-'));const saved=await new IncidentService(h.api()).create(h.draft,'QA',async items=>{items[0].documentPreparation={actor:'QA',target:fixtureTarget,requestedAt:new Date().toISOString()};});
  writeFileSync(join(dir,'incidents-background.json'),JSON.stringify([{id:saved.id,prepareOnly:true,attempts:3,state:'running',actor:'QA',user:{role:'viewer',permissions:['products']}}]));let executed=0;const queue=new IncidentBackgroundQueue(dir,async()=>{executed++;return {state:'done',message:'unexpected'};});try{await queue.recoverPreparationIntents(()=>h.api().list(true),fixtureTarget);await sleep(1100);assert.equal(queue.get(saved.id)?.state,'blocked');assert.equal(executed,0);}finally{queue.dispose();}
 });
 await test('Forged kit identity rejected before persistence or any Odoo write',{kit:true},async h=>{
  h.draft.products[0].selectedKitComponents![0].sku='FORGED';assert((await h.call('POST','/',h.draft)).statusCode>=400);assert.equal((await h.api().list(true)).length,0);assert.equal(h.counts().returnCreates,0);
 });
 await test('Physical DEV staged → actual Recepciones route → preflight → validation → fresh Sheets release REX',{},async h=>{
  Object.assign(h.draft,{type:'wrong_product',solution:'wait_resend',wrongReceived:'B',wrongReceivedProduct:{productId:11,sku:'B',name:'B',barcode:''}});
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);assert.equal((await h.settle()).state,'done');
  const staged=(await h.api().list(true))[0],dev=staged.returns.find(r=>!r.stockCorrection)!;const prior=h.counts();assert(dev);assert.equal(prior.validations,0);assert(reshipmentPrerequisites(staged,fixtureTarget).length>0);
  const action=await h.call('POST',`/receipts/${staged.id}/actions`,{revision:staged.revision,action:{kind:'return',id:dev.id,operatorCode:'OPQA',condition:'perfect',destination:'stock',quantities:Object.fromEntries(dev.products.map(p=>[p.sku,p.expectedQuantity]))}});
  assert.equal(action.statusCode,200);const job=await h.settle();assert.equal(job.state,'done',job.message);
  const after=(await h.api().list(true))[0];assert.equal(after.returns.find(r=>r.id===dev.id)?.state,'processed');assert.equal(reshipmentPrerequisites(after,fixtureTarget).length,0);assert.equal(h.counts().validations,1);assert.equal(h.counts().returnCreates,prior.returnCreates);assert.equal(h.counts().rexCreates,prior.rexCreates);
  h.restart();const reread=(await h.api().list(true))[0];assert.equal(reread.revision,after.revision);assert.equal(reshipmentPrerequisites(reread,fixtureTarget).length,0);assert.equal(h.counts().validations,1);
 });

 for(const kind of ['missing_product','wrong_quantity','kit'] as const)await test(`Refund omitted item (${kind}): standard DEV linked, stock +1, no REX or physical receipt`,kind==='kit'?{kit:true}:{},async h=>{
  h.draft.solution='refund_missing';if(kind==='wrong_quantity'){h.draft.type='wrong_quantity';h.draft.products[0].receivedQuantity=1;}
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);const job=await h.settle();assert.equal(job.state,'done',job.message);
  const i=(await h.api().list(true))[0],r=i.returns[0];assert(r.stockCorrection);assert.equal(r.state,'processed');assert(!r.receivedBy);assert.equal(i.stockRegularized,true);
  const audit=i.odooOperations!.find(op=>op.kind==='return')!,pick=h.tables['stock.picking'].find(p=>p.id===audit.pickingId);assert.equal(pick.return_id[0],30);assert.equal(pick.sale_id[0],20);assert.equal(pick.state,'done');assert.equal(h.counts().stockDelta,1);assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,0);
  const counts=h.counts(),costs=structuredClone(i.costs),rev=i.revision;await h.call('POST',`/${i.id}/documents/prepare`,{revision:rev});assert.equal((await h.settle()).state,'done');h.restart();const after=(await h.api().list(true))[0];assert.equal(after.revision,rev);assert.equal(after.returns.length,1);assert.deepEqual(after.costs,costs);assert.deepEqual(h.counts(),counts);
 });
 await test('Legacy closed refund lacking DEV: explicit recovery reopens only internal stock, preserves solved customer/refund',{},async h=>{
  h.stop();h.draft.solution='refund_missing';const service=new IncidentService(h.api()),saved=await service.create(h.draft,'QA');
  saved.returns=[];saved.clientStatus='Solucionado';saved.status='Cerrada';saved.closedAt=new Date().toISOString();saved.revision++;await h.api().save([saved],{[saved.id]:saved.revision-1});
  // A genuine legacy record never had its DEV auxiliary row. save() deliberately
  // retains historical rows, so remove only this synthetic fixture row directly.
  const fixtureFile=join(h.directory,'sheets.json'),rows=JSON.parse(readFileSync(fixtureFile,'utf8'));rows[SHEETS.indexOf('Devoluciones')]=[HEADERS];writeFileSync(fixtureFile,JSON.stringify(rows));
  const costs=structuredClone(saved.costs);h.start();
  const result=await h.call('POST',`/${saved.id}/documents/prepare`,{revision:saved.revision});assert.equal(result.statusCode,200);const recoveredJob=await h.settle();assert.equal(recoveredJob.state,'done',recoveredJob.message);
  const after=(await h.api().list(true))[0];assert.equal(after.clientStatus,'Solucionado');assert.equal(after.status,'Resuelta');assert.equal(after.returns.length,1);assert.equal(after.returns[0].state,'processed');assert(after.stockRegularized);assert.deepEqual(after.costs,costs);assert.equal(h.counts().validations,1);assert.equal(h.counts().rexCreates,0);
  const revision=after.revision;await h.call('POST',`/${after.id}/documents/prepare`,{revision});assert.equal((await h.settle()).state,'done');assert.equal((await h.api().list(true))[0].revision,revision);assert.equal(h.counts().validations,1);
 });

 for(const solution of ['keep_extra','recover_extra'])await test(`Extra already shipped (${solution}): one linked outbound delta, never REX/label`,{},async h=>{
  h.draft.type='wrong_quantity';h.draft.solution=solution;h.draft.products[0].receivedQuantity=3;h.tables['stock.picking.type'].push({id:99,code:'outgoing',company_id:[1,'LAB'],default_location_src_id:[5,'Stock'],default_location_dest_id:[6,'Customer']});
  assert.equal((await h.call('POST','/',h.draft)).statusCode,201);const job=await h.settle();assert.equal(job.state,'done',job.message);
  const i=(await h.api().list(true))[0],op=i.odooOperations!.find(op=>op.kind==='correction')!;assert(op);assert.equal(op.status,'done');assert.deepEqual(op.lines?.map(l=>[l.sku,l.quantity,l.sourceId,l.destinationId,l.saleLineId]),[['A',1,5,6,15]]);assert.equal(h.counts().stockDelta,-1);assert.equal(h.counts().validations,1);assert.equal(i.odooOperations!.filter(o=>o.kind==='reshipment').length,0);
  if(solution==='recover_extra'){assert.equal(i.returns[0].state,'awaiting');assert.equal(i.stockRegularized,false);}else assert.equal(i.stockRegularized,true);
  const counts=h.counts(),costs=structuredClone(i.costs),revision=i.revision;await h.call('POST',`/${i.id}/documents/prepare`,{revision});assert.equal((await h.settle()).state,'done');h.restart();const after=(await h.api().list(true))[0];assert.equal(after.revision,revision);assert.deepEqual(after.costs,costs);assert.deepEqual(h.counts(),counts);
 });
 await test('Extra outbound lost response is reconciled once, never a second stock decrement',{timeout:true},async h=>{
  h.draft.type='wrong_quantity';h.draft.solution='keep_extra';h.draft.products[0].receivedQuantity=3;
  await h.call('POST','/',h.draft);assert.equal((await h.settle()).state,'done');assert.equal(h.counts().stockDelta,-1);assert.equal(h.counts().validations,1);
 });
 console.log(`PASS ${passed} integrated scenarios, real routes/proposer/executor/service/Sheets serializer and fresh readers. Zero external RPCs.`);
}finally{GoogleApi.prototype.request=original.request;GoogleApi.prototype.configured=original.configured;globalThis.fetch=original.fetch;}
