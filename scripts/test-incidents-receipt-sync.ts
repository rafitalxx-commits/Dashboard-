import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildIncident,applyAction} from '../backend/incidents/workflow.ts';
import {SheetsRepository} from '../backend/incidents/repository.ts';
import {registerIncidentRoutes} from '../backend/incidents/routes.ts';
import {getIncidentClosureChecklist} from '../backend/incidents/domain.ts';
import {TEST_TARGET} from '../backend/incidents/odooStock.ts';
const dir=mkdtempSync(join(tmpdir(),'receipt-sync-'));const file=join(dir,'rows.json');
const seed=()=>buildIncident({requestId:crypto.randomUUID(),context:{source:'demo',order:{odooReference:'QA',channel:'Website',customerName:'Ficticio'},products:[{sku:'B',name:'B',orderedQuantity:2,affectedQuantity:2}]},products:[{sku:'B',name:'B',orderedQuantity:2,affectedQuantity:2}],origin:'customer',type:'withdrawal',reason:'QA',solution:'withdraw_refund'},'INC-2026-00036','DEV-2026-00019','QA');
writeFileSync(file,JSON.stringify([seed()]));writeFileSync(join(dir,'warehouse-workers.json'),JSON.stringify([{id:'w',code:'OP001',name:'QA',active:true}]));
const load=()=>JSON.parse(readFileSync(file,'utf8'));const saved=()=>load()[0];
const original={list:SheetsRepository.prototype.list,save:SheetsRepository.prototype.save,status:SheetsRepository.prototype.status,fetch:globalThis.fetch};
SheetsRepository.prototype.list=async()=>load();SheetsRepository.prototype.status=()=>({source:'sheets',configured:true,writable:true,message:'Fixture only'});
SheetsRepository.prototype.save=async(items,expected)=>{const prior=load();for(const i of items)assert.equal(prior.find((x:any)=>x.id===i.id).revision,expected[i.id]);writeFileSync(file,JSON.stringify(items));};
globalThis.fetch=(async()=>{throw Error('No external calls in regression');}) as any;
let handler:any;let user={name:'QA warehouse',role:'viewer',permissions:['products','odooWrite']};let writes=0;let fail=false;let confirmed:any=null;
const op={key:'INC-2026-00036:return:DEV-2026-00019:fixture',kind:'return' as const,returnId:'DEV-2026-00019',lines:[{productId:2,sku:'B',quantity:2,uomId:1,sourceId:5,destinationId:8}],blockers:[]};
const result=()=>({key:op.key,kind:op.kind,returnId:op.returnId,lines:op.lines,digest:'qa',pickingId:91,status:'done' as const,target:TEST_TARGET,confirmedAt:new Date().toISOString()});
registerIncidentRoutes({middlewares:{use:(_p:any,fn:any)=>handler=fn}},{getSessionUser:()=>user},{DASHBOARD_DATA_DIR:dir,INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true',INCIDENTS_DEMO_WORKFLOW_ENABLED:'true'}, {catalog:async()=>({products:[],hasMore:false}),lookup:async()=>{throw Error('unused');},statistics:async()=>({}),image:async()=>Buffer.alloc(0),odoo:{mode:'test',target:TEST_TARGET,inspect:async()=>({}),read:async()=>{throw Error('unused');},stock:{propose:async()=>({operations:[op],blockers:[],digest:'qa'})} as any,executor:{reconcileExisting:async()=>{if(fail)throw Error('Odoo temporalmente no disponible');return confirmed;},execute:async()=>{writes++;confirmed=result();return confirmed;}} as any}});
async function call(path:string,body:any){const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{method:'POST',url:path,headers:{}});const res:any={statusCode:200,setHeader:()=>{},end:(data:any)=>res.body=JSON.parse(data)};await handler(req,res);return res;}
async function settled(){for(let n=0;n<150;n++){const jobs=JSON.parse(readFileSync(join(dir,'incidents-background.json'),'utf8'));if(jobs.length&&!['queued','running'].includes(jobs.at(-1).state))return jobs.at(-1);await new Promise(r=>setTimeout(r,10));}throw Error('Queue did not settle');}
try{
 fail=true;
 const a={kind:'return',id:op.returnId,operatorCode:'OP001',condition:'perfect',destination:'stock',quantities:{B:2}};
 const response=await call('/receipts/INC-2026-00036/actions',{revision:saved().revision,action:a});assert.equal(response.statusCode,200);assert(response.body.incident.returns[0].warehouseConfirmedAt);assert.equal(response.body.incident.processes.find((p:any)=>p.kind==='reception').state,'resolved');assert.equal(response.body.incident.processes.find((p:any)=>p.kind==='refund').state,'pending');assert(!getIncidentClosureChecklist(response.body.incident).goodsRegularized,'Stored physical arrival is not a completed DEV until asynchronous processing finishes');assert.equal(getIncidentClosureChecklist(response.body.incident).canClose,false);
 assert.equal((await settled()).state,'failed');assert.equal(writes,0);assert.match(saved().returns[0].odooSyncError,/temporalmente/);
 const double=await call('/receipts/INC-2026-00036/actions',{revision:saved().revision,action:a});assert.equal(double.statusCode,400);
 fail=false;let r=await call('/receipts/INC-2026-00036/sync',{revision:saved().revision,returnId:op.returnId});assert.equal(r.statusCode,200);assert.equal((await settled()).state,'done');assert.equal(saved().returns[0].state,'processed');assert.equal(saved().returns[0].odooSyncError,undefined);assert.equal(writes,1);
 const revision=saved().revision;r=await call('/receipts/INC-2026-00036/sync',{revision,returnId:op.returnId});assert.equal(r.statusCode,200);await settled();assert.equal(writes,1);assert.equal(saved().revision,revision);
 // A historical saved arrival is promoted without another physical submission or changing its operator/time.
 let legacy=seed();legacy=applyAction(legacy,{...a,operator:{id:'w',code:'OP001',name:'QA'}},'QA');delete legacy.returns[0].warehouseConfirmedAt;legacy.processes.find(p=>p.kind==='reception')!.state='in_progress';writeFileSync(file,JSON.stringify([legacy]));const at=legacy.returns[0].receivedAt;
 user={...user,permissions:['products']};r=await call('/receipts/INC-2026-00036/sync',{revision:legacy.revision,returnId:op.returnId});assert.equal(r.statusCode,200);assert.equal((await settled()).state,'blocked');assert.equal(writes,1);assert(saved().returns[0].warehouseConfirmedAt);assert.equal(saved().returns[0].receivedAt,at);assert.match(saved().returns[0].odooSyncError,/permiso/);
 // Partial arrivals are not complete or unlocked; legacy storage with no optional field remains readable.
 let partial=seed();partial=applyAction(partial,{...a,quantities:{B:1},condition:'used',operator:{id:'w',code:'OP001',name:'QA'}},'QA');assert.equal(partial.returns[0].warehouseConfirmedAt,undefined);assert.equal(getIncidentClosureChecklist(partial).goodsRegularized,false);
 console.log('PASS receipt sync: viewer+odooWrite, saved confirmation, outage persistence, retry, no duplicate, legacy recovery, missing permission, partial and closure gates. External calls forbidden.');
}finally{Object.assign(SheetsRepository.prototype,{list:original.list,save:original.save,status:original.status});globalThis.fetch=original.fetch;}
