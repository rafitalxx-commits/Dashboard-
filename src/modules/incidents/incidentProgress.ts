import {hasRecordedIncidentRecovery} from '../../../backend/incidents/operatorWorkflow.ts';
import {requiresExtraOutbound,extraOutboundRecorded} from '../../../backend/incidents/excessMerchandise.ts';
import {requiresOmittedStockCorrection} from '../../../backend/incidents/omittedMerchandise.ts';
import {reshipmentPrerequisites} from '../../../backend/incidents/reshipment.ts';
import {incidentShipments} from '../../../backend/incidents/shipmentConfirmation.ts';
import {warehouseReceived} from '../../../backend/incidents/receiptConfirmation.ts';
import type { Incident, IncidentClosureChecklist } from '../../../backend/incidents/types';
import { getIncidentClosureChecklist } from '../../../backend/incidents/domain.ts';

export type ProgressSection = 'General' | 'Logística' | 'Reclamaciones' | 'Costes' | 'Documentos / fotos';
export type ProgressKey = Exclude<keyof IncidentClosureChecklist, 'missing' | 'canClose' | 'stockRegularized'>;
export type ProgressRequirement = { key: ProgressKey; label: string; task: string; help: string; section: ProgressSection; target?: string; href?: string; done: boolean; applicable: boolean; tone: string };

/** Operator presentation: every visible requirement comes from the shared close contract; technical stock remains internal. */
export function getIncidentProgress(incident: Incident) {
  const checks = getIncidentClosureChecklist(incident);
  const recoveryOnly=!checks.costsClosed&&hasRecordedIncidentRecovery(incident);
  const extraPending=requiresExtraOutbound(incident)&&!extraOutboundRecorded(incident);
  const correctivePending=requiresOmittedStockCorrection(incident)&&!checks.goodsRegularized;
  const activeReturn = incident.returns.find(r => !r.stockCorrection&&!['processed','cancelled'].includes(r.state));
  const inspected=Boolean(activeReturn&&warehouseReceived(activeReturn));
  const receiptHelp=activeReturn?inspected?`${activeReturn.id} ya está recibida y validada por almacén. ${activeReturn.odooSyncError?`Odoo pendiente: ${activeReturn.odooSyncError}. Conciliar la sincronización guardada; no repetir la recepción física.`:'Esperando confirmación de la entrada en Odoo; no repetir la recepción física.'}`:'En Recepciones: identifica al operario, revisa el producto y confirma su destino.':'Revisa los procesos físicos pendientes de esta incidencia.';
  const shipping = incidentShipments(incident);
  const blockers=shipping.required&&!shipping.allSent?reshipmentPrerequisites(incident,incident.documentPreparation?.target||incident.odooOperations?.find(op=>op.kind==='reshipment')?.target):[];
  const shipment = shipping.pending.find(op => op.dispatchReference);
  const receiptHref = activeReturn ? `#/productos/recepciones?dev=${encodeURIComponent(activeReturn.id)}` : undefined;
  const specs: Omit<ProgressRequirement, 'done'>[] = [
    {key:'clientSolved',label:'Cliente solucionado',task:'Confirmar la solución al cliente',help:'Comprueba la solución y registra el estado del cliente. Un albarán creado no acredita una entrega.',section:'General',target:'client',applicable:true,tone:'blue'},
    {key:'goodsRegularized',label:'Mercancía regularizada',task:extraPending?'Sincronizar salida del producto sobrante en Odoo':correctivePending?'Validar DEV correctiva en Odoo':activeReturn ? `${warehouseReceived(activeReturn)?'Finalizando devolución':activeReturn.state === 'arrived' ? 'Revisar devolución' : 'Recibir devolución'} ${activeReturn.id}` : 'Revisar la mercancía pendiente',help:extraPending?'El sobrante ya salió físicamente. Registra solo su salida adicional en Odoo, sin crear REX ni otra etiqueta.':correctivePending?'La unidad no salió del almacén. Recupera la DEV correctiva vinculada a la salida Odoo original; no registres una llegada física ni repitas el abono.':receiptHelp,section:correctivePending||extraPending?'General':'Logística',href:correctivePending?undefined:receiptHref,applicable:incident.returns.length > 0 || incident.processes.some(p=>p.kind==='reception'),tone:'amber'},
    {key:'logisticsResolved',label:shipping.allSent?'Gestiones internas finalizadas':'Reenvíos / procesos finalizados',task:blockers.length?(inspected?'REX bloqueado · conciliación Odoo pendiente':'REX bloqueado · completar requisitos previos'):shipment ? `Expedir ${shipment.dispatchReference}` : shipping.allSent?'Completar gestiones internas pendientes':'Finalizar reenvíos y procesos pendientes',help:blockers.length?blockers.join('. '):shipment ? 'Genera la etiqueta desde Expediciones con el operario. Crear el REX no significa que esté enviado.' : 'Comprueba las recepciones, reembolsos, reparaciones y seguimientos que sigan abiertos.',section:incident.processes.some(p=>['refund','repair','follow_up'].includes(p.kind)&&!['resolved','assumed'].includes(p.state))?'General':'Logística',target:'processes',applicable:incident.processes.some(p=>p.requiredToClose),tone:'blue'},
    {key:'warrantyResolved',label:'Garantía diagnosticada / resuelta',task:'Registrar diagnóstico y solución',help:'Completa el diagnóstico y su solución desde General.',section:'General',applicable:incident.type==='warranty',tone:'purple'},
    {key:'claimsResolvedOrAssumed',label:'Reclamación resuelta / asumida',task:'Resolver o asumir la reclamación',help:'Registra el resultado, la indemnización o la pérdida asumida en el expediente.',section:'Reclamaciones',applicable:incident.claimIds.length>0,tone:'amber'},
    {key:'costsClosed',label:'Costes registrados',task:recoveryOnly?'Registrar gasto o confirmar que no hubo gastos':'Registrar un coste',help:recoveryOnly?'Has registrado una indemnización o recuperación, no un gasto. Registra los gastos reales o, si no hubo ninguno, confirma Otros gastos con importe 0 €. No repitas la indemnización.':'Añade al menos un coste. Después puedes incluir más, incluso con la incidencia resuelta.',section:'Costes',applicable:true,tone:'pink'},
  ];
  // A false domain requirement is always visible, even if its source is incomplete.
  const requirements = specs.map(r=>({...r,done:checks[r.key],applicable:r.applicable || !checks[r.key]}));
  const pending = requirements.filter(r=>!r.done);
  return {checks,requirements,pending,activeReturn,shipment,shipping,receiptHref};
}
