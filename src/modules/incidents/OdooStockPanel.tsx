import { downloadReshipmentDocument } from './ReshipmentDocument';
import { useEffect, useRef, useState } from 'react';
import type { Incident } from '../../../backend/incidents/types';
import type { StockProposal, StockOperation } from '../../../backend/incidents/odooStock';
import { api } from './api';
import { Message,OperationStatus } from './components';

export function OdooStockPanel({incident,onUpdated,disabled}:{incident:Incident;onUpdated:(i:Incident)=>void;disabled:boolean}){
 const [proposal,setProposal]=useState<StockProposal>();
 const [writable,setWritable]=useState(false);const [rexWritable,setRexWritable]=useState(false);const [mode,setMode]=useState('');
 const [loading,setLoading]=useState(false);const [progress,setProgress]=useState('');
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const lock=useRef(false);
 const run=async(fn:()=>Promise<void>,label='Procesando operación…')=>{if(lock.current)return;lock.current=true;setLoading(true);setProgress(label);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setProgress('');setLoading(false);lock.current=false;}};
 const load=()=>run(async()=>{const [result,status]=await Promise.all([api(`/${incident.id}/odoo/proposal`),api('/status')]);setProposal(result.proposal);setWritable(status.odooWritable);setRexWritable(status.rexWritable);setMode(status.odooMode);setMessage('Consulta Odoo completada. No se ha modificado stock.');},'Consultando la propuesta y esperando respuesta de Odoo…');
 useEffect(()=>{void load();},[incident.id]);
 const action=(key:string,reconcile:boolean)=>run(async()=>{const result=await api(`/${incident.id}/odoo/${reconcile?'reconcile':'execute'}`,{key,revision:incident.revision,digest:proposal?.digest});onUpdated(result.incident);setProposal(undefined);if(result.rexPreparation?.status==='failed')setError(result.rexPreparation.message);const operation=result.incident.odooOperations?.find((x:any)=>x.key===key);setMessage(operation?.backorder?`Lote validado: ${operation.externalReference||operation.pickingId}. Resto pendiente en ${operation.backorder.externalReference}; la devolución no está completada.`:operation?.status==='awaiting_arrival'?`Entrada creada: ${operation.externalReference||operation.pickingId}. Sigue pendiente de llegada física; valida solo cuando el producto esté recibido.`:operation?.status==='ready_for_expedition'?`Salida creada: ${operation.externalReference||operation.pickingId}. Queda preparada para Expediciones; todavía no está validada ni entregada.`:'Movimiento validado en Odoo y guardado en la incidencia.');},reconcile?'Conciliando con Odoo; espera a que termine…':'Procesando el movimiento y esperando confirmación de Odoo…');
 const current=proposal?.revision===incident.revision;
 const actionLabel=(op:StockOperation)=>op.kind==='scrap'?'Registrar desecho en Odoo':op.kind==='correction'?'Validar corrección de stock':op.kind==='reshipment'?'Crear albarán de reexpedición':op.stageOnly?'Preparar devolución pendiente':'Validar entrada recibida';
 const operationTitle=(op:StockOperation)=>op.kind==='scrap'?'Pérdida / rotura · desecho de la salida original':op.kind==='correction'?'Reintegrar a stock el producto no enviado':op.kind==='reshipment'?'Reexpedición de pedido':'Devolución al pedido original';
 return <section className="callout">
  <h3>Conexión de stock · Odoo</h3>
  <p>La corrección del producto no enviado, la entrada del producto equivocado y el nuevo envío son movimientos separados. Los albaranes quedan asociados al pedido Odoo original; ninguna preparación pendiente se cuenta como stock movido.</p>
  <button className="btn" disabled={disabled||loading} onClick={()=>void load()}>{loading?'Consultando / conciliando…':'Consultar propuesta Odoo'}</button>
  <OperationStatus message={progress}/><div role="status" aria-live="polite">{message&&<Message>{message}</Message>}{error&&<Message error>{error}</Message>}</div>
  {incident.odooOperations?.some(op=>op.kind==='reshipment'&&op.dispatchReference)&&<button className="btn" disabled={loading} onClick={()=>void run(async()=>{await downloadReshipmentDocument(incident);setMessage('Documento REX con QR descargado. No se ha creado una etiqueta de transporte.');})}>Descargar documento REX con QR</button>}
  {proposal&&<>
   <p className="small">Pedido Odoo #{proposal.orderId} · salidas originales {proposal.originalPickingIds.join(', ')||'no disponibles'}</p>
   {!current&&<Message error>La incidencia ha cambiado. Actualiza la propuesta antes de realizar otra operación.</Message>}
   {proposal.blockers.map(b=><Message error key={b}>{b}</Message>)}
   {proposal.openOutgoingPickings?.map(p=><Message error key={p.id}><strong>Salida Odoo ya existente:</strong> {p.name} · picking #{p.id} · {p.state}. No se crea otro REX hasta conciliar este albarán. {p.lines.map(l=>`${l.product} × ${l.quantity}`).join(', ')||'Sin líneas activas'}</Message>)}
   {!proposal.operations.length&&incident.solution==='cross_direct'&&<button className="btn" disabled={disabled||loading||!current||!!proposal.blockers.length} onClick={()=>void action('no-stock-movement',true)}>Confirmar sin movimiento intermedio</button>}
   {proposal.operations.filter(op=>op.kind!=='reshipment').map(op=>{
    const already=incident.odooOperations?.find(x=>x.key===op.key);
    const canReconcile=!!op.receiptBatch||!!already&&(op.stageOnly||already.status==='done'||!already.status);
    const canExecute=!already||(op.kind==='return'&&!op.stageOnly&&already.status==='awaiting_arrival');
    return <article className="callout" key={op.key}>
     <strong>{operationTitle(op)} · {op.returnId||''}</strong>
     {op.dispatchReference&&<p><strong>{op.dispatchReference}</strong> · QR disponible en el documento de reexpedición tras crear el picking.</p>}
     {op.lines.map((l,n)=><p key={n}>{l.sku} × {l.quantity} · {op.receiptBatch?'esta llegada · ':op.receiptReview?'esperado en el albarán · ':''}ubicación {l.sourceId} → {l.destinationId}{l.saleLineId?` · línea pedido ${l.saleLineId}`:''}</p>)}
     {op.receiptReview&&<section aria-label="Revisión de cantidades de devolución">
      <h4>Recibido y pendiente por producto</h4>
      {op.receiptReview.rows.map((row,n)=><div className="callout" key={n}>
       <strong>{row.sku}</strong><span className="small"> · unidad Odoo #{row.uomId}</span>
       <p>Esperado: {row.expected} · Recibido acumulado: {row.received}</p>
       <p>Ya contabilizado: {row.posted} · Por contabilizar de lo recibido: {row.thisArrival}</p>
       <p>Pendiente de llegada: {row.pending}</p>
      </div>)}
      {op.receiptReview.state==='partial'&&<Message>Recepción parcial: el resto debe quedar pendiente en Odoo. Al validar se contabilizará solo esta llegada y se conservarán las unidades pendientes en un backorder. La devolución seguirá abierta.</Message>}
      {op.receiptReview.state==='empty'&&<Message>No hay unidades recibidas para validar. El albarán sigue pendiente.</Message>}
      {op.receiptReview.state==='already_posted'&&<Message>Lo recibido ya está contabilizado. No hay una nueva llegada que validar.</Message>}
      {op.receiptReview.state==='invalid'&&<Message error>Hay diferencias que requieren conciliación. No se propone ninguna cantidad para validar.</Message>}
     </section>}
     {op.stageOnly&&op.kind==='return'&&<Message>Se creará el albarán de entrada vinculado al pedido, sin validar ni sumar stock. Cuando llegue el producto, registra su recepción e inspección; después podrás validarlo.</Message>}
     {op.stageOnly&&op.kind==='reshipment'&&<Message>Se creará una salida del almacén vinculada al pedido, con política «Lo antes posible», sin validar la entrega. Expediciones la procesará como una salida pendiente.</Message>}
     {op.kind==='scrap'&&<Message>Desecho vinculado al albarán #{op.originalPickingId}. Solo se desechan las unidades recibidas; no repone mercancía automáticamente.</Message>}
     {op.blockers.map(b=><Message error key={b}>{b}</Message>)}
     <div className="actions">
      {canReconcile&&<button className="btn" disabled={disabled||loading||!current} onClick={()=>void action(op.key,true)}>{op.stageOnly?'Conciliar albarán pendiente · sin repetir':'Conciliar albarán existente · sin repetir'}</button>}
      {(op.kind==='reshipment'?rexWritable:writable)&&canExecute&&<button className="btn primary" disabled={disabled||loading||!current||!!proposal.blockers.length||!!op.blockers.length||!op.lines.length} onClick={()=>void action(op.key,false)}>{loading?'Procesando en Odoo…':op.kind==='return'&&op.existingPickingId&&!op.stageOnly?'Validar entrada recibida':actionLabel(op)}</button>}
      {already&&<span className="small">{already.kind==='scrap'?'Desecho':'Albarán'} {already.externalReference||already.pickingId} · {already.status==='awaiting_arrival'?'pendiente de llegada':already.status==='ready_for_expedition'?'listo para Expediciones':'validado'}</span>}
     </div>
    </article>;
   })}
   {!writable&&!rexWritable&&<Message>Preparación Odoo no habilitada. La consulta no modifica stock ni crea albaranes.</Message>}
   <details><summary>Conexión y referencia de la propuesta</summary><p className="small">{mode==='operational'?'Conexión operativa':'Conexión de pruebas'}</p><p className="small">{proposal.target}</p><p className="small" style={{overflowWrap:'anywhere'}}>Propuesta: {proposal.digest}</p>{proposal.operations.map(op=><p className="small" key={op.key}>{op.key}</p>)}</details>
  </>}
 </section>;
}
