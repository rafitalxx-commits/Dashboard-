import assert from 'node:assert/strict';
import { GoogleApi,SheetsRepository,SHEETS,HEADERS } from '../backend/incidents/repository.ts';
import { IncidentService } from '../backend/incidents/service.ts';
import type { WizardDraft } from '../backend/incidents/types.ts';
class FakeSheets extends GoogleApi{
 grids=new Map(SHEETS.map((s,n)=>[n,[HEADERS]]));calls=0;fail=false;
 configured(){return true;}
 async request(url:string,init:any={}){this.calls++;if(url.includes('?fields=sheets.properties'))return {sheets:SHEETS.map((s,n)=>({properties:{title:s,sheetId:n}}))};if(url.includes('values:batchGet'))return {valueRanges:SHEETS.map((s,n)=>({values:structuredClone(this.grids.get(n))}))};if(url.endsWith(':batchUpdate')){if(this.fail)throw Error('Resultado incierto de escritura');const data=JSON.parse(init.body);const copy=structuredClone(this.grids);for(const r of data.requests){if(r.appendDimension)continue;const {start,rows}=r.updateCells;const grid=copy.get(start.sheetId)!;grid[start.rowIndex]=rows[0].values.map((c:any)=>c.userEnteredValue.stringValue??c.userEnteredValue.numberValue??c.userEnteredValue.boolValue);}this.grids=copy;return {replies:[]};}throw Error('Unexpected URL '+url);}
}
const fake=new FakeSheets({});const env={INCIDENTS_SPREADSHEET_ID:'TEST',INCIDENTS_SHEETS_WRITE_ENABLED:'true'};let repo=new SheetsRepository(env,fake);let service=new IncidentService(repo);
const d:WizardDraft={requestId:crypto.randomUUID(),context:{source:'demo',order:{odooReference:'TEST',channel:'Website',customerName:'Ficticio'},products:[{sku:'A',name:'A',orderedQuantity:1,affectedQuantity:1,unitCostSnapshot:1}]},origin:'warehouse',type:'wrong_packaging',scope:'pack_ok',solution:'pack_record',products:[]};
let i=await service.create(d,'Tester');i=await service.action(i.id,i.revision,{kind:'note',text:'Persistencia verificada'},'Tester');
assert.equal(fake.grids.get(0)!.length,2);assert.equal(fake.grids.get(5)!.length,2);assert.equal(fake.grids.get(0)![1][36]!==undefined,true);
repo=new SheetsRepository(env,fake);service=new IncidentService(repo);const loaded=await repo.list();assert.equal(loaded[0].notes[0].text,'Persistencia verificada');assert.equal(loaded[0].revision,2);
const before=fake.calls;await repo.list();await repo.list();assert.equal(fake.calls,before,'TTL evita releer por render');
await assert.rejects(service.action(i.id,1,{kind:'note',text:'Obsoleta'},'Tester'),/Otro usuario/);
const same=await service.create(d,'Tester');assert.equal(same.id,i.id);assert.equal(fake.grids.get(0)!.length,2);
fake.fail=true;await assert.rejects(service.action(i.id,2,{kind:'note',text:'No confirmada'},'Tester'),/incierto/);assert.equal(repo.status().writable,false);fake.fail=false;await repo.list(true);assert.equal(repo.status().writable,true);assert.equal((await repo.list())[0].notes.length,1);
for(let n=0;n<8;n++){const current=(await repo.list())[0];await service.action(current.id,current.revision,{kind:'note',text:'x'.repeat(6000)},'Tester');}
const withHistory=(await new SheetsRepository(env,fake).list())[0];assert.equal(withHistory.notes.length,9);assert(JSON.stringify(withHistory).length>50000);assert(fake.grids.get(0)![1][36].length<10000,'Historia normalizada fuera de celda principal');
const latest=(await repo.list(true))[0];
await service.action(latest.id,latest.revision,{kind:'note',text:'=1+1'},'Tester');
assert.equal((await new SheetsRepository(env,fake).list())[0].notes.at(-1)!.text,'=1+1','Texto libre literal, nunca fórmula');
// Optional physical confirmation and sync errors survive a new repository and legacy records.
const receiptDraft:WizardDraft={...d,requestId:crypto.randomUUID(),origin:'customer',type:'withdrawal',reason:'QA',solution:'withdraw_refund',products:d.context.products};
let receipt=await service.create(receiptDraft,'QA');receipt=await service.action(receipt.id,receipt.revision,{kind:'return',id:receipt.returns[0].id,operator:{id:'QA',code:'OPQA',name:'QA'},condition:'perfect',destination:'stock',quantities:{A:1}},'QA');
await service.recordReceiptSyncFailure(receipt.id,'Odoo temporalmente no disponible');
const reloaded=(await new SheetsRepository(env,fake).list(true)).find(x=>x.id===receipt.id)!;assert(reloaded.returns[0].warehouseConfirmedAt);assert.match(reloaded.returns[0].odooSyncError!,/temporalmente/);assert.equal(reloaded.processes.find(p=>p.kind==='reception')!.state,'resolved');assert.equal(reloaded.stockRegularized,false);
assert((await new SheetsRepository(env,fake).list(true)).some(x=>x.id===i.id&&!x.returns.length));
// Entered zero cost preserves optional audit fields through a completely new Sheets reader.
const forCost=(await repo.list(true)).find(x=>x.id===i.id)!;
const withCost=await service.action(forCost.id,forCost.revision,{kind:'cost',description:'Cero explícito QA',category:'other',amount:0,state:'confirmed'},'Cost recorder QA');
const persistedCost=(await new SheetsRepository(env,fake).list(true)).find(x=>x.id===i.id)!.costs.at(-1)!;
assert.equal(persistedCost.amount,0);assert(persistedCost.recordedAt);assert.equal(persistedCost.recordedBy,'Cost recorder QA');assert.equal(persistedCost.id,withCost.costs.at(-1)!.id);
const writesBefore=fake.calls;
fake.grids.get(5)![0]=['cabecera incompatible'];
await assert.rejects(new SheetsRepository(env,fake).list(true),/Cabeceras incompatibles en Notas/);
assert.equal(fake.calls,writesBefore+2,'Cabecera auxiliar incompatible solo permite lecturas');
console.log('PASS Sheets simulado: misma fila, notas + timeline, persistencia, TTL, idempotencia, conflicto, fallo incierto/reconciliación, texto literal y validación de cabeceras auxiliares. Sin APIs Google reales.');
