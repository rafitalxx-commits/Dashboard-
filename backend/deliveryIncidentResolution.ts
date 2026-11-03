/** Dashboard-only confirmation. Never performs an Odoo or carrier operation. */
export type ManualShipmentResolution = {
  kind: 'shipment-confirmed'; tracking: string; reason: string;
  confirmedAt: string; confirmedBy: string; confirmedById: string;
};
export type ResolvableDeliveryIncident = {
  id: string; orderId: number; orderName?: string; tracking?: string;
  pickingId?: string; reason: string; resolvedAt?: string; resolvedBy?: string;
  manualResolution?: ManualShipmentResolution;
};
export type ShipmentConfirmation = { incidentId: string; tracking: string; reason: string; confirmed: boolean };
export function confirmIncidentShipment<T extends ResolvableDeliveryIncident>(
  incidents: T[], input: ShipmentConfirmation, actor: {id: string; name: string},
  currentTracking?: string, now = new Date().toISOString(),
): {incidents: T[]; incident: T} {
  if (!input || typeof input.incidentId !== 'string' || !input.incidentId.trim()) throw new Error('Selecciona una incidencia.');
  const incident = incidents.find(i => i.id === input.incidentId);
  if (!incident) throw new Error('La incidencia ya no existe. Actualiza el listado.');
  const tracking = (currentTracking ?? incident.tracking ?? '').trim();
  if (!tracking) throw new Error('Se necesita un seguimiento para confirmar el envío.');
  if (input.confirmed !== true) throw new Error('Confirma expresamente que el pedido ha sido enviado.');
  if (typeof input.tracking !== 'string' || input.tracking.trim() !== tracking) throw new Error('El seguimiento ha cambiado. Actualiza y revisa el pedido.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 1000) throw new Error('Indica un motivo de entre 1 y 1000 caracteres.');
  if (!actor.id || !actor.name) throw new Error('Usuario no identificado.');
  // A repeated response/retry must preserve the first confirmation and its audit.
  if (incident.resolvedAt) {
    if (incident.manualResolution?.tracking === tracking) return {incidents, incident};
    throw new Error('La incidencia ya está resuelta. Actualiza el listado.');
  }
  const resolved = {...incident, resolvedAt: now, resolvedBy: actor.name,
    manualResolution: {kind: 'shipment-confirmed' as const, tracking, reason,
      confirmedAt: now, confirmedBy: actor.name, confirmedById: actor.id}};
  return {incidents: incidents.map(i => i.id === incident.id ? resolved : i), incident: resolved};
}
export function mergeDeliveryIncident<T extends ResolvableDeliveryIncident>(previous: T | undefined, incoming: T): T {
  const sameFailure = previous?.manualResolution?.kind === 'shipment-confirmed' &&
    previous.reason === incoming.reason && previous.orderId === incoming.orderId &&
    (previous.pickingId || '') === (incoming.pickingId || '') &&
    previous.manualResolution.tracking === (incoming.tracking ?? previous.tracking ?? '').trim();
  return {...previous, ...incoming,
    resolvedAt: sameFailure ? previous!.resolvedAt : undefined,
    resolvedBy: sameFailure ? previous!.resolvedBy : undefined,
    manualResolution: sameFailure ? previous!.manualResolution : undefined};
}

/** An Odoo read/sync may have started before the operator confirmed shipment.
 * Rebase only these local confirmations immediately before the synchronous write. */
export function preserveConcurrentShipmentConfirmations<T extends ResolvableDeliveryIncident,
  A extends {id: string; manualShipmentResolution?: ManualShipmentResolution},
  S extends {incidents: T[]; audit: A[]}>(proposed: S, current: S): S {
  const currentById = new Map(current.incidents.map(i => [i.id, i]));
  const ids = new Set(proposed.incidents.map(i => i.id));
  const auditIds = new Set(proposed.audit.map(a => a.id));
  return {...proposed, incidents: [
    ...proposed.incidents.map(i => currentById.get(i.id)?.manualResolution
      ? mergeDeliveryIncident(currentById.get(i.id), i) : i),
    ...current.incidents.filter(i => i.manualResolution && !ids.has(i.id)),
  ], audit: [...proposed.audit, ...current.audit.filter(a => a.manualShipmentResolution && !auditIds.has(a.id))].slice(-1000)};
}
