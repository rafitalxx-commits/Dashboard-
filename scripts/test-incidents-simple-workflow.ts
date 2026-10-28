import assert from 'node:assert/strict';
import {buildIncident,applyAction,updateIncidentDerivedState} from '../backend/incidents/workflow.ts';
import {getIncidentClosureChecklist} from '../backend/incidents/domain.ts';
import {hasRecordedIncidentCost,incidentPendingWork} from '../backend/incidents/operatorWorkflow.ts';
import {aggregateStatistics,incidentEconomics} from '../backend/incidents/analytics.ts';
import {getIncidentProgress} from '../src/modules/incidents/incidentProgress.ts';
import {MemoryRepository} from '../backend/incidents/repository.ts';
import {IncidentService} from '../backend/incidents/service.ts';

const products=[{productId:10,sku:'A',name:'Producto A',orderedQuantity:2,affectedQuantity:1}];
const make=()=>buildIncident({requestId:crypto.randomUUID(),origin:'warehouse',type:'missing_product',solution:'resend_missing',products,context:{source:'demo',order:{odooReference:'QA-SIMPLE',channel:'TEST',customerName:'QA'},products}},'INC-2026-99979','DEV-2026-99979','QA');
const sent=()=>{const i=make();i.odooOperations=[{key:'rex',digest:'qa',kind:'reshipment',pickingId:1,dispatchReference:'REX-2026-99979-01',status:'done',confirmedAt:new Date().toISOString(),shipmentCode:'QA-SIM',shippedAt:new Date().toISOString(),shippedBy:'QA',simulated:true}];for(const r of i.returns.filter(r=>r.stockCorrection)){r.state='processed';i.odooOperations.push({key:i.id+':return:'+r.id,kind:'return',returnId:r.id,status:'done',pickingId:2,digest:'qa',confirmedAt:new Date().toISOString()});}updateIncidentDerivedState(i);return i;};
const cost=(amount:number)=>({kind:'cost',category:'other',description:'Coste registrado QA',amount,state:'confirmed'});

let i=sent();assert(!hasRecordedIncidentCost(i),'Automatic empty shipment provision is not an entered cost');
assert(getIncidentProgress(i).pending.some(p=>p.key==='costsClosed'));
assert(!getIncidentProgress(i).requirements.some(p=>p.key==='stockRegularized' as any));
assert(!incidentPendingWork(i).summary.includes('Odoo'));
i=applyAction(i,{kind:'client',value:'Solucionado'},'QA');
assert.throws(()=>applyAction(i,{kind:'close'},'QA'),/Costes registrados/);
i=applyAction(i,cost(0),'QA');assert(hasRecordedIncidentCost(i),'Explicit zero completes the cost entry');
assert.equal(i.status,'Resuelta');assert.equal(i.stockRegularized,false,'Never forge internal stock completion');
assert(getIncidentClosureChecklist(i).canClose,'Technical stock task is not a manual operator requirement');
assert.equal(incidentPendingWork(i).summary,'Listo para cierre');
const opBefore=structuredClone(i.odooOperations),stockBefore=structuredClone(i.stockPlan);
i=applyAction(i,cost(12.5),'QA');assert.equal(incidentEconomics(i).gross,12.5);assert.equal(aggregateStatistics([i]).net,12.5);
assert.equal(i.status,'Resuelta');assert(getIncidentClosureChecklist(i).costsClosed);
i=applyAction(i,{kind:'close'},'QA');i=applyAction(i,cost(4),'QA');
assert.equal(i.clientStatus,'Solucionado');assert.equal(aggregateStatistics([i]).net,16.5);
assert(getIncidentClosureChecklist(i).costsClosed);assert.deepEqual(i.odooOperations,opBefore);assert.deepEqual(i.stockPlan,stockBefore);
const repo=new MemoryRepository();repo.items=[i];const stored=(await new IncidentService(repo).repo.list())[0];
assert(stored.costs.at(-1)!.recordedAt);assert.equal(stored.costs.at(-1)!.recordedBy,'QA');

// Older ledgers need no migration and pending empty placeholders don't undo a real entry.
const legacy=sent();legacy.costs=[{id:'legacy',category:'other',description:'Legacy',amount:6,direction:'cost',state:'pending',occurredAt:'2026-10-22',source:'manual'},...legacy.costs];
assert(hasRecordedIncidentCost(legacy));updateIncidentDerivedState(legacy);assert(!/coste|stock|Odoo/i.test(legacy.pendingSummary!));
legacy.costs=legacy.costs.filter(c=>c.id!=='legacy');assert(!hasRecordedIncidentCost(legacy));
legacy.costs.push({id:'recovery',category:'indemnity',description:'Recuperación no es gasto',amount:7,direction:'recovery',state:'confirmed',occurredAt:'2026-10-22',source:'carrier'});assert(!hasRecordedIncidentCost(legacy));

// The only source of the received article is the saved receiving inspection.
const wrong=buildIncident({requestId:crypto.randomUUID(),origin:'warehouse',type:'wrong_product',solution:'wait_resend',products,context:{source:'demo',order:{odooReference:'QA-RETURN',channel:'TEST',customerName:'QA'},products}},'INC-2026-99978','DEV-2026-99978','QA');
wrong.evidence.push({id:'photo',name:'QA photo',mimeType:'image/jpeg',size:1,returnId:wrong.returns[0].id,url:'https://example.invalid/qa',createdAt:new Date().toISOString()} as any);
const expected=wrong.returns[0].products[0].sku;
const inspection={kind:'return',id:wrong.returns[0].id,operator:{id:'QA',code:'OPQA',name:'QA'},condition:'wrong_product',destination:'stock',quantities:{[expected]:1},itemOverrides:[{expectedSku:expected,mode:'catalog',product:{productId:11,sku:'B',name:'Producto B'},quantity:2}]};
const received=applyAction(wrong,inspection,'QA');assert.equal(received.wrongReceivedProduct,undefined);
assert.equal(received.returns[0].itemOverrides![0].product!.sku,'B');assert.equal(received.returns[0].itemOverrides![0].quantity,2);
assert.equal(received.odooOperations?.length||0,0);assert(!getIncidentClosureChecklist(received).goodsRegularized,'No administrative close ahead of the saved DEV sync');
const foreign=applyAction(wrong,{...inspection,destination:'not_ours',itemOverrides:[{expectedSku:expected,mode:'not_ours',description:'Mercancía ajena QA',quantity:3}]},'QA');
repo.items=[foreign];const done=await new IncidentService(repo).completeReturnAfterOdoo(foreign.id,foreign.returns[0].id,'QA');
assert.equal(done.returns[0].state,'processed');assert.equal(done.odooOperations?.length||0,0,'Foreign goods never manufacture stock');
console.log('PASS simplified workflow: one entered cost including explicit zero; more costs after resolution/closure count in statistics; empty provisions/recoveries distinguished; no manual stock task/fake sync; receiving-only catalog or foreign goods; pending DEV cannot be closed early');
