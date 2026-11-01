import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {WizardDraft} from './types.ts';
export type Submission={requestId:string;state:'queued'|'running'|'saved'|'failed';message:string;incidentId?:string;orderReference:string;updatedAt:string};
type Stored=Submission&{draft:WizardDraft;actor:string;owner:string;target:string;digest:string;user:{role:string;permissions:string[]}};
/** Accept locally before any RPC. Replay reconciles requestId in Sheets before doing work.
 * Failed requests require an explicit retry; changing target or payload never replays them. */
export class IncidentSubmissions {
 private file:string;private jobs:Stored[];private running=false;private timer?:ReturnType<typeof setTimeout>;private disposed=false;
 constructor(directory:string,private target:()=>string,private execute:(draft:WizardDraft,actor:string,user:Stored['user'])=>Promise<{id:string}>){
  this.file=join(directory,'incidents-submissions.json');this.jobs=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[];
  if(!Array.isArray(this.jobs))throw Error('Solicitudes de incidencias inválidas');
  for(const job of this.jobs)if(job.state==='running')job.state='queued';
  this.save();this.schedule();
 }
 private save(){mkdirSync(join(this.file,'..'),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.jobs),{mode:0o600,flush:true});renameSync(this.file+'.tmp',this.file);}
 private schedule(){if(this.disposed||this.timer)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.drain();},0);this.timer.unref();}
 dispose(){this.disposed=true;if(this.timer)clearTimeout(this.timer);}
 private present(j:Stored):Submission{return {requestId:j.requestId,state:j.state,message:j.message,incidentId:j.incidentId,orderReference:j.orderReference,updatedAt:j.updatedAt};}
 list(owner:string){return this.jobs.filter(j=>j.owner===owner&&j.target===this.target()).map(j=>this.present(j));}
 retry(requestId:string,owner:string){const job=this.jobs.find(j=>j.requestId===requestId&&j.owner===owner&&j.target===this.target());if(!job)throw Error('Solicitud no encontrada');if(job.state==='failed'){job.state='queued';job.message='Recuperando la misma solicitud, sin duplicar';job.updatedAt=new Date().toISOString();this.save();this.schedule();}return this.present(job);}
 accept(draft:WizardDraft,actor:string,owner:string,user:Stored['user']){
  if(typeof draft?.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(draft.requestId)||!draft.context?.order?.odooReference||!Array.isArray(draft.products))throw Error('Solicitud de incidencia inválida');
  const digest=createHash('sha256').update(JSON.stringify(draft)).digest('hex');const prior=this.jobs.find(j=>j.requestId===draft.requestId);
  if(prior){if(prior.owner!==owner||prior.target!==this.target()||prior.digest!==digest)throw Error('Solicitud ya guardada con otros datos; no duplicar');if(prior.state==='failed'){prior.state='queued';prior.message='Solicitud recuperada; comprobando si ya existe antes de crear';prior.updatedAt=new Date().toISOString();this.save();this.schedule();}return this.present(prior);}
  const job:Stored={requestId:draft.requestId,draft:structuredClone(draft),actor,owner,user:{role:user.role,permissions:[...user.permissions]},target:this.target(),digest,state:'queued',message:'Solicitud guardada en Dashboard. Puedes continuar; preparando incidencia y documentos en segundo plano.',orderReference:draft.context.order.odooReference,updatedAt:new Date().toISOString()};
  this.jobs.push(job);try{this.save();}catch(error){this.jobs.pop();throw error;}this.schedule();return this.present(job);
 }
 private async drain(){if(this.running||this.disposed)return;this.running=true;try{for(const job of this.jobs.filter(j=>j.state==='queued')){
  if(this.disposed)break;
  job.state='running';job.updatedAt=new Date().toISOString();this.save();
  try{if(job.target!==this.target())throw Error('Destino Odoo cambiado; solicitud bloqueada sin ejecutar');const incident=await this.execute(structuredClone(job.draft),job.actor,job.user);job.incidentId=incident.id;job.state='saved';job.message='Incidencia guardada. REX/DEV disponibles según la solución; sincronización Odoo independiente.';}
  catch(error){job.state='failed';job.message=`Solicitud pendiente: ${(error as Error).message}. No registres otra incidencia; recupera esta solicitud.`;}
  job.updatedAt=new Date().toISOString();this.save();
 }}finally{this.running=false;if(!this.disposed&&this.jobs.some(j=>j.state==='queued'))this.schedule();}}
}
