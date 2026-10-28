import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {IncidentOdooStock,ControlledStockExecutor,StockJournal,TEST_TARGET,type OdooCall,type StockLine} from '../backend/incidents/odooStock.ts';
import {buildIncident,applyAction} from '../backend/incidents/workflow.ts';
import {IncidentService} from '../backend/incidents/service.ts';
import {MemoryRepository} from '../backend/incidents/repository.ts';
const root='INC-2026-00990:return:DEV-2026-00990';
const line=(id:number,q:number):StockLine=>({productId:id,sku:id===10?'A':'B',uomId:1,quantity:q,sourceId:6,destinationId:5});
let tests=0;
async function test(name:string,task:()=>Promise<void>){await task();console.log(`OK ${++tests} ${name}`);}
function fixture(two=false){
 const folder=mkdtempSync(join(tmpdir(),'receipt-batch-'));
 const products=[{productId:10,sku:'A',name:'A',orderedQuantity:5,affectedQuantity:5},...(two?[{productId:11,sku:'B',name:'B',orderedQuantity:3,affectedQuantity:3}]:[])];
 let incident=buildIncident({requestId:'receipt-batch-test',origin:'customer',type:'withdrawal',solution:'withdraw_refund',reason:'QA',context:{source:'odoo',order:{odooReference:'S-TEST',customerName:'Ficticio',channel:'LAB'},products},products},'INC-2026-00990','DEV-2026-00990','QA');
 const expected=[line(10,5),...(two?[line(11,3)]:[])];
 const picking=(id:number,parent=0)=>({id,name:`WH/RET/${id}`,origin:root,state:'confirmed',company_id:[1,'LAB'],partner_id:[2,'QA'],sale_id:false,picking_type_id:[8,'Returns'],backorder_id:parent?[parent,'Parent']:false,location_id:[6,'Customer'],location_dest_id:[5,'Stock']});
 const picks=[picking(80)];
 const move=(l:StockLine,pick=80)=>({id:pick*100+l.productId,picking_id:[pick,'DEV'],product_id:[l.productId,l.sku],product_uom:[1,'Uds'],product_uom_qty:l.quantity,quantity:0,picked:false,sale_line_id:false,to_refund:false,location_id:[6,'Customer'],location_dest_id:[5,'Stock'],state:'confirmed'});
 let moves=expected.map(l=>move(l));let writes=0,validations=0,crash='',policy='ask',foreignWizard=false,wrongParent=false,badUom=false;
 incident.odooOperations=[{key:root,digest:'prepared',kind:'return',returnId:incident.returns[0].id,pickingId:80,status:'awaiting_arrival',lines:expected,target:TEST_TARGET,confirmedAt:new Date().toISOString()}];
 const repo=new MemoryRepository();repo.items=[incident];let service=new IncidentService(repo);
 let journal=new StockJournal(folder);
 journal.put({key:root,digest:'prepared',state:'prepared',pickingId:80,actor:'QA',updatedAt:new Date().toISOString()});
 const read:OdooCall=async(model,method,args,kw)=>{
  const domain=args[0] as any[];const filter=(name:string)=>domain.find(x=>Array.isArray(x)&&x[0]===name)?.[2];
  if(model==='uom.uom')return [{id:1,rounding:1}];
  if(model==='sale.order')return [{id:20,name:'S-TEST',company_id:[1,'LAB'],partner_shipping_id:[2,'QA'],warehouse_id:[3,'WH']}];
  if(model==='sale.order.line')return products.map(l=>({id:l.productId+100,product_id:[l.productId,l.sku],product_uom:[1,'Uds'],product_uom_qty:l.orderedQuantity}));
  if(model==='product.product')return products.filter(p=>method==='read'?(args[0] as number[]).includes(p.productId):p.sku===filter('default_code')).map(p=>({id:p.productId,default_code:p.sku,tracking:'none',is_storable:true,uom_id:[1,'Uds'],company_id:false}));
  if(model==='stock.picking'){
   if(method==='read')return picks.filter(p=>(args[0] as number[]).includes(p.id)).map(p=>({...p,backorder_id:wrongParent?[999,'Wrong']:p.backorder_id}));
   if(filter('backorder_id')!==undefined)return picks.filter(p=>p.backorder_id&&p.backorder_id[0]===filter('backorder_id'));
   if(filter('origin')!==undefined)return picks.filter(p=>p.origin===filter('origin'));
   if(domain.some(x=>x[0]==='state'&&x[1]==='not in'))return [];
   return [{id:30,origin:'S-TEST',state:'done',company_id:[1,'LAB'],location_id:[5,'Stock'],location_dest_id:[6,'Customer'],picking_type_id:[9,'OUT']}];
  }
  if(model==='stock.move'){
   if(domain.some(x=>x[0]==='picking_id'&&x[1]==='in'))return expected.map(l=>({...move(l,30),quantity:l.quantity,state:'done',location_id:[5,'Stock'],location_dest_id:[6,'Customer']}));
   if(filter('picking_id')!==undefined)return moves.filter(m=>m.picking_id[0]===filter('picking_id')&&m.state!=='cancel').map(m=>({...m,product_uom:badUom?[99,'Wrong']:m.product_uom}));
   return [];
  }
  if(model==='stock.picking.type')return Number((args[0] as number[])[0])===9?[{id:9,return_picking_type_id:[8,'Returns'],company_id:[1,'LAB']}]:[{id:8,code:'incoming',company_id:[1,'LAB'],create_backorder:policy}];
  if(model==='stock.location')return (args[0] as number[]).map(id=>({id,usage:id===5?'internal':'customer',company_id:id===5?[1,'LAB']:false}));
  if(model==='stock.backorder.confirmation')return [{id:90,pick_ids:[currentPicking],backorder_confirmation_line_ids:[91]}];
  if(model==='stock.backorder.confirmation.line')return [{picking_id:[currentPicking,'DEV'],to_backorder:backorderDecision}];
  throw Error(`Unexpected ${model}.${method}`);
 };
 let currentPicking=80,backorderDecision=true;
 const finish=()=>{
  const pending=moves.filter(m=>m.picking_id[0]===currentPicking);const remainder=pending.filter(m=>m.product_uom_qty>m.quantity);
  const child=80+picks.length;
  if(remainder.length&&backorderDecision){picks.push(picking(child,currentPicking));moves.push(...remainder.map(m=>({...m,id:child*100+m.product_id[0],picking_id:[child,'DEV'],product_uom_qty:m.product_uom_qty-m.quantity,quantity:0,picked:false})));}
  for(const m of pending){if(!m.quantity)m.state='cancel';else{m.product_uom_qty=m.quantity;m.state='done';}}
  picks.find(p=>p.id===currentPicking)!.state='done';
  if(crash==='after')throw Error('timeout after commit');return true;
 };
 const write:OdooCall=async(model,method,args)=>{writes++;
  if(model==='stock.move'){if(crash==='before')throw Error('timeout before commit');Object.assign(moves.find(m=>m.id===(args[0] as number[])[0])!,args[1]);return true;}
  if(model==='stock.picking'&&method==='button_validate'){validations++;currentPicking=(args[0] as number[])[0];if(moves.some(m=>m.picking_id[0]===currentPicking&&m.quantity<m.product_uom_qty))return {type:'ir.actions.act_window',res_model:foreignWizard?'some.other.wizard':'stock.backorder.confirmation',context:{button_validate_picking_ids:[currentPicking]}};return finish();}
  if(model==='stock.backorder.confirmation'&&method==='create'){backorderDecision=Boolean((args[0] as any).backorder_confirmation_line_ids[0][2].to_backorder);return 90;}
  if(model==='stock.backorder.confirmation'&&method==='process')return finish();
  throw Error(`Unexpected WRITE ${model}.${method}`);
 };
 const stock=new IncidentOdooStock(read,TEST_TARGET);
 const env={INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_DEMO_WORKFLOW_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true'};
 let executor=new ControlledStockExecutor(read,write,journal,env);
 const arrive=async(a:number,b=0,condition:'perfect'|'incomplete'='perfect')=>{const i=(await repo.list())[0];if(condition==='incomplete')repo.items[0].evidence=[{id:'qa-photo',name:'QA.jpg',url:'https://lab.invalid/qa.jpg',mimeType:'image/jpeg',returnId:i.returns[0].id}];return service.action(i.id,i.revision,{kind:'return',id:i.returns[0].id,operator:{id:'QA',code:'QA',name:'QA'},condition,destination:'stock',quantities:{A:a,...(two?{B:b}:{})}},'QA');};
 const proposal=async()=>stock.propose((await repo.list())[0]);
 const current=async()=>{const p=await proposal();return {p,op:p.operations.find(op=>op.receiptBatch)!};};
 return {folder,repo,stock,read,write,arrive,proposal,current,picks,get moves(){return moves;},get service(){return service;},get executor(){return executor;},get journal(){return journal;},get writes(){return writes;},get validations(){return validations;},set crash(v:string){crash=v;},set policy(v:string){policy=v;},set foreignWizard(v:boolean){foreignWizard=v;},set wrongParent(v:boolean){wrongParent=v;},set badUom(v:boolean){badUom=v;},restart(){writeFileSync(join(folder,'repo.json'),JSON.stringify(repo.items));repo.items=JSON.parse(readFileSync(join(folder,'repo.json'),'utf8'));service=new IncidentService(repo);journal=new StockJournal(folder);executor=new ControlledStockExecutor(read,write,journal,env);}};
}
await test('Dos llegadas 2+3, resto enlazado por ID y auditoría persistente sin duplicados',async()=>{
 const f=fixture();await f.arrive(2);let {p,op}=await f.current();assert.deepEqual(op.blockers,[]);assert.equal(op.lines[0].quantity,2);
 let result=await f.executor.execute(p,op.key,'QA');assert.equal(result.backorder?.lines[0].quantity,3);const firstKey=op.key;
 let i=await f.service.confirmOdoo(p.incidentId,p.revision,result,p.operations.map(o=>o.key),'QA');assert(!i.stockRegularized);assert.equal(i.returns[0].state,'arrived');assert.equal(i.returns[0].odooReceiptId,81);assert.equal(i.odooOperations?.length,3);
 f.restart();let saved=(await f.repo.list())[0];const count=f.writes;let reconciled=await f.executor.reconcile(p,firstKey);saved=await f.service.confirmOdoo(saved.id,saved.revision,reconciled,[],'QA');assert.equal(saved.revision,i.revision);assert.equal(f.writes,count);
 await f.arrive(5);({p,op}=await f.current());assert.equal(op.lines[0].quantity,3);assert.equal(op.receiptReview?.rows[0].posted,2);assert.equal(op.receiptReview?.rows[0].expected,5);
 result=await f.executor.execute(p,op.key,'QA');assert(!result.backorder);i=await f.service.confirmOdoo(i.id,p.revision,result,p.operations.map(o=>o.key),'QA');assert(i.stockRegularized);assert.equal(i.returns[0].odooReceiptId,81);assert.equal(i.odooOperations?.filter(o=>o.status==='done').flatMap(o=>o.lines||[]).reduce((n,l)=>n+l.quantity,0),5);assert.equal(f.validations,2);
 f.restart();const revision=i.revision;const writes=f.writes;result=await f.executor.execute(p,op.key,'QA');i=await f.service.confirmOdoo(i.id,revision,result,[],'QA');assert.equal(i.revision,revision);assert.equal(f.writes,writes);const first=await f.executor.reconcile(p,firstKey);assert.equal(first.pickingId,80);assert.equal(first.backorder?.pickingId,81);assert.equal(f.writes,writes);
});
await test('Línea no recibida queda a cero y se conserva entera en backorder',async()=>{const f=fixture(true);await f.arrive(2,0);const {p,op}=await f.current();const r=await f.executor.execute(p,op.key,'QA');assert.deepEqual(r.backorder?.lines.map(l=>[l.sku,l.quantity]),[['A',3],['B',3]]);assert(f.moves.find(m=>m.picking_id[0]===80&&m.product_id[0]===11)?.quantity===0);});
await test('Cancelada bloqueada antes de escritura',async()=>{const f=fixture();await f.arrive(2);f.repo.items[0].returns[0].state='cancelled';const {p,op}=await f.current();await assert.rejects(f.executor.execute(p,op.key,'QA'),/bloqueos/);assert.equal(f.writes,0);});
await test('Timeout antes del primer write bloquea replay tras reinicio',async()=>{const f=fixture();await f.arrive(2);const {p,op}=await f.current();f.crash='before';await assert.rejects(f.executor.execute(p,op.key,'QA'),/incierta/);const n=f.writes;f.restart();f.crash='';await assert.rejects(f.executor.execute(p,op.key,'QA'),/no coincide/);assert.equal(f.writes,n);});
await test('Timeout después de validar recupera solo lecturas y conserva el backorder',async()=>{const f=fixture();await f.arrive(2);const {p,op}=await f.current();f.crash='after';await assert.rejects(f.executor.execute(p,op.key,'QA'),/incierta/);f.restart();const writes=f.writes;const r=await f.executor.execute(p,op.key,'QA');assert.equal(r.backorder?.pickingId,81);assert.equal(f.writes,writes);assert.equal(f.validations,1);});
await test('Fallo Sheets tras commit recupera lote y pendiente sin reescribir Odoo',async()=>{const f=fixture();await f.arrive(2);const {p,op}=await f.current();const r=await f.executor.execute(p,op.key,'QA');const save=f.repo.save.bind(f.repo);f.repo.save=async()=>{throw Error('Sheets failure');};await assert.rejects(f.service.confirmOdoo(p.incidentId,p.revision,r,p.operations.map(o=>o.key),'QA'),/Sheets/);f.repo.save=save;f.restart();const writes=f.writes;const recovered=await f.executor.reconcile(p,op.key);const i=await f.service.confirmOdoo(p.incidentId,p.revision,recovered,p.operations.map(o=>o.key),'QA');assert.equal(i.odooOperations?.length,3);assert(!i.stockRegularized);assert.equal(f.writes,writes);});
await test('Política never, UoM cambiada y padre ajeno nunca escriben cantidades',async()=>{for(const bad of ['policy','badUom','wrongParent']){const f=fixture();await f.arrive(2);const {p,op}=await f.current();if(bad==='policy')f.policy='never';if(bad==='badUom')f.badUom=true;if(bad==='wrongParent')f.wrongParent=true;await assert.rejects(f.executor.execute(p,op.key,'QA'),/incierta/);assert.equal(f.writes,0);}});
await test('Asistente ajeno jamás se procesa',async()=>{const f=fixture();await f.arrive(2);const {p,op}=await f.current();f.foreignWizard=true;await assert.rejects(f.executor.execute(p,op.key,'QA'),/incierta/);assert.equal(f.writes,2);assert.equal(f.picks.length,1);});
await test('Reducir conteo ya contabilizado bloquea siguiente llegada',async()=>{const f=fixture();await f.arrive(2);let {p,op}=await f.current();const result=await f.executor.execute(p,op.key,'QA');await f.service.confirmOdoo(p.incidentId,p.revision,result,p.operations.map(o=>o.key),'QA');await f.arrive(1);p=await f.proposal();assert(p.operations.some(o=>o.blockers.some(b=>b.includes('inferior'))));});
await test('Tres llegadas: conciliar lote antiguo conserva el último albarán, sin nueva revisión',async()=>{
 const f=fixture();let firstProposal:any,firstKey='';
 for(const count of [2,4,5]){await f.arrive(count);const {p,op}=await f.current();if(count===2){firstProposal=p;firstKey=op.key;}const result=await f.executor.execute(p,op.key,'QA');await f.service.confirmOdoo(p.incidentId,p.revision,result,p.operations.map(o=>o.key),'QA');}
 f.restart();const before=(await f.repo.list())[0];const writes=f.writes;const result=await f.executor.reconcile(firstProposal,firstKey);const p=await f.proposal();const after=await f.service.confirmOdoo(before.id,before.revision,result,p.operations.map(o=>o.key),'QA');assert.equal(after.returns[0].odooReceiptId,82);assert.equal(after.revision,before.revision);assert.equal(f.writes,writes);
});
await test('Fracción incompatible con redondeo UoM no escribe ni redondea unidades hacia arriba',async()=>{const f=fixture();await f.arrive(0.5);const {p,op}=await f.current();await assert.rejects(f.executor.execute(p,op.key,'QA'),/incierta/);assert.equal(f.writes,0);});
await test('Recepción completa sigue permitida con política never, sin resto que cancelar',async()=>{const f=fixture();await f.arrive(5);f.policy='never';const {p,op}=await f.current();const result=await f.executor.execute(p,op.key,'QA');assert.equal(result.status,'done');assert(!result.backorder);assert.equal(f.validations,1);});
await test('Producto incompleto: recibe lo contado y cancela el resto, sin dejar backorder',async()=>{const f=fixture();await f.arrive(2,0,'incomplete');const {p,op}=await f.current();assert.equal(op.discardRemainder,true);const result=await f.executor.execute(p,op.key,'QA');assert.equal(result.status,'done');assert.deepEqual(result.discardedRemainder?.map(l=>[l.sku,l.quantity]),[['A',3]]);assert(!result.backorder);assert.equal(f.picks.length,1);const saved=await f.service.confirmOdoo(p.incidentId,p.revision,result,p.operations.map(o=>o.key),'QA');assert.match(saved.timeline.at(-1)?.summary||'',/faltante cancelado/);assert.equal(saved.returns[0].state,'arrived');const completed=await f.service.completeReturnAfterOdoo(saved.id,saved.returns[0].id,'QA');assert.equal(completed.returns[0].state,'processed');assert.equal(completed.returns[0].products[0].receivedQuantity,2);assert.equal(completed.odooOperations?.some(o=>o.status==='awaiting_arrival'&&!o.receiptConsumedBy),false);});


await test('Preflight automático: pendiente exacto llega a validación, solo después se concilia done',async()=>{
 const f=fixture();await f.arrive(5);const {p,op}=await f.current();
 assert.equal(await f.executor.reconcileExisting(p,op.key),null);assert.equal(f.writes,0);
 const result=await f.executor.execute(p,op.key,'QA');assert.equal(result.status,'done');
 await f.service.confirmOdoo(p.incidentId,p.revision,result,p.operations.map(o=>o.key),'QA');const i=await f.service.completeReturnAfterOdoo(p.incidentId,op.returnId!,'QA');assert.equal(i.returns[0].state,'processed');
 f.restart();const count=f.writes;const recovered=await f.executor.reconcileExisting(p,op.key);assert.equal(recovered?.status,'done');assert.equal(f.writes,count);assert.equal(f.validations,1);
});
await test('Preflight bloquea identidad, padre, ruta y líneas distintas sin escribir',async()=>{
 for(const field of ['origin','partner_id','location_id','state','backorder_id','quantity']){
  const f=fixture();await f.arrive(5);const {p,op}=await f.current();
  if(field==='quantity')f.moves[0].product_uom_qty=999;
  else Object.assign(f.picks[0],{[field]:field==='state'?'cancel':field==='origin'?'FOREIGN':[999,'Foreign']});
  await assert.rejects(f.executor.reconcileExisting(p,op.key));assert.equal(f.writes,0);
 }
});
await test('Preflight no valida incertidumbre ni siquiera con otro digest/cantidad',async()=>{
 const f=fixture();await f.arrive(5);const {p,op}=await f.current();
 f.journal.put({key:op.key+':old',digest:'old',state:'uncertain',pickingId:80,actor:'QA',updatedAt:new Date().toISOString(),operation:op});
 await assert.rejects(f.executor.reconcileExisting(p,op.key),/incierta/);assert.equal(f.writes,0);
});

await test('Preflight recupera entrada done aun sin diario del lote, solo lecturas',async()=>{
 const f=fixture();await f.arrive(5);const {p,op}=await f.current();await f.executor.execute(p,op.key,'QA');const writes=f.writes;
 const recovered=new ControlledStockExecutor(f.read,async()=>{throw Error('REPLAY FORBIDDEN');},new StockJournal(mkdtempSync(join(tmpdir(),'receipt-empty-journal-'))),{INCIDENTS_ODOO_MODE:'test'});
 assert.equal((await recovered.reconcileExisting(p,op.key))?.status,'done');assert.equal(f.writes,writes);
});
console.log(`${tests} escenarios de lotes/backorder: sin llamadas externas`);
