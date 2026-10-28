import assert from 'node:assert/strict';
import {incidentVolumes} from '../backend/incidents/statistics.ts';
const labels=[
 {tracking:'1',shipper:'MRW',operator:'Ana',odooOrderRef:'S1',orderRefs:['S1'],externalOrderRef:'AMAZON-1'},
 {tracking:'1',shipper:'MRW',operator:'Ana',odooOrderRef:'S1'},
 {tracking:'2',shipper:'MRW',operator:'Ana',odooOrderRef:'S1'},
 {tracking:'1',shipper:'GLS',operator:'Luis',orderRefs:['S2','S3']},
 {tracking:'',shipper:'MRW',operator:'Ana',odooOrderRef:'S4'},
];
const all=incidentVolumes(labels);assert.equal(all.shipments,3);assert.equal(all.operators.Ana,1);assert.equal(all.operators.Luis,2);assert.equal(all.carriers.MRW,2);assert.equal(all.carriers.GLS,1);
const scoped=incidentVolumes(labels,'Amazon');assert.equal(scoped.shipments,null);assert.deepEqual(scoped.operators,{});assert.deepEqual(scoped.carriers,{});
console.log('PASS estadísticas: alias de pedido no duplica, reimpresiones no duplican, tracking por agencia, agrupados y canal sin denominador inventado.');
