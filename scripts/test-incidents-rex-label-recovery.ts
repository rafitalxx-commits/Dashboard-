import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {SheetsRepository} from '../backend/incidents/repository.ts';
import {buildIncident} from '../backend/incidents/workflow.ts';
import {registerIncidentRoutes} from '../backend/incidents/routes.ts';
import {TEST_TARGET} from '../backend/incidents/odooRuntime.ts';
const directory=mkdtempSync(join(tmpdir(),'rex-audit-recovery-'));
let incident=buildIncident({requestId:'lab-recovery-fixture',origin:'carrier',type:'lost',solution:'lost_resend',context:{source:'demo',order:{odooReference:'S-QA',channel:'Website',customerName:'QA'},products:[{productId:10,sku:'QA',name:'QA',orderedQuantity:1,affectedQuantity:1}]},products:[{productId:10,sku:'QA',name:'QA',orderedQuantity:1,affectedQuantity:1}]},'INC-2026-99988','DEV-2026-99988','QA');
const reference='REX-2026-99988-01',line={productId:10,sku:'QA',quantity:1,uomId:1,sourceId:8,destinationId:5};
const operation={key:incident.id+':reshipment',digest:'qa-digest',kind:'reshipment' as const,pickingId:80,dispatchReference:reference,target:TEST_TARGET,status:'ready_for_expedition' as const,lines:[line],confirmedAt:new Date().toISOString()};
incident.odooOperations=[operation];
const label={reference,incidentId:incident.id,orderReference:'S-QA',pickingId:80,shipmentCode:'SIM-'+reference,tracking:'SIM-'+reference,carrier:'DEMO',operator:'Operario original',operatorCode:'OP001',operatorId:'worker-1',createdAt:'2026-10-20T10:00:00.000Z',simulated:true};
const labelsPath=join(directory,'incidents-demo-labels.json');writeFileSync(labelsPath,JSON.stringify([label]));const originalLabels=readFileSync(labelsPath);
const list=SheetsRepository.prototype.list,status=SheetsRepository.prototype.status,save=SheetsRepository.prototype.save;
let handler:any,reconciliations=0,isolation=0,stockWrites=0;let pickingState='done';let user={id:'qa',name:'QA',role:'viewer',permissions:['expeditions','odooWrite']};const initialIncident=structuredClone(incident);
try {
 SheetsRepository.prototype.status=()=>({configured:true,writable:true,source:'test',message:'test'} as any);
 SheetsRepository.prototype.list=async()=>[structuredClone(incident)];
 SheetsRepository.prototype.save=async(items:any,expected:any)=>{assert.equal(expected[incident.id],incident.revision);incident=structuredClone(items[0]);};
 const read=async(model:string)=>{
  if(model==='sale.order')return [{id:20,company_id:[1,'QA']}];
  if(model==='stock.picking')return [{id:80,name:'QA-OUT',state:pickingState,origin:reference,sale_id:[20,'S-QA'],company_id:[1,'QA'],partner_id:[30,'QA'],picking_type_id:[2,'QA'],carrier_tracking_ref:label.tracking}];
  if(model==='stock.picking.type')return [{code:'outgoing'}];
  if(model==='stock.move')return [{product_id:[10,'QA'],product_uom:[1,'Unit'],product_uom_qty:1,location_id:[8,'Stock'],location_dest_id:[5,'Customer'],state:pickingState}];
  if(model==='res.partner')return [{name:'QA',street:'QA',zip:'00000',city:'QA',country_id:[1,'ES']}];
  if(model==='res.country')return [{code:'ES'}];
  throw Error('Unexpected read '+model);
 };
 const runtimeEnv={DASHBOARD_DATA_DIR:directory,INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_WRITE_ENABLED:'false',INCIDENTS_DEMO_LABEL_ENABLED:'true',INCIDENTS_DEMO_WORKFLOW_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true'};
 registerIncidentRoutes({middlewares:{use:(_path:any,fn:any)=>handler=fn}},{getSessionUser:()=>user},runtimeEnv, {lookup:async()=>{throw Error();},catalog:async()=>({products:[],hasMore:false}),statistics:async()=>({}),image:async()=>Buffer.from(''),odoo:{mode:'test',target:TEST_TARGET,read,inspect:async()=>({}),isolate:async(_scope:string,task:()=>Promise<any>)=>{isolation++;return task();},stock:{propose:async()=>({operations:[{...operation,blockers:[]}],blockers:[]})} as any,executor:{reconcileDemoReshipmentForLabel:async(input:any)=>{reconciliations++;assert.equal(input.shipmentCode,label.shipmentCode);return {...operation,status:'done',shipmentCode:input.shipmentCode,tracking:input.tracking};},validateReshipmentForLabel:async()=>{stockWrites++;pickingState='done';return {...operation,status:'done',shipmentCode:label.shipmentCode,tracking:label.tracking};}} as any}});
 const call=async(body:object={})=>{const request=Readable.from([JSON.stringify(body)]);Object.assign(request,{method:'POST',url:'/reshipments/'+reference+'/demo-label-created',headers:{}});const response:any={statusCode:200,setHeader:()=>{},end:(body:string)=>response.body=JSON.parse(body)};await handler(request,response);return response;};
 const before=incident.revision,client=incident.clientStatus,costs=structuredClone(incident.costs),first=await call();assert.equal(first.statusCode,200,JSON.stringify(first.body));assert.equal(first.body.reconciled,true);assert.equal(first.body.reused,true);assert.equal(incident.odooOperations![0].status,'done');assert.equal(incident.odooOperations![0].shippedBy,label.operator);assert.equal(incident.clientStatus,client);assert.deepEqual(incident.costs,costs);assert.equal(incident.revision,before+1);
 const again=await call();assert.equal(again.statusCode,200);assert.equal(incident.revision,before+1);assert.equal(reconciliations,1);assert.equal(isolation,0);assert.equal(stockWrites,0);assert.deepEqual(readFileSync(labelsPath),originalLabels);
 // A contradictory previous label must not certify another picking.
  incident.odooOperations=[operation];writeFileSync(labelsPath,JSON.stringify([{...label,pickingId:81}]));assert.equal((await call()).statusCode,400);assert.equal(reconciliations,1);
  incident.status='Cerrada';writeFileSync(labelsPath,JSON.stringify([label]));assert.equal((await call()).statusCode,400);assert.equal(reconciliations,1);
 runtimeEnv.INCIDENTS_ODOO_WRITE_ENABLED='true';
 // A non-admin operator with the two scoped permissions can create the label.
 incident=structuredClone(initialIncident);pickingState='assigned';writeFileSync(labelsPath,'[]');writeFileSync(join(directory,'warehouse-workers.json'),JSON.stringify([{id:'worker-1',code:'OP001',name:'Operario original',active:true}]));
 user={...user,permissions:['expeditions']};assert.equal((await call({operatorCode:'OP001'})).statusCode,403);assert.equal(stockWrites,0);assert.deepEqual(JSON.parse(readFileSync(labelsPath,'utf8')),[]);
 user={...user,permissions:['expeditions','odooWrite']};assert.equal((await call({operatorCode:''})).statusCode,400);assert.equal(stockWrites,0);
 const created=await call({operatorCode:'OP001'});assert.equal(created.statusCode,200,JSON.stringify(created.body));assert.equal(stockWrites,1);assert.equal(created.body.label.shipmentCode,label.shipmentCode);const freshLabels=readFileSync(labelsPath);const doneRevision=incident.revision;
 const reused=await call();assert.equal(reused.statusCode,200);assert.equal(stockWrites,1);assert.equal(incident.revision,doneRevision);assert.deepEqual(readFileSync(labelsPath),freshLabels);
 console.log('PASS REX recovery HTTP: existing DEMO label + completed picking repair audit with closed stock gates, no QR required/recreated, no isolation/stock write/new label, duplicate idempotence, contradictory evidence rejected, customer/costs unchanged; viewer with Expeditions+odooWrite creates once, missing permission/QR blocked.');
} finally {SheetsRepository.prototype.list=list;SheetsRepository.prototype.status=status;SheetsRepository.prototype.save=save;}
