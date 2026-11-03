import {SheetsRepository} from './repository.ts';
import {incidentFromReshipment,reshipmentPrerequisites} from './reshipment.ts';
import {TEST_TARGET,operationalOdooTarget} from './odooRuntime.ts';
import type {Incident} from './types.ts';
/** Must run before any carrier call or ledger reservation. Ordinary orders do not read Sheets. */
export async function assertIncidentLabelAllowed(env:Record<string,string>,input:unknown,load?:()=>Promise<Incident[]>){
 const value=input as Record<string,unknown>|null;
 const refs=[value?.reference,value?.externalShippingCode,value?.externalOrderRef,...(Array.isArray(value?.orderRefs)?value.orderRefs:[])].filter((v):v is string=>typeof v==='string').map(v=>v.trim().toUpperCase()).filter(v=>v.startsWith('REX-'));
 if(!refs.length)return;
 const target=env.INCIDENTS_ODOO_MODE==='test'?TEST_TARGET:operationalOdooTarget(env);
 const all=await (load?load():new SheetsRepository(env).list(true));
 for(const reference of new Set(refs)){
  const incident=all.find(i=>i.id===incidentFromReshipment(reference));if(!incident)throw Error(`REX bloqueado: ${reference} no tiene una incidencia verificable`);
  const blockers=reshipmentPrerequisites(incident,target);if(blockers.length)throw Error(blockers.join('. '));
  const ops=incident.odooOperations?.filter(op=>op.kind==='reshipment'&&op.dispatchReference===reference)||[];
  if(ops.length!==1||(ops[0].target||TEST_TARGET)!==target||ops[0].status!=='ready_for_expedition'||!ops[0].lines?.length||!(ops[0].pickingId>0))throw Error(`REX bloqueado: ${reference} no tiene una única salida Odoo preparada en esta conexión; no generar etiqueta`);
 }
}
