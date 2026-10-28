import assert from 'node:assert/strict';
import { reviewPartialReceipt } from '../backend/incidents/partialReceipt.ts';
import type { StockLine } from '../backend/incidents/odooStock.ts';
const line=(quantity:number,overrides:Partial<StockLine>={}):StockLine=>({productId:11,sku:'QA-A',uomId:1,sourceId:6,destinationId:5,quantity,...overrides});
let count=0;
function test(name:string,fn:()=>void){fn();console.log(`PASS ${++count} ${name}`);}
test('Llegada parcial: solo propone lo recibido y conserva el resto',()=>{
 const p=reviewPartialReceipt([line(5)],[line(2)]);assert.equal(p.state,'partial');assert.deepEqual(p.batch,[line(2)]);assert.deepEqual(p.remainder,[line(3)]);assert.deepEqual(p.rows[0],{sku:'QA-A',productId:11,uomId:1,expected:5,received:2,posted:0,thisArrival:2,pending:3});
});
test('Segunda llegada acumulada: descuenta entrada ya confirmada sin duplicarla',()=>{
 const p=reviewPartialReceipt([line(5)],[line(4)],[line(2)]);assert.equal(p.state,'partial');assert.deepEqual(p.batch,[line(2)]);assert.deepEqual(p.remainder,[line(1)]);
 const final=reviewPartialReceipt([line(5)],[line(5)],[line(2),line(2)]);assert.equal(final.state,'complete');assert.deepEqual(final.batch,[line(1)]);assert.deepEqual(final.remainder,[]);
});
test('Reintento de conteo ya confirmado: no hay lote nuevo',()=>{
 const p=reviewPartialReceipt([line(5)],[line(2)],[line(2)]);assert.equal(p.state,'already_posted');assert.deepEqual(p.batch,[]);assert.deepEqual(p.remainder,[line(3)]);
});
test('Llegada vacía: no se transforma en una recepción total',()=>{
 const p=reviewPartialReceipt([line(5)],[]);assert.equal(p.state,'empty');assert.deepEqual(p.batch,[]);assert.deepEqual(p.remainder,[line(5)]);
});
test('Varias referencias y líneas duplicadas: sumar por identidad, no por SKU global',()=>{
 const b={productId:12,sku:'QA-B'},p=reviewPartialReceipt([line(2),line(3),line(4,b)],[line(1),line(1),line(4,b)],[line(1)]);
 assert.equal(p.state,'partial');assert.deepEqual(p.batch,[line(1),line(4,b)]);assert.deepEqual(p.remainder,[line(3)]);assert.equal(p.rows.length,2);
});
test('Componentes de kit: no convertir dos componentes en dos kits',()=>{
 const b={productId:12,sku:'QA-B'},p=reviewPartialReceipt([line(4),line(2,b)],[line(2),line(1,b)]);
 assert.deepEqual(p.batch,[line(2),line(1,b)]);assert.deepEqual(p.remainder,[line(2),line(1,b)]);
});
test('Decimales: no inventar residuos de coma flotante',()=>{
 const p=reviewPartialReceipt([line(0.3)],[line(0.1+0.2)],[line(0.1)]);assert.equal(p.state,'complete');assert.deepEqual(p.batch,[line(0.2)]);assert.deepEqual(p.remainder,[]);
});
test('No redondear a cero cantidades pequeñas sin una regla UoM explícita',()=>{
 const p=reviewPartialReceipt([line(5e-10)],[line(2e-10)]);assert.equal(p.state,'partial');assert.deepEqual(p.batch,[line(2e-10)]);assert.deepEqual(p.remainder,[line(3e-10)]);
});
test('Cantidades inválidas/sobrantes/reducciones bloquean todo el lote',()=>{
 for(const quantity of [-1,NaN,Infinity,6]){const p=reviewPartialReceipt([line(5)],[line(quantity)]);assert.equal(p.state,'invalid');assert.deepEqual(p.batch,[]);assert.deepEqual(p.remainder,[]);}
 assert.equal(reviewPartialReceipt([line(5)],[line(1)],[line(2)]).state,'invalid');
 assert.equal(reviewPartialReceipt([line(5)],[line(5)],[line(6)]).state,'invalid');
 assert.equal(reviewPartialReceipt([],[]).state,'invalid');
});
test('Mismo producto con ruta/UoM/vínculo distinto no oculta diferencias',()=>{
 for(const overrides of [{destinationId:99},{sourceId:7},{uomId:2},{saleLineId:9},{toRefund:true},{sku:'ALIAS'},{productId:22}]){
  assert.equal(reviewPartialReceipt([line(5)],[line(2,overrides)]).state,'invalid');
  assert.equal(reviewPartialReceipt([line(5)],[line(2)],[line(1,overrides)]).state,'invalid');
 }
});
test('IDs/ruta y referencias incoherentes no producen un plan ejecutable',()=>{
 for(const overrides of [{productId:0},{uomId:1.5},{sourceId:5},{sku:''},{saleLineId:-1}])assert.equal(reviewPartialReceipt([line(5,overrides)],[]).state,'invalid');
 assert.equal(reviewPartialReceipt([line(2),line(3,{sku:'ALIAS'})],[]).state,'invalid');
});
test('La revisión no modifica entradas ni su auditoría',()=>{
 const expected=[line(5)],received=[line(2)],posted=[line(1)];const before=JSON.stringify({expected,received,posted});
 const result=reviewPartialReceipt(expected,received,posted);result.batch[0].quantity=99;assert.equal(JSON.stringify({expected,received,posted}),before);
});
console.log(`${count} pruebas de revisión parcial; cero red y escrituras Odoo.`);
