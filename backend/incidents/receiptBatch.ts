import type {OdooCall,StockLine,StockOperation,StockProposal} from './odooStock.ts';
import {reviewPartialReceipt} from './partialReceipt.ts';
const relation=(v:any)=>Array.isArray(v)?Number(v[0]):0;
export const receiptCanonical=(lines:StockLine[])=>JSON.stringify(lines.map(l=>[l.productId,l.uomId,l.sourceId,l.destinationId,l.quantity,l.saleLineId||0,!!l.toRefund].join(':')).sort());
const fields=['id','name','state','origin','company_id','partner_id','sale_id','picking_type_id','backorder_id','location_id','location_dest_id'];
/** ID and parent are authoritative: backorders intentionally share origin. */
async function inspect(read:OdooCall,p:StockProposal,op:StockOperation,id:number,parent:number|undefined,lines:StockLine[],complete:boolean){
 const batch=op.receiptBatch!;
 const rows=await read('stock.picking','read',[[id]],{fields});const row=rows[0];
 const route=batch.expected[0];
 if(rows.length!==1||row.id!==id||row.origin!==batch.origin||relation(row.company_id)!==p.companyId||relation(row.partner_id)!==p.partnerId||(relation(row.sale_id)&&relation(row.sale_id)!==p.orderId)||relation(row.location_id)!==route.sourceId||relation(row.location_dest_id)!==route.destinationId||relation(row.backorder_id)!==(parent||0)||!(complete?['done']:['confirmed','waiting','assigned']).includes(row.state))throw Error('Entrada/backorder no coincide con ID, padre, estado, cliente, compañía o ruta aprobados; conciliar');
 const types=await read('stock.picking.type','read',[[relation(row.picking_type_id)]],{fields:['id','code','company_id','create_backorder']});
 const out=await read('stock.picking.type','read',[[p.outgoingPickingTypeId]],{fields:['id','return_picking_type_id']});
 if(types.length!==1||types[0].code!=='incoming'||relation(types[0].company_id)!==p.companyId||types[0].id!==relation(out[0]?.return_picking_type_id))throw Error('Tipo de devolución distinto al original');
 const moves=await read('stock.move','search_read',[[['picking_id','=',id],['state','!=','cancel'],['scrapped','=',false]]],{fields:['id','product_id','product_uom_qty','quantity','picked','product_uom','sale_line_id','to_refund','location_id','location_dest_id','state'],limit:1000});
 const actual=moves.map((m:any)=>({productId:relation(m.product_id),sku:'read',uomId:relation(m.product_uom),sourceId:relation(m.location_id),destinationId:relation(m.location_dest_id),quantity:Number(complete?m.quantity:m.product_uom_qty),saleLineId:relation(m.sale_line_id)||undefined,toRefund:!!m.to_refund}));
 if(moves.length>=1000||moves.some((m:any)=>complete?m.state!=='done':!['confirmed','waiting','assigned'].includes(m.state))||receiptCanonical(actual)!==receiptCanonical(lines)||new Set(actual.map((l:StockLine)=>receiptCanonical([{...l,quantity:1}]))).size!==actual.length)throw Error('Movimientos de entrada/backorder distintos de la cantidad/UoM/vínculo aprobados');
 return {row,moves,type:types[0]};
}
/** Recovery probes completed receipts, but a pristine pending picking still needs
 * its first validation. Inspect every identity/line before returning permission
 * to enter the guarded executor; this function never writes or creates stock. */
