import type {Incident} from './types.ts';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
type Job={attempts?:number;nextAttemptAt?:number;prepareOnly?:boolean;receiptsOnly?:boolean;id:string;actor:string;user:{role:string;permissions:string[]};state:'queued'|'running'|'done'|'blocked'|'failed';message:string;updatedAt:string};
/** Durable IDs only. Stock executor journal owns external idempotence and uncertainty. */
export class IncidentBackgroundQueue{
 private file:string;private running=false;private jobs:Job[];private disposed=false;private timers=new Set<ReturnType<typeof setTimeout>>();
 recoveryError='';
 private schedule(task:()=>void,delay:number){if(this.disposed)return;const timer=setTimeout(()=>{this.timers.delete(timer);if(!this.disposed)task();},delay);timer.unref();this.timers.add(timer);}
 dispose(){this.disposed=true;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();}
 constructor(directory:string,private execute:(job:Job)=>Promise<{state:'done'|'blocked';message:string}>){
  this.file=join(directory,'incidents-background.json');this.jobs=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[];
  if(!Array.isArray(this.jobs))throw Error('Cola de incidencias inválida');
  for(const job of this.jobs)if(job.state==='running'){job.state=job.prepareOnly&&(job.attempts||0)<3?'queued':'blocked';job.message='Proceso interrumpido: conciliar antes de reanudar, sin repetir movimientos';}this.save();
  this.schedule(()=>void this.drain(),1000);
 }
 get(id:string){return [...this.jobs].reverse().find(job=>job.id===id);}
 enqueue(id:string,actor:string,user:Job['user'],receiptsOnly=false,prepareOnly=false){
  const prior=this.get(id);if(prior&&Boolean(prior.prepareOnly)===prepareOnly&&Boolean(prior.receiptsOnly)===receiptsOnly&&['queued','running'].includes(prior.state))return prior;
  const job:Job={id,actor,receiptsOnly,prepareOnly,user:{role:user.role,permissions:[...user.permissions]},state:'queued',message:'Preparación Odoo en segundo plano',updatedAt:new Date().toISOString()};
  this.jobs=this.jobs.filter(j=>j.id!==id||['queued','running'].includes(j.state));this.jobs.push(job);this.save();this.schedule(()=>void this.drain(),0);return job;
 }
 /** Restores the save→enqueue crash window, only for explicit new-record outbox intents.
  * Existing failed/capped jobs and legacy incidents are never silently replayed. */
 async recoverPreparationIntents(load:()=>Promise<Incident[]>,target:string){
  for(const incident of await load()){
   const intent=incident.documentPreparation;
   if(!intent||intent.target!==target||incident.status==='Cerrada'||this.get(incident.id))continue;
   this.enqueue(incident.id,intent.actor,{role:'viewer',permissions:['products']},false,true);
  }
 }
 startIntentRecovery(load:()=>Promise<Incident[]>,target:string){
  const recover=async()=>{try{await this.recoverPreparationIntents(load,target);this.recoveryError='';}catch(error){this.recoveryError=`Recuperación de documentos pendiente: ${(error as Error).message}`;this.schedule(()=>void recover(),65000);}};
  this.schedule(()=>void recover(),1000);
 }
 private save(){mkdirSync(join(this.file,'..'),{recursive:true});const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.jobs,null,2),{mode:0o600,flush:true});renameSync(temp,this.file);}
 private async drain(){if(this.running||this.disposed)return;this.running=true;try{
  for(const job of this.jobs.filter(j=>j.state==='queued'&&(!j.nextAttemptAt||j.nextAttemptAt<=Date.now()))){
   if(this.disposed)break;
   job.state='running';job.attempts=(job.attempts||0)+1;delete job.nextAttemptAt;job.updatedAt=new Date().toISOString();this.save();
   try{Object.assign(job,await this.execute(job));}catch(e){job.state='failed';job.message=(e as Error).message;if(job.prepareOnly&&(job.attempts||0)<3&&((e as {retryableDocumentPreparation?:boolean}).retryableDocumentPreparation||/No se pudo conectar|HTTP 50[234]|Google API 50[234]|fetch failed|timeout|temporalmente no disponible/i.test(job.message))&&!/inciert|no repetir/i.test(job.message)){job.state='queued';job.nextAttemptAt=Date.now()+65000;job.message+=' · reintento automático de preparación pendiente (conciliación antes de crear)';}}
   job.updatedAt=new Date().toISOString();this.save();
  }
 }finally{this.running=false;const pending=this.jobs.filter(j=>j.state==='queued');if(pending.length)this.schedule(()=>void this.drain(),Math.max(0,Math.min(...pending.map(j=>j.nextAttemptAt||Date.now()))-Date.now()));}}
}
