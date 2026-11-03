import assert from 'node:assert/strict';
import {mergeIncidentSnapshots} from '../src/modules/incidents/incidentSnapshots.ts';
import {getIncidentProgress} from '../src/modules/incidents/incidentProgress.ts';
import {buildIncident} from '../backend/incidents/workflow.ts';
import type {WizardDraft} from '../backend/incidents/types.ts';
const draft:WizardDraft={requestId:'qa-live-progress',origin:'warehouse',type:'wrong_product',solution:'wait_resend',context:{source:'odoo',order:{odooReference:'QA-1',channel:'QA',customerName:'QA'},products:[]},products:[{productId:10,sku:'QA',name:'QA',orderedQuantity:1,affectedQuantity:1}],wrongReceived:'QB',wrongReceivedProduct:{productId:11,sku:'QB',name:'QB'}};
draft.context.products=structuredClone(draft.products);
for(const solution of ['wait_resend','cross_wait','origin_resend','customer_exchange','warranty_receive']){
 const i=buildIncident(draft,'INC-2026-99997','DEV-2026-99997','QA');i.solution=solution;
 // Focus on the physical return wait; other solution prerequisites remain intact.
 const r=i.returns.find(r=>!r.stockCorrection)!;assert(r);
 const before=getIncidentProgress(i);assert(before.pending.some(p=>p.key==='goodsRegularized'));
 Object.assign(r,{state:'arrived',receivedBy:{id:'qa',name:'QA',code:'OPQA'},receivedAt:'2026-10-26T09:00:00Z',warehouseConfirmedAt:'2026-10-26T09:00:00Z',condition:'perfect',destination:'stock',odooSyncError:'QA sync failure'});
 const during=getIncidentProgress(i);assert(during.pending.find(p=>p.key==='goodsRegularized')?.help.includes('QA sync failure'));assert(!during.pending.find(p=>p.key==='goodsRegularized')?.help.includes('identifica al operario'));
 r.state='processed';for(const p of i.processes.filter(p=>p.kind==='reception'))p.state='resolved';assert(!getIncidentProgress(i).pending.some(p=>p.key==='goodsRegularized'));
}
const newer=buildIncident(draft,'INC-2026-99997','DEV-2026-99997','QA');newer.revision=8;
const old=structuredClone(newer);old.revision=4;old.clientStatus='Pendiente';newer.clientStatus='Solucionado';
assert.equal(mergeIncidentSnapshots([newer],[old])[0].clientStatus,'Solucionado');assert.equal(mergeIncidentSnapshots([newer],[]).length,1);
const equal=structuredClone(newer);equal.documentPreparationStatus={state:'running',message:'QA',updatedAt:'2026-10-26T09:00:00Z'};assert.equal(mergeIncidentSnapshots([newer],[equal])[0].documentPreparationStatus?.state,'running');
const other=structuredClone(newer);other.id='INC-2026-99998';assert.equal(mergeIncidentSnapshots([newer],[other]).length,2);
console.log('PASS live progress contract: five receive-first solutions; inspection/Odoo distinction; revision monotonicity; equal-revision job metadata; missing/new IDs');
