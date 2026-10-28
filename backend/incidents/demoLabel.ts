/** Server-generated test labels, isolated from every carrier ledger and production target. */
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {demoWorkflowWritable,TEST_TARGET} from './odooRuntime.ts';
import type {Incident} from './types.ts';
export type DemoRexLabel={reference:string;incidentId:string;orderReference:string;pickingId:number;shipmentCode:string;tracking:string;carrier:string;operator:string;operatorCode:string;operatorId:string;createdAt:string;simulated:true};
export function assertDemoLabelScope(env:Record<string,string>,target:string,incident:Incident,op:NonNullable<Incident['odooOperations']>[number]){
 if(env.INCIDENTS_ODOO_MODE!=='test'||target!==TEST_TARGET||env.INCIDENTS_DEMO_LABEL_ENABLED!=='true'||env.INCIDENTS_ODOO_WRITE_ENABLED!=='true'||env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED!=='true'||(!demoWorkflowWritable(env,target)&&(env.INCIDENTS_ODOO_APPROVED_OPERATION!==op.key||env.INCIDENTS_ODOO_APPROVED_DIGEST!==op.digest)))throw Error('Etiqueta simulada bloqueada: requiere DEMO y aprobación exacta de esta salida');
 if((!demoWorkflowWritable(env,target)&&(!incident.requestId.startsWith('lab-')||!incident.observationsSummary?.includes('PRUEBA TÉCNICA')))||incident.status==='Cerrada')throw Error('Solo incidencias técnicas LAB abiertas admiten etiqueta simulada');
 if(op.kind!=='reshipment'||!op.dispatchReference||(op.target||TEST_TARGET)!==TEST_TARGET||!['ready_for_expedition','done'].includes(op.status||''))throw Error('REX de prueba no preparado o de otro destino');
}
export class DemoLabelStore{
 private file:string;
 constructor(private directory:string){this.file=join(directory,'incidents-demo-labels.json');}
 private read():DemoRexLabel[]{if(!existsSync(this.file))return [];const rows=JSON.parse(readFileSync(this.file,'utf8'));if(!Array.isArray(rows)||rows.some(r=>r.simulated!==true||!r.reference||!r.shipmentCode||!r.operatorCode))throw Error('Diario de etiquetas DEMO dañado; no generar otra etiqueta');return rows;}
 find(reference:string){const rows=this.read().filter(r=>r.reference===reference);if(rows.length>1)throw Error('Etiqueta DEMO duplicada; requiere revisión');return rows[0];}
 prepare(incident:Incident,op:NonNullable<Incident['odooOperations']>[number],operatorCode:string){
  const workersFile=join(this.directory,'warehouse-workers.json');const workers=existsSync(workersFile)?JSON.parse(readFileSync(workersFile,'utf8')):[];
  const workersFound=workers.filter((w:any)=>w.active&&w.code===operatorCode.trim().toUpperCase());if(workersFound.length!==1)throw Error('Identifica un único operario activo con su QR');const worker=workersFound[0];
  const previous=this.find(op.dispatchReference!);if(previous){if(previous.pickingId!==op.pickingId||previous.orderReference!==incident.order.odooReference||previous.operatorId!==worker.id)throw Error('Etiqueta DEMO ya registrada con otro picking, pedido u operario');return previous;}
  const label:DemoRexLabel={reference:op.dispatchReference!,incidentId:incident.id,orderReference:incident.order.odooReference,pickingId:op.pickingId,shipmentCode:`SIM-${op.dispatchReference}`,tracking:`SIM-${op.dispatchReference}`,carrier:'DEMO · Sin transportista',operator:worker.name,operatorCode:worker.code,operatorId:worker.id,createdAt:new Date().toISOString(),simulated:true};
  const rows=this.read();this.write(this.file,[...rows,label]);return label;
 }
 recordActivity(label:DemoRexLabel){
  const file=join(this.directory,'warehouse-worker-activity.json');const rows=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];if(!Array.isArray(rows))throw Error('Actividad de operarios dañada; no ignorar historial');
  const id=`demo-label-${label.reference}`;const prior=rows.filter((r:any)=>r.id===id);if(prior.length>1||prior.some((r:any)=>r.tracking!==label.tracking||r.workerId!==label.operatorId))throw Error('Actividad DEMO contradictoria');
  if(!prior.length)this.write(file,[{id,workerId:label.operatorId,workerCode:label.operatorCode,workerName:label.operator,orderRef:label.reference,carrier:label.carrier,tracking:label.tracking,result:'simulated-label',createdAt:label.createdAt},...rows]);
 }
 private write(file:string,value:unknown){mkdirSync(this.directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600,flush:true});renameSync(temp,file);}
}
