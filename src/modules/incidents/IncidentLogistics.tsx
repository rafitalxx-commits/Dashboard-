import {requiresExtraOutbound,extraOutboundRecorded} from '../../../backend/incidents/excessMerchandise';
import {unidentifiedReturnProduct} from '../../../backend/incidents/merchandise';
import {confirmedReshipment,incidentShipments} from '../../../backend/incidents/shipmentConfirmation';
import {warehouseReceived} from '../../../backend/incidents/receiptConfirmation';
import {reshipmentReference,reshipmentPrerequisites} from '../../../backend/incidents/reshipment';
import type {Incident} from '../../../backend/incidents/types';
import {date} from './components';

/** Only physical tasks and their actual result. No manual stock checklist. */
export function IncidentLogistics({incident}:{incident:Incident}){
 const shipping=incidentShipments(incident);const blockers=reshipmentPrerequisites(incident,incident.documentPreparation?.target||incident.odooOperations?.find(op=>op.kind==='reshipment')?.target);const blocked=blockers.length>0;
 return <section aria-label="Logística de la incidencia">
  {requiresExtraOutbound(incident)&&<section aria-label="Salida adicional del producto sobrante"><h3>Salida adicional · mercancía ya enviada</h3><p>{extraOutboundRecorded(incident)?'✓ Salida sobrante validada en Odoo':'◷ Salida sobrante pendiente de sincronizar con Odoo'}</p>{incident.odooOperations?.filter(op=>op.kind==='correction'&&op.key===incident.id+':correction').map(op=><article key={op.key}><strong>{op.externalReference||op.pickingId}</strong>{op.lines?.map((l,n)=><p key={n}>{l.sku} × {l.quantity}</p>)}</article>)}<p className="small">Solo se registra la diferencia enviada de más. No requiere nuevo envío, REX ni etiqueta.</p></section>}
  {shipping.required&&<><h3>REX · Reenvíos</h3>{!shipping.allSent&&blocked&&<div className="callout warn" role="alert"><strong>REX bloqueado · No se puede generar etiqueta ni enviar</strong>{blockers.map(reason=><p key={reason}>{reason}</p>)}<p>El documento REX puede imprimirse para preparar el material; no autoriza la salida. Se liberará automáticamente al completar los requisitos.</p></div>}{!shipping.operations.length&&<div className="callout"><strong>{reshipmentReference(incident.id)}</strong><p>{blocked?'🔒 Bloqueado · pendiente de DEV / validación':'◷ Pendiente de preparar'}</p><a className="btn soft" href={`#/expediciones?pedido=${encodeURIComponent(reshipmentReference(incident.id))}`}>Abrir en Expediciones →</a></div>}
  {shipping.operations.map(op=>{const sent=confirmedReshipment(op);return <article className="callout" key={op.key} aria-label={op.dispatchReference||'Reenvío'}>
   <strong>{op.dispatchReference||op.externalReference}</strong>
   <p>{sent?`✓ Hecho · Reenvío enviado${op.simulated?' · Simulado DEMO':''}`:blocked?'🔒 Bloqueado · no expedir':'◷ Pendiente de enviar'}</p>
   <ul className="inc-physical-lines">{op.lines?.map((line,index)=><li key={index}>{line.sku} × {line.quantity}</li>)}</ul>
   {sent?<><small>{date(op.shippedAt!)} · {op.shippedBy}</small>{op.tracking&&<p>{op.carrier} · {op.tracking}</p>}</>:<a className="btn soft" href={`#/expediciones?pedido=${encodeURIComponent(op.dispatchReference||reshipmentReference(incident.id))}`}>Abrir en Expediciones →</a>}
  </article>;})}</>}
  {incident.returns.length>0&&<><h3>DEV · Devoluciones</h3>{incident.returns.map(r=>{const received=warehouseReceived(r),cancelled=r.state==='cancelled';return <article className="callout" key={r.id} aria-label={r.id}>
   <strong>{r.id}</strong><p>{cancelled?'Cancelada':r.stockCorrection?received?'✓ Hecho · Salida original corregida en Odoo':'◷ Corrección Odoo automática pendiente':received?'✓ Hecho · Producto recepcionado':'◷ Pendiente de recibir'}</p>
   {received&&r.receivedBy&&<small>{date(r.receivedAt||r.updatedAt)} · {r.receivedBy.name}</small>}
   {r.products.map(p=>{const actual=r.itemOverrides?.find(item=>item.expectedSku===p.sku);return <p className="small" key={p.sku}>{actual?.mode==='not_ours'?`Mercancía ajena al catálogo: ${actual.description} × ${actual.quantity}`:actual?.mode==='catalog'?`${actual.product!.sku} · ${actual.product!.name} × ${actual.quantity}`:unidentifiedReturnProduct(p)?'Producto pendiente de identificar al recuperar':`${p.sku} · ${p.name} × ${p.receivedQuantity??p.expectedQuantity}`}</p>;})}
   {r.stockCorrection&&<small>Corrección interna: no requiere devolución física del cliente.</small>}
   {!r.stockCorrection&&!received&&!cancelled&&<a className="btn soft" href={`#/productos/recepciones?dev=${encodeURIComponent(r.id)}`}>Abrir en Recepciones →</a>}
   {received&&r.state!=='processed'&&<small role="status">Finalizando recepción automáticamente.</small>}
  </article>;})}</>}
  {!requiresExtraOutbound(incident)&&!shipping.required&&!incident.returns.length&&<p>No hay devoluciones ni reenvíos para esta incidencia.</p>}
 </section>;
}
