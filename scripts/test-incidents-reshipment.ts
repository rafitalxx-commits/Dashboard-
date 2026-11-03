import assert from 'node:assert/strict';
import { reshipmentReference, incidentFromReshipment, resolveReshipment, reshipmentPrintData } from '../backend/incidents/reshipment.ts';
import type { Incident } from '../backend/incidents/types.ts';
const reference=reshipmentReference('INC-2026-00024');
assert.equal(reference,'REX-2026-00024-01');
assert.equal(incidentFromReshipment(reference),'INC-2026-00024');
for(const invalid of ['S65711','REX-2026-24-01','REX-2026-00024-00','REX-2026-00024-01/extra'])assert.throws(()=>incidentFromReshipment(invalid));
const incident={id:'INC-2026-00024',order:{odooReference:'S65711'},odooOperations:[{key:'INC-2026-00024:reshipment',kind:'reshipment',dispatchReference:reference,pickingId:90,lines:[{productId:10,sku:'A',quantity:1,uomId:1,sourceId:8,destinationId:5}]}]} as Incident;
let state='assigned',quantity=1,orderId=20,duplicate=false,type='outgoing',calls=0;
const read=async(model:string,method:string)=>{
 assert(['search_read','read'].includes(method));calls++;
 if(model==='sale.order')return [{id:20}];
 if(model==='stock.picking'){const row={id:90,name:'WH/OUT/90',state,sale_id:[orderId,'S65711'],company_id:[1,'LAB'],partner_id:[2,'TEST'],picking_type_id:[4,'OUT'],carrier_tracking_ref:false};return duplicate?[row,row]:[row];}
 if(model==='stock.picking.type')return [{code:type}];
 if(model==='res.partner')return [{name:'QA ficticio',street:'Calle QA',zip:'00000',city:'QA',country_id:[1,'ES']}];
 if(model==='res.country')return [{code:'ES'}];
 if(model==='stock.move')return [{product_id:[10,'A'],product_uom:[1,'Uds'],product_uom_qty:quantity,location_id:[8,'Stock'],location_dest_id:[5,'Cliente'],state}];
 throw Error('unexpected');
};
let result=await resolveReshipment(reference,incident,read);assert.equal(result.lines!.length,1);assert.equal(result.partnerId,2);assert.equal(result.labelCreationEnabled,true);assert.equal(result.reference,reference);
quantity=2;await assert.rejects(resolveReshipment(reference,incident,read),/líneas/);quantity=1;
orderId=21;await assert.rejects(resolveReshipment(reference,incident,read),/otro pedido/);orderId=20;
duplicate=true;await assert.rejects(resolveReshipment(reference,incident,read),/duplicado/);duplicate=false;
type='incoming';await assert.rejects(resolveReshipment(reference,incident,read),/salida/);type='outgoing';
for(const value of ['draft','cancel']){state=value;await assert.rejects(resolveReshipment(reference,incident,read),/reservada/);}
for(const value of ['confirmed','waiting']){state=value;assert.equal((await resolveReshipment(reference,incident,read)).labelCreationEnabled,false);}
state='done';result=await resolveReshipment(reference,incident,read);assert.equal(result.state,'done');assert.equal(result.labelCreationEnabled,false);
const prior=calls;await assert.rejects(resolveReshipment('REX-2026-00025-01',incident,read),/pertenece/);assert.equal(calls,prior);
console.log('REX: referencias, pedido, picking único, tipo, cantidades, reserva, estados y consulta sin escritura comprobados.');

let productSku='A';const printRead=async(model:string,method:string,args:any[],kwargs:any)=>model==='product.product'?[{id:10,name:'Producto QA',default_code:productSku}]:read(model,method);
const print=await reshipmentPrintData(reference,incident,printRead);assert.equal(print.destination.address,'Calle QA');assert.equal(print.destination.name,'QA ficticio');assert.equal(print.incidentId,incident.id);assert.deepEqual(print.lines.map(l=>[l.sku,l.name,l.quantity]),[['A','Producto QA',1]]);productSku='B';await assert.rejects(reshipmentPrintData(reference,incident,printRead),/producto del REX cambió/);console.log('REX albarán: destino real, producto del picking y comprobación SKU sin escrituras PASS');

// Provisional documents are discoverable but can never authorize a label.
const {reshipmentPreparation}=await import('../backend/incidents/reshipment.ts');
const staged={...incident,revision:7,status:'En gestión',solution:'wait_resend',odooOperations:[],processes:[{id:'receive',kind:'reception',state:'resolved'},{id:'reship',kind:'reshipment',dependsOn:['receive'],state:'pending'}],stockPlan:[{action:'new_outbound',quantity:1}],returns:[{id:'DEV-QA',state:'arrived'}]} as unknown as Incident;
let pending=reshipmentPreparation(staged)!;assert.equal(pending.state,'waiting_dependencies');assert.equal(pending.labelCreationEnabled,false);assert.match(pending.notice,/operario de almacén/);
staged.returns[0].state='processed';pending=reshipmentPreparation(staged)!;assert(pending.blockers.length>0,'Processed without external evidence is not enough');
staged.odooOperations=[{kind:'return',returnId:'DEV-QA',status:'done',target:'wrong-database'}] as any;assert(reshipmentPreparation(staged)!.blockers.length>0);
Object.assign(staged.returns[0],{receivedBy:{id:'qa',code:'OPQA',name:'QA'},receivedAt:new Date().toISOString(),condition:'perfect',destination:'stock'});staged.odooOperations=[{kind:'return',returnId:'DEV-QA',status:'done'}] as any;pending=reshipmentPreparation(staged)!;assert.deepEqual(pending.blockers,[]);assert.equal(pending.labelCreationEnabled,false);assert.equal(pending.revision,7);
assert.throws(()=>reshipmentPreparation(staged,'REX-2026-00024-02'),/inexistente/);
assert.throws(()=>reshipmentPreparation(staged,'REX-2026-00025-01'),/pertenece/);
staged.status='Cerrada';assert.match(reshipmentPreparation(staged)!.notice,/cerrada/);
assert.equal(reshipmentPreparation(incident),null,'Audited records must go through Odoo verification, not provisional fallback');
assert.equal(reshipmentPreparation({...incident,odooOperations:[...incident.odooOperations!,...incident.odooOperations!]}),null);
console.log('PASS lifecycle: document-only, prerequisites, target isolation, ready to prepare but never label, closed, unknown ordinal, audited/duplicate never downgraded.');
