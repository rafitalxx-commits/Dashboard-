import {requiresExtraOutbound,extraOutboundRecorded} from './excessMerchandise.ts';
import {requiresOmittedStockCorrection} from './omittedMerchandise.ts';
import {isUnsentMerchandiseRefund} from './economics.ts';
import {hasRecordedIncidentCost} from './operatorWorkflow.ts';
import {incidentShipments} from './shipmentConfirmation.ts';
import type { Incident, IncidentClosureChecklist } from "./types.ts";

const isOutstanding = (state: string) =>
  state === "pending" || state === "in_progress" || state === "blocked";

/** Derives the close gate instead of allowing a chosen solution to close work. */
export function getIncidentClosureChecklist(incident: Incident): IncidentClosureChecklist {
  const clientSolved = incident.clientStatus === "Solucionado";
  const logisticsResolved = !incident.processes.some(
    (process) => process.requiredToClose && isOutstanding(process.state) &&
      // These already have their own mandatory closure check. A stock task
      // must not make a completed shipment appear pending a second time.
      process.kind !== 'stock_adjustment' && process.kind !== 'reception' &&
      !(process.kind === 'diagnosis' && incident.type === 'warranty'),
  ) && !incident.processes.some(process =>
    process.requiredToClose && process.kind === "reshipment" &&
    !incidentShipments(incident).allSent,
  );
  const goodsRegularized = (!requiresExtraOutbound(incident)||extraOutboundRecorded(incident)) && (!requiresOmittedStockCorrection(incident)||incident.returns.some(r=>r.stockCorrection&&r.state==='processed'&&incident.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'))) && (incident.returns || []).every(r => r.state === "processed" || r.state === "cancelled") && !incident.processes.some(
    (process) =>
      process.requiredToClose &&
      process.kind === "reception" &&
      isOutstanding(process.state),
  );
  const stockRegularized = incident.stockRegularized && (
    !incident.processes.some(
      (process) =>
        process.requiredToClose &&
        process.kind === "stock_adjustment" &&
        isOutstanding(process.state),
    ));
  const warrantyResolved =
    incident.type !== "warranty" ||
    !incident.processes.some(
      (process) =>
        process.requiredToClose &&
        process.kind === "diagnosis" &&
        isOutstanding(process.state),
    );
  const claimsResolvedOrAssumed = incident.claimIds.every((claimId) => {
    const claim = incident.claims.find((item) => item.id === claimId);
    return Boolean(claim && (claim.status === "compensated" || (claim.status === "closed" && (claim.assumed || (claim.recoveredAmount ?? 0) > 0))));
  });
  const costsClosed = hasRecordedIncidentCost(incident);

  const checks: Array<[boolean, string]> = [
    [clientSolved, "Cliente solucionado"],
    [goodsRegularized, "Recepciones y devoluciones procesadas"],
    [logisticsResolved, "Reenvíos y procesos logísticos finalizados"],
    [warrantyResolved, "Garantía diagnosticada y resuelta"],
    [claimsResolvedOrAssumed, "Reclamaciones resueltas o asumidas"],
    [costsClosed, "Costes registrados"],
  ];
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);

  return {
    clientSolved,
    goodsRegularized,
    stockRegularized,
    logisticsResolved,
    warrantyResolved,
    claimsResolvedOrAssumed,
    costsClosed,
    missing,
    canClose: missing.length === 0,
  };
}

/** Net loss is extraordinary costs minus recoveries/indemnities. */
export function getIncidentNetLoss(incident: Incident): number {
  return incident.costs.reduce((total, cost) => {
    if(isUnsentMerchandiseRefund(incident,cost))return total;
    const amount = Math.abs(cost.amount);
    return total + (cost.direction === "cost" ? amount : -amount);
  }, 0);
}
