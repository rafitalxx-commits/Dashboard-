import {useEffect, useRef, useState} from 'react';
import type {FormEvent} from 'react';
import {odooClient} from '../services/odooClient';
type Incident = Awaited<ReturnType<typeof odooClient.getDeliveryIncidents>>[number];
export function ConfirmIncidentShipment({incident, onClose, onSaved}: {
  incident: Incident; onClose: () => void; onSaved: (incident: Incident) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current!; node.showModal();
    return () => {node.close(); trigger?.focus();};
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !confirmed || !reason.trim() || !incident.tracking?.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await odooClient.confirmIncidentShipped({incidentId: incident.id,
        tracking: incident.tracking!, reason: reason.trim(), confirmed: true});
      onSaved(result.incident);
    } catch (e) {setError(e instanceof Error ? e.message : 'No se pudo guardar la confirmación.');}
    finally {lock.current = false; setBusy(false);}
  }
  return <dialog ref={dialog} className="shipment-confirm-dialog" aria-labelledby="shipment-confirm-title"
    onCancel={e => {e.preventDefault(); if (!lock.current) onClose();}}>
    <form onSubmit={submit} aria-busy={busy}>
      <h2 id="shipment-confirm-title">Confirmar pedido enviado</h2>
      <p><strong>{incident.orderName || `#${incident.orderId}`}</strong></p>
      <p>Seguimiento: <strong className="shipment-confirm-tracking">{incident.tracking}</strong></p>
      <p>Se resolverá esta incidencia como <strong>Enviado confirmado manualmente</strong>.
        No significa entregado al cliente. No crea ni valida albaranes en Odoo.</p>
      {error && <p role="alert" className="shipment-confirm-error">{error}</p>}
      <label>Motivo de la confirmación<textarea autoFocus required maxLength={1000} rows={3}
        value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/></label>
      <label className="shipment-confirm-check"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={e => setConfirmed(e.target.checked)}/>Confirmo que este pedido ha sido enviado y que el seguimiento corresponde a este pedido.</label>
      <p className="shipment-confirm-note">Quedará registrado tu usuario, la fecha, el motivo y el seguimiento.</p>
      <div className="shipment-confirm-actions"><button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" disabled={busy || !confirmed || !reason.trim()}>{busy ? 'Guardando confirmación…' : 'Confirmar envío y resolver'}</button></div>
      {busy && <p role="status">Guardando confirmación…</p>}
    </form>
  </dialog>;
}
