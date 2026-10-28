import type { CatalogMatch } from './types.ts';
type ReadRpc = (model:string,method:string,args:unknown[],kwargs:Record<string,unknown>)=>Promise<any>;
/** Read-only, bounded full Odoo catalog search. No demo fallback or cache refresh. */
export async function searchIncidentCatalog(call:ReadRpc,query:string,id?:number):Promise<{products:CatalogMatch[];hasMore:boolean}>{
 const term=query.trim();
 if(id!==undefined&&(!Number.isInteger(id)||id<=0))throw Error('Producto inválido');
 if(id===undefined&&(term.length<2||term.length>120))throw Error('Escribe entre 2 y 120 caracteres');
 const domain:unknown[]=[['active','=',true],['type','!=','service']];
 if(id!==undefined)domain.push(['id','=',id]);
 else for(const token of term.split(/\s+/).filter(Boolean))domain.push('|','|',['default_code','ilike',token],['barcode','ilike',token],['name','ilike',token]);
 const rows=await call('product.product','search_read',[domain],{fields:['id','default_code','display_name','barcode','image_128','type'],context:{lang:'es_ES'},order:'default_code asc, id asc',limit:21});
 return {products:rows.filter((p:any)=>p.type!=='service').slice(0,20).map((p:any)=>({...(p.type?{productType:p.type}:{}),productId:p.id,sku:p.default_code||String(p.id),name:p.display_name||p.default_code||String(p.id),barcode:p.barcode||'',...(p.image_128?{imageUrl:/^(data:|https?:)/.test(p.image_128)?p.image_128:`data:image/png;base64,${p.image_128}`}:{})})),hasMore:rows.length>20};
}
