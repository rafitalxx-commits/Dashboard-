import type {Incident,IncidentCost} from './types.ts';

/** Returning the sale price of merchandise omitted in preparation reverses a sale;
 * it is not destroyed/lost stock or an extraordinary incident expense. Derive this
 * for existing records too, preserving their refund/payment history unchanged. */
export function isUnsentMerchandiseRefund(i:Incident,c:IncidentCost):boolean{
 if(c.category!=='refund'||c.direction!=='cost'||i.origin!=='warehouse'||i.solution!=='refund_missing')return false;
 return i.type==='missing_product'||i.type==='wrong_quantity'&&i.products.length>0&&
  i.products.every(p=>p.receivedQuantity!==undefined&&p.receivedQuantity<=p.orderedQuantity)&&
  i.products.some(p=>p.receivedQuantity!<p.orderedQuantity);
}
export function unsentMerchandiseRefundAmount(i:Incident):number{
 return i.costs.filter(c=>isUnsentMerchandiseRefund(i,c)).reduce((n,c)=>n+Math.abs(c.amount),0);
}
