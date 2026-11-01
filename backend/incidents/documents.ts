import {requiresExtraOutbound,extraOutboundRecorded} from './excessMerchandise.ts';
import {requiresOmittedStockCorrection} from './omittedMerchandise.ts';
import {TEST_TARGET} from './odooRuntime.ts';
import type {Incident} from './types.ts';
import type {StockProposal,StockOperation} from './odooStock.ts';

/** External success is durable: a transient audit failure must retry reconciliation, not stock. */
export class DocumentAuditPendingError extends Error {
 readonly retryableDocumentPreparation=true;
 constructor(cause:unknown){super(`Odoo confirmado; historial Dashboard pendiente: ${(cause as Error).message}`);}
}
export function missingIncidentDocuments(i:Incident):string[]{
 const missing=i.returns.filter(r=>r.state!=='cancelled'&&!i.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.pickingId>0&&(r.stockCorrection?op.status==='done':['awaiting_arrival','done'].includes(op.status||'')))).map(r=>r.id);
 if(requiresExtraOutbound(i)&&!extraOutboundRecorded(i))missing.push('Salida adicional de unidades ya enviadas');
 if(requiresOmittedStockCorrection(i)&&!i.returns.some(r=>r.stockCorrection))missing.push('DEV correctiva de mercancía no enviada');
 if((i.processes.some(p=>p.kind==='reshipment')||i.stockPlan.some(p=>p.action==='new_outbound'))&&!i.odooOperations?.some(op=>op.kind==='reshipment'&&op.dispatchReference&&op.lines?.length&&op.pickingId>0&&['ready_for_expedition','done'].includes(op.status||'')))missing.push(i.id.replace('INC-','REX-')+'-01');
 return missing;
}
const preparable=(op:StockOperation)=>(op.stageOnly&&['return','reshipment'].includes(op.kind))||(op.kind==='return'&&op.standardReturn)||(op.kind==='correction'&&op.extraOutbound===true);
/** REX stays staged. Validate only a linked corrective DEV or the exact extra
 * outbound already physically shipped; physical returns still await inspection. */
export async function prepareIncidentDocuments(id:string,deps:{
 load:()=>Promise<Incident[]>;
 propose:(i:Incident,all:Incident[],options:{prepareDocuments:true})=>Promise<StockProposal>;
 run:(p:StockProposal,op:StockOperation)=>Promise<NonNullable<Incident['odooOperations']>[number]>;
 confirm:(i:Incident,result:NonNullable<Incident['odooOperations']>[number])=>Promise<Incident>;
}){
 let all=await deps.load(),incident=all.find(i=>i.id===id);if(!incident)throw Error('Incidencia no encontrada');
 if(incident.status==='Cerrada')return {state:'blocked' as const,message:'Incidencia cerrada: no registrar nuevos albaranes'};
 if(!requiresExtraOutbound(incident)&&!incident.returns.some(r=>r.state!=='cancelled')&&!incident.processes.some(p=>p.kind==='reshipment')&&!incident.stockPlan.some(p=>p.action==='new_outbound'))return {state:'done' as const,message:'La solución elegida no requiere albaranes DEV/REX'};
 const initial=await deps.propose(incident,all,{prepareDocuments:true});
 if(incident.odooOperations?.some(op=>(op.target||TEST_TARGET)!==initial.target))return {state:'blocked' as const,message:'La incidencia contiene movimientos de otra base Odoo; no se reutilizan IDs ni se reanuda la preparación en otra conexión'};
 // The corrective DEV is a prerequisite for preparing another warehouse decrement.
 const keys=initial.operations.filter(preparable).sort((a,b)=>Number(Boolean(b.standardReturn))-Number(Boolean(a.standardReturn))).map(op=>op.key);
 for(const key of keys){
  all=await deps.load();incident=all.find(i=>i.id===id)!;
  if(incident.status==='Cerrada')return {state:'blocked' as const,message:'Incidencia cerrada durante la preparación; no se han creado más movimientos'};
  const proposal=await deps.propose(incident,all,{prepareDocuments:true});
  const op=proposal.operations.find(op=>op.key===key);
  if(!op||!preparable(op)||op.blockers.length||!op.lines.length)continue;
  if(op.kind==='reshipment'&&incident.returns.some(r=>r.stockCorrection&&r.state!=='cancelled'&&!incident!.odooOperations?.some(old=>old.kind==='return'&&old.returnId===r.id&&old.status==='done')))continue;
  // The executor always reconciles the exact reference before attempting creation.
  const result=await deps.run(proposal,op);
  if(result.key!==op.key||result.kind!==op.kind||!(result.pickingId>0)||op.kind==='return'&&result.returnId!==op.returnId)throw Error('Odoo devolvió una operación distinta de la solicitada; conciliar sin repetir');
  if((op.standardReturn||op.extraOutbound)&&result.status!=='done')throw Error('La DEV correctiva no está validada en Odoo; no preparar REX');
  if(result.status==='done'&&!op.standardReturn&&!op.extraOutbound&&!incident!.odooOperations?.some(old=>old.key===key&&old.status==='done'))throw Error('Un albarán nuevo aparece validado: requiere conciliación; no asumir preparación');
  try{await deps.confirm(incident,result);}catch(error){throw new DocumentAuditPendingError(error);}
 }
 all=await deps.load();incident=all.find(i=>i.id===id)!;
 const final=await deps.propose(incident,all,{prepareDocuments:true});
 const issues=[...final.blockers,...final.operations.filter(op=>(['return','reshipment'].includes(op.kind)||op.extraOutbound)).flatMap(op=>op.blockers)];
 const missing=missingIncidentDocuments(incident);
 if(missing.length||issues.length)return {state:'blocked' as const,message:`Preparación automática pendiente: ${[...new Set([...missing,...issues])].join('; ')}. No registrar otra incidencia ni otra llegada.`};
 const correction=incident.returns.some(r=>r.stockCorrection);
 return {state:'done' as const,message:requiresExtraOutbound(incident)&&extraOutboundRecorded(incident)?'Salida adicional del sobrante validada en Odoo; mercancía ya enviada, sin REX, etiqueta ni transporte nuevos.':correction?incident.processes.some(p=>p.kind==='reshipment')?'DEV correctiva validada en Odoo y REX preparado en el pedido/Dashboard. REX pendiente de expedición; no implica envío ni etiqueta.':'DEV correctiva vinculada a la salida original y validada en Odoo. Stock de la unidad omitida corregido; no requiere devolución física ni REX.':incident.returns.length?'Albaranes preparados en Odoo y Dashboard. Las devoluciones físicas esperan recepción; REX pendiente de expedición si corresponde. Sin envío ni etiqueta.':'Preparación de documentos completada. Las salidas quedan pendientes de expedición; no implica envío ni etiqueta.'};
}