export async function reconcileReceiptBatchIfCompleted(read:OdooCall,p:StockProposal,op:StockOperation){
 const batch=op.receiptBatch!;
 const rows=await read('stock.picking','read',[[batch.pickingId]],{fields:['id','state']});
 if(rows.length===1&&rows[0].state==='done')return verifyReceiptBatch(read,p,op);
 await inspect(read,p,op,batch.pickingId,batch.parentPickingId,batch.expected,false);
 const children=await read('stock.picking','search_read',[[['backorder_id','=',batch.pickingId]]],{fields:['id'],limit:2});
 if(children.length)throw Error('Entrada pendiente con backorder existente; conciliar antes de validar');
 return null;
}
export async function verifyReceiptBatch(read:OdooCall,p:StockProposal,op:StockOperation){
 const batch=op.receiptBatch!;
 const plan=reviewPartialReceipt(batch.expected,op.lines);
 if(plan.blockers.length||!plan.batch.length)throw Error('Lote de recepción inválido');
 const {row}=await inspect(read,p,op,batch.pickingId,batch.parentPickingId,op.lines,true);
 const children=await read('stock.picking','search_read',[[['backorder_id','=',batch.pickingId]]],{fields,limit:3});
 let backorder:undefined|{key:string;pickingId:number;externalReference:string;lines:StockLine[];parentPickingId:number};
 const discardedRemainder=op.discardRemainder?plan.remainder:undefined;
 if(plan.remainder.length&&!op.discardRemainder){
  if(children.length!==1)throw Error('No hay un único backorder para el resto; conciliar sin repetir');
  const seen=new Set<number>();
  const inspectTree=async(id:number,parent:number):Promise<StockLine[]>=>{
   if(seen.has(id)||seen.size>=20)throw Error('Cadena de backorders ambigua o demasiado larga');seen.add(id);
   const rows=await read('stock.picking','read',[[id]],{fields});const row=rows[0];if(!row)throw Error('Backorder no encontrado');
   const moves=await read('stock.move','search_read',[[['picking_id','=',id],['state','!=','cancel'],['scrapped','=',false]]],{fields:['product_id','product_uom','quantity','product_uom_qty','sale_line_id','to_refund','location_id','location_dest_id'],limit:1000});
   const current:StockLine[]=moves.map((m:any)=>({productId:relation(m.product_id),sku:batch.expected.find(l=>l.productId===relation(m.product_id))?.sku||'unknown',uomId:relation(m.product_uom),quantity:Number(row.state==='done'?m.quantity:m.product_uom_qty),sourceId:relation(m.location_id),destinationId:relation(m.location_dest_id),saleLineId:relation(m.sale_line_id)||undefined,toRefund:!!m.to_refund}));
   await inspect(read,p,op,id,parent,current,row.state==='done');
   const next=await read('stock.picking','search_read',[[['backorder_id','=',id]]],{fields:['id'],limit:3});
   if(next.length>1||(next.length&&row.state!=='done'))throw Error('Cadena de backorders inconsistente');
   return [...current,...(next.length?await inspectTree(next[0].id,id):[])];
  };
  const balance=reviewPartialReceipt(plan.remainder,await inspectTree(children[0].id,batch.pickingId));
  if(balance.state!=='complete')throw Error('Resto histórico distinto de sus lotes/backorders; conciliar');
  backorder={key:`${batch.origin}:pending:${children[0].id}`,pickingId:children[0].id,externalReference:children[0].name,lines:plan.remainder,parentPickingId:batch.pickingId};
 }else if(children.length)throw Error(op.discardRemainder?'Se creó un backorder pese a declarar producto incompleto; conciliar, no reintentar':'Backorder inesperado en recepción completa; conciliar');
 return {key:op.key,digest:p.digest,pickingId:batch.pickingId,confirmedAt:new Date().toISOString(),kind:'return' as const,returnId:op.returnId,lines:op.lines,status:'done' as const,externalReference:String(row.name),target:p.target,receiptOrigin:batch.origin,receiptSourceKey:batch.sourceKey,backorder,...(discardedRemainder?.length?{discardedRemainder}:{})};
}
export async function applyReceiptBatch(read:OdooCall,write:OdooCall,p:StockProposal,op:StockOperation,context:Record<string,unknown>){
 const batch=op.receiptBatch!;
 const plan=reviewPartialReceipt(batch.expected,op.lines);
 if(plan.blockers.length||!plan.batch.length||!op.receiptReview||!['complete','partial'].includes(op.receiptReview.state)||receiptCanonical(op.receiptReview.batch)!==receiptCanonical(op.lines)||op.receiptReview.blockers.length)throw Error('Revisión de lote parcial no válida');
 const uoms=await read('uom.uom','read',[[...new Set(batch.expected.map(l=>l.uomId))]],{fields:['id','rounding']});
 for(const line of [...batch.expected,...op.lines,...plan.remainder]){const step=Number(uoms.find((u:any)=>u.id===line.uomId)?.rounding),units=line.quantity/step;if(!(step>0)||!Number.isFinite(units)||Math.abs(units-Math.round(units))>16*Number.EPSILON*Math.max(1,Math.abs(units)))throw Error('Cantidad no representable en el redondeo de su UoM Odoo; no se modifica el lote');}
 const {moves,type}=await inspect(read,p,op,batch.pickingId,batch.parentPickingId,batch.expected,false);
 if(plan.remainder.length&&!op.discardRemainder&&!['ask','always'].includes(type.create_backorder))throw Error('El tipo de recepción cancela el resto; no se valida un parcial con política never');
 const children=await read('stock.picking','search_read',[[['backorder_id','=',batch.pickingId]]],{fields:['id'],limit:2});if(children.length)throw Error('La entrada ya tiene un backorder; conciliar');
 // Every demand line is written, including zero for products not in this arrival.
 for(const m of moves){const identity=(l:StockLine)=>l.productId===relation(m.product_id)&&l.uomId===relation(m.product_uom)&&l.sourceId===relation(m.location_id)&&l.destinationId===relation(m.location_dest_id)&&(l.saleLineId||0)===relation(m.sale_line_id)&&!!l.toRefund===!!m.to_refund;const quantity=op.lines.find(identity)?.quantity||0;
  await write('stock.move','write',[[m.id],{quantity,picked:quantity>0}],{context});
 }
 const response=await write('stock.picking','button_validate',[[batch.pickingId]],{context});
 if(response&&typeof response==='object'){
  // No generic wizard acceptance. Build a fresh native wizard with exactly this picking.
  if(response.res_model!=='stock.backorder.confirmation'||response.type!=='ir.actions.act_window'||typeof response.context!=='object'||!response.context||JSON.stringify(response.context.button_validate_picking_ids)!==JSON.stringify([batch.pickingId])||!plan.remainder.length)throw Error('Asistente ajeno al lote; no se confirma');
  const wizardContext={...context,button_validate_picking_ids:[batch.pickingId]};
  const id=await write('stock.backorder.confirmation','create',[{pick_ids:[[6,0,[batch.pickingId]]],backorder_confirmation_line_ids:[[0,0,{picking_id:batch.pickingId,to_backorder:!op.discardRemainder}]]}],{context:wizardContext});
  if(!Number.isSafeInteger(id)||id<=0)throw Error('Asistente sin ID');
  const wizard=await read('stock.backorder.confirmation','read',[[id]],{fields:['id','pick_ids','backorder_confirmation_line_ids']});
  const lines=wizard.length===1?await read('stock.backorder.confirmation.line','read',[wizard[0].backorder_confirmation_line_ids],{fields:['picking_id','to_backorder']}):[];
  if(JSON.stringify(wizard[0]?.pick_ids)!==JSON.stringify([batch.pickingId])||lines.length!==1||relation(lines[0].picking_id)!==batch.pickingId||lines[0].to_backorder!==!op.discardRemainder)throw Error('El asistente incluye otra entrada o una decisión de resto distinta a la aprobada');
  await write('stock.backorder.confirmation','process',[[id]],{context:wizardContext});
 }
 return verifyReceiptBatch(read,p,op);
}
