import type {Incident} from './types.ts';

type Operation = NonNullable<Incident['odooOperations']>[number];

/** A label alone is not a shipment. These facts are saved by Expeditions after
 * Odoo confirms the picking; every consumer uses the same audited event. */
export function confirmedReshipment(op: Partial<Operation>): boolean {
 return op.kind === 'reshipment' && op.status === 'done' &&
  Boolean(op.shipmentCode && op.shippedBy && op.shippedAt);
}

export function incidentShipments(incident: Incident) {
 const operations = (incident.odooOperations || []).filter(op => op.kind === 'reshipment');
 const sent = operations.filter(confirmedReshipment);
 const pending = operations.filter(op => !confirmedReshipment(op));
 const required = incident.processes.some(p => p.kind === 'reshipment') || operations.length > 0;
 const allSent = operations.length > 0 && pending.length === 0;
 return {operations, sent, pending, required, allSent,
  simulated: sent.length > 0 && sent.every(op => op.simulated),
  label: allSent ? 'Reenvío enviado' : sent.length ? `Reenvíos enviados: ${sent.length}/${operations.length}` : 'Reenvío pendiente'};
}
