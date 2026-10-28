import {requiresExtraOutbound,extraOutboundRecorded} from './excessMerchandise.ts';
import {requiresOmittedStockCorrection} from './omittedMerchandise.ts';
import {confirmedReshipment} from './shipmentConfirmation.ts';
import {confirmWarehouseReceipt} from './receiptConfirmation.ts';
import {coherentIncident} from './coherence.ts';
import type { IncidentRepository } from './repository.ts';
import type { Incident, WizardDraft } from './types.ts';
import { applyAction, buildIncident, attachOmittedStockCorrectionReturn, updateIncidentDerivedState, type Action } from './workflow.ts';
import { IncidentSequence } from './sequence.ts';
export class IncidentService {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(public repo:IncidentRepository, private sequencePath?:string){}
 private async serial<T>(fn:()=>Promise<T>):Promise<T>{const work=this.queue.then(fn);this.queue=work.catch(()=>{});return work;}
 async create(d:WizardDraft,actor:string,prepare?:(items:Incident[])=>Promise<void>){return this.serial(async()=>{const all=await this.repo.list(true);const seen=all.find(i=>i.requestId===d.requestId);if(seen)return seen;if(!/^[a-zA-Z0-9_-]{8,100}$/.test(d.requestId))throw Error('ID de solicitud inválido');const year=new Date().getFullYear();const sequence=new IncidentSequence(this.sequencePath,year,all.map(i=>i.id),all.flatMap(i=>i.returns.map(r=>r.id)));const i=buildIncident(d,sequence.next('INC'),sequence.next('DEV'),actor);const created=[i];if(d.type==='order_crossing'&&d.relatedContext){const other=buildIncident({...d,requestId:d.requestId+'-related',context:d.relatedContext,relatedContext:d.context,products:d.relatedContext.products},sequence.next('INC'),sequence.next('DEV'),actor);i.relatedIncidentIds=[other.id];other.relatedIncidentIds=[i.id];created.push(other);}sequence.persist();if(prepare)await prepare(created);await this.repo.save(created,Object.fromEntries(created.map(x=>[x.id,0])));return i;});}
 /** Explicit document recovery only; never bulk-rewrite or blindly replay a legacy correction. */
 async ensureOmittedStockCorrection(id:string,revision:number,actor:string){return this.serial(async()=>{
  const all=await this.repo.list(true),i=all.find(i=>i.id===id);if(!i||i.revision!==revision)throw Error('Otro usuario modificó la incidencia. Actualiza antes de recuperar');
  if(!requiresOmittedStockCorrection(i)||i.returns.some(r=>r.stockCorrection))return i;
  if(i.returns.length||i.odooOperations?.length)throw Error('Hay devoluciones o movimientos anteriores; conciliar antes de añadir una DEV correctiva');
  if(!i.stockPlan.some(p=>p.action==='correct_recorded_vs_physical'))throw Error('Falta el plan de corrección original; requiere revisión');
  const year=new Date().getFullYear(),sequence=new IncidentSequence(this.sequencePath,year,all.map(i=>i.id),all.flatMap(i=>i.returns.map(r=>r.id)));
  attachOmittedStockCorrectionReturn(i,sequence.next('DEV'),actor);sequence.persist();
  if(i.status==='Cerrada'){const previousClosedAt=i.closedAt;i.status='Resuelta';delete i.closedAt;
   i.timeline.push({id:crypto.randomUUID(),type:'incident_reopened',actor,occurredAt:new Date().toISOString(),summary:'Gestión interna reabierta para corregir stock omitido; se conserva la solución y el abono del cliente',details:{previousClosedAt:previousClosedAt||null,reason:'missing_stock_correction',clientStatus:i.clientStatus}});
  }
  i.stockRegularized=false;for(const p of i.processes.filter(p=>p.kind==='stock_adjustment'))p.state='pending';
  updateIncidentDerivedState(i);i.revision++;i.updatedAt=new Date().toISOString();await this.repo.save([i],{[id]:revision});return i;
 });}
 async action(id:string,revision:number,a:Action,actor:string){return this.serial(async()=>{const current=(await this.repo.list(true)).find(i=>i.id===id);if(!current)throw Error('Incidencia no encontrada');if(current.revision!==revision)throw Error('Otro usuario modificó la incidencia. Actualiza antes de guardar');const changed=applyAction(current,a,actor);await this.repo.save([changed],{[id]:revision});return changed;});}
 async confirmNoStockMovement(id:string,revision:number,actor:string){return this.serial(async()=>{
  const i=(await this.repo.list(true)).find(x=>x.id===id);if(!i||i.revision!==revision)throw Error('Otro usuario modificó la incidencia. Actualiza antes de guardar');
  if(i.solution!=='cross_direct'||i.returns.length||i.stockPlan.some(p=>p.action==='new_outbound'))throw Error('Esta operación requiere movimientos físicos');
  if(i.stockRegularized)return i;
  i.stockRegularized=true;for(const p of i.processes.filter(p=>p.kind==='stock_adjustment')){p.state='resolved';p.resultReference='Cruce directo: salidas originales verificadas; sin movimiento intermedio';}
  i.timeline.push({id:crypto.randomUUID(),type:'stock_regularized',actor,occurredAt:new Date().toISOString(),summary:'Cruce directo: salidas originales verificadas en Odoo. No corresponde entrada/salida intermedia; entrega entre clientes pendiente de justificante logístico.'});i.revision++;i.updatedAt=new Date().toISOString();await this.repo.save([i],{[id]:revision});return i;
 });}
 async confirmOdoo(id:string,revision:number,result:NonNullable<Incident['odooOperations']>[number],requiredKeys:string[],actor:string,ready=true){return this.serial(async()=>{
  const i=(await this.repo.list(true)).find(x=>x.id===id);if(!i)throw Error('Incidencia no encontrada');
  const priorIndex=i.odooOperations?.findIndex(x=>x.key===result.key&&x.pickingId===result.pickingId)??-1;
  const sameStatus=priorIndex>=0&&i.odooOperations![priorIndex].status===result.status;
  const correctionRepair=sameStatus&&result.kind==='return'&&result.status==='done'&&i.returns.some(r=>r.id===result.returnId&&r.stockCorrection&&r.state!=='processed'&&r.state!=='cancelled');
  if(sameStatus&&!requiredKeys.length&&!correctionRepair)return i;
  const before=JSON.stringify(i);if(sameStatus)result=i.odooOperations![priorIndex];
  if(!sameStatus&&i.revision!==revision)throw Error('Otro usuario modificó la incidencia; Odoo ya confirmado. Recupera solo el historial mediante conciliación');
  const expected=i.revision;if(priorIndex>=0)i.odooOperations![priorIndex]=result;else i.odooOperations=[...(i.odooOperations||[]),result];
  if(result.receiptSourceKey){
   const source=i.odooOperations!.find(op=>op.key===result.receiptSourceKey);
   if(!source||source.status!=='awaiting_arrival'||source.pickingId!==result.pickingId||(source.receiptConsumedBy&&source.receiptConsumedBy!==result.key))throw Error('Lote no corresponde a la entrada pendiente auditada');
   source.receiptConsumedBy=result.key;
   if(result.backorder&&!i.odooOperations!.some(op=>op.key===result.backorder!.key))i.odooOperations!.push({key:result.backorder.key,digest:result.digest,pickingId:result.backorder.pickingId,confirmedAt:result.confirmedAt,status:'awaiting_arrival',externalReference:result.backorder.externalReference,kind:'return',returnId:result.returnId,lines:result.backorder.lines,target:result.target,receiptOrigin:result.receiptOrigin,backorderOf:result.pickingId});
  }
  const dev=result.kind==='return'?i.returns.find(r=>result.returnId===r.id||result.key===`${id}:return:${r.id}`):undefined;if(dev){dev.odooReceiptId=i.odooOperations!.find(op=>op.kind==='return'&&op.returnId===dev.id&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy)?.pickingId||i.odooOperations!.filter(op=>op.kind==='return'&&op.returnId===dev.id&&op.status==='done').at(-1)?.pickingId||result.pickingId;if(dev.stockCorrection&&result.status==='done'){dev.state='processed';dev.updatedAt=result.confirmedAt;}}
  const correctionDevDone=i.returns.some(r=>r.stockCorrection&&r.state==='processed'&&i.odooOperations!.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'));
  i.stockRegularized=correctionDevDone||(requiresExtraOutbound(i)&&extraOutboundRecorded(i)&&i.returns.every(r=>['processed','cancelled'].includes(r.state)))||ready&&!i.odooOperations!.some(op=>op.kind==='return'&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy)&&requiredKeys.length>0&&requiredKeys.every(key=>i.odooOperations!.some(x=>x.key===key&&(x.status==='done'||!x.status)));
  if(correctionDevDone)for(const process of i.processes.filter(p=>p.kind==='stock_adjustment')){process.state='resolved';process.updatedAt=result.confirmedAt;process.resultReference=`DEV ${i.returns.find(r=>r.stockCorrection&&r.state==='processed')?.odooReceiptId||result.pickingId} validada en Odoo`}
  if(i.stockRegularized)for(const process of i.processes.filter(p=>p.kind==='stock_adjustment')){const reference=(i.odooOperations||[]).map(x=>String(x.pickingId)).join(', ');if(process.state!=='resolved'||process.resultReference!==reference){process.state='resolved';process.updatedAt=result.confirmedAt;process.resultReference=reference;}}
  if(result.kind==='reshipment')for(const process of i.processes.filter(p=>p.kind==='reshipment')){
   if(result.status==='ready_for_expedition'){process.state='in_progress';process.resultReference=result.dispatchReference||String(result.pickingId);process.updatedAt=result.confirmedAt;}
   if(confirmedReshipment(result)){process.state='resolved';process.resultReference=`${result.dispatchReference||result.pickingId} · etiqueta ${result.simulated?'SIMULADA DEMO ':''}${result.shipmentCode}`;process.updatedAt=result.confirmedAt;}
  }
  if(result.kind==='scrap'&&result.returnId&&result.status==='done'&&priorIndex<0){
   const prices=(result.lines||[]).map(l=>({quantity:l.quantity,cost:i.products.find(p=>p.sku===l.sku)?.unitCostSnapshot}));
   i.costs.push({id:crypto.randomUUID(),description:`Producto dañado desechado · ${result.externalReference||result.scrapId}`,category:'lost_product',amount:prices.reduce((n,x)=>n+x.quantity*(x.cost||0),0),direction:'cost',state:prices.every(x=>x.cost!==undefined)?'confirmed':'pending',occurredAt:result.confirmedAt,source:'return'});
  }
  updateIncidentDerivedState(i);
  if(sameStatus&&JSON.stringify(i)===before)return i;
  const completed=result.status==='done'||!result.status;
  i.timeline.push({id:crypto.randomUUID(),type:confirmedReshipment(result)?'reshipment_sent':completed?'stock_regularized':result.kind==='reshipment'?'reshipment_created':'reception_created',actor,occurredAt:result.confirmedAt,summary:dev?.stockCorrection&&result.status==='done'?`DEV ${dev.id} validada en Odoo como devolución enlazada a la salida original; stock corregido. No hubo recepción física del cliente`:result.backorder?`Lote recibido en Odoo: ${result.externalReference||result.pickingId}. Resto pendiente en backorder ${result.backorder.externalReference} (#${result.backorder.pickingId}); devolución y cliente sin completar`:result.discardedRemainder?.length?`Entrada Odoo ${result.externalReference||result.pickingId} confirmada. Producto incompleto: faltante cancelado en Odoo (${result.discardedRemainder.map(line=>`${line.sku} × ${line.quantity}`).join(', ')}); la DEV no queda pendiente por esas unidades`:result.simulated?`PRUEBA DEMO: salida ${result.externalReference||result.pickingId} validada con etiqueta simulada ${result.shipmentCode}. Sin transporte ni entrega reales`:completed?`Odoo validado: ${result.key} · ${result.kind==='scrap'?'desecho':'albarán'} ${result.externalReference||result.pickingId}. No acredita entrega al cliente ni reembolso`:`Albarán Odoo ${result.externalReference||result.pickingId} creado para ${result.kind==='reshipment'?'reexpedición pendiente de Expediciones':'recepción pendiente de llegada física'}. Pedido ${i.order.odooReference}; aún no mueve stock`});
  i.revision++;i.updatedAt=result.confirmedAt;await this.repo.save([i],{[id]:expected});return i;
 });}
 async confirmStoredReceipt(id:string,revision:number,returnId:string,actor:string){return this.serial(async()=>{
  const i=(await this.repo.list(true)).find(x=>x.id===id);if(!i||i.revision!==revision)throw Error('Otro usuario modificó la incidencia. Actualiza antes de guardar');
  if(i.status==='Cerrada')throw Error('La incidencia está cerrada');
  const r=i.returns.find(x=>x.id===returnId);if(!r||r.state==='cancelled')throw Error('Devolución inexistente o cancelada');
  if(r.state==='processed')return i;
  if(r.warehouseConfirmedAt&&!r.odooSyncError)return i;
  if(!r.warehouseConfirmedAt&&!confirmWarehouseReceipt(i,r))return i;
  delete r.odooSyncError;
  i.timeline.push({id:crypto.randomUUID(),type:'goods_received',actor,occurredAt:new Date().toISOString(),summary:`${r.id}: producto recepcionado en almacén según inspección ya guardada; sincronización Odoo pendiente, sin repetir recepción`});
  updateIncidentDerivedState(i);i.revision++;i.updatedAt=new Date().toISOString();await this.repo.save([i],{[id]:revision});return i;
 });}
 async recordReceiptSyncFailure(id:string,message:string){return this.serial(async()=>{
  const i=(await this.repo.list(true)).find(x=>x.id===id);if(!i)return;
  const pending=i.returns.filter(r=>r.state==='arrived'&&r.odooSyncError!==message);if(!pending.length)return;
  const revision=i.revision;for(const r of pending)r.odooSyncError=message;
  i.revision++;i.updatedAt=new Date().toISOString();await this.repo.save([i],{[id]:revision});
 });}
 async completeReturnAfterOdoo(id:string,returnId:string,actor:string){return this.serial(async()=>{
  const i=(await this.repo.list(true)).find(x=>x.id===id);if(!i)throw Error('Incidencia no encontrada');
  const r=i.returns.find(x=>x.id===returnId);if(!r||r.state!=='arrived'||!r.receivedBy||!r.condition||!r.destination)throw Error('Recepción física sin inspección o destino completo');
  if(r.products.some(product=>Number(product.receivedQuantity||0)>product.expectedQuantity))throw Error('La cantidad recibida supera la cantidad esperada');
  if(r.condition!=='incomplete'&&r.products.some(product=>product.receivedQuantity!==product.expectedQuantity))throw Error('Quedan cantidades físicas pendientes de recibir; márcalo como incompleto si el faltante es definitivo');
  const operations=i.odooOperations||[];const inbound=operations.filter(op=>op.kind==='return'&&op.returnId===returnId);
  const requiresInbound=r.products.some(product=>r.itemOverrides?.find(item=>item.expectedSku===product.sku)?.mode!=='not_ours');
  if((requiresInbound&&!inbound.some(op=>op.status==='done'))||inbound.some(op=>op.status==='awaiting_arrival'&&!op.receiptConsumedBy))throw Error('Entrada Odoo incompleta o con unidades pendientes');
  if(!requiresInbound&&(r.destination!=='not_ours'||r.itemOverrides?.length!==r.products.length||r.itemOverrides.some(item=>item.mode!=='not_ours')))throw Error('La excepción sin stock Odoo requiere que toda la mercancía se marque como ajena al catálogo');
  if(r.destination==='discard'){
   const expected=new Map<number,number>();for(const op of inbound.filter(x=>x.status==='done'))for(const line of op.lines||[])expected.set(line.productId,(expected.get(line.productId)||0)+line.quantity);
   const scrapped=new Map<number,number>();for(const op of operations.filter(x=>x.kind==='scrap'&&x.returnId===returnId&&x.status==='done'))for(const line of op.lines||[])scrapped.set(line.productId,(scrapped.get(line.productId)||0)+line.quantity);
   if([...expected].some(([productId,quantity])=>Math.abs(quantity-(scrapped.get(productId)||0))>1e-8))throw Error('Desecho Odoo pendiente o incompleto');
  }
  const expectedRevision=i.revision;r.state='processed';delete r.odooSyncError;r.updatedAt=new Date().toISOString();
  const process=i.processes.find(p=>p.kind==='reception'&&p.title.startsWith(returnId));if(process){process.state='resolved';process.updatedAt=r.updatedAt;process.resultReference=r.destination==='discard'?'Producto recepcionado; entrada y desecho Odoo confirmados':'Producto recepcionado en Odoo';}
  i.stockRegularized=i.stockRegularized&&!(i.returns.some(item=>item.id!==returnId&&item.state!=='processed'&&item.state!=='cancelled')||operations.some(op=>op.kind==='return'&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy));
  i.timeline.push({id:crypto.randomUUID(),type:requiresInbound?'stock_regularized':'goods_received',actor,occurredAt:r.updatedAt,summary:requiresInbound?`${returnId}: producto recepcionado; ${r.destination==='discard'?'entrada y desecho':'reincorporación a stock'} confirmados en Odoo`:`${returnId}: producto recepcionado; mercancía ajena al catálogo registrada, sin movimiento de stock Odoo`});
  updateIncidentDerivedState(i);i.revision++;i.updatedAt=r.updatedAt;await this.repo.save([i],{[id]:expectedRevision});return i;
 });}
 async reconcileCoherence(id:string,revision:number,actor:string){return this.serial(async()=>{
  const original=(await this.repo.list(true)).find(i=>i.id===id);if(!original||original.revision!==revision)throw Error('Otro usuario modificó la incidencia. Actualiza antes de guardar');
  const changed=coherentIncident(original);if(JSON.stringify(changed)===JSON.stringify(original))return original;
  changed.revision++;changed.updatedAt=new Date().toISOString();changed.timeline.push({id:crypto.randomUUID(),type:'note_added',actor,occurredAt:changed.updatedAt,summary:'Coherencia interna revisada: no se han repetido movimientos Odoo ni atribuido un operario histórico.'});
  await this.repo.save([changed],{[id]:revision});return changed;
 });}
 async attachEvidence(id:string,evidence:Incident['evidence'][number],folder:{id:string;url:string},actor:string,photosFolder?:{id:string;url:string}){return this.serial(async()=>{
  const i=(await this.repo.list(true)).find(x=>x.id===id);if(!i)throw Error('Incidencia no encontrada');
  if(i.evidence.some(e=>e.id===evidence.id))return i;
  if(i.status==='Cerrada')throw Error('La incidencia está cerrada; el archivo sigue en Drive y requiere revisión');
  const r=evidence.returnId?i.returns.find(r=>r.id===evidence.returnId):undefined;if(evidence.returnId&&!r)throw Error('DEV ajena a incidencia');
  const expected=i.revision;i.evidence.push(evidence);i.driveFolder=folder;if(evidence.mimeType.startsWith('image/')&&photosFolder)i.drivePhotosFolder=photosFolder;
  if(r&&!r.driveFileIds.includes(evidence.id))r.driveFileIds.push(evidence.id);
  i.photoCount=i.evidence.filter(e=>e.mimeType.startsWith('image/')).length;
  i.timeline.push({id:crypto.randomUUID(),type:'evidence_added',actor,occurredAt:new Date().toISOString(),summary:`Archivo Drive añadido: ${evidence.name}`});
  i.revision++;i.updatedAt=new Date().toISOString();await this.repo.save([i],{[id]:expected});return i;
 });}
}
