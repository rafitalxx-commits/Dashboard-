import type {Incident} from './types.ts';
import {TEST_TARGET} from './odooRuntime.ts';
export function requiresExtraOutbound(i:Incident){return i.origin==='warehouse'&&i.type==='wrong_quantity'&&['keep_extra','recover_extra'].includes(i.solution||'')&&i.products.length>0&&i.products.every(p=>p.receivedQuantity!==undefined&&p.receivedQuantity>p.orderedQuantity);}
export function extraOutboundRecorded(i:Incident){
 if(!requiresExtraOutbound(i))return false;
 const expected=i.products.flatMap(p=>p.kitComponents?.length?p.kitComponents.filter(c=>c.productType!=='service').map(c=>({sku:c.sku,quantity:p.selectedKitComponents?.find(s=>s.productId===c.productId)?.quantity??c.quantityPerKit*(p.receivedQuantity!-p.orderedQuantity)})).filter(l=>l.quantity>0):[{sku:p.sku,quantity:p.receivedQuantity!-p.orderedQuantity}]);
 const canonical=(lines:Array<{sku:string;quantity:number}>)=>JSON.stringify([...lines.reduce((m,l)=>m.set(l.sku,(m.get(l.sku)||0)+l.quantity),new Map<string,number>())].sort((a,b)=>a[0].localeCompare(b[0])));
 const matches=i.odooOperations?.filter(op=>op.kind==='correction'&&op.key===`${i.id}:correction`&&op.status==='done'&&op.lines?.length&&(op.target||TEST_TARGET)===(i.documentPreparation?.target||TEST_TARGET))||[];
 return matches.length===1&&canonical(matches[0].lines!)===canonical(expected);
}
