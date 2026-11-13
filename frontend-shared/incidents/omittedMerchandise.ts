import type {Incident} from './types.ts';
/** Customer remedy (refund/resend) does not change the falsely recorded stock exit. */
export function requiresOmittedStockCorrection(i:Pick<Incident,'origin'|'type'|'solution'|'products'>){
 if(i.origin!=='warehouse'||!['resend_missing','refund_missing'].includes(i.solution||''))return false;
 return i.type==='missing_product'||i.type==='wrong_quantity'&&i.products.length>0&&
  i.products.every(p=>p.receivedQuantity!==undefined&&p.receivedQuantity<p.orderedQuantity);
}
