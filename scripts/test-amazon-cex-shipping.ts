import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildConfirmShipmentRequest, createAmazonSpApiClient } from "../backend/amazonSpApi/client.ts";
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const source=readFileSync(new URL('../src/modules/expeditions/ExpeditionsView.tsx',import.meta.url),'utf8');
const definition=source.match(/function amazonShippingMethod\(carrier: string, carrierStatus\?: string\) \{[\s\S]*?\n\}/)![0];
const methods=[vm.runInNewContext(`(${definition.replaceAll(': string','').replace('carrierStatus?','carrierStatus')})`,{shippingServiceLabel:(s:string)=>`label:${s}`})];
if(process.argv[2]){
 const js=readFileSync(process.argv[2],'utf8');
 assert.equal((js.match(/shippingMethod:Kj\(/g)||[]).length,2);
 methods.push(vm.runInNewContext(`(${js.match(/function Kj\(t,s\)\{[^{}]+\}/)![0]})`,{pm:(s:string)=>`label:${s}`}));
}
const config={endpoint:'https://example.invalid',marketplaceId:'TEST'};
const base={pickingId:1,saleOrderId:1,saleOrderName:'TEST',amazonOrderId:'111-1111111-1111111',tracking:'TEST-UNCHANGED',carrier:'Correos Express',carrierCode:'Correos Express',shippingMethod:'',shipmentDate:'2026-11-10T00:00:00Z',marketplaceId:'TEST',packageReferenceId:'1',orderItems:[{orderItemId:'TEST',quantity:1}]};
let cases=0;
for(const method of methods){
 for(const [status,expected] of [['cex-paq-24','Paq24'],['cex-baleares-express','Bareares Exp'],['cex-paq-14','label:cex-paq-14'],['cex-canarias-express','label:cex-canarias-express']]){
  const draft={...base,shippingMethod:method('Correos Express',status)};
  const p=buildConfirmShipmentRequest(config,draft).body.packageDetail;
  assert.equal(p.carrierCode,'Correos Express');assert.equal(p.carrierName,'Correos Express');assert.equal(p.shippingMethod,expected);assert.equal(p.trackingNumber,base.tracking);
  const dry=await createAmazonSpApiClient({MARKETPLACE_ID:'TEST'}).confirmShipment(draft,{dryRun:true});assert.equal(dry.dryRun,true);assert.equal(dry.request.body.packageDetail.shippingMethod,expected);cases++;
 }
 assert.equal(method('MRW','mrw-urgent-1900-expedition'),'Urgente 19');cases++;
}
for(const [carrier,shippingMethod,code,expected] of [
 ['Correos Express','Correos Express PAQ 24','Correos Express','Paq24'],
 ['Correos Express','Correos Express Baleares Express','Correos Express','Bareares Exp'],
 ['Correos-Express','cex-paq-24','Correos Express','Paq24'],
 ['Correos','Postal','Correos','Postal'],['MRW','Urgente 19','MRW','Urgente 19'],['DHL','Express','DHL','Express'],['GLS','96','GLS','96'],
]){
 const p=buildConfirmShipmentRequest(config,{...base,carrier,carrierCode:carrier,shippingMethod}).body.packageDetail;
 assert.equal(p.carrierCode,code);assert.equal(p.shippingMethod,expected);cases++;
}
console.log(`PASS: ${cases} CEX/MRW/legacy/other-carrier cases; serializer+dry-run; no network or writes`);
