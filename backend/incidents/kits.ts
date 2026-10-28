import type {IncidentProduct,IncidentKitComponent} from './types.ts';
type Read=(model:string,method:string,args:any[],kwargs:any)=>Promise<any[]>;
const id=(v:any)=>Array.isArray(v)?Number(v[0]):Number(v)||0;
/** Snapshot physical components without creating/manufacturing any product.
 * For a return, completed ORIGINAL moves linked to its sale line take priority
 * over today's recipe. With no completed source, only a unique BoM is accepted. */
export async function enrichIncidentKits(read:Read,orderId:number,companyId:number,saleLines:any[],products:IncidentProduct[],imageBase:string):Promise<IncidentProduct[]> {
 const pickings=await read('stock.picking','search_read',[[['sale_id','=',orderId],['state','!=','cancel'],['picking_type_id.code','=','outgoing']]],{fields:['id','origin','state'],limit:100});
 if(pickings.length>=100)throw Error('Demasiadas salidas originales para determinar el desglose del kit');
 const originalPickings=pickings.filter(p=>!/^REX-|^INC-/.test(String(p.origin||'')));
 const originalIds=originalPickings.filter(p=>!p.state||p.state==='done').map(p=>p.id);
 const moves=originalIds.length?await read('stock.move','search_read',[[['picking_id','in',originalIds],['state','=','done'],['scrapped','=',false]]],{fields:['product_id','product_uom','quantity','sale_line_id'],limit:1000}):[];
 if(moves.length>=1000)throw Error('Desglose original incompleto: demasiados movimientos');
 const cache=new Map<number,any>();
 const product=async(productId:number)=>{if(!cache.has(productId)){const rows=await read('product.product','read',[[productId]],{fields:['id','default_code','name','type','product_tmpl_id','uom_id','is_storable','standard_price']});if(rows.length!==1)throw Error('Componente de kit inexistente o ambiguo');cache.set(productId,rows[0]);}return cache.get(productId);};
 const knownIds=[...new Set([...products.map(p=>p.productId).filter(Boolean),...moves.map(m=>id(m.product_id)).filter(Boolean)])];
 if(knownIds.length){const known=await read('product.product','read',[knownIds],{fields:['id','default_code','name','type','product_tmpl_id','uom_id','is_storable','standard_price']});for(const row of known)cache.set(row.id,row);}
 const component=(p:any,quantityPerKit:number):IncidentKitComponent=>({productId:p.id,sku:p.default_code||String(p.id),name:p.name||p.default_code||String(p.id),productType:p.type,quantityPerKit,uomId:id(p.uom_id),imageUrl:`${imageBase}/api/incidents/product-image?id=${p.id}`});
 const aggregate=(rows:IncidentKitComponent[])=>{const grouped=new Map<string,IncidentKitComponent>();for(const row of rows){const key=`${row.productId}:${row.uomId}`;const before=grouped.get(key);grouped.set(key,before?{...before,quantityPerKit:before.quantityPerKit+row.quantityPerKit}:row);}return [...grouped.values()];};
 const bomParts=async(p:any,quantity:number,ancestors:number[]):Promise<IncidentKitComponent[]>=>{
  if(p.type==='service')return [];
  if(ancestors.includes(p.id)||ancestors.length>8)throw Error('Lista de materiales cíclica o demasiado profunda');
  if(!id(p.product_tmpl_id))return [component(p,quantity)];
  const all=await read('mrp.bom','search_read',[[['product_tmpl_id','=',id(p.product_tmpl_id)],['active','=',true],['type','in',['normal','phantom']],['company_id','in',[false,companyId]]]],{fields:['id','product_id','product_qty','product_uom_id','bom_line_ids'],limit:50});
  const compatible=all.filter(b=>!id(b.product_id)||id(b.product_id)===p.id),exact=compatible.filter(b=>id(b.product_id)===p.id),choices=exact.length?exact:compatible;
  if(choices.length>1||all.length>=50)throw Error(`Kit ${p.default_code}: varias listas de materiales; requiere selección explícita`);
  if(!choices.length)return [component(p,quantity)];
  const bom=choices[0];if(!(Number(bom.product_qty)>0)||id(bom.product_uom_id)!==id(p.uom_id))throw Error(`Kit ${p.default_code}: unidad/cantidad de fabricación incompatible`);
  const rows=await read('mrp.bom.line','read',[bom.bom_line_ids],{fields:['product_id','product_qty','product_uom_id']});if(!rows.length)throw Error(`Kit ${p.default_code}: lista de materiales vacía`);
  const result:IncidentKitComponent[]=[];
  for(const row of rows){const child=await product(id(row.product_id));if(child.type==='service')continue;if(id(row.product_uom_id)!==id(child.uom_id))throw Error(`Kit ${p.default_code}: unidad del componente incompatible`);const amount=quantity*Number(row.product_qty)/Number(bom.product_qty);if(!(amount>0))throw Error(`Kit ${p.default_code}: cantidad de componente inválida`);result.push(...await bomParts(child,amount,[...ancestors,p.id]));}
  return aggregate(result);
 };
 const result:IncidentProduct[]=[];
 for(const item of products){
  const parent=await product(item.productId!);if(parent.type==='service')continue;
  const line=saleLines.find(l=>l.id===item.saleLineId)||saleLines.find(l=>id(l.product_id)===item.productId),original=line?moves.filter(m=>id(m.sale_line_id)===line.id):[];
  if(original.some(m=>id(m.product_id)===item.productId)){result.push(item);continue;}
  let parts:IncidentKitComponent[]=[];let source:'original_delivery'|'bom'='bom';
  if(original.length){if(originalPickings.some(p=>p.state&&p.state!=='done'))throw Error(`Kit ${item.sku}: la salida original está parcial o pendiente; concilia sus componentes antes de preparar la devolución`);source='original_delivery';if(!(Number(line.product_uom_qty)>0))throw Error('Cantidad original del kit inválida');for(const move of original){const p=await product(id(move.product_id));if(p.type==='service')continue;if(id(move.product_uom)!==id(p.uom_id)||!(Number(move.quantity)>0))throw Error('Componente original del kit sin cantidad/unidad válida');parts.push(component(p,Number(move.quantity)/Number(line.product_uom_qty)));}parts=aggregate(parts);}
  else parts=await bomParts(parent,1,[]);
  if(parts.length===1&&parts[0].productId===item.productId)result.push(item);
  else if(parts.length)result.push({...item,kitComponents:parts,kitSource:source});
  else throw Error(`Kit ${item.sku}: no contiene mercancía física; registra los servicios en Costes`);
 }
 return result;
}
