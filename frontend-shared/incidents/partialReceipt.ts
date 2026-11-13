import type { StockLine } from './odooStock.ts';

export type ReceiptReview = {
  state: 'empty' | 'partial' | 'complete' | 'already_posted' | 'invalid';
  rows: Array<{ sku:string; productId:number; uomId:number; expected:number; received:number; posted:number; thisArrival:number; pending:number }>;
  batch: StockLine[];
  remainder: StockLine[];
  blockers: string[];
};

// Identity includes route and sale/refund linkage: equal product quantities must
// never conceal a changed destination or a different accounting operation.
const key = (l:StockLine) => JSON.stringify([l.productId,l.uomId,l.sourceId,l.destinationId,l.saleLineId||0,!!l.toRefund]);
// Only absorb binary arithmetic noise, not a business/UoM rounding threshold.
const difference = (a:number,b:number) => {
  const delta=a-b,tolerance=8*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
  return Math.abs(delta)<=tolerance?0:Number(delta.toPrecision(15));
};

/** Read-only plan. received is CUMULATIVE physical count, posted only confirmed
 * Odoo receipts. Neither a prepared picking nor a proposed batch moves stock. */
export function reviewPartialReceipt(expected:StockLine[], received:StockLine[], posted:StockLine[]=[]):ReceiptReview {
  const blockers:string[]=[];
  const aggregate=(lines:StockLine[],label:string)=>{
    const result=new Map<string,StockLine>();
    for(const l of lines){
      if(!l.sku?.trim() || ![l.productId,l.uomId,l.sourceId,l.destinationId].every(id=>Number.isSafeInteger(id)&&id>0) || l.sourceId===l.destinationId || !Number.isFinite(l.quantity) || l.quantity<=0 || (l.saleLineId!==undefined&&(!Number.isSafeInteger(l.saleLineId)||l.saleLineId<=0))){
        blockers.push(`${label}: identidad, cantidad o ruta no válida`);continue;
      }
      const identity=key(l),previous=result.get(identity);
      if(previous&&previous.sku!==l.sku)blockers.push(`${label}: varias referencias para el mismo producto/ruta`);
      const quantity=(previous?.quantity||0)+l.quantity;
      if(!Number.isFinite(quantity))blockers.push(`${label}: suma de cantidades no válida`);
      result.set(identity,{...l,quantity});
    }
    return result;
  };
  const demand=aggregate(expected,'Esperado'),physical=aggregate(received,'Recibido'),done=aggregate(posted,'Contabilizado');
  if(!demand.size)blockers.push('No hay mercancía esperada para esta devolución');
  for(const [identity,l] of [...physical,...done]){
    if(!demand.has(identity)||demand.get(identity)!.sku!==l.sku)blockers.push(`${l.sku}: producto, unidad, vínculo o ruta ajenos a la entrada esperada`);
  }
  const rows:ReceiptReview['rows']=[],batch:StockLine[]=[],remainder:StockLine[]=[];
  for(const [identity,l] of demand){
    const count=physical.get(identity)?.quantity||0,accounted=done.get(identity)?.quantity||0;
    if(difference(count,l.quantity)>0)blockers.push(`${l.sku}: recibido superior a lo esperado`);
    if(difference(accounted,count)>0)blockers.push(`${l.sku}: el conteo recibido es inferior a lo ya contabilizado; conciliar, no sobrescribir`);
    if(difference(accounted,l.quantity)>0)blockers.push(`${l.sku}: contabilizado superior a lo esperado`);
    const thisArrival=Math.max(0,difference(count,accounted)),pending=Math.max(0,difference(l.quantity,count));
    rows.push({sku:l.sku,productId:l.productId,uomId:l.uomId,expected:l.quantity,received:count,posted:accounted,thisArrival,pending});
    if(thisArrival>0)batch.push({...l,quantity:thisArrival});
    if(pending>0)remainder.push({...l,quantity:pending});
  }
  const unique=[...new Set(blockers)];
  // Invalid input must not leave executable-looking quantities in the contract.
  return {state:unique.length?'invalid':!batch.length?(done.size?'already_posted':'empty'):remainder.length?'partial':'complete',rows,batch:unique.length?[]:batch,remainder:unique.length?[]:remainder,blockers:unique};
}
