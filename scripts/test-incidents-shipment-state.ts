import assert from 'node:assert/strict';
import {buildIncident, applyAction, updateIncidentDerivedState} from '../backend/incidents/workflow.ts';
import {incidentShipments, confirmedReshipment} from '../backend/incidents/shipmentConfirmation.ts';
import {coherentIncident} from '../backend/incidents/coherence.ts';
import {getIncidentClosureChecklist} from '../backend/incidents/domain.ts';
import {IncidentService} from '../backend/incidents/service.ts';
import {MemoryRepository} from '../backend/incidents/repository.ts';
import {getIncidentProgress} from '../src/modules/incidents/incidentProgress.ts';
import type {Incident} from '../backend/incidents/types.ts';

const products=[{sku:'QA',productId:10,name:'QA',affectedQuantity:1,orderedQuantity:1}];
const make=()=>buildIncident({requestId:crypto.randomUUID(),origin:'warehouse',type:'wrong_product',solution:'resend_recover',context:{source:'demo',order:{odooReference:'QA-ONLY',channel:'TEST',customerName:'QA'},products},products},'INC-2026-99982','DEV-2026-99982','QA');
type Operation=NonNullable<Incident['odooOperations']>[number];
const dispatched:Operation={key:'QA:rex:1',kind:'reshipment',digest:'qa',pickingId:1,status:'done',dispatchReference:'REX-2026-99982-01',externalReference:'QA-OUT',confirmedAt:'2026-10-22T12:01:00.000Z',shipmentCode:'QA-SIM',shippedBy:'QA worker',shippedAt:'2026-10-22T12:00:00.000Z',simulated:true};

const empty=make();assert(!incidentShipments(empty).allSent);
for(const op of [{...dispatched,status:'ready_for_expedition' as const},{...dispatched,shipmentCode:undefined},{...dispatched,shippedBy:undefined},{...dispatched,shippedAt:undefined}]){
 const i=make();i.odooOperations=[op];updateIncidentDerivedState(i);
 assert(!confirmedReshipment(op));assert.notEqual(i.status,'Reenvío enviado');
 assert(!getIncidentClosureChecklist(i).logisticsResolved);
 assert.throws(()=>applyAction(i,{kind:'client',value:'Solucionado'},'QA'),/REX/);
}
const manual=make();manual.processes.find(p=>p.kind==='reshipment')!.state='resolved';
updateIncidentDerivedState(manual);assert.notEqual(manual.status,'Reenvío enviado');assert(!getIncidentClosureChecklist(manual).logisticsResolved);

// Physical dispatch completes the REX, not an unrelated correction, cost or customer delivery.
const repo=new MemoryRepository();repo.items=[make()];const service=new IncidentService(repo);
const before=structuredClone(repo.items[0]);
let sent=await service.confirmOdoo(before.id,before.revision,dispatched,[dispatched.key,'QA:original-correction'],'QA',false);
assert.equal(sent.status,'Reenvío enviado');assert.equal(sent.clientStatus,before.clientStatus);
assert.deepEqual(sent.costs,before.costs);assert.equal(sent.stockRegularized,false);
assert(sent.processes.filter(p=>p.kind==='reshipment').every(p=>p.state==='resolved'));
assert(sent.processes.some(p=>p.kind==='stock_adjustment'&&p.state==='pending'));
assert.equal(sent.timeline.at(-1)!.type,'reshipment_sent');
const progress=getIncidentProgress(sent);assert.equal(progress.shipping.label,'Reenvío enviado');
assert.equal(progress.shipment,undefined);assert(progress.checks.logisticsResolved);
assert(!progress.pending.some(p=>/Expedir|Finalizar reenvíos/.test(p.task)));
assert.equal((await repo.list())[0].status,'Reenvío enviado');
const again=await service.confirmOdoo(sent.id,sent.revision,dispatched,[dispatched.key,'QA:original-correction'],'QA',false);
assert.deepEqual(again,sent,'Repeated confirmation must not append history/revision or undo shipment');
sent=applyAction(sent,{kind:'cost',description:'QA pending cost',category:'other',amount:3,state:'pending',occurredAt:'2026-10-22'},'QA');
sent=applyAction(sent,{kind:'note',text:'QA unrelated note'},'QA');assert.equal(sent.status,'Reenvío enviado');
assert.equal(sent.clientStatus,'Pendiente');assert(!getIncidentClosureChecklist(sent).canClose);

const historical=make();historical.odooOperations=[dispatched];
const repaired=coherentIncident(historical);assert.equal(repaired.status,'Reenvío enviado');
assert(repaired.processes.filter(p=>p.kind==='reshipment').every(p=>p.state==='resolved'));
assert.deepEqual(coherentIncident(repaired),repaired);assert.equal(historical.status,'En gestión');

// One completed REX cannot hide another one still awaiting expedition.
const partial=make();partial.odooOperations=[dispatched,{...dispatched,key:'QA:rex:2',pickingId:2,dispatchReference:'REX-2026-99982-02',status:'ready_for_expedition',shipmentCode:undefined,shippedAt:undefined,shippedBy:undefined}];
updateIncidentDerivedState(partial);assert.notEqual(partial.status,'Reenvío enviado');
assert.equal(incidentShipments(partial).label,'Reenvíos enviados: 1/2');
assert.equal(getIncidentProgress(partial).shipment?.dispatchReference,'REX-2026-99982-02');
assert(!getIncidentClosureChecklist(partial).logisticsResolved);
assert.throws(()=>applyAction(partial,{kind:'client',value:'Solucionado'},'QA'),/REX/);
partial.odooOperations[1]={...partial.odooOperations[1],status:'done',shipmentCode:'QA-SIM-2',shippedAt:dispatched.shippedAt,shippedBy:dispatched.shippedBy};
updateIncidentDerivedState(partial);assert.equal(partial.status,'Reenvío enviado');
const solved=applyAction(partial,{kind:'client',value:'Solucionado'},'QA');assert.equal(solved.status,'Resuelta');
assert(incidentShipments(solved).allSent);assert(!getIncidentClosureChecklist(solved).canClose);
const closed={...solved,status:'Cerrada' as const};assert.deepEqual(coherentIncident(closed),closed);
// Classifying independent tasks once does not weaken administrative closure.
for(const kind of ['stock_adjustment','reception','diagnosis','refund','repair','claim','follow_up','reshipment'] as const){
 for(const state of ['pending','in_progress','blocked','resolved','assumed'] as const){
  const i=make();i.returns=[];i.type=kind==='diagnosis'?'warranty':i.type;i.clientStatus='Solucionado';i.costs=[{id:'known-cost',description:'QA',category:'other',amount:1,direction:'cost',state:'confirmed',occurredAt:dispatched.confirmedAt,source:'manual'}];i.stockRegularized=true;i.odooOperations=[dispatched];
  i.processes=[{id:'QA-task',kind,title:'QA independent task',state,requiredToClose:true,updatedAt:dispatched.confirmedAt}];
  const checks=getIncidentClosureChecklist(i);
  const expectedClose=kind==='stock_adjustment'||!['pending','in_progress','blocked'].includes(state);
  assert.equal(checks.canClose,expectedClose,`Operator close contract changed for ${kind}/${state}`);
 }
}
const noShipment=make();noShipment.processes=[];noShipment.odooOperations=[];updateIncidentDerivedState(noShipment);assert.equal(noShipment.status,'En gestión');
console.log('PASS shipment state: authoritative automatic transition, persistent/idempotent confirmation, no manual duplicate step, independent costs/stock/client, historical recovery, partial multi-REX, close gate preserved');
