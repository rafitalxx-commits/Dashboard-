import assert from 'node:assert/strict';
import {confirmIncidentShipment, mergeDeliveryIncident, preserveConcurrentShipmentConfirmations} from '../backend/deliveryIncidentResolution.ts';
const incident={id:'i1',orderId:1,orderName:'QA-S1',reason:'No hay albaran asociado en Odoo.',tracking:'TRACK-1'};
const input={incidentId:'i1',tracking:'TRACK-1',reason:'Salida comprobada por almacén',confirmed:true};
const actor={id:'qa-user',name:'Operario QA'};
const other={...incident,id:'i2',orderId:2};
for(const patch of [{confirmed:false},{tracking:'OTRO'},{reason:''},{reason:' '.repeat(3)},{reason:'a'.repeat(1001)},{incidentId:''},{incidentId:'inexistente'}])assert.throws(()=>confirmIncidentShipment([incident],{...input,...patch},actor));
assert.throws(()=>confirmIncidentShipment([{...incident,tracking:''}],input,actor));
assert.throws(()=>confirmIncidentShipment([incident],input,{...actor,id:''}));
assert.throws(()=>confirmIncidentShipment([incident],input,actor,'TRACK-NUEVO'));
const result=confirmIncidentShipment([incident,other],input,actor,undefined,'2026-11-03T10:00:00Z');
assert.equal(result.incident.resolvedBy,actor.name);assert.equal(result.incident.manualResolution?.reason,input.reason);
assert.equal(result.incident.manualResolution?.confirmedById,actor.id);assert.deepEqual(result.incidents[1],other);assert.equal(incident.resolvedAt,undefined);
const disk=JSON.parse(JSON.stringify(result.incidents));
assert.deepEqual(confirmIncidentShipment(disk,input,actor,undefined,'later').incidents,disk);
const merged=mergeDeliveryIncident(disk[0],{...incident,lastAttemptAt:'later'});
assert.equal(merged.resolvedAt,'2026-11-03T10:00:00Z');assert.deepEqual(merged.manualResolution,disk[0].manualResolution);
for(const patch of [{tracking:'NEW'},{pickingId:'99'},{reason:'Otro bloqueo'},{orderId:10}]){
 const reopened=mergeDeliveryIncident(disk[0],{...incident,...patch});assert.equal(reopened.resolvedAt,undefined);assert.equal(reopened.manualResolution,undefined);
}
assert.equal(mergeDeliveryIncident({...incident,resolvedAt:'legacy'},incident).resolvedAt,undefined);
console.log('PASS: validation, exact target, audit, serialized reload/idempotence, sync dedup, changed failure reopens, legacy compatible.');

const fresh={incidents:disk,audit:[{id:'audit-1',manualShipmentResolution:disk[0].manualResolution}]};
const stale={incidents:[incident,other],audit:[]};
const rebased=preserveConcurrentShipmentConfirmations(stale,fresh);
assert.equal(rebased.incidents[0].resolvedAt,disk[0].resolvedAt);assert.deepEqual(rebased.audit,fresh.audit);
const removed=preserveConcurrentShipmentConfirmations({incidents:[],audit:[]},fresh);
assert.equal(removed.incidents.length,1);
const changed=preserveConcurrentShipmentConfirmations({incidents:[{...incident,tracking:'NEW'}],audit:[]},fresh);
assert.equal(changed.incidents[0].resolvedAt,undefined);assert.deepEqual(changed.audit,fresh.audit);
console.log('PASS: stale sync/read writers preserve confirmations/audit, changed shipment can reopen.');
