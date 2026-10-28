import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductLocations } from '../backend/products/locations.ts';
import { createExpeditionReplenishment } from '../backend/expeditionReplenishment/service.ts';
const require=createRequire(import.meta.url),fs=require('node:fs');
const dir=mkdtempSync(join(tmpdir(),'replenishment-persistence-')),file=join(dir,'product-locations.json');
const catalog={list:()=>({products:[{id:1,reference:'TEST',name:'Prueba',uom:'uds'}]})};
const engine=createProductLocations({dataDir:dir});
const service=createExpeditionReplenishment(engine,catalog);
try {
 for(const code of ['A101','B202'])engine.saveCatalogEntry({code});
 engine.save({productId:1,code:'A101',quantity:-3,preferred:true});engine.save({productId:1,code:'B202',quantity:8});
 const before=readFileSync(file,'utf8');
 const input={productId:1,fromCode:'B202',toCode:'A101',quantity:4,requestId:'atomic-replenishment-0001'};
 const rename=fs.renameSync;
 try {
  fs.renameSync=(from:string,to:string)=>{if(to===file)throw new Error('simulated persistence failure');return rename(from,to);};syncBuiltinESMExports();
  assert.throws(()=>service.transfer(input),/simulated persistence failure/);
 } finally {fs.renameSync=rename;syncBuiltinESMExports();}
 assert.equal(readFileSync(file,'utf8'),before,'failed replacement cannot truncate or partially replace the original');
 assert.deepEqual(readdirSync(dir),['product-locations.json'],'temporary file cleaned after failure');
 const fresh=createProductLocations({dataDir:dir});const restarted=createExpeditionReplenishment(fresh,catalog);
 restarted.transfer(input);
 const committed=readFileSync(file,'utf8');
 const current=fresh.forProduct(1);
 assert.equal(current.find(x=>x.code==='A101')?.quantity,1);assert.equal(current.find(x=>x.code==='B202')?.quantity,4);
 assert.equal(current.reduce((sum,x)=>sum+x.quantity,0),5,'total preserved');
 createExpeditionReplenishment(createProductLocations({dataDir:dir}),catalog).transfer(input);
 assert.equal(readFileSync(file,'utf8'),committed,'lost-response recovery after process reconstruction does not mutate');
 assert.equal(JSON.parse(committed).changes.filter((x:{reason:string})=>x.reason==='replenishment').length,2,'one debit and one credit audit');
 writeFileSync(file,'{invalid');
 assert.throws(()=>createProductLocations({dataDir:dir}).summary(),/No se pudieron leer/);
 assert.throws(()=>restarted.transfer({...input,requestId:'atomic-replenishment-0002'}),/No se pudieron leer/);
 assert.equal(readFileSync(file,'utf8'),'{invalid','corruption fails closed instead of replacing with empty stock');
 console.log('PASS: atomic failed-write recovery, original bytes protected, no orphan temp file, balances+idempotency persisted together, restart/retry once, total and audit preserved, corrupt data fail closed');
} finally {rmSync(dir,{recursive:true,force:true});}
