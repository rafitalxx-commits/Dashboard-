import {isUnsentMerchandiseRefund} from './economics.ts';
import {explicitlyEnteredIncidentCost,recordedIncidentCost} from './operatorWorkflow.ts';
import type { Incident } from './types.ts';

export type StatisticsFilters = { from: string; to: string; operator?: string; resolver?: string; carrier?: string; type?: string; channel?: string; status?: string; origin?: string; caseScope?: 'warranty'|'returns'|'other'; includeTests?: boolean; testEnvironment?: boolean };
const preparationTypes = new Set(['wrong_product','missing_product','wrong_quantity','order_crossing','wrong_packaging']);
export const isPreparationError = (i: Incident) => i.origin === 'warehouse' && preparationTypes.has(i.type);
export const isTestIncident = (i: Incident) => /^(lab|test|demo|qa|example)([-_:]|$)/i.test(i.requestId) || /^(TEST|DEMO|QA)[-_]/i.test(i.order.odooReference) || Boolean(i.odooOperations?.some(op => op.simulated || /demo|test/i.test(op.target || '')));
export function resolution(i: Incident) {
  if (i.clientStatus !== 'Solucionado') return null;
  const event = i.timeline.filter(e => e.type === 'client_solved').reverse().sort((a,b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (!event) return { actor: 'Sin identificar', hours: null };
  const hours = (Date.parse(event.occurredAt) - Date.parse(i.createdAt)) / 3600000;
  return { actor: event.actor?.trim() || 'Sin identificar', hours: Number.isFinite(hours) && hours >= 0 ? hours : null };
}
const cents = (amount: number) => Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100) : 0;
const businessDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
/** Locale formatting order differs across browsers; keys must always be ISO. */
export function statisticsDate(value: Date) {
  const parts=Object.fromEntries(businessDate.formatToParts(value).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const incidentDate = (i: Incident) => Number.isFinite(Date.parse(i.createdAt)) ? statisticsDate(new Date(i.createdAt)) : '';
export function incidentEconomics(i: Incident) {
  let gross = 0, recovered = 0, estimated = 0, pendingRecovery = 0, pendingLines = 0, transport = 0, merchandise = 0, saleAdjustments = 0;
  for (const c of i.costs) {
    if(c.direction==='cost'&&c.amount===0&&!recordedIncidentCost(i,c))continue;
    const amount = cents(c.amount);
    if(isUnsentMerchandiseRefund(i,c)){saleAdjustments+=amount;continue;}
    if (c.direction === 'recovery') {
      if (c.state === 'confirmed') recovered += amount;
      else if (c.source !== 'carrier' && c.state !== 'assumed') pendingRecovery += amount;
    } else if (c.state === 'confirmed' || c.state === 'assumed' || explicitlyEnteredIncidentCost(i,c)) {
      gross += amount;
      if (['pickup','return_shipping','reshipment'].includes(c.category)) transport += amount;
      if (c.category === 'lost_product') merchandise += amount;
    } else { estimated += amount; pendingLines++; }
  }
  // The cost ledger is authoritative for receipts. Do not add claim.recoveredAmount again.
  for (const c of i.claims) if (!['closed','compensated','rejected'].includes(c.status) && !c.assumed) pendingRecovery += Math.max(0,cents(c.claimedAmount || 0)-cents(c.recoveredAmount || 0));
  return { gross:gross/100, recovered:recovered/100, net:(gross-recovered)/100, estimated:estimated/100, pendingRecovery:pendingRecovery/100, pendingLines, transport:transport/100, merchandise:merchandise/100, saleAdjustments:saleAdjustments/100 };
}
export function filterStatistics(incidents: Incident[], f: StatisticsFilters, dates = true) {
  return incidents.filter(i => (f.includeTests || !(f.testEnvironment || isTestIncident(i))) && (!dates || incidentDate(i) >= f.from && incidentDate(i) <= f.to)
    && (!f.caseScope || (f.caseScope === 'warranty' ? i.type === 'warranty' : f.caseScope === 'returns' ? i.returns.length > 0 : i.type !== 'warranty' && i.returns.length === 0))
    && (!f.operator || isPreparationError(i) && (i.order.preparedBy?.trim() || 'Sin atribuir') === f.operator)
    && (!f.resolver || resolution(i)?.actor === f.resolver) && (!f.carrier || (i.order.carrier || 'Sin agencia') === f.carrier)
    && (!f.type || i.type === f.type) && (!f.channel || i.order.channel === f.channel) && (!f.status || i.status === f.status) && (!f.origin || i.origin === f.origin));
}
export function aggregateStatistics(rows: Incident[]) {
  const total = { count:rows.length, gross:0, recovered:0, net:0, estimated:0, pendingRecovery:0, pendingLines:0, transport:0, merchandise:0, saleAdjustments:0, solved:0, preparation:0, unattributed:0 };
  for (const i of rows) { const e=incidentEconomics(i); for (const key of ['gross','recovered','net','estimated','pendingRecovery','pendingLines','transport','merchandise','saleAdjustments'] as const) total[key] += e[key]; if (resolution(i)) total.solved++; if (isPreparationError(i)) {total.preparation++; if (!i.order.preparedBy?.trim()) total.unattributed++;} }
  for (const key of ['gross','recovered','net','estimated','pendingRecovery','transport','merchandise','saleAdjustments'] as const) total[key] = Math.round(total[key]*100)/100;
  return total;
}
export function groupStatistics(rows: Incident[], key: 'operator'|'carrier'|'resolver') {
  const groups = new Map<string, Incident[]>();
  for (const i of rows) {
    if (key==='operator' && !isPreparationError(i) || key==='resolver' && !resolution(i)) continue;
    const name=key==='operator' ? i.order.preparedBy?.trim() || 'Sin atribuir' : key==='carrier' ? i.order.carrier || 'Sin agencia' : resolution(i)!.actor;
    groups.set(name,[...(groups.get(name)||[]),i]);
  }
  return [...groups].map(([name,items])=>{const times=items.map(i=>resolution(i)?.hours).filter((h): h is number=>h!=null);return {name,...aggregateStatistics(items),transportCases:items.filter(i=>i.origin==='carrier').length,hours:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,items};}).sort((a,b)=>key==='resolver'?b.solved-a.solved:b.net-a.net||b.count-a.count);
}
