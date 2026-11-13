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
/** A normal customer withdrawal/product return reverses the sale; the refund
 * is not an extraordinary loss. Real, separately entered pickup expenses remain costs. */
export function isCustomerReturnRefund(i:Incident,c:IncidentCost):boolean{
 return c.category==='refund'&&c.direction==='cost'&&i.origin==='customer'&&i.type==='withdrawal'&&i.returns.length>0;
}
export function isSaleAdjustmentRefund(i:Incident,c:IncidentCost):boolean{
 return isUnsentMerchandiseRefund(i,c)||isCustomerReturnRefund(i,c);
}
/** Sale price of the goods listed on normal customer-withdrawal DEV records. */
export function customerWithdrawalProductValue(i:Incident):number{
 if(i.origin!=='customer'||i.type!=='withdrawal')return 0;
 let value=0;
 for(const ret of i.returns)for(const line of ret.products){
  const product=i.products.find(p=>p.sku===line.sku&&Number.isFinite(p.unitSalePrice));
  if(product)value+=Math.max(0,product.unitSalePrice||0)*Math.max(0,line.expectedQuantity);
 }
 return Math.round(value*100)/100;
}
export function unsentMerchandiseRefundAmount(i:Incident):number{
 return i.costs.filter(c=>isUnsentMerchandiseRefund(i,c)).reduce((n,c)=>n+Math.abs(c.amount),0);
}
