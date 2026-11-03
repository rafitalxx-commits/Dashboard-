import type {IncidentProduct,OrderContext} from './types.ts';
/** Internal pending-identity marker, never an Odoo product SKU. */
export function unidentifiedReturnProduct(product:{sku:string}):boolean{return product.sku==='POR_IDENTIFICAR';}
/** Classification is Odoo's product type, never a guessed SKU/name. Legacy
 * unclassified snapshots remain readable; authoritative lookup supplies type. */
export function merchandiseProducts<T extends {productType?:string}>(products:T[]):T[]{return products.filter(product=>product.productType!=='service');}
export function merchandiseContext(context:OrderContext):OrderContext{
 const products=merchandiseProducts(context.products);
 return {...context,products,excludedServiceCount:(context.excludedServiceCount||0)+context.products.length-products.length};
}
export function orderMerchandise(lines:any[],products:any[]):IncidentProduct[]{
 return lines.flatMap(line=>{const product=products.find(p=>p.id===line.product_id?.[0]);if(!product||product.type==='service')return [];
 return [{saleLineId:line.id,productId:product.id,productType:product.type,sku:product.default_code||String(product.id),name:line.name,orderedQuantity:Number(line.product_uom_qty),affectedQuantity:Number(line.product_uom_qty),unitSalePrice:Number(line.price_unit)*(1-Number(line.discount||0)/100),unitCostSnapshot:product.standard_price===undefined?undefined:Number(product.standard_price)}];});
}

/** Retain only confirmed quantities from the client; identity, names and BoM come from Odoo. */
export function verifiedIncidentProduct(original:IncidentProduct,submitted:IncidentProduct):IncidentProduct {
 const selections=submitted.selectedKitComponents;
 if(selections===undefined)return {...original,affectedQuantity:submitted.affectedQuantity,receivedQuantity:submitted.receivedQuantity};
 const components=original.kitComponents?.filter(c=>c.productType!=='service')||[];
 if(!Array.isArray(selections)||!components.length||selections.length!==components.length||new Set(selections.map(c=>c.productId)).size!==components.length)throw Error(`${original.sku}: confirma todos los componentes fabricados`);
 const selectedKitComponents=components.map(component=>{
  const chosen=selections.find(c=>c.productId===component.productId&&c.sku===component.sku);
  if(!chosen||!Number.isFinite(chosen.quantity)||chosen.quantity<0)throw Error(`${original.sku}: componente o cantidad no válidos`);
  return {productId:component.productId,sku:component.sku,name:component.name,uomId:component.uomId,imageUrl:component.imageUrl,quantity:chosen.quantity};
 });
 return {...original,affectedQuantity:submitted.affectedQuantity,receivedQuantity:submitted.receivedQuantity,selectedKitComponents};
}
