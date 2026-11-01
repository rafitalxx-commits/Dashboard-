import assert from 'node:assert/strict';import {mkdtempSync,existsSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {OdooDemoReader} from '../backend/incidents/odooDemo.ts';
const dir=mkdtempSync(join(tmpdir(),'demo-isolation-'));const servers=[{id:1,smtp_host:'external.example.test',smtp_port:587}];let writes=0,concurrent=0,maxConcurrent=0,automation=false,failTask=false,failReads=0,failStockWrite=false,stockAttempts=0;
const env={INCIDENTS_ODOO_URL:'https://demo-todoelectrico.odoo.rgbconsulting.com',INCIDENTS_ODOO_DATABASE:'odoo-todoelectrico18-demo-01',INCIDENTS_ODOO_USERNAME:'fake',INCIDENTS_ODOO_API_KEY:'fake',INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_DEMO_WORKFLOW_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true',DASHBOARD_DATA_DIR:dir};
const reader=new OdooDemoReader(env,async(_url,init)=>{const {params}=JSON.parse(String(init?.body));let result:any;if(params.service==='common')result=8;else{const [, , ,model,method,args]=params.args;
 if(method==='search_read'&&failReads>0){failReads--;throw Error('Transient read outage');}
 if(model==='stock.picking'&&method==='action_confirm'){stockAttempts++;if(failStockWrite)throw Error('Uncertain write response');}
 if(method==='write'){writes++;if(model==='ir.mail_server')Object.assign(servers[0],args[1]);result=true;}
 else if(model==='res.company')result=[{id:1,stock_move_email_validation:false,stock_move_sms_validation:false}];
 else if(model==='ir.mail_server')result=structuredClone(servers);
 else if(model==='base.automation')result=automation?[{id:1,model_id:[1,'stock.picking']}]:[];
 else if(model==='ir.model')result=[{id:1,model:'stock.picking'}];
 else if(model==='ir.cron'||model==='stock.picking'||model==='mail.mail')result=[];
 else throw Error(model);
 }return new Response(JSON.stringify({result}),{status:200,headers:{'Content-Type':'application/json'}});});
const task=async()=>{concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);assert.equal(servers[0].smtp_host,'127.0.0.1');try{if(failTask)throw Error('QA failure');await reader.controlledWrite('stock.picking','action_confirm',[[1]]);await new Promise(r=>setTimeout(r,5));return 'OK';}finally{concurrent--;}};
try{
 await assert.rejects(reader.controlledWrite('stock.picking','action_confirm',[[1]]),/aislamiento/);
 const scopes=['INC-2026-99992:reshipment','INC-2026-99993:reshipment'];assert.deepEqual(await Promise.all(scopes.map(scope=>reader.isolated(scope,task))),['OK','OK']);assert.equal(maxConcurrent,1);assert.equal(servers[0].smtp_host,'external.example.test');assert.equal(servers[0].smtp_port,587);assert(!existsSync(join(dir,'incidents-smtp-isolation-pending.json')));
 failTask=true;await assert.rejects(reader.isolated(scopes[0],task),/QA failure/);assert.equal(servers[0].smtp_host,'external.example.test');assert(!existsSync(join(dir,'incidents-smtp-isolation-pending.json')));
 automation=true;const prior=writes;await assert.rejects(reader.isolated(scopes[0],task),/externos/);assert.equal(writes,prior);
 automation=false;failTask=false;
 const pending=join(dir,'incidents-smtp-isolation-pending.json');const snapshot={scope:scopes[0],servers:[{id:1,smtp_host:'external.example.test',smtp_port:587}],startedAt:new Date(Date.now()-120000).toISOString()};
 servers[0].smtp_host='127.0.0.1';servers[0].smtp_port=9;writeFileSync(pending,JSON.stringify(snapshot));assert.equal(await reader.isolated(scopes[1],task),'OK');assert.equal(servers[0].smtp_host,'external.example.test');assert(!existsSync(pending));
 servers[0].smtp_host='changed-by-human.example.test';writeFileSync(pending,JSON.stringify(snapshot));const conflictWrites=writes;await assert.rejects(reader.isolated(scopes[1],task),/cambió/);assert.equal(writes,conflictWrites);assert(existsSync(pending));unlinkSync(pending);
 servers[0].smtp_host='external.example.test';writeFileSync(pending,JSON.stringify({...snapshot,startedAt:new Date().toISOString()}));await assert.rejects(reader.isolated(scopes[1],task),/curso/);assert.equal(writes,conflictWrites);unlinkSync(pending);
 failReads=2;assert.equal(await reader.isolated(scopes[0],task),'OK');assert.equal(failReads,0);
 failStockWrite=true;const attempts=stockAttempts;await assert.rejects(reader.isolated(scopes[0],task),/No se pudo conectar/);assert.equal(stockAttempts,attempts+1,'No retry of an uncertain write');assert(!existsSync(pending));
 console.log('PASS DEMO isolation: no unguarded write, serialized scopes, exact SMTP restore on success/failure, active automation fail-closed, interrupted recovery, changed SMTP and active isolation preserved');
}finally{rmSync(dir,{recursive:true,force:true});}
