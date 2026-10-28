import {requiresExtraOutbound,extraOutboundRecorded} from './excessMerchandise.ts';
import {requiresOmittedStockCorrection} from './omittedMerchandise.ts';
import type {Incident, IncidentCost, IncidentSubstatus} from './types.ts';

/** Empty automatic provisions are not entered costs. Keep legacy entries and
 * explicit zero-cost registrations readable without rewriting the ledger. */
export function explicitlyEnteredIncidentCost(i:Incident,c:IncidentCost):boolean {
 return Boolean(c.recordedAt || i.timeline.some(e=>
  ['cost_added','cost_updated'].includes(e.type)&&e.details?.costId===c.id));
}
export function recordedIncidentCost(i:Incident,c:IncidentCost):boolean {
 return c.direction==='cost' && (explicitlyEnteredIncidentCost(i,c) || c.amount>0 ||
  ['confirmed','assumed'].includes(c.state));
}
/** Recoveries remain income; entering one never confirms the expense review. */
export function hasRecordedIncidentRecovery(i:Incident):boolean{
 return i.costs.some(c=>c.direction==='recovery'&&(explicitlyEnteredIncidentCost(i,c)||['confirmed','assumed'].includes(c.state)));
}
export function hasRecordedIncidentCost(i:Incident):boolean {
 return i.costs.some(c=>recordedIncidentCost(i,c));
}

/** Operator work excludes technical stock corrections, never changes their
 * audit or falsely asserts that Odoo has already completed them. */
export function incidentPendingWork(i:Incident):{summary:string;substatus:IncidentSubstatus} {
 if(i.status==='Cerrada')return {summary:'Sin pendientes',substatus:null};
 const p=i.processes.find(p=>p.kind!=='stock_adjustment'&&['pending','in_progress','blocked'].includes(p.state));
 if(p)return {summary:p.title,substatus:({reception:'esperando_recepcion',reshipment:'esperando_reenvio',refund:'esperando_reembolso',repair:'esperando_revision',diagnosis:'esperando_diagnostico',claim:'esperando_agencia',follow_up:'esperando_agencia'} as const)[p.kind as Exclude<typeof p.kind,'stock_adjustment'>]};
 if(requiresExtraOutbound(i)&&!extraOutboundRecorded(i))return {summary:'Salida Odoo del producto sobrante pendiente',substatus:'esperando_reenvio'};
 const syncing=i.returns.find(r=>r.state==='arrived'&&r.warehouseConfirmedAt);
 if(syncing)return {summary:`${syncing.id} · finalizando recepción`,substatus:'esperando_recepcion'};
 if(i.claims.some(c=>!['closed','compensated'].includes(c.status)))return {summary:'Reclamación pendiente',substatus:'esperando_agencia'};
 if(requiresOmittedStockCorrection(i)&&!i.returns.some(r=>r.stockCorrection&&r.state==='processed'&&i.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done')))return {summary:'DEV correctiva Odoo pendiente · no requiere devolución física',substatus:'esperando_recepcion'};
 if(!hasRecordedIncidentCost(i))return {summary:'Registrar un coste',substatus:'pendiente_coste'};
 return {summary:i.clientStatus!=='Solucionado'?'Solucionar cliente':'Listo para cierre',substatus:null};
}
