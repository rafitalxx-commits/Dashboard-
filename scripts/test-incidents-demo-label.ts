import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DemoLabelStore,assertDemoLabelScope} from '../backend/incidents/demoLabel.ts';import {TEST_TARGET} from '../backend/incidents/odooRuntime.ts';import type {Incident} from '../backend/incidents/types.ts';
const op={key:'INC-2026-00031:reshipment',digest:'qa-digest',kind:'reshipment' as const,dispatchReference:'REX-2026-00031-01',pickingId:78590,status:'ready_for_expedition' as const,target:TEST_TARGET,confirmedAt:new Date().toISOString()};
const i={id:'INC-2026-00031',requestId:'lab-qa-demo-label',observationsSummary:'PRUEBA TÉCNICA DEMO',status:'En gestión',order:{odooReference:'S-TEST'}} as Incident;
const env={INCIDENTS_ODOO_MODE:'test',INCIDENTS_DEMO_LABEL_ENABLED:'true',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true',INCIDENTS_ODOO_APPROVED_OPERATION:op.key,INCIDENTS_ODOO_APPROVED_DIGEST:op.digest};
assert.doesNotThrow(()=>assertDemoLabelScope(env,TEST_TARGET,i,op));let rejected=0;
for(const field of Object.keys(env)){assert.throws(()=>assertDemoLabelScope({...env,[field]:'invalid'},TEST_TARGET,i,op));rejected++;}
assert.throws(()=>assertDemoLabelScope(env,'https://production.example/db',i,op));assert.throws(()=>assertDemoLabelScope(env,TEST_TARGET,{...i,requestId:'real-order'},op));assert.throws(()=>assertDemoLabelScope(env,TEST_TARGET,{...i,status:'Cerrada'},op));assert.throws(()=>assertDemoLabelScope(env,TEST_TARGET,{...i,observationsSummary:'Real incident'},op));
const dir=mkdtempSync(join(tmpdir(),'demo-rex-label-'));writeFileSync(join(dir,'warehouse-workers.json'),JSON.stringify([{id:'QA',code:'OP001',name:'Operario técnico QA',active:true}]));
const store=new DemoLabelStore(dir);assert.throws(()=>store.prepare(i,op,''),/operario/);assert(!existsSync(join(dir,'incidents-demo-labels.json')));
const label=store.prepare(i,op,'op001');assert.equal(label.simulated,true);assert.equal(label.shipmentCode,'SIM-REX-2026-00031-01');assert.deepEqual(store.prepare(i,op,'OP001'),label);
store.recordActivity(label);store.recordActivity(label);assert.equal(JSON.parse(readFileSync(join(dir,'warehouse-worker-activity.json'),'utf8')).length,1);
const restarted=new DemoLabelStore(dir);assert.deepEqual(restarted.find(label.reference),label);assert.throws(()=>restarted.prepare(i,{...op,pickingId:888},'OP001'),/otro/);assert(!existsSync(join(dir,'genei-shipping-labels.json')),'No fake carrier ledger');
writeFileSync(join(dir,'incidents-demo-labels.json'),'invalid json');assert.throws(()=>new DemoLabelStore(dir).find(label.reference));assert.throws(()=>new DemoLabelStore(dir).prepare(i,op,'OP001'));
console.log(`PASS etiquetas DEMO: ${rejected} gates, destino producción bloqueado, solo caso técnico, QR activo, persistencia/reinicio, duplicados y corrupción; cero transportistas/Odoo`);
