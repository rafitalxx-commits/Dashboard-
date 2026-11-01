import assert from 'node:assert/strict';
import{buildIncident,applyAction}from'../backend/incidents/workflow.ts';
import{getIncidentNetLoss}from'../backend/incidents/domain.ts';
import{incidentEconomics,aggregateStatistics,groupStatistics}from'../backend/incidents/analytics.ts';
import{isUnsentMerchandiseRefund,unsentMerchandiseRefundAmount}from'../backend/incidents/economics.ts';
import type{WizardDraft}from'../backend/incidents/types.ts';
const product={sku:'QA',name:'QA',orderedQuantity:2,affectedQuantity:1,unitSalePrice:31.45,unitCostSnapshot:10};
const draft:WizardDraft={requestId:'qa-unsent-economics',origin:'warehouse',type:'missing_product',solution:'refund_missing',context:{source:'odoo',order:{odooReference:'QA-ORDER',customerName:'QA',channel:'QA',preparedBy:'QA'},products:[product]},products:[product]};
const i=buildIncident(draft,'INC-2026-99992','DEV-2026-99992','QA');assert.equal(i.costs[0].amount,31.45);
const original=JSON.stringify(i);
for(const state of ['pending','estimated','confirmed','assumed'] as const){
 const current=structuredClone(i);current.costs[0].state=state;
 assert(isUnsentMerchandiseRefund(current,current.costs[0]));assert.equal(getIncidentNetLoss(current),0);
 assert.equal(incidentEconomics(current).gross,0);assert.equal(incidentEconomics(current).estimated,0);assert.equal(incidentEconomics(current).saleAdjustments,31.45);
}
const reviewed=applyAction(i,{kind:'cost',id:i.costs[0].id,category:'refund',description:'Abono real',amount:31.45,state:'confirmed'},'QA');assert.equal(getIncidentNetLoss(reviewed),0);assert.equal(unsentMerchandiseRefundAmount(reviewed),31.45);
const shipping=applyAction(reviewed,{kind:'cost',category:'reshipment',amount:5,state:'confirmed'},'QA');assert.equal(getIncidentNetLoss(shipping),5);assert.equal(incidentEconomics(shipping).transport,5);
const damaged=applyAction(shipping,{kind:'cost',category:'lost_product',amount:10,state:'confirmed'},'QA');assert.equal(getIncidentNetLoss(damaged),15);assert.equal(incidentEconomics(damaged).merchandise,10);
const recovered=applyAction(damaged,{kind:'cost',category:'indemnity',amount:3,state:'confirmed'},'QA');assert.equal(getIncidentNetLoss(recovered),12);
const short=structuredClone(i);short.type='wrong_quantity';short.products[0].receivedQuantity=1;assert.equal(getIncidentNetLoss(short),0);
short.products[0].receivedQuantity=3;assert.equal(getIncidentNetLoss(short),31.45);short.products[0].receivedQuantity=undefined;assert.equal(getIncidentNetLoss(short),31.45);
for(const type of ['lost','damage','withdrawal','warranty'] as const){const real=structuredClone(reviewed);real.type=type;assert.equal(getIncidentNetLoss(real),31.45);assert.equal(incidentEconomics(real).saleAdjustments,0);}
const carrier=structuredClone(reviewed);carrier.origin='carrier';assert.equal(getIncidentNetLoss(carrier),31.45);
const totals=aggregateStatistics([reviewed,shipping]);assert.equal(totals.net,5);assert.equal(totals.saleAdjustments,62.9);assert.equal(groupStatistics([reviewed,shipping],'operator')[0].net,5);
assert.equal(JSON.stringify(i),original);const historical=JSON.parse(original);assert.equal(getIncidentNetLoss(historical),0);assert.equal(historical.costs[0].amount,31.45);
console.log('PASS omitted-product refund is sale adjustment across pending/estimated/confirmed/assumed, manual edits and historic reads; extra shipping/damage/recoveries preserved; true losses/returns remain costs; summaries/statistics agree; no mutation');
