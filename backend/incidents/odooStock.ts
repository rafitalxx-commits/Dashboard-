import {requiresExtraOutbound} from './excessMerchandise.ts';
import {requiresOmittedStockCorrection} from './omittedMerchandise.ts';
import {returnBeforeReshipmentBlockers} from './reshipment.ts';
import {unidentifiedReturnProduct} from './merchandise.ts';
import {IncidentChatter} from './chatter.ts';
import {applyReceiptBatch,verifyReceiptBatch,reconcileReceiptBatchIfCompleted} from './receiptBatch.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { reshipmentReference } from './reshipment.ts';
import { operationalTargetMatches, operationalWorkflowWritable, physicalWorkflowWritable, operationalRexWritable, operationalDocumentsWritable, demoWorkflowWritable, TEST_TARGET } from './odooRuntime.ts';
export { TEST_TARGET } from './odooRuntime.ts';
import type { Incident } from './types.ts';
import { reviewPartialReceipt, type ReceiptReview } from './partialReceipt.ts';
export type OdooCall = (model:string,method:string,args:unknown[],kwargs?:Record<string,unknown>)=>Promise<any>;
export type StockLine = {productId:number;sku:string;quantity:number;uomId:number;sourceId:number;destinationId:number;saleLineId?:number;toRefund?:boolean;originMoveId?:number};
export type StockOperation = {extraOutbound?:boolean;receiptOrigin?:string;standardReturn?:boolean;backorderOf?:number;discardRemainder?:boolean;receiptBatch?:{sourceKey:string;pickingId:number;origin:string;expected:StockLine[];parentPickingId?:number};receiptReview?:ReceiptReview;key:string;kind:'correction'|'return'|'reshipment'|'scrap';returnId?:string;blockers:string[];lines:StockLine[];stageOnly?:boolean;existingPickingId?:number;dispatchReference?:string;originalPickingId?:number;originalOrderReference?:string;originalReceiptKey?:string};
export type StockProposal = {incidentId:string;revision:number;target:string;orderId:number;companyId:number;partnerId:number;customerLocationId:number;outgoingPickingTypeId:number;operations:StockOperation[];blockers:string[];digest:string;originalPickingIds:number[];openOutgoingPickings:Array<{id:number;name:string;state:string;lines:Array<{product:string;quantity:number}>}>};
const relation=(v:any)=>Array.isArray(v)?Number(v[0]):0;
const done=(s:string)=>['resolved','assumed'].includes(s);
/** Loss/damage scraps the original customer-side material, never a second warehouse decrement. */
export class IncidentOdooStock {
 constructor(private call:OdooCall,private target:string){}
 async propose(i:Incident,related:Incident[]=[],options:{prepareDocuments?:boolean}={}):Promise<StockProposal>{
  const blockers:string[]=[];const operations:StockOperation[]=[];
  if(i.odooOperations?.some(op=>(op.target||TEST_TARGET)!==this.target))blockers.push('La incidencia contiene movimientos de otra base Odoo; se requiere conciliación explícita antes de cambiar de conexión');
  const orders=await this.call('sale.order','search_read',[[['name','=',i.order.odooReference]]],{fields:['id','name','company_id','partner_shipping_id','warehouse_id'],limit:2});
  if(orders.length!==1)throw Error('El pedido no existe de forma unívoca en la conexión Odoo seleccionada; no se reutilizan IDs de otra base');
  const order=orders[0];const companyId=relation(order.company_id),partnerId=relation(order.partner_shipping_id);
  if(!companyId||!partnerId)blockers.push('Falta compañía o dirección de entrega del pedido');
  const orderLines=await this.call('sale.order.line','search_read',[[['order_id','=',order.id],['state','!=','cancel']]],{fields:['id','product_id','product_uom','product_uom_qty'],limit:500});
  const pickings=await this.call('stock.picking','search_read',[[['sale_id','=',order.id],['state','=','done'],['picking_type_id.code','=','outgoing']]],{fields:['id','origin','location_id','location_dest_id','company_id','picking_type_id'],limit:100});
  const activeOut=await this.call('stock.picking','search_read',[[['sale_id','=',order.id],['state','not in',['done','cancel']],['picking_type_id.code','=','outgoing']]],{fields:['id','name','state'],limit:100});
  const activeMoves=activeOut.length?await this.call('stock.move','search_read',[[['picking_id','in',activeOut.map((p:any)=>p.id)],['state','!=','cancel']]],{fields:['picking_id','product_id','product_uom_qty'],limit:1000}):[];
  const openOutgoingPickings=activeOut.map((p:any)=>({id:Number(p.id),name:String(p.name||p.id),state:String(p.state),lines:activeMoves.filter((m:any)=>relation(m.picking_id)===Number(p.id)).map((m:any)=>({product:String(Array.isArray(m.product_id)?m.product_id[1]:m.product_id||'Producto'),quantity:Number(m.product_uom_qty||0)}))}));
  const foreignOutgoing=activeOut.filter((p:any)=>!i.odooOperations?.some(op=>op.kind==='reshipment'&&op.pickingId===p.id&&op.dispatchReference&&op.lines?.length&&op.status==='ready_for_expedition'&&(op.target||TEST_TARGET)===this.target));
  if(foreignOutgoing.length)blockers.push(`El pedido ya tiene una salida no finalizada en Odoo (${openOutgoingPickings.filter((p:{id:number})=>foreignOutgoing.some((out:any)=>out.id===p.id)).map((p:{name:string;id:number;state:string})=>`${p.name} #${p.id} · ${p.state}`).join(', ')}); conciliarla antes de crear otro REX`);
  const locations=new Set(pickings.map((p:any)=>`${relation(p.location_id)}:${relation(p.location_dest_id)}`));
  if(locations.size>1)blockers.push('Varias rutas originales: seleccionar y conciliar el albarán exacto');
  const outgoingPickingTypes=new Set(pickings.map((p:any)=>relation(p.picking_type_id)).filter(Boolean));
  if(outgoingPickingTypes.size>1)blockers.push('Varios tipos de albarán saliente originales: selección explícita necesaria');
  let outgoingPickingTypeId=relation(pickings[0]?.picking_type_id);
  if(!outgoingPickingTypeId&&pickings.length)blockers.push('Falta el tipo de operación del albarán original');
  if(pickings.some((p:any)=>relation(p.company_id)!==companyId))blockers.push('Compañía de la salida original inconsistente');
  let stockId=relation(pickings[0]?.location_id),customerId=relation(pickings[0]?.location_dest_id);
  if(!pickings.length){
   const warehouseId=relation(order.warehouse_id);
   if(!warehouseId)blockers.push('Sin salida original validada ni almacén asignado al pedido; no se puede determinar una ruta REX segura');
   else {
    const warehouses=await this.call('stock.warehouse','read',[[warehouseId]],{fields:['id','company_id','lot_stock_id','out_type_id']});
    if(warehouses.length!==1||relation(warehouses[0].company_id)!==companyId)blockers.push('Almacén del pedido inexistente, ambiguo o de otra compañía');
    else {
     const warehouse=warehouses[0];stockId=relation(warehouse.lot_stock_id);outgoingPickingTypeId=relation(warehouse.out_type_id);
     const types=outgoingPickingTypeId?await this.call('stock.picking.type','read',[[outgoingPickingTypeId]],{fields:['id','code','company_id','default_location_src_id','default_location_dest_id']}):[];
     const partners=partnerId?await this.call('res.partner','read',[[partnerId]],{fields:['id','property_stock_customer']}):[];
     if(types.length!==1||types[0].code!=='outgoing'||relation(types[0].company_id)!==companyId)blockers.push('El tipo de salida configurado en el almacén no es único o no corresponde a la compañía');
     else if(relation(types[0].default_location_src_id)&&relation(types[0].default_location_src_id)!==stockId)blockers.push('La ubicación origen por defecto no coincide con el stock del almacén del pedido');
     customerId=relation(partners[0]?.property_stock_customer)||relation(types[0]?.default_location_dest_id);
     const locations=stockId&&customerId?await this.call('stock.location','read',[[stockId,customerId]],{fields:['id','usage','company_id']}):[];
     const source=locations.find((x:any)=>x.id===stockId),destination=locations.find((x:any)=>x.id===customerId);
     if(!source||source.usage!=='internal'||relation(source.company_id)!==companyId||!destination||destination.usage!=='customer'||customerId===stockId)blockers.push('La ruta derivada del almacén y destinatario no es válida; se requiere revisión de Odoo');
    }
   }
  }
  if(i.type==='order_crossing'){
   const other=related.find(x=>i.relatedIncidentIds.includes(x.id)&&x.relatedIncidentIds.includes(i.id));
   if(!other)blockers.push('Cruce: identifica la segunda incidencia y pedido relacionados; no inferir la mercancía cruzada');
   else {
    const otherOrders=await this.call('sale.order','search_read',[[['name','=',other.order.odooReference]]],{fields:['id','company_id'],limit:2});
    if(otherOrders.length!==1||relation(otherOrders[0].company_id)!==companyId)blockers.push('Cruce: segundo pedido Odoo inexistente, ambiguo o de otra compañía');
    else {const otherPickings=await this.call('stock.picking','search_read',[[['sale_id','=',otherOrders[0].id],['state','=','done'],['picking_type_id.code','=','outgoing']]],{fields:['id','location_id','location_dest_id','company_id'],limit:100});if(!otherPickings.length||otherPickings.some((p:any)=>relation(p.location_id)!==stockId||relation(p.location_dest_id)!==customerId||relation(p.company_id)!==companyId))blockers.push('Cruce: la segunda salida original debe estar validada y compartir ruta/compañía; no crear ajuste intermedio');}
   }
  }
  const moveRows=pickings.length?await this.call('stock.move','search_read',[[['picking_id','in',pickings.map((p:any)=>p.id)],['state','=','done'],['scrapped','=',false]]],{fields:['id','picking_id','product_id','quantity','product_uom','sale_line_id','location_id','location_dest_id'],limit:1000}):[];
  if(moveRows.length===1000)blockers.push('Demasiados movimientos originales: conciliación manual necesaria');
  const product=async(sku:string,skipNonStock=false,allowKitParent=false)=>{
   const products=await this.call('product.product','search_read',[[['default_code','=',sku]]],{fields:['id','default_code','product_tmpl_id','uom_id','tracking','company_id','is_storable','type'],limit:2});
   if(products.length!==1){blockers.push(`Referencia Odoo inexistente o ambigua: ${sku}`);return;}
   const p=products[0];if(p.type==='service')return;if(p.tracking!=='none'){blockers.push(`Lote/serie obligatorio para ${sku}; no se inventa trazabilidad`);return;}
   if(!p.is_storable&&skipNonStock&&!allowKitParent)return;
   if(!p.is_storable&&!allowKitParent){blockers.push(`${sku}: producto no almacenable; no regularizar stock`);return;}
   if(relation(p.company_id)&&relation(p.company_id)!==companyId){blockers.push(`${sku}: compañía incompatible`);return;}
   return p;
  };
  const line=async(sku:string,quantity:number,sourceId:number,destinationId:number)=>{
   if(!Number.isFinite(quantity)||quantity<=0||!sourceId||!destinationId||sourceId===destinationId){blockers.push(`Cantidad/ruta no válida para ${sku}`);return;}
   const p=await product(sku);if(!p)return;
   return {productId:p.id,sku,quantity,uomId:relation(p.uom_id),sourceId,destinationId};
  };
  // Returns of phantom kits follow the exact components of the ORIGINAL sale,
  // not a fresh BOM or the additional REX. This also recovers Odoo's own explosion.
  const receiptLines=async(sku:string,quantity:number):Promise<StockLine[]>=>{
   const identity=await product(sku,false,true);if(!identity)return [];const parent:StockLine={productId:identity.id,sku,quantity,uomId:relation(identity.uom_id),sourceId:customerId,destinationId:stockId};
   const direct=async()=>{const value=await line(sku,quantity,customerId,stockId);return value?[value]:[];};
   const sold=orderLines.filter((l:any)=>relation(l.product_id)===parent.productId);
   const originalIds=new Set(pickings.filter((p:any)=>!/^REX-|^INC-/.test(String(p.origin||''))).map((p:any)=>p.id));
   const original=moveRows.filter((m:any)=>originalIds.has(relation(m.picking_id)));
   if(original.some((m:any)=>relation(m.product_id)===parent.productId))return direct();
   if(sold.length!==1||!(Number(sold[0].product_uom_qty)>0)||quantity>Number(sold[0].product_uom_qty))return direct();
   const components=original.filter((m:any)=>relation(m.sale_line_id)===sold[0].id);
   if(!components.length)return direct();
   const ids=[...new Set(components.map((m:any)=>relation(m.product_id)))];const products=await this.call('product.product','read',[ids],{fields:['id','default_code','uom_id','tracking','is_storable','company_id','type']});
   const totals=new Map<number,StockLine>();
   for(const move of components){const p=products.find((p:any)=>p.id===relation(move.product_id));if(p?.type==='service')continue;if(!p?.default_code||p.tracking!=='none'||!p.is_storable||relation(move.product_uom)!==relation(p.uom_id)||(relation(p.company_id)&&relation(p.company_id)!==companyId)){blockers.push(`${sku}: componentes originales sin identidad/UoM/trazabilidad válidas`);return [];}
    const count=Number(move.quantity)*quantity/Number(sold[0].product_uom_qty);if(!(count>0)){blockers.push(`${sku}: cantidad de componente no válida`);return [];}
    const previous=totals.get(p.id);totals.set(p.id,{productId:p.id,sku:p.default_code,uomId:relation(p.uom_id),quantity:(previous?.quantity||0)+count,sourceId:customerId,destinationId:stockId});
   }
   return [...totals.values()];
  };
  // Correct only the falsely recorded quantity, preserving all legitimate original sales moves.
  const correction=i.stockPlan.filter(p=>['correct_recorded_vs_physical','record_extra_outbound'].includes(p.action));
  const stockCorrectionReturn=requiresOmittedStockCorrection(i)?i.returns.find(r=>r.stockCorrection):undefined;
  if(stockCorrectionReturn&&correction.some(p=>p.action==='correct_recorded_vs_physical')){
   const start=blockers.length;const lines:StockLine[]=[];const key=`${i.id}:return:${stockCorrectionReturn.id}`;const auditedReturn=i.odooOperations?.find(x=>x.key===key&&x.kind==='return'&&x.returnId===stockCorrectionReturn.id&&x.status==='done');const originalPickings=pickings.filter((p:any)=>!/^REX-|^INC-/.test(String(p.origin||'')));
   if(stockCorrectionReturn.state==='cancelled')blockers.push('DEV correctiva cancelada; conciliar antes de crear movimientos');
   const originalMoves=moveRows.filter((m:any)=>originalPickings.some((p:any)=>p.id===relation(m.picking_id))&&relation(m.location_id)===stockId&&relation(m.location_dest_id)===customerId);
   const ownReturns=await this.call('stock.picking','search_read',[[['origin','=',key],['company_id','=',companyId]]],{fields:['id'],limit:2});
   if(ownReturns.length>1)blockers.push('Hay varias DEV con la referencia correctiva; conciliar antes de continuar');
   // These are the confirmed component quantities, not a fresh explosion of the kit parent.
   for(const plan of stockCorrectionReturn.products)for(const physical of await receiptLines(plan.sku,plan.expectedQuantity)){
    const candidates=originalMoves.filter((m:any)=>relation(m.product_id)===physical.productId&&relation(m.product_uom)===physical.uomId&&(!physical.saleLineId||relation(m.sale_line_id)===physical.saleLineId));
    if(candidates.length!==1){blockers.push(`${physical.sku}: no hay un único movimiento saliente original para crear la DEV estándar`);continue;}
    const original=candidates[0];if(Number(original.quantity)<physical.quantity){blockers.push(`${physical.sku}: la cantidad DEV supera la salida original validada`);continue;}
    const returned=await this.call('stock.move','search_read',[[['origin_returned_move_id','=',original.id],['state','!=','cancel']]],{fields:['id','picking_id','state','quantity','product_uom_qty'],limit:100});
    const ownIds=new Set([...ownReturns.map((row:any)=>Number(row.id)),...(auditedReturn?[auditedReturn.pickingId]:[])]);
    if(returned.length>=100||returned.some((row:any)=>!ownIds.has(relation(row.picking_id)))){blockers.push(`${physical.sku}: ya existe una devolución vinculada a la salida original; conciliarla antes de repetir`);continue;}
    lines.push({...physical,saleLineId:relation(original.sale_line_id)||undefined,toRefund:true,originMoveId:Number(original.id)});
   }
   const originalPickingIds=new Set(lines.map(line=>relation(originalMoves.find((m:any)=>Number(m.id)===line.originMoveId)?.picking_id)));
   if(originalPickingIds.size!==1)blockers.push('La DEV afecta a varias salidas originales; requiere conciliarlas por separado antes de generar documentos');
   if(lines.length&&blockers.length===start){
    const originalPickingId=[...originalPickingIds][0];
    operations.push({key,kind:'return',returnId:stockCorrectionReturn.id,standardReturn:true,originalPickingId,dispatchReference:key,lines,blockers:[],stageOnly:false,existingPickingId:i.odooOperations?.find(x=>x.key===key)?.pickingId});
   }else if(blockers.length>start)operations.push({key:`${i.id}:return:${stockCorrectionReturn.id}`,kind:'return',returnId:stockCorrectionReturn.id,standardReturn:true,lines,blockers:blockers.splice(start),stageOnly:false});
  }
  if(correction.length&&i.type!=='order_crossing'&&!stockCorrectionReturn){const start=blockers.length;const lines:StockLine[]=[];
   {
    for(const p of correction){if(p.action==='record_extra_outbound'&&requiresExtraOutbound(i)){const product=i.products.find(product=>product.sku===p.sku);if(!product||p.quantity!==product.receivedQuantity!-product.orderedQuantity)blockers.push(`${p.sku}: plan sobrante distinto del exceso confirmado`);}const selected=p.action==='record_extra_outbound'?i.products.find(product=>product.sku===p.sku)?.selectedKitComponents:undefined;const values=selected? (await Promise.all(selected.filter(line=>line.quantity>0).map(line=>receiptLines(line.sku,line.quantity)))).flat():await receiptLines(p.sku,p.quantity);for(const physical of values){const value=p.action==='record_extra_outbound'?{...physical,sourceId:stockId,destinationId:customerId}:physical;
     if(moveRows.some((m:any)=>relation(m.product_id)===value.productId&&relation(m.product_uom)!==value.uomId))blockers.push(`${value.sku}: UoM original distinta; requiere conversión explícita`);
     const recorded=moveRows.filter((m:any)=>relation(m.product_id)===value.productId).reduce((n:number,m:any)=>n+Number(m.quantity),0);
     if(p.action==='correct_recorded_vs_physical'&&recorded<value.quantity)blockers.push(`${p.sku}: la corrección supera la salida original validada`);
     if(p.action==='correct_recorded_vs_physical'){
      const linked:number[]=[...new Set<number>(moveRows.filter((m:any)=>relation(m.product_id)===value.productId).map((m:any)=>relation(m.sale_line_id)).filter((id:number)=>Boolean(id)))];
      if(linked.length!==1)blockers.push(`${p.sku}: no hay una única línea original del pedido para asociar la devolución contable`);
      else lines.push({...value,saleLineId:linked[0],toRefund:true});
     }else{
      const originalIds=new Set(pickings.filter((row:any)=>!/^INC-|^REX-/.test(String(row.origin||''))).map((row:any)=>row.id));
      const originals=moveRows.filter((m:any)=>originalIds.has(relation(m.picking_id))&&relation(m.product_id)===value.productId&&relation(m.product_uom)===value.uomId);
      const links=[...new Set<number>(originals.map((m:any)=>relation(m.sale_line_id)).filter(Boolean))];
      if(requiresExtraOutbound(i)&&links.length!==1)blockers.push(`${p.sku}: salida sobrante sin una única línea comercial original; conciliar`);
      lines.push({...value,...(links.length===1?{saleLineId:links[0]}:{})});
     }
    }}
    if(lines.length||blockers.length>start){const opBlockers=blockers.splice(start);const groups=new Map<string,StockLine[]>();for(const l of lines){const route=`${l.sourceId}-${l.destinationId}`;groups.set(route,[...(groups.get(route)||[]),l]);}for(const [route,routeLines] of groups){const suffix=groups.size>1?`:${route}`:'';const key=`${i.id}:correction${suffix}`;const existingPickingId=i.odooOperations?.find(x=>x.key===key)?.pickingId;operations.push({key,kind:'correction',extraOutbound:requiresExtraOutbound(i)&&correction.every(p=>p.action==='record_extra_outbound'),lines:routeLines,blockers:[...opBlockers],existingPickingId});}if(!groups.size&&opBlockers.length)operations.push({key:`${i.id}:correction`,kind:'correction',lines:[],blockers:opBlockers});}
   }
  }
  // A damaged return enters Stock first; its scrap is a separate audited movement.
  for(const r of i.returns.filter(r=>r.destination==='discard')){
   const receipts=(i.odooOperations||[]).filter(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done');
   if(!receipts.length)continue;
   const locations=await this.call('stock.location','search_read',[[['scrap_location','=',true],['usage','=','inventory'],['company_id','in',[false,companyId]]]],{fields:['id'],limit:2});
   if(locations.length!==1){blockers.push(`${r.id}: ubicación de desecho no unívoca`);continue;}
   for(const receipt of receipts)for(const l of receipt.lines||[]){
    if(l.destinationId!==stockId){blockers.push(`${r.id}: concilia ubicación recibida antes del desecho`);continue;}
    const key=`${i.id}:scrap:return:${r.id}:${receipt.pickingId}:${l.productId}`;
    operations.push({key,kind:'scrap',returnId:r.id,originalPickingId:receipt.pickingId,originalOrderReference:i.order.odooReference,originalReceiptKey:receipt.receiptOrigin||receipt.key,lines:[{...l,sourceId:stockId,destinationId:locations[0].id}],blockers:[]});
   }
  }
  for(const r of i.returns){
   if(r.stockCorrection)continue;
   const prior=(i.odooOperations||[]).filter(x=>x.kind==='return'&&x.returnId===r.id&&x.lines&&!x.receiptConsumedBy);
   const pendingReceipts=prior.filter(x=>x.status==='awaiting_arrival'||x.status==='ready_for_expedition');const prepared=pendingReceipts[0];
   if(prepared){
    const issues:string[]=[];
    if(r.state!=='awaiting'&&!r.receivedBy)issues.push(`${r.id}: operario de Recepciones obligatorio`);
    if(r.state==='cancelled')issues.push(`${r.id}: la devolución cancelada requiere conciliar el albarán pendiente; no validar`);
    const physical:StockLine[]=[];
    if(r.state!=='awaiting')for(const product of r.products){const override=r.itemOverrides?.find(item=>item.expectedSku===product.sku);if(override?.mode==='not_ours')continue;if(override?.mode==='catalog'){physical.push(...await receiptLines(override.product!.sku,override.quantity));continue;}if(Number(product.receivedQuantity)>0)physical.push(...await receiptLines(product.sku,Number(product.receivedQuantity)));}
    if(r.itemOverrides?.some(item=>item.mode==='not_ours'||item.product?.sku!==item.expectedSku))issues.push(`${r.id}: hay un albarán de devolución preparado con el SKU esperado; no se puede sustituir por otro producto sin conciliar ese albarán primero`);
    const posted=prior.filter(op=>op.status==='done').flatMap(op=>op.lines!);
    const expected=[...posted,...prepared.lines!];
    const receiptReview=r.state!=='awaiting'?reviewPartialReceipt(expected,physical,posted):undefined;
    if(pendingReceipts.length!==1)issues.push(`${r.id}: hay varias entradas pendientes; conciliar antes de recibir`);
    if(receiptReview?.blockers.length)issues.push(...receiptReview.blockers.map(message=>`${r.id}: ${message}`));
    if(receiptReview&&!receiptReview.batch.length)issues.push(`${r.id}: no hay unidades nuevas recibidas para validar`);
    if(r.state!=='awaiting'&&(!r.condition||!r.destination))issues.push(`${r.id}: registra inspección física y destino antes de validar la entrada`);
    if(r.state!=='awaiting'&&r.destination&&!['stock','discard'].includes(r.destination))issues.push(`${r.id}: la entrada preparada va a Stock, pero el destino elegido es ${r.destination}; no validar una ruta distinta`);
    for(const old of prior.filter(op=>op.status==='done'))operations.push({key:old.key,kind:'return',returnId:r.id,lines:old.lines!,blockers:[]});
    const batch=receiptReview?.batch;
    const suffix=batch?.length?createHash('sha256').update(JSON.stringify({pickingId:prepared.pickingId,batch,posted:prior.filter(op=>op.status==='done').map(op=>op.key).sort()})).digest('hex').slice(0,16):'';
    operations.push({key:suffix?`${prepared.key}:batch:${suffix}`:prepared.key,kind:'return',returnId:r.id,lines:batch?.length?batch:prepared.lines!,blockers:issues,stageOnly:r.state==='awaiting'||!!receiptReview&&!receiptReview.batch.length,existingPickingId:prepared.pickingId,receiptOrigin:prepared.receiptOrigin,backorderOf:prepared.backorderOf,discardRemainder:r.condition==='incomplete',receiptReview,...(suffix?{receiptBatch:{sourceKey:prepared.key,pickingId:prepared.pickingId,origin:prepared.receiptOrigin||prepared.key,expected:prepared.lines!,parentPickingId:prepared.backorderOf}}:{})});continue;
   }
   for(const old of prior)operations.push({key:old.key,kind:'return',returnId:r.id,lines:old.lines!,blockers:[]});
   const start=blockers.length;const pending=(message:string)=>operations.push({key:`${i.id}:return:${r.id}`,kind:'return',returnId:r.id,lines:[],blockers:[message,...blockers.splice(start)]});
   if(r.state==='cancelled')continue;
   if(r.state!=='awaiting'&&r.products.some(product=>unidentifiedReturnProduct(product)&&!r.itemOverrides?.some(item=>item.expectedSku===product.sku))){pending(`${r.id}: identifica el producto recuperado antes de registrar stock`);continue;}
   if(r.state==='awaiting'&&i.type==='wrong_product'&&i.wrongReceivedProduct){
    const actual=i.wrongReceivedProduct;const receipt=await receiptLines(actual.sku,actual.quantity);
    operations.push({key:`${i.id}:return:${r.id}`,kind:'return',returnId:r.id,lines:receipt,blockers:receipt.length?[]:[...new Set(blockers.splice(start))],stageOnly:true});continue;
   }
   if(r.state==='awaiting'&&i.type==='wrong_product'&&!i.wrongReceivedProduct){pending(`${r.id}: identifica el producto realmente enviado para preparar la entrada pendiente`);continue;}
   if(r.state==='awaiting'){
    const lines:StockLine[]=[];for(const p of r.products){lines.push(...await receiptLines(p.sku,p.expectedQuantity));}
    operations.push({key:`${i.id}:return:${r.id}`,kind:'return',returnId:r.id,lines,blockers:blockers.splice(start),stageOnly:true});continue;
   }
   if(r.destination==='not_ours'){
    if(!r.itemOverrides?.length||r.itemOverrides.length!==r.products.length||r.itemOverrides.some(item=>item.mode!=='not_ours'))pending(`${r.id}: “mercancía ajena” requiere identificar cada línea como no perteneciente al catálogo`);
    continue;
   }
   if(!['arrived','processed'].includes(r.state)){pending(`${r.id}: pendiente llegada física; no crear entrada`);continue;}
   if(!r.receivedBy){pending(`${r.id}: operario de Recepciones obligatorio`);continue;}
   if(!r.destination||!r.condition){pending(`${r.id}: faltan estado y destino`);continue;}
   if(!['stock','discard'].includes(r.destination)){pending(`${r.id}: destino no admitido para reincorporación Odoo`);continue;}
   const dest=stockId;
   const lines:StockLine[]=[];for(const p of r.products){
    const override=r.itemOverrides?.find(item=>item.expectedSku===p.sku);if(override?.mode==='not_ours')continue;
    const sku=override?.mode==='catalog'?override.product!.sku:p.sku;const physicalQuantity=override?.mode==='catalog'?override.quantity:(p.receivedQuantity||0);
    if(physicalQuantity>0)for(const physical of await receiptLines(sku,physicalQuantity)){
     const posted=prior.flatMap(x=>x.lines!).filter(x=>x.productId===physical.productId);const already=posted.reduce((n,x)=>n+x.quantity,0);const quantity=physical.quantity-already;
     if(quantity<0||posted.some(x=>x.sourceId!==customerId||x.destinationId!==dest))blockers.push(`${r.id}: cantidades o destino ya contabilizados no se pueden sobrescribir; requiere conciliación`);
     if(quantity>0)lines.push({...physical,quantity});
    }else if(prior.flatMap(x=>x.lines!).some(x=>x.sku===sku&&x.quantity>0))blockers.push(`${r.id}: cantidades ya contabilizadas no se pueden sobrescribir; requiere conciliación`);
   }
   if(lines.length||blockers.length>start||!prior.length){const suffix=createHash('sha256').update(JSON.stringify({lines,previous:prior.map(x=>x.key).sort()})).digest('hex').slice(0,16);operations.push({key:`${i.id}:return:${r.id}:${suffix}`,kind:'return',returnId:r.id,lines,blockers:blockers.splice(start)});}
  }
  // Replicate S65737: a true stock.scrap tied to the original outgoing picking.
  // Split into one immutable operation per product/picking; quantities include prior scraps.
  if(i.type==='lost'||(i.type==='damage'&&i.subtype!=='package_only')){
   if(i.returns.length)blockers.push('Desecho: existe devolución física; conciliar su recepción y ubicación antes de desechar, no usar automáticamente Clientes');
   else {
    const scrapLocations=await this.call('stock.location','search_read',[[['scrap_location','=',true],['usage','=','inventory'],['company_id','in',[false,companyId]]]],{fields:['id','company_id'],limit:2});
    if(scrapLocations.length!==1)blockers.push('Desecho: configura una única ubicación de desecho de esta compañía');
    else for(const item of i.products){
     const start=blockers.length;const p=await product(item.sku,true,true);if(!p)continue;
     const saleLines=orderLines.filter((l:any)=>relation(l.product_id)===p.id);
     const matching=moveRows.filter((m:any)=>relation(m.product_id)===p.id||saleLines.some((l:any)=>l.id===relation(m.sale_line_id)));
     if(!matching.length){blockers.push(`${item.sku}: desecho sin movimiento original inequívoco; no inventar componentes ni stock`);continue;}
     const groups=new Map<string,any[]>();for(const m of matching){const key=`${relation(m.picking_id)}:${relation(m.product_id)}:${relation(m.product_uom)}`;groups.set(key,[...(groups.get(key)||[]),m]);}
     for(const rows of groups.values()){
      const first=rows[0],originalPickingId=relation(first.picking_id),productId=relation(first.product_id);
      const ids=[...new Set(matching.filter((m:any)=>relation(m.product_id)===productId).map((m:any)=>relation(m.picking_id)))];
      if(ids.length!==1||!originalPickingId||rows.some((m:any)=>relation(m.location_dest_id)!==customerId)){blockers.push(`${item.sku}: varias salidas o ubicación original distinta de Clientes; seleccionar material antes de desechar`);continue;}
      const originalQuantity=rows.reduce((sum:number,m:any)=>sum+Number(m.quantity),0);
      const ordered=Number(saleLines.length===1?saleLines[0].product_uom_qty:0);
      const quantity=productId===p.id?item.affectedQuantity:ordered>0?originalQuantity*item.affectedQuantity/ordered:0;
      const skuRows=await this.call('product.product','read',[[productId]],{fields:['id','default_code','tracking','is_storable','uom_id','type']});const component=skuRows[0];if(component?.type==='service')continue;
      if(!component?.is_storable||component.tracking!=='none'||relation(component.uom_id)!==relation(first.product_uom)||!component.default_code||!(quantity>0)||quantity>originalQuantity){blockers.push(`${item.sku}: cantidad, UoM o trazabilidad del desecho requiere revisión`);continue;}
      const key=`${i.id}:scrap:${originalPickingId}:${productId}`;
      const prior=await this.call('stock.scrap','search_read',[[['picking_id','=',originalPickingId],['product_id','=',productId],['state','=','done']]],{fields:['id','origin','scrap_qty','product_uom_id'],limit:1000});
      const returned=await this.call('stock.move','search_read',[[['origin_returned_move_id','in',rows.map((m:any)=>m.id)],['state','=','done']]],{fields:['quantity','product_uom'],limit:1000});
      const other=prior.filter((x:any)=>x.origin!==`${i.order.odooReference} · ${key}`);
      const issues:string[]=[];
      if(prior.length===1000||returned.length===1000||other.some((x:any)=>relation(x.product_uom_id)!==relation(first.product_uom))||returned.some((x:any)=>relation(x.product_uom)!==relation(first.product_uom))||other.reduce((sum:number,x:any)=>sum+Number(x.scrap_qty),0)+returned.reduce((sum:number,x:any)=>sum+Number(x.quantity),0)+quantity>originalQuantity)issues.push('El desecho supera el material original restante, ya fue devuelto o desechado; conciliar antes de repetir');
      operations.push({key,kind:'scrap',originalPickingId,originalOrderReference:i.order.odooReference,lines:[{productId,sku:component.default_code,quantity,uomId:relation(first.product_uom),sourceId:customerId,destinationId:scrapLocations[0].id}],blockers:issues});
     }
     // Errors affecting a component must block the whole proposal, not silently drop it.
     if(blockers.length>start)continue;
    }
   }
  }
  const outbound=i.stockPlan.filter(p=>p.action==='new_outbound');
  if(outbound.length){const start=blockers.length;const process=i.processes.find(p=>p.kind==='reshipment');
   if(i.returns.some(r=>r.stockCorrection&&r.state!=='cancelled'&&!i.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'&&(op.target||TEST_TARGET)===this.target)))blockers.push('Primero validar la DEV correctiva de la salida original en Odoo');
   if(!options.prepareDocuments)blockers.push(...returnBeforeReshipmentBlockers(i,this.target));
   if(!process||!options.prepareDocuments&&process.dependsOn?.some(id=>!done(i.processes.find(p=>p.id===id)?.state||'')))blockers.push('Reenvío bloqueado por recepción/diagnóstico anterior');
   const lines:StockLine[]=[];
   const bomCache=new Map<number,any[]>();
   const expand=async(parent:any,quantity:number,ancestry:number[],depth=0):Promise<Array<{product:any;quantity:number}>>=>{
    const parentId=Number(parent.id);if(ancestry.includes(parentId)||depth>8){blockers.push(`${parent.default_code||parentId}: estructura de fabricación cíclica o demasiado profunda`);return [];}
    // Some catalogue fixtures (and true simple products) have no template relation exposed.
    // A manufactured product in Odoo always has one; if omitted, retain the stock product as a leaf.
    if(!parent.product_tmpl_id)return [{product:parent,quantity}];
    let boms=bomCache.get(parentId);
    if(!boms){
     const found=await this.call('mrp.bom','search_read',[[['product_tmpl_id','=',relation(parent.product_tmpl_id)],['active','=',true],['type','in',['normal','phantom']],['company_id','in',[false,companyId]]]],{fields:['id','product_tmpl_id','product_id','product_qty','product_uom_id','bom_line_ids','company_id','type'],limit:50});
     const applicable=found.filter((b:any)=>!relation(b.product_id)||relation(b.product_id)===parentId);
     const exact=applicable.filter((b:any)=>relation(b.product_id)===parentId);
     const selected:any[]=exact.length?exact:applicable;
     if(selected.length>1){blockers.push(`${parent.default_code||parentId}: hay varias listas de materiales aplicables; no se elige una automáticamente`);return [];}
     bomCache.set(parentId,selected);boms=selected;
    }
    boms=boms||[];
    if(!boms.length){
     if(String(parent.default_code||'').trim().toUpperCase()==='V2MR'){blockers.push('V2MR no tiene una BoM activa y única en Odoo; no se enviará la referencia padre como si fuera una unidad de stock');return [];}
     return [{product:parent,quantity}];
    }
    const bom=boms[0];const bomQty=Number(bom.product_qty||0);const bomUom=relation(bom.product_uom_id),parentUom=relation(parent.uom_id);
    if(bomQty<=0||!bomUom||bomUom!==parentUom){blockers.push(`${parent.default_code||parentId}: cantidad/UoM de fabricación no coincide con la unidad de venta; se requiere conversión explícita`);return [];}
    const rows=bom.bom_line_ids?.length?await this.call('mrp.bom.line','read',[bom.bom_line_ids],{fields:['product_id','product_qty','product_uom_id','child_bom_id']}):[];
    if(!rows.length){blockers.push(`${parent.default_code||parentId}: la lista de materiales está vacía o no se pudo leer`);return [];}
    const expanded:Array<{product:any;quantity:number}>=[];
    for(const row of rows){const componentId=relation(row.product_id);const component=await this.call('product.product','read',[[componentId]],{fields:['id','default_code','product_tmpl_id','uom_id','tracking','company_id','is_storable','type']});
     if(component.length!==1){blockers.push(`${parent.default_code||parentId}: componente de fabricación inexistente o ambiguo`);continue;}
     const item=component[0];if(item.type==='service')continue; // Nested kit parents can also be non-storable.
     const componentUom=relation(row.product_uom_id),itemUom=relation(item.uom_id);
     if(!item.default_code||!componentUom||componentUom!==itemUom){blockers.push(`${parent.default_code||parentId}: UoM del componente ${item.default_code||componentId} distinta a su UoM de stock; no se inventa conversión`);continue;}
     const componentQty=Number(row.product_qty||0)*quantity/bomQty;
     if(!Number.isFinite(componentQty)||componentQty<=0){blockers.push(`${parent.default_code||parentId}: cantidad de componente no válida`);continue;}
     const nested=await expand(item,componentQty,[...ancestry,parentId],depth+1);expanded.push(...nested);
    }
    return expanded;
   };
   for(const p of outbound){
    const item=await this.call('product.product','search_read',[[['default_code','=',p.sku]]],{fields:['id','default_code','product_tmpl_id','uom_id','tracking','company_id','is_storable','type'],limit:2});
    if(item.length!==1){blockers.push(`Referencia Odoo inexistente o ambigua: ${p.sku}`);continue;}
    if(item[0].type==='service')continue; // Kit parents may be non-storable: expand first.
    const matches=orderLines.filter((l:any)=>relation(l.product_id)===Number(item[0].id));
    if(matches.length>1){blockers.push(`${p.sku}: varias líneas del pedido coinciden; el reenvío requiere selección explícita`);continue;}
    const confirmedComponent=i.products.flatMap(product=>product.kitComponents||[]).find(component=>component.sku===p.sku&&component.productId===Number(item[0].id));
    // The incident already names the physical leaf and quantity. A later recipe
    // change must not explode that selection into different stock products.
    if(confirmedComponent&&item[0].is_storable===false){blockers.push(`${p.sku}: el componente confirmado ya no es almacenable; conciliar antes de crear REX`);continue;}
    const components=confirmedComponent?[{product:item[0],quantity:p.quantity}]:await expand(item[0],p.quantity,[]);
    for(const component of components){
     if(component.product.type==='service'||component.product.is_storable===false)continue;
     const value=await line(String(component.product.default_code),component.quantity,stockId,customerId);
     if(!value)continue;
     // Only link a move to a sale line when it represents that exact product. The picking.sale_id
     // links all exploded component moves to the customer order without falsifying sale-line product/UoM.
     const componentSaleLines=orderLines.filter((l:any)=>relation(l.product_id)===value.productId&&relation(l.product_uom)===value.uomId);
     if(componentSaleLines.length===1)lines.push({...value,saleLineId:Number(componentSaleLines[0].id)});else if(componentSaleLines.length>1)blockers.push(`${value.sku}: varias líneas de pedido coinciden con el componente fabricado`);else lines.push(value);
    }
   }
   if(!lines.length)blockers.push('La reexpedición no contiene productos almacenables para crear una salida REX');
   const key=`${i.id}:reshipment`;const existingPickingId=i.odooOperations?.find(x=>x.key===key&&x.status==='ready_for_expedition')?.pickingId;
   const prior=i.odooOperations?.find(x=>x.key===key);
   operations.push({key,kind:'reshipment',lines,blockers:blockers.splice(start),stageOnly:true,existingPickingId,dispatchReference:prior?prior.dispatchReference:reshipmentReference(i.id)});
  }
  if(new Set(operations.map(x=>x.key)).size!==operations.length)blockers.push('Varias líneas afectan al mismo material original; conciliar cantidades antes de crear movimientos');
  const body={incidentId:i.id,revision:i.revision,target:this.target,orderId:order.id,companyId,partnerId,customerLocationId:customerId,outgoingPickingTypeId,operations,blockers:[...new Set(blockers)],originalPickingIds:pickings.map((p:any)=>p.id),openOutgoingPickings};
  return {...body,digest:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
 }
}
export type StockJournalEntry={key:string;digest:string;state:'started'|'uncertain'|'confirmed'|'prepared';pickingId?:number;scrapId?:number;updatedAt:string;actor:string;operation?:StockOperation};
/** Persist intent before RPC. Uncertain outcomes never replay automatically, even after restart. */
export class StockJournal{
 private path:string;
 constructor(directory:string,mode:'test'|'operational'='test'){this.path=join(directory,mode==='operational'?'incidents-odoo-operational-journal.json':'incidents-odoo-journal.json');}
 all():StockJournalEntry[]{return existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):[];}
 put(entry:StockJournalEntry){const all=this.all().filter(x=>x.key!==entry.key);all.push(entry);mkdirSync(join(this.path,'..'),{recursive:true});const tmp=this.path+'.'+crypto.randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(all),{mode:0o600,flush:true});renameSync(tmp,this.path);}
}
/** Dedicated narrow executor: server-owned digest approval, one immutable operation, no API-provided RPC. */
export class ControlledStockExecutor {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private read:OdooCall,private write:OdooCall,private journal:StockJournal,private env:Record<string,string|undefined>,private chatter?:IncidentChatter){}
 async recordAudit(result:{key:string;target?:string;pickingId:number;scrapId?:number;status?:string;dispatchReference?:string;externalReference?:string;lines?:StockLine[]},actor:string){
  if(!this.chatter)return;
  return this.chatter.record({target:result.target||TEST_TARGET,key:result.key,model:result.scrapId?'stock.scrap':'stock.picking',id:result.scrapId||result.pickingId,status:result.status||'done',actor,reference:result.dispatchReference||result.externalReference,lines:result.lines||[]});
 }
 private async verifyScrap(p:StockProposal,op:StockOperation){
  if((p.target!==TEST_TARGET&&!operationalTargetMatches(this.env,p.target))||!op.originalPickingId||!op.originalOrderReference||op.lines.length!==1)throw Error('Desecho requiere un material y picking original inequívocos en DEMO');
  const pickings=await this.read('stock.picking','read',[[op.originalPickingId]],{fields:['id','state','sale_id','company_id','location_dest_id','origin','partner_id']});const picking=pickings[0];const line=op.lines[0];
  if(!picking||picking.state!=='done'||(relation(picking.sale_id)!==p.orderId&&!(op.returnId&&op.originalReceiptKey&&picking.origin===op.originalReceiptKey&&!relation(picking.sale_id)&&relation(picking.partner_id)===p.partnerId))||relation(picking.company_id)!==p.companyId||relation(picking.location_dest_id)!==line.sourceId)throw Error('El desecho no coincide con la salida original del pedido');
  const rows=await this.read('stock.scrap','search_read',[[['origin','=',`${op.originalOrderReference} · ${op.key}`],['company_id','=',p.companyId]]],{fields:['id','name','state','picking_id','product_id','product_uom_id','scrap_qty','location_id','scrap_location_id','should_replenish'],limit:2});
  const row=rows[0];if(rows.length!==1||row.state!=='done'||relation(row.picking_id)!==op.originalPickingId||relation(row.product_id)!==line.productId||relation(row.product_uom_id)!==line.uomId||Number(row.scrap_qty)!==line.quantity||relation(row.location_id)!==line.sourceId||relation(row.scrap_location_id)!==line.destinationId||row.should_replenish)throw Error('Desecho no confirmado o distinto al material aprobado; conciliar, no repetir');
  return {key:op.key,digest:p.digest,pickingId:op.originalPickingId,scrapId:Number(row.id),confirmedAt:new Date().toISOString(),kind:'scrap' as const,returnId:op.returnId,lines:op.lines,status:'done' as const,externalReference:String(row.name),target:p.target};
 }
 private async executeScrap(p:StockProposal,op:StockOperation,actor:string){
  if(!physicalWorkflowWritable(this.env,p.target))throw Error('Desecho requiere conexión operativa habilitada o TEST aislado');
  if(!physicalWorkflowWritable(this.env,p.target)||!op.originalPickingId||!op.originalOrderReference||op.lines.length!==1)throw Error('Desecho DEMO incompleto');
  const saved=this.journal.all().find(x=>x.key===op.key);
  const origin=`${op.originalOrderReference} · ${op.key}`;
  const existing=await this.read('stock.scrap','search_read',[[['origin','=',origin],['company_id','=',p.companyId]]],{fields:['id'],limit:2});
  if(saved||existing.length){const result=await this.verifyScrap(p,op);this.journal.put({key:op.key,digest:saved?.digest||p.digest,state:'confirmed',pickingId:result.pickingId,scrapId:result.scrapId,actor:saved?.actor||actor,updatedAt:result.confirmedAt});return result;}
  const line=op.lines[0];
  const originals=await this.read('stock.picking','read',[[op.originalPickingId]],{fields:['id','state','sale_id','company_id','location_dest_id','origin','partner_id']});const original=originals[0];
  if(!original||original.state!=='done'||(relation(original.sale_id)!==p.orderId&&!(op.returnId&&op.originalReceiptKey&&original.origin===op.originalReceiptKey&&!relation(original.sale_id)&&relation(original.partner_id)===p.partnerId))||relation(original.company_id)!==p.companyId||relation(original.location_dest_id)!==line.sourceId)throw Error('Salida original inválida para el desecho');
  const locations=await this.read('stock.location','read',[[line.sourceId,line.destinationId]],{fields:['id','usage','scrap_location','company_id']});
  if(!locations.some((x:any)=>x.id===line.sourceId&&x.usage===(op.returnId?'internal':'customer'))||!locations.some((x:any)=>x.id===line.destinationId&&x.usage==='inventory'&&x.scrap_location&&(!relation(x.company_id)||relation(x.company_id)===p.companyId)))throw Error('Desecho solo Clientes → ubicación de desecho configurada; nunca descontar almacén de nuevo');
  // Re-read original and already scrapped quantities at the last possible point.
  const moves=await this.read('stock.move','search_read',[[['picking_id','=',op.originalPickingId],['product_id','=',line.productId],['state','=','done'],['scrapped','=',false]]],{fields:['id','quantity','product_uom'],limit:1000});
  const scraps=await this.read('stock.scrap','search_read',[[['picking_id','=',op.originalPickingId],['product_id','=',line.productId],['state','=','done']]],{fields:['scrap_qty','product_uom_id'],limit:1000});
  const returned=await this.read('stock.move','search_read',[[['origin_returned_move_id','in',moves.map((m:any)=>m.id)],['state','=','done']]],{fields:['quantity','product_uom'],limit:1000});
  if(!moves.length||moves.length===1000||scraps.length===1000||returned.length===1000||moves.some((m:any)=>relation(m.product_uom)!==line.uomId)||returned.some((m:any)=>relation(m.product_uom)!==line.uomId)||scraps.some((s:any)=>relation(s.product_uom_id)!==line.uomId)||scraps.reduce((sum:number,s:any)=>sum+Number(s.scrap_qty),0)+returned.reduce((sum:number,m:any)=>sum+Number(m.quantity),0)+line.quantity>moves.reduce((sum:number,m:any)=>sum+Number(m.quantity),0))throw Error('El material original disponible para desecho ha cambiado; actualizar propuesta');
  const entry:StockJournalEntry={key:op.key,digest:p.digest,state:'started',pickingId:op.originalPickingId,actor,updatedAt:new Date().toISOString()};this.journal.put(entry);
  const context={mail_create_nosubscribe:true,mail_create_nolog:true,mail_notrack:true,tracking_disable:true,mail_notify_force_send:false,allowed_company_ids:[p.companyId]};
  try{
   const id=await this.write('stock.scrap','create',[{origin,company_id:p.companyId,picking_id:op.originalPickingId,product_id:line.productId,product_uom_id:line.uomId,scrap_qty:line.quantity,location_id:line.sourceId,scrap_location_id:line.destinationId,should_replenish:false}],{context});
   if(!Number.isInteger(id)||id<=0)throw Error('Odoo no confirmó el desecho');entry.scrapId=id;this.journal.put(entry);
   const response=await this.write('stock.scrap','action_validate',[[id]],{context});if(response&&typeof response==='object')throw Error('El desecho requiere asistente; no se fuerza stock');
   const result=await this.verifyScrap(p,op);this.journal.put({...entry,state:'confirmed',updatedAt:result.confirmedAt});return result;
  }catch{this.journal.put({...entry,state:'uncertain',updatedAt:new Date().toISOString()});throw Error('Desecho Odoo incierto o incompleto. No repetir; conciliar por referencia');}
 }
 private async executeStandardReturn(p:StockProposal,op:StockOperation,actor:string){
  if(!physicalWorkflowWritable(this.env,p.target)||!op.returnId||!op.originalPickingId||!op.lines.length||op.lines.some(line=>!line.originMoveId))throw Error('La DEV correctiva requiere destino TEST, aislamiento y movimientos originales identificados');
  const origin=op.dispatchReference||op.key;const saved=this.journal.all().find(row=>row.key===op.key);
  const existing=await this.read('stock.picking','search_read',[[['origin','=',origin],['company_id','=',p.companyId]]],{fields:['id'],limit:2});
  if(existing.length>1)throw Error('Hay varias DEV correctivas con la referencia; conciliar, no repetir');
  if(saved||existing.length){if(existing.length!==1)throw Error('DEV correctiva iniciada sin picking localizable; no repetir, conciliar por return_id');const result=await this.verify(p,op,Number(existing[0].id));this.journal.put({key:op.key,digest:saved?.digest||p.digest,state:'confirmed',pickingId:result.pickingId,actor:saved?.actor||actor,updatedAt:result.confirmedAt});return result;}
  const originalRows=await this.read('stock.picking','read',[[op.originalPickingId]],{fields:['id','name','state','sale_id','company_id','picking_type_id','location_id','location_dest_id','return_id']});const original=originalRows[0];
  if(!original||original.state!=='done'||relation(original.sale_id)!==p.orderId||relation(original.company_id)!==p.companyId||relation(original.return_id))throw Error('La devolución solo procede desde la salida original validada del pedido y sin retorno previo');
  const originalIds=op.lines.map(line=>line.originMoveId!);if(new Set(originalIds).size!==originalIds.length)throw Error('La propuesta repite un movimiento original en la DEV');
  const sourceMoves=await this.read('stock.move','read',[originalIds],{fields:['id','picking_id','product_id','product_uom','quantity','state','scrapped','location_id','location_dest_id']});
  if(sourceMoves.length!==op.lines.length||sourceMoves.some((move:any)=>{const line=op.lines.find(x=>x.originMoveId===Number(move.id));return !line||relation(move.picking_id)!==op.originalPickingId||move.state!=='done'||move.scrapped||relation(move.product_id)!==line.productId||relation(move.product_uom)!==line.uomId||Number(move.quantity)<line.quantity||relation(move.location_id)!==line.destinationId||relation(move.location_dest_id)!==line.sourceId;}))throw Error('La salida original cambió desde la propuesta; actualiza antes de devolver');
  const previous=await this.read('stock.move','search_read',[[['origin_returned_move_id','in',originalIds],['state','!=','cancel']]],{fields:['id','origin_returned_move_id','state','quantity','product_uom_qty'],limit:100});
  if(previous.length)throw Error('Ya existe un retorno activo para la salida original; conciliar antes de crear la DEV correctiva');
  const context={allowed_company_ids:[p.companyId],active_model:'stock.picking',active_id:op.originalPickingId,active_ids:[op.originalPickingId],tracking_disable:true,mail_create_nosubscribe:true,mail_create_nolog:true,mail_notrack:true,mail_notify_force_send:false};
  const wizardId=await this.write('stock.return.picking','create',[{picking_id:op.originalPickingId}],{context});
  if(!Number.isInteger(wizardId)||wizardId<=0)throw Error('Odoo no confirmó el asistente estándar de devolución');
  const wizardLines=await this.read('stock.return.picking.line','search_read',[[['wizard_id','=',wizardId]]],{fields:['id','product_id','move_id','quantity'],limit:1000});
  const fields=await this.read('stock.return.picking.line','fields_get',[['to_refund']],{attributes:['type']});
  if(!Object.hasOwn(fields||{},'to_refund'))throw Error('Odoo no ofrece el control de corrección de cantidad entregada (to_refund); DEV bloqueada');
  const commands:any[]=[];
  for(const line of op.lines){const candidates=wizardLines.filter((row:any)=>relation(row.move_id)===line.originMoveId&&relation(row.product_id)===line.productId);if(candidates.length!==1)throw Error('El asistente estándar no presenta una línea inequívoca del movimiento que se debe devolver');}
  for(const row of wizardLines){const line=op.lines.find(x=>x.originMoveId===relation(row.move_id)&&x.productId===relation(row.product_id));commands.push([1,Number(row.id),{quantity:line?.quantity||0,to_refund:Boolean(line)}]);}
  this.journal.put({key:op.key,digest:p.digest,state:'started',actor,updatedAt:new Date().toISOString()});
  try{
   await this.write('stock.return.picking','write',[[wizardId],{product_return_moves:commands}],{context});
   const action=await this.write('stock.return.picking','action_create_returns',[[wizardId]],{context});const id=Number(action?.res_id);
   if(!Number.isInteger(id)||id<=0)throw Error('El asistente Odoo no devolvió el ID del albarán DEV');
   this.journal.put({key:op.key,digest:p.digest,state:'started',pickingId:id,actor,updatedAt:new Date().toISOString()});
   await this.write('stock.picking','write',[[id],{origin}],{context});
   const createdMoves=await this.read('stock.move','search_read',[[['picking_id','=',id],['state','!=','cancel']]],{fields:['id','product_id','product_uom_qty','product_uom','origin_returned_move_id','location_id','location_dest_id','state'],limit:1000});
   if(createdMoves.length!==op.lines.length)throw Error('La DEV Odoo generó líneas distintas de la propuesta');
   for(const move of createdMoves){const line=op.lines.find(x=>x.originMoveId===relation(move.origin_returned_move_id)&&x.productId===relation(move.product_id)&&x.uomId===relation(move.product_uom)&&x.quantity===Number(move.product_uom_qty)&&x.sourceId===relation(move.location_id)&&x.destinationId===relation(move.location_dest_id));if(!line)throw Error('La DEV Odoo no conserva producto, cantidad, ruta o vínculo de origen aprobados');await this.write('stock.move','write',[[move.id],{quantity:line.quantity,picked:true}],{context});}
   const validated=await this.write('stock.picking','button_validate',[[id]],{context});if(validated&&typeof validated==='object')throw Error('Odoo exige un asistente al validar la DEV; conciliación manual necesaria');
   const result=await this.verify(p,op,id);this.journal.put({key:op.key,digest:p.digest,state:'confirmed',pickingId:id,actor,updatedAt:result.confirmedAt});return result;
  }catch{this.journal.put({key:op.key,digest:p.digest,state:'uncertain',pickingId:this.journal.all().find(x=>x.key===op.key)?.pickingId,actor,updatedAt:new Date().toISOString()});throw Error('DEV correctiva Odoo incierta o incompleta. No repetir; conciliar DEV, return_id y movimientos antes de continuar');}
 }
 private async verify(p:Pick<StockProposal,'orderId'|'companyId'|'digest'|'target'> & Partial<Pick<StockProposal,'partnerId'>>,op:StockOperation,id:number){
  const rows=await this.read('stock.picking','read',[[id]],{fields:['id','name','state','origin','company_id','sale_id','move_type','partner_id','return_id']});const row=rows[0];
  const accepted=op.stageOnly?['confirmed','assigned','waiting','done']:['done'];
  if(!row||row.origin!==(op.receiptOrigin||op.dispatchReference||op.key)||relation(row.company_id)!==p.companyId||(relation(row.sale_id)!==p.orderId&&!(op.kind==='return'&&!relation(row.sale_id)&&p.partnerId&&relation(row.partner_id)===p.partnerId))||!accepted.includes(row.state))throw Error('Odoo no confirma el estado o vínculo al pedido esperado; requiere conciliación, no repetir');
  if(op.kind==='reshipment'&&row.move_type!=='direct')throw Error('El REX no tiene política de entrega Lo antes posible; requiere conciliación');
  if(op.standardReturn&&relation(row.return_id)!==op.originalPickingId)throw Error('La DEV no conserva el vínculo return_id con la salida original');
  const moves=await this.read('stock.move','search_read',[[['picking_id','=',id],['state','!=','cancel'],['scrapped','=',false]]],{fields:['product_id','product_uom_qty','quantity','product_uom','sale_line_id','to_refund','location_id','location_dest_id','origin_returned_move_id','state'],limit:1000});
  const canonical=(lines:StockLine[])=>lines.map(l=>`${l.productId}:${l.uomId}:${l.sourceId}:${l.destinationId}:${l.quantity}:${l.saleLineId||0}:${Boolean(l.toRefund)}:${op.standardReturn?l.originMoveId||0:0}`).sort();
  const actual=moves.map((m:any)=>({productId:relation(m.product_id),uomId:relation(m.product_uom),sourceId:relation(m.location_id),destinationId:relation(m.location_dest_id),quantity:Number(op.stageOnly&&row.state!=='done'?m.product_uom_qty:m.quantity),saleLineId:relation(m.sale_line_id)||undefined,toRefund:Boolean(m.to_refund),originMoveId:relation(m.origin_returned_move_id)||undefined}));
  // Odoo may attach an extra, zero-ordered/zero-priced sale line when an unlinked
  // component is delivered. Accept only that verified metadata addition; never
  // relax product/UoM/quantity/route/refund or an explicitly approved sale link.
  const approved=op.lines.map(line=>({...line}));
  if(op.kind==='reshipment'&&row.state==='done')for(const line of approved){
   if(line.saleLineId)continue;
   const candidates=actual.filter((m:any)=>m.productId===line.productId&&m.uomId===line.uomId&&m.sourceId===line.sourceId&&m.destinationId===line.destinationId&&m.quantity===line.quantity&&Boolean(m.toRefund)===Boolean(line.toRefund));
   if(candidates.length!==1||!candidates[0].saleLineId)continue;
   const sales=await this.read('sale.order.line','read',[[candidates[0].saleLineId]],{fields:['id','order_id','company_id','product_id','product_uom','product_uom_qty','price_unit','discount','qty_delivered','is_delivery','state']});const sale=sales[0];
   if(sales.length!==1||sale.id!==candidates[0].saleLineId||relation(sale.order_id)!==p.orderId||relation(sale.company_id)!==p.companyId||relation(sale.product_id)!==line.productId||relation(sale.product_uom)!==line.uomId||sale.product_uom_qty!==0||sale.price_unit!==0||sale.discount!==0||sale.is_delivery!==false||!['sale','done'].includes(sale.state)||!(sale.qty_delivered>=line.quantity))throw Error('La línea comercial añadida por Odoo no es una línea técnica gratuita del mismo pedido/producto; requiere conciliación');
   line.saleLineId=sale.id;
  }
  if(moves.some((m:any)=>op.stageOnly&&row.state!=='done'?!['confirmed','assigned','waiting'].includes(m.state):m.state!=='done')||JSON.stringify(canonical(actual))!==JSON.stringify(canonical(approved)))throw Error('Movimientos Odoo no coinciden con cantidades/ruta aprobadas; no repetir');
  const status:'done'|'awaiting_arrival'|'ready_for_expedition'=op.stageOnly&&row.state!=='done'?(op.kind==='reshipment'?'ready_for_expedition':'awaiting_arrival'):'done';
  return {key:op.key,digest:p.digest,pickingId:id,confirmedAt:new Date().toISOString(),kind:op.kind,returnId:op.returnId,lines:approved,status,externalReference:String(row.name||id),dispatchReference:op.dispatchReference,target:p.target};
 }
 async reconcile(p:StockProposal,key:string){
  const op=p.operations.find(x=>x.key===key);if(!op)throw Error('Operación no encontrada');
  const entry=this.journal.all().find(x=>x.key===key);
  if(op.receiptBatch||entry?.operation?.receiptBatch){const stored=entry?.operation||op;const result=await verifyReceiptBatch(this.read,p,stored);this.journal.put({key,digest:entry?.digest||p.digest,state:'confirmed',pickingId:result.pickingId,actor:entry?.actor||'reconciliación',updatedAt:result.confirmedAt,operation:stored});return result;}
  if(op.kind==='scrap'){const result=await this.verifyScrap(p,op);this.journal.put({key,digest:entry?.digest||p.digest,state:'confirmed',pickingId:result.pickingId,scrapId:result.scrapId,actor:entry?.actor||'reconciliación',updatedAt:result.confirmedAt});return result;}
  if(op.kind==='return'&&op.stageOnly&&op.existingPickingId){const result=await this.verify(p,op,op.existingPickingId);return result;}
  const rows=await this.read('stock.picking','search_read',[[['origin','=',op.dispatchReference||key],['company_id','=',p.companyId]]],{fields:['id'],limit:2});
  if(rows.length!==1)throw Error('No hay un único albarán para conciliar; no repetir la operación');
  const result=await this.verify(p,op,rows[0].id);
  this.journal.put({key,digest:entry?.digest||p.digest,state:result.status==='done'?'confirmed':'prepared',pickingId:result.pickingId,actor:entry?.actor||'reconciliación',updatedAt:result.confirmedAt});return result;
 }
 /** Read-only recovery before any retry. A missing exact reference may proceed
  * to the guarded executor; an existing but non-matching/incomplete record fails closed. */
 async reconcileExisting(p:StockProposal,key:string){
  const op=p.operations.find(x=>x.key===key);if(!op)throw Error('Operación no encontrada');
  const entry=this.journal.all().find(x=>x.key===key);
  if(entry)return this.reconcile(p,key); // started/uncertain must never replay.
  if(op.receiptBatch){
   if(this.journal.all().some(saved=>saved.pickingId===op.receiptBatch!.pickingId&&['started','uncertain'].includes(saved.state)))throw Error('La entrada conserva una operación incierta; conciliar el lote guardado, no validar otro');
   const result=await reconcileReceiptBatchIfCompleted(this.read,p,op);
   if(result)this.journal.put({key,digest:p.digest,state:'confirmed',pickingId:result.pickingId,actor:'reconciliación',updatedAt:result.confirmedAt,operation:structuredClone(op)});
   return result;
  }
  if(op.kind==='return'&&op.stageOnly&&op.existingPickingId)return this.reconcile(p,key);
  if(op.kind==='scrap'){
   const origin=`${op.originalOrderReference||''} · ${op.key}`;
   const rows=await this.read('stock.scrap','search_read',[[['origin','=',origin],['company_id','=',p.companyId]]],{fields:['id'],limit:2});
   if(!rows.length)return null;if(rows.length!==1)throw Error('Desecho duplicado en Odoo; conciliar, no repetir');
   const result=await this.verifyScrap(p,op);this.journal.put({key,digest:p.digest,state:'confirmed',pickingId:result.pickingId,scrapId:result.scrapId,actor:'reconciliación',updatedAt:result.confirmedAt});return result;
  }
  const rows=await this.read('stock.picking','search_read',[[['origin','=',op.dispatchReference||key],['company_id','=',p.companyId]]],{fields:['id'],limit:2});
  if(!rows.length)return null;if(rows.length!==1)throw Error('Hay varios albaranes con la referencia; conciliar, no repetir');
  const result=await this.verify(p,op,Number(rows[0].id));
  this.journal.put({key,digest:p.digest,state:result.status==='done'?'confirmed':'prepared',pickingId:result.pickingId,actor:'reconciliación',updatedAt:result.confirmedAt});return result;
 }
 async execute(p:StockProposal,key:string,actor:string){
  const job=this.queue.then(async()=>{
   const op=p.operations.find(x=>x.key===key);
   const operational=operationalWorkflowWritable(this.env,p.target)||op?.stageOnly===true&&(operationalRexWritable(this.env,p.target)&&op.kind==='reshipment'||operationalDocumentsWritable(this.env,p.target)&&['return','reshipment'].includes(op.kind));
   const test=this.env.INCIDENTS_ODOO_MODE!=='operational'&&this.env.INCIDENTS_ODOO_WRITE_ENABLED==='true'&&(demoWorkflowWritable(this.env,p.target)||(this.env.INCIDENTS_ODOO_APPROVED_DIGEST===p.digest&&this.env.INCIDENTS_ODOO_APPROVED_OPERATION===key))&&p.target===TEST_TARGET;
   if(!operational&&!test)throw Error('Escritura Odoo bloqueada: solo REX pendiente en conexión operativa habilitada o prueba exacta autorizada');
   if(!op||p.blockers.length||op.blockers.length||!op.lines.length)throw Error('Resuelve los bloqueos de la operación antes de escribir Odoo');
   if(op.receiptReview){
    const canonical=(lines:StockLine[])=>JSON.stringify(lines.map(l=>[l.productId,l.uomId,l.sourceId,l.destinationId,l.quantity,l.saleLineId||0,!!l.toRefund].join(':')).sort());
    if(!['complete','partial'].includes(op.receiptReview.state)||op.receiptReview.blockers.length||canonical(op.receiptReview.batch)!==canonical(op.lines)||!op.receiptBatch)throw Error('Recepción parcial o con unidades ya contabilizadas: validación bloqueada hasta conciliar el backorder');
   }
   if(op.receiptBatch){
    if(!physicalWorkflowWritable(this.env,p.target))throw Error('Recepción por lotes requiere conexión operativa habilitada o TEST aislado');
    const saved=this.journal.all().find(x=>x.key===key);
    if(saved)return this.reconcile(p,key);
    const entry:StockJournalEntry={key,digest:p.digest,state:'started',pickingId:op.receiptBatch.pickingId,actor,updatedAt:new Date().toISOString(),operation:structuredClone(op)};
    this.journal.put(entry);
    const context={mail_create_nosubscribe:true,mail_create_nolog:true,mail_notrack:true,tracking_disable:true,mail_notify_force_send:false,allowed_company_ids:[p.companyId]};
    try{const result=await applyReceiptBatch(this.read,this.write,p,op,context);this.journal.put({...entry,state:'confirmed',updatedAt:result.confirmedAt});return result;}
    catch{this.journal.put({...entry,state:'uncertain',updatedAt:new Date().toISOString()});throw Error('Recepción parcial Odoo incierta o incompleta. No repetir; conciliar el lote por ID');}
   }
   if(op.kind==='scrap')return this.executeScrap(p,op,actor);
   if(op.standardReturn)return this.executeStandardReturn(p,op,actor);
   const saved=this.journal.all().find(x=>x.key===key);
   if(saved){if(saved.state==='prepared'&&!op.stageOnly){if(!op.existingPickingId||op.existingPickingId!==saved.pickingId)throw Error('Recepción preparada no coincide con el albarán que se va a validar');}
    else return this.reconcile(p,key);}
   const existing=await this.read('stock.picking','search_read',[[['origin','=',op.dispatchReference||key],['company_id','=',p.companyId]]],{fields:['id'],limit:2});
   if(saved?.state==='prepared'&&op.existingPickingId){if(existing.length!==1||existing[0].id!==op.existingPickingId)throw Error('El albarán pendiente no coincide; no repetir');}
   if(existing.length&&!(saved?.state==='prepared'&&op.existingPickingId===existing[0]?.id))throw Error('Ya existe un albarán con esta referencia; conciliar, no repetir');
   const route=op.lines[0];
   const routeCode=op.kind==='reshipment'?'outgoing':op.kind==='return'?'incoming':route.sourceId===p.customerLocationId?'incoming':route.destinationId===p.customerLocationId?'outgoing':'internal';
   const outgoingTypes=op.kind==='return'?await this.read('stock.picking.type','read',[[p.outgoingPickingTypeId]],{fields:['id','company_id','return_picking_type_id']}):[];
   const returnTypeId=relation(outgoingTypes[0]?.return_picking_type_id);
   if(op.kind==='return'&&(!returnTypeId||relation(outgoingTypes[0]?.company_id)!==p.companyId))throw Error('Configura el tipo de devolución en la salida original; no usar recepción genérica');
   let types=op.kind==='return'
    ? await this.read('stock.picking.type','read',[[returnTypeId]],{fields:['id','code','company_id','default_location_src_id','default_location_dest_id']})
    : (op.kind==='reshipment'||op.extraOutbound)
    ? await this.read('stock.picking.type','search_read',[[['id','=',p.outgoingPickingTypeId]]],{fields:['id','code','company_id','default_location_src_id','default_location_dest_id'],limit:2})
    : await this.read('stock.picking.type','search_read',[[['company_id','=',p.companyId],['code','=',routeCode]]],{fields:['id','code','company_id','default_location_src_id','default_location_dest_id'],limit:20});
   // A customer's return type may default to Vendors (S65737: type6). Explicit
   // customer→stock locations override that default, as Odoo's return wizard does.
   if(op.kind!=='reshipment'&&op.kind!=='return')types=types.filter((t:any)=>(!relation(t.default_location_src_id)||relation(t.default_location_src_id)===route.sourceId)&&(!relation(t.default_location_dest_id)||relation(t.default_location_dest_id)===route.destinationId));
   if(types.length!==1)throw Error('Tipo de operación Odoo ambiguo; necesita configuración explícita');
   if((op.kind==='reshipment'||op.extraOutbound)&&(types[0].code!=='outgoing'||relation(types[0].company_id)!==p.companyId||([relation(types[0].default_location_src_id),relation(types[0].default_location_dest_id)].some((id,n)=>id&&id!==[route.sourceId,route.destinationId][n]))))throw Error('El tipo saliente original no coincide con la compañía o ruta propuesta');
   if(op.kind==='return'&&(types[0].code!=='incoming'||relation(types[0].company_id)!==p.companyId||route.sourceId!==p.customerLocationId||op.lines.some(l=>l.sourceId!==route.sourceId||l.destinationId!==route.destinationId)))throw Error('La devolución no coincide con la compañía y ruta del cliente');
   if(op.kind!=='reshipment'&&op.kind!=='return'&&(types[0].code!==routeCode||relation(types[0].company_id)!==p.companyId||([relation(types[0].default_location_src_id),relation(types[0].default_location_dest_id)].some((id,n)=>id&&id!==[route.sourceId,route.destinationId][n]))))throw Error('El tipo de entrada/salida no coincide con la compañía o ruta propuesta');
   let entry:StockJournalEntry={key,digest:p.digest,state:'started',actor,updatedAt:new Date().toISOString()};this.journal.put(entry);
   const context={mail_create_nosubscribe:true,mail_create_nolog:true,mail_notrack:true,tracking_disable:true,mail_notify_force_send:false,allowed_company_ids:[p.companyId]};
   try{
    const id=saved?.state==='prepared'?saved.pickingId:await this.write('stock.picking','create',[{origin:op.dispatchReference||key,company_id:p.companyId,partner_id:p.partnerId,sale_id:p.orderId,move_type:'direct',picking_type_id:types[0].id,location_id:route.sourceId,location_dest_id:route.destinationId,move_ids:op.lines.map(l=>[0,0,{name:`${p.incidentId} · ${l.sku}`,product_id:l.productId,product_uom:l.uomId,product_uom_qty:l.quantity,location_id:l.sourceId,location_dest_id:l.destinationId,company_id:p.companyId,...(l.saleLineId?{sale_line_id:l.saleLineId}:{}),...(l.toRefund?{to_refund:true}:{})}])}],{context});
    if(!Number.isInteger(id)||id<=0)throw Error('Odoo no confirmó el ID del albarán');
    entry={...entry,pickingId:id};this.journal.put(entry);
    if(!saved)await this.write('stock.picking','action_confirm',[[id]],{context});
    if(saved?.state==='prepared'){
     await this.verify(p,{...op,stageOnly:true},id);
     const preparedMoves=await this.read('stock.move','search_read',[[['picking_id','=',id],['state','!=','cancel'],['scrapped','=',false]]],{fields:['id','product_id','product_uom_qty'],limit:1000});
     if(preparedMoves.length!==op.lines.length)throw Error('La recepción preparada tiene líneas distintas; no validar');
     for(const move of preparedMoves){const line=op.lines.find(l=>l.productId===relation(move.product_id)&&l.quantity===Number(move.product_uom_qty));if(!line)throw Error('La recepción física no coincide con lo preparado');await this.write('stock.move','write',[[move.id],{quantity:line.quantity,picked:true}],{context});}
     const result=await this.write('stock.picking','button_validate',[[id]],{context});if(result&&typeof result==='object')throw Error('Odoo exige un asistente; no se confirma automáticamente');
     const confirmed=await this.verify(p,op,id);this.journal.put({...entry,state:'confirmed',updatedAt:confirmed.confirmedAt});return confirmed;
    }
    if(types[0].code!=='incoming')await this.write('stock.picking','action_assign',[[id]],{context});
    const moves=await this.read('stock.move','search_read',[[['picking_id','=',id],['state','!=','cancel'],['scrapped','=',false]]],{fields:['id','product_id','product_uom_qty','state'],limit:1000});
    if(moves.length!==op.lines.length)throw Error('Odoo generó movimientos adicionales; revisar antes de validar');
    if(!op.stageOnly&&types[0].code!=='incoming'&&moves.some((m:any)=>m.state!=='assigned'))throw Error('Odoo no reserva completamente la mercancía; no se fuerza stock negativo');
    if(op.stageOnly){const prepared=await this.verify(p,op,id);this.journal.put({...entry,state:'prepared',pickingId:id,updatedAt:prepared.confirmedAt});return prepared;}
    for(const move of moves){const l=op.lines.find(l=>l.productId===relation(move.product_id)&&l.quantity===Number(move.product_uom_qty));if(!l)throw Error('Movimientos distintos de los aprobados');await this.write('stock.move','write',[[move.id],{quantity:l.quantity,picked:true}],{context});}
    const result=await this.write('stock.picking','button_validate',[[id]],{context});
    if(result&&typeof result==='object')throw Error('Odoo exige un asistente; no se confirma automáticamente');
    const confirmed=await this.verify(p,op,id);this.journal.put({...entry,state:'confirmed',updatedAt:confirmed.confirmedAt});return confirmed;
   }catch{this.journal.put({...entry,state:'uncertain',updatedAt:new Date().toISOString()});throw Error('Resultado Odoo incierto o incompleto. No repetir; conciliar por referencia de operación');}
  });const audited=job.then(async result=>{await this.recordAudit(result,actor);return result;});this.queue=audited.catch(()=>{});return audited;
 }
 /** Recover only the audit of an already completed DEMO label. Never calls write
  * or an isolation wrapper, even if the picking changes while being inspected. */
 async reconcileDemoReshipmentForLabel(input:{key:string;digest:string;pickingId:number;orderId:number;companyId:number;reference:string;lines:StockLine[];shipmentCode:string;tracking?:string;target?:string},actor:string){
  const job=this.queue.then(async()=>{
   if(this.env.INCIDENTS_ODOO_MODE!=='test'||input.target!==TEST_TARGET||!/^REX-\d{4}-\d{5,}-\d{2}$/.test(input.reference)||input.shipmentCode!==`SIM-${input.reference}`||(input.tracking||input.shipmentCode)!==input.shipmentCode||!input.lines.length)throw Error('Conciliación exclusiva de una etiqueta DEMO existente');
   const rows=await this.read('stock.picking','read',[[input.pickingId]],{fields:['id','state','origin','company_id','sale_id','carrier_tracking_ref']});const picking=rows[0];
   if(!picking||picking.state!=='done'||picking.origin!==input.reference||relation(picking.sale_id)!==input.orderId||relation(picking.company_id)!==input.companyId||picking.carrier_tracking_ref!==input.shipmentCode)throw Error('La salida DEMO y su etiqueta no están confirmadas; no se repite la operación');
   const operation:StockOperation={key:input.key,kind:'reshipment',lines:input.lines,blockers:[],stageOnly:false,dispatchReference:input.reference};
   const confirmed=await this.verify({orderId:input.orderId,companyId:input.companyId,digest:input.digest,target:TEST_TARGET},operation,input.pickingId);
   const journalKey=`${input.key}:label:${input.shipmentCode}`,saved=this.journal.all().find(entry=>entry.key===journalKey);
   if(saved&&(saved.pickingId!==input.pickingId||saved.digest!==input.digest))throw Error('Diario de etiqueta DEMO contradictorio; requiere revisión');
   if(saved?.state!=='confirmed')this.journal.put({key:journalKey,digest:input.digest,state:'confirmed',pickingId:input.pickingId,actor,updatedAt:confirmed.confirmedAt});
   return {...confirmed,shipmentCode:input.shipmentCode,tracking:input.shipmentCode};
  });this.queue=job.catch(()=>{});return job;
 }
 /** Validate only an audited REX whose generated-label evidence was checked by the route. */
 async validateReshipmentForLabel(input:{key:string;digest:string;pickingId:number;orderId:number;companyId:number;reference:string;lines:StockLine[];shipmentCode:string;tracking?:string;target?:string},actor:string){
  const job=this.queue.then(async()=>{
   const operational=operationalRexWritable(this.env,input.target);
   const test=this.env.INCIDENTS_ODOO_MODE!=='operational'&&(input.target||TEST_TARGET)===TEST_TARGET&&this.env.INCIDENTS_ODOO_WRITE_ENABLED==='true'&&this.env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED==='true'&&(demoWorkflowWritable(this.env,input.target||TEST_TARGET)||(this.env.INCIDENTS_ODOO_APPROVED_DIGEST===input.digest&&this.env.INCIDENTS_ODOO_APPROVED_OPERATION===input.key));
   if(!operational&&!test)throw Error('Validación Odoo bloqueada: la conexión REX no está habilitada para este destino');
   if(!/^REX-\d{4}-\d{5,}-\d{2}$/.test(input.reference)||!input.shipmentCode.trim()||!input.lines.length)throw Error('Datos de etiqueta o picking REX incompletos');
   const tracking=input.tracking?.trim()||input.shipmentCode;
   const journalKey=`${input.key}:label:${input.shipmentCode}`;const saved=this.journal.all().find(x=>x.key===journalKey);
   const proposal={orderId:input.orderId,companyId:input.companyId,digest:input.digest,target:input.target||TEST_TARGET};
   const operation:StockOperation={key:input.key,kind:'reshipment',lines:input.lines,blockers:[],stageOnly:false,dispatchReference:input.reference};
   const rows=await this.read('stock.picking','read',[[input.pickingId]],{fields:['id','name','state','origin','company_id','sale_id','carrier_tracking_ref']});const picking=rows[0];
   if(!picking||picking.origin!==input.reference||relation(picking.sale_id)!==input.orderId||relation(picking.company_id)!==input.companyId)throw Error('El picking no coincide con el REX/pedido/compañía auditados');
   if(picking.state==='done'){
    if(String(picking.carrier_tracking_ref||'')!==tracking)throw Error('El picking ya está validado con otro tracking; requiere conciliación');
    const confirmed=await this.verify(proposal,operation,input.pickingId);
    if(saved?.state!=='confirmed')this.journal.put({key:journalKey,digest:input.digest,state:'confirmed',pickingId:input.pickingId,actor,updatedAt:confirmed.confirmedAt});
    return {...confirmed,shipmentCode:input.shipmentCode,tracking};
   }
   if(saved)throw Error('Validación REX con resultado previo en diario; concilia Odoo antes de reintentar. No se repite la escritura');
   if(picking.state!=='assigned')throw Error('El picking REX no está reservado; no se valida');
   await this.verify(proposal,{...operation,stageOnly:true},input.pickingId);
   const moves=await this.read('stock.move','search_read',[[['picking_id','=',input.pickingId],['state','!=','cancel']]],{fields:['id','product_id','product_uom_qty','state'],limit:1000});
   if(moves.length!==input.lines.length||moves.some((m:any)=>m.state!=='assigned'))throw Error('La reserva del picking no está completa');
   const context={mail_create_nosubscribe:true,mail_create_nolog:true,mail_notrack:true,tracking_disable:true,mail_notify_force_send:false,allowed_company_ids:[input.companyId]};
   const entry:StockJournalEntry={key:journalKey,digest:input.digest,state:'started',pickingId:input.pickingId,actor,updatedAt:new Date().toISOString()};this.journal.put(entry);
   try{
    await this.write('stock.picking','write',[[input.pickingId],{carrier_tracking_ref:tracking}],{context});
    for(const move of moves){const line=input.lines.find(l=>l.productId===relation(move.product_id)&&l.quantity===Number(move.product_uom_qty));if(!line)throw Error('Movimiento REX no coincide');await this.write('stock.move','write',[[move.id],{quantity:line.quantity,picked:true}],{context});}
    const result=await this.write('stock.picking','button_validate',[[input.pickingId]],{context});if(result&&typeof result==='object')throw Error('Odoo requiere asistente; no se confirma automáticamente');
    const confirmed=await this.verify(proposal,operation,input.pickingId);
    const verified=await this.read('stock.picking','read',[[input.pickingId]],{fields:['id','carrier_tracking_ref']});
    if(verified[0]?.carrier_tracking_ref!==tracking)throw Error('Odoo no confirma el tracking de la etiqueta');
    this.journal.put({...entry,state:'confirmed',updatedAt:confirmed.confirmedAt});return {...confirmed,shipmentCode:input.shipmentCode,tracking};
   }catch(error){this.journal.put({...entry,state:'uncertain',updatedAt:new Date().toISOString()});throw error;}
  });const audited=job.then(async result=>{await this.recordAudit(result,actor);return result;});this.queue=audited.catch(()=>{});return audited;
 }
}
