import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {IncidentSubmissions} from '../backend/incidents/submissions.ts';
const wait=async(test:()=>boolean)=>{for(let n=0;n<100;n++){if(test())return;await new Promise(r=>setTimeout(r,10));}throw Error('Queue did not settle');};
const dir=mkdtempSync(join(tmpdir(),'incident-submissions-'));const user={role:'viewer',permissions:['products']};
const draft:any={requestId:'submission-test-001',context:{order:{odooReference:'QA-S'}},products:[]};
let release!:()=>void,calls=0,target='demo';const gate=new Promise<void>(r=>release=r);
let queue=new IncidentSubmissions(dir,()=>target,async()=>{calls++;await gate;return {id:'INC-QA'};});
try{
 assert.throws(()=>queue.accept({...draft,requestId:undefined},'operator','owner',user),/inválida/);
 const accepted=queue.accept(draft,'operator','owner',user);assert.equal(accepted.state,'queued');assert.equal(calls,0);assert.equal(statSync(join(dir,'incidents-submissions.json')).mode&0o777,0o600);assert(!('draft' in accepted));assert.equal(queue.list('other').length,0);
 queue.accept(draft,'operator','owner',user);assert.equal(queue.list('owner').length,1);assert.throws(()=>queue.accept({...draft,products:[1]},'operator','owner',user),/otros datos/);assert.throws(()=>queue.accept(draft,'operator','other',user),/otros datos/);
 await wait(()=>queue.list('owner')[0].state==='running');assert.equal(calls,1);release();await wait(()=>queue.list('owner')[0].state==='saved');queue.dispose();
 queue=new IncidentSubmissions(dir,()=>target,async()=>{throw Error('Saved job must never replay');});await new Promise(r=>setTimeout(r,20));assert.equal(queue.list('owner')[0].incidentId,'INC-QA');queue.dispose();
 // Persisted-before-enqueue/restart and in-flight restart use the same saved request identity.
 let n=0;for(const state of ['queued','running']){const rows=JSON.parse(readFileSync(join(dir,'incidents-submissions.json'),'utf8'));rows[0].state=state;writeFileSync(join(dir,'incidents-submissions.json'),JSON.stringify(rows));queue=new IncidentSubmissions(dir,()=>target,async d=>{assert.equal(d.requestId,draft.requestId);n++;return {id:'INC-QA'};});await wait(()=>queue.list('owner')[0].state==='saved');queue.dispose();}assert.equal(n,2);
 // Changed target blocks before executor; no cross-environment replay.
 const rows=JSON.parse(readFileSync(join(dir,'incidents-submissions.json'),'utf8'));rows[0].state='queued';writeFileSync(join(dir,'incidents-submissions.json'),JSON.stringify(rows));target='production';queue=new IncidentSubmissions(dir,()=>target,async()=>{throw Error('MUST NOT EXECUTE');});await wait(()=>JSON.parse(readFileSync(join(dir,'incidents-submissions.json'),'utf8'))[0].state==='failed');assert.equal(queue.list('owner').length,0);queue.dispose();
 target='demo';let attempts=0;queue=new IncidentSubmissions(dir,()=>target,async()=>{attempts++;if(attempts===1)throw Error('transient');return {id:'INC-QA'};});await new Promise(r=>setTimeout(r,20));assert.equal(attempts,0);queue.retry(draft.requestId,'owner');await wait(()=>queue.list('owner')[0].state==='failed');assert.equal(attempts,1);queue.retry(draft.requestId,'owner');await wait(()=>queue.list('owner')[0].state==='saved');assert.equal(attempts,2);
 console.log('PASS durable submissions: immediate local ack, disk permissions, double submit, owner/payload protection, saved/queued/running restarts, target isolation, explicit failure recovery. Zero external RPCs.');
}finally{release();queue.dispose();}
