import {requiresOmittedStockCorrection} from './omittedMerchandise.ts';
import {incidentPendingWork} from './operatorWorkflow.ts';
import {incidentShipments} from './shipmentConfirmation.ts';
import {confirmWarehouseReceipt} from './receiptConfirmation.ts';
import { merchandiseContext, merchandiseProducts, unidentifiedReturnProduct } from './merchandise.ts';
import type { Incident, IncidentOrigin, IncidentType, WizardDraft, IncidentProcess, IncidentCost, CustomerReturn } from './types.ts';
import { getIncidentClosureChecklist } from './domain.ts';

export const origins: Record<IncidentOrigin,string> = { warehouse:'Preparación / Almacén', carrier:'Transporte', customer:'Cliente / Devoluciones' };
export const types: Record<IncidentType,string> = { wrong_product:'Producto equivocado',missing_product:'Falta de producto',wrong_quantity:'Cantidad incorrecta',order_crossing:'Cruce de pedido / etiqueta',wrong_packaging:'Embalaje incorrecto',delivery_delay:'Retraso de entrega',late_delivery_rejected:'Entrega tardía · cliente ya no lo quiere',damage:'Daño / rotura',lost:'Pérdida',delivered_not_received:'Entregado pero cliente no lo tiene',return_to_origin:'Devolución de agencia / retorno a origen',withdrawal:'Desistimiento normal',wrong_purchase:'Compra equivocada / no lo necesita',incompatible_product:'Producto incompatible',warranty:'Garantía' };
export const originTypes: Record<IncidentOrigin,IncidentType[]> = {warehouse:['wrong_product','missing_product','wrong_quantity','order_crossing','wrong_packaging'],carrier:['delivery_delay','late_delivery_rejected','damage','lost','delivered_not_received','return_to_origin'],customer:['withdrawal','wrong_purchase','incompatible_product','warranty']};
export function solutions(d: Pick<WizardDraft,'type'|'products'|'scope'>): Array<[string,string]> {
 switch(d.type){
 case 'wrong_product':return [['resend_recover','Reenviar correcto ya + recuperar en paralelo'],['wait_resend','Esperar recuperación y después reenviar'],['refund_after_recover','Recuperar y después reembolsar']];
 case 'missing_product':return [['resend_missing','Enviar lo que falta'],['refund_missing','Abonar lo que falta']];
 case 'wrong_quantity':return (d.products[0]?.receivedQuantity ?? 0) > (d.products[0]?.orderedQuantity ?? 0) ? [['recover_extra','Recuperar unidades sobrantes'],['keep_extra','El cliente conserva los sobrantes']] : [['resend_missing','Enviar lo que falta'],['refund_missing','Abonar lo que falta']];
 case 'order_crossing':return [['cross_resend_recover','Reenviar correcto + recuperar en paralelo'],['cross_wait','Esperar recuperar antes de reenviar'],['cross_direct','Recoger en cliente A y entregar directamente a cliente B'],['cross_refund','Recuperar y luego reembolsar']];
 case 'wrong_packaging':return d.scope==='pack_ok'?[['pack_record','Registrar sin daño de producto']]:[['pack_resend','Reenviar productos afectados'],['pack_refund','Reembolsar productos afectados']];
 case 'delivery_delay':return [['delay_wait','Esperar entrega'],['delay_resend','Hacer nuevo envío'],['delay_refund','Reembolsar']];
 case 'late_delivery_rejected':return [['late_collect_refund','Crear recogida + devolución + reembolso tras revisión']];
 case 'damage':return d.scope==='package_only'?[['pack_record','Registrar embalaje dañado; producto correcto']]:[['damage_resend','Reenviar productos dañados'],['damage_refund','Reembolsar productos dañados']];
 case 'lost':return [['lost_resend','Reenviar pedido'],['lost_refund','Reembolsar pedido']];
 case 'delivered_not_received':return [['dnr_investigate','Investigar / solicitar POD'],['dnr_resend','Reenviar pedido'],['dnr_refund','Reembolsar']];
 case 'return_to_origin':return [['origin_resend','Reenviar al recibir'],['origin_refund','Reembolsar al recibir']];
 case 'withdrawal':return [['withdraw_refund','Devolución + reembolso tras recepción y revisión']];
 case 'wrong_purchase':case 'incompatible_product':return [['customer_refund','Devolución + reembolso tras revisión'],['customer_exchange','Devolución + cambio por alternativa']];
 case 'warranty':return [['warranty_receive','Recibir mercancía y realizar diagnóstico']];
 }
}
export const iso=()=>new Date().toISOString();
export const uid=()=>globalThis.crypto.randomUUID();
export function addEvent(i:Incident,type:Incident['timeline'][number]['type'],summary:string,actor:string){i.timeline.push({id:uid(),type,summary,actor,occurredAt:iso()});i.updatedAt=iso();}
function selectedPhysicalLines(product:Incident['products'][number],quantity=product.affectedQuantity){
 if(!product.kitComponents?.length)return [{productId:product.productId,sku:product.sku,name:product.name,imageUrl:product.imageUrl,expectedQuantity:quantity}];
 const components=product.kitComponents.filter(c=>c.productType!=='service');
 return components.map(component=>{const selected=product.selectedKitComponents?.find(item=>item.productId===component.productId);return {productId:component.productId,sku:component.sku,name:component.name,imageUrl:component.imageUrl,kitParentSku:product.sku,expectedQuantity:selected?.quantity??component.quantityPerKit*quantity};}).filter(line=>line.expectedQuantity>0);
}
function selectedOutboundLines(products:Incident['products']){
 const grouped=new Map<string,{sku:string;quantity:number}>();
 for(const product of products)for(const line of selectedPhysicalLines(product)){const prior=grouped.get(line.sku);grouped.set(line.sku,{sku:line.sku,quantity:(prior?.quantity||0)+line.expectedQuantity});}
 return [...grouped.values()];
}
export function validateDraft(d:WizardDraft){
 if(d.preparedByCorrection&&(!d.preparedByCorrection.name.trim()||!d.preparedByCorrection.reason.trim()))throw Error('Indica operario corregido y motivo excepcional');
 if(!d.context?.order?.odooReference || !d.context.products.length)throw Error('Localiza un pedido con productos antes de continuar');
 if(!originTypes[d.origin]?.includes(d.type))throw Error('El tipo no corresponde al origen elegido');
 if(!solutions(d).some(([id])=>id===d.solution))throw Error('Selecciona una solución válida para esta rama');
 if(d.type==='withdrawal'&&!d.reason?.trim())throw Error('El motivo de desistimiento es obligatorio');
 if(d.type==='wrong_product'&&d.wrongReceivedUnknown===true&&(d.wrongReceivedProduct||d.wrongReceived?.trim()))throw Error('Un producto pendiente de identificar no puede llevar un SKU seleccionado');
 if(d.type==='wrong_product'&&d.wrongReceivedUnknown===false&&!d.wrongReceivedProduct)throw Error('Selecciona el producto recibido desde el catálogo Odoo');
 if(d.wrongReceivedProduct?.productType==='service')throw Error('Los servicios no son mercancía devuelta; registra su gasto en Costes');
 if(d.type==='wrong_product'&&d.wrongReceivedProduct&&(!Number.isInteger(d.wrongReceivedProduct.productId)||d.wrongReceivedProduct.productId<=0||!d.wrongReceivedProduct.sku||!d.wrongReceivedProduct.name))throw Error('El producto recibido no es válido; vuelve a seleccionarlo del catálogo');
 if(d.type==='wrong_product'&&d.wrongReceivedQuantity!==undefined&&(!Number.isFinite(d.wrongReceivedQuantity)||Number(d.wrongReceivedQuantity)<=0))throw Error('Indica cuántas unidades del producto equivocado se enviaron');
 if(d.type==='damage'&&d.scope!=='package_only'&&!d.evidence?.length)throw Error('Las fotos del producto dañado son obligatorias y deben estar en Drive');
 if((d.type==='wrong_packaging'&&!['pack_ok','one','many','all'].includes(d.scope||''))||(d.type==='damage'&&!['package_only','damaged'].includes(d.scope||'')))throw Error('Selecciona el alcance');
 const needsProducts=['wrong_product','missing_product','wrong_quantity','withdrawal','wrong_purchase','incompatible_product','warranty'].includes(d.type)||(['wrong_packaging','damage'].includes(d.type)&&!['pack_ok','package_only'].includes(d.scope||''));
 if(needsProducts&&!d.products.length)throw Error('Selecciona al menos un producto');
 if(d.type==='wrong_quantity'&&(d.products.length!==1||d.products[0].orderedQuantity===d.products[0].receivedQuantity||!Number.isFinite(d.products[0].receivedQuantity)||d.products[0].receivedQuantity!<0))throw Error('Indica un producto y una cantidad recibida distinta de la pedida');
 const wholeProducts=['order_crossing','delivery_delay','late_delivery_rejected','lost','delivered_not_received','return_to_origin'].includes(d.type)?d.context.products:[];const relatedProducts=d.type==='order_crossing'?d.relatedContext?.products||[]:[];for(const p of [...d.products,...wholeProducts,...relatedProducts]){if(!Number.isFinite(p.affectedQuantity)||p.affectedQuantity<=0)throw Error('Cantidad afectada inválida');if(d.type!=='wrong_quantity'&&p.affectedQuantity>p.orderedQuantity)throw Error('La cantidad afectada supera el pedido');if(!d.context.products.some(x=>x.sku===p.sku)&&!relatedProducts.some(x=>x.sku===p.sku))throw Error('Producto ajeno al pedido');if(p.selectedKitComponents){const components=p.kitComponents?.filter(c=>c.productType!=='service')||[];if(!components.length||p.selectedKitComponents.length!==components.length||new Set(p.selectedKitComponents.map(c=>c.productId)).size!==components.length)throw Error(`${p.sku}: confirma todos los componentes fabricados`);for(const selection of p.selectedKitComponents){const component=components.find(c=>c.productId===selection.productId);if(!component||component.sku!==selection.sku||!Number.isFinite(selection.quantity)||selection.quantity<0||selection.quantity>component.quantityPerKit*p.affectedQuantity)throw Error(`${p.sku}: cantidad de componente no válida`);}}}
 if(d.type==='order_crossing'&&d.solution==='cross_direct'&&!d.relatedContext)throw Error('El traslado directo requiere identificar el segundo pedido');
 if(d.relatedContext?.order.odooReference===d.context.order.odooReference)throw Error('El segundo pedido debe ser distinto');
 if(d.type==='wrong_packaging'&&d.scope==='one'&&d.products.length!==1)throw Error('Selecciona un solo producto');
 if(d.type==='wrong_packaging'&&d.scope==='many'&&d.products.length<2)throw Error('Selecciona varios productos');
 if(d.type==='warranty'&&(!d.warrantyAge||(d.warrantyAge==='over1'&&!d.freightPayer)))throw Error('Indica antigüedad de garantía y quién paga los portes');
 if(d.evidence?.some(e=>!e.id||!/^https:\/\/(drive|docs)\.google\.com\//.test(e.url)))throw Error('Evidencia sin referencia válida de Drive');
}
/** Shared by new incidences and explicit recovery of legacy missing DEV records. */
export function attachOmittedStockCorrectionReturn(i:Incident,devId:string,actor:string,now=iso()){
 if(!requiresOmittedStockCorrection(i)||i.returns.some(r=>r.stockCorrection))return false;
 const products=[...i.products.flatMap(p=>selectedPhysicalLines(p)).reduce((map,row)=>{const prior=map.get(row.sku);map.set(row.sku,prior?{...prior,expectedQuantity:prior.expectedQuantity+row.expectedQuantity}:row);return map;},new Map<string,CustomerReturn['products'][number]>()).values()];
 if(!products.length||products.some(p=>!(p.expectedQuantity>0)))throw Error('Selecciona mercancía y cantidad omitida para la DEV correctiva');
 i.returns.push({id:devId,incidentId:i.id,createdAt:now,updatedAt:now,orderReference:i.order.odooReference,customerName:i.order.customerName,products,origin:i.origin,state:'awaiting',stockCorrection:true,driveFileIds:[]});
 addEvent(i,'reception_created',`${devId} · devolución de corrección de la salida registrada; no implica recogida física del cliente`,actor);return true;
}
export function buildIncident(d:WizardDraft,id:string,devId:string,actor:string):Incident{
 d={...d,context:merchandiseContext(d.context),relatedContext:d.relatedContext?merchandiseContext(d.relatedContext):undefined,products:merchandiseProducts(d.products)};validateDraft(d);const now=iso();
 const whole=['order_crossing','delivery_delay','late_delivery_rejected','lost','delivered_not_received','return_to_origin'].includes(d.type);
 const products=structuredClone(whole?d.context.products.map(p=>({...p,affectedQuantity:p.orderedQuantity})):d.products);
 if(d.type==='wrong_quantity')products.forEach(p=>p.affectedQuantity=Math.abs(p.orderedQuantity-(p.receivedQuantity??0)));
 const wrongReceived=d.wrongReceivedProduct?.sku||d.wrongReceived;
 const wrongReceivedQuantity=Number(d.wrongReceivedQuantity||products.reduce((n,p)=>n+p.affectedQuantity,0));
 const i:Incident={id,revision:1,requestId:d.requestId,returns:[],evidence:structuredClone(d.evidence||[]),stockPlan:[],createdAt:now,updatedAt:now,relatedIncidentIds:[],order:structuredClone(d.context.order),origin:d.origin,type:d.type,subtype:d.scope,status:'Nueva',substatus:null,clientStatus:'Pendiente',solution:d.solution,wrongReceivedProduct:d.type==='wrong_product'&&d.wrongReceivedProduct?{sku:d.wrongReceivedProduct.sku,name:d.wrongReceivedProduct.name,barcode:d.wrongReceivedProduct.barcode,productId:d.wrongReceivedProduct.productId,quantity:wrongReceivedQuantity}:undefined,observationsSummary:[d.reason,d.observations].filter(Boolean).join('\n'),products,notes:[],processes:[],costs:[],claims:[],claimIds:[],photoCount:d.evidence?.filter(e=>e.mimeType.startsWith('image/')).length||0,stockRegularized:true,productCostSnapshot:products.every(p=>p.unitCostSnapshot!==undefined)?products.reduce((n,p)=>n+p.affectedQuantity*p.unitCostSnapshot!,0):undefined,timeline:[],freightPayer:d.type==='warranty'?(d.warrantyAge==='under1'?'company':d.freightPayer):undefined};
 if(d.preparedByCorrection){const original=i.order.preparedBy||'No identificado';i.order.preparedBy=d.preparedByCorrection.name.trim();addEvent(i,'note_added',`Corrección excepcional de operario: ${original} → ${i.order.preparedBy}. Motivo: ${d.preparedByCorrection.reason}`,actor);}
 const proc=(kind:IncidentProcess['kind'],title:string,dependsOn:string[]=[])=>{const p:IncidentProcess={id:uid(),kind,title,dependsOn,state:dependsOn.length?'blocked':'pending',requiredToClose:true,updatedAt:now};i.processes.push(p);return p.id;};
 const cost=(category:IncidentCost['category'],description:string,amount?:number)=>i.costs.push({id:uid(),category,description,amount:amount??0,direction:'cost',state:amount===undefined?'pending':'estimated',occurredAt:now,source:'manual'});
 const stock=(action:string,reason:string,lines:Array<{sku:string;quantity:number}>=products.map(p=>({sku:p.sku,quantity:p.affectedQuantity})))=>{i.stockRegularized=false;const title=action==='receive_on_physical_arrival'?'Regularizar entrada física de la devolución en Odoo':action==='correct_recorded_vs_physical'?'Conciliar salida original frente al material realmente expedido en Odoo':'Regularización física Odoo · requiere base de pruebas';proc('stock_adjustment',title);for(const p of lines)i.stockPlan.push({sku:p.sku,action,quantity:p.quantity,reason});};
 const s=d.solution;const more=d.type==='wrong_quantity'&&(products[0]?.receivedQuantity??0)>(products[0]?.orderedQuantity??0);
 const recovery=['resend_recover','wait_resend','refund_after_recover','cross_resend_recover','cross_wait','cross_refund','recover_extra','late_collect_refund','origin_resend','origin_refund','withdraw_refund','customer_refund','customer_exchange','warranty_receive'].includes(s);
 let receive:string|undefined;
 if(recovery){receive=proc('reception',`${devId} · recibir y revisar mercancía`);i.returns.push({id:devId,incidentId:id,createdAt:now,updatedAt:now,orderReference:i.order.odooReference,customerName:i.order.customerName,products:(d.type==='wrong_product'?[{sku:wrongReceived||'POR_IDENTIFICAR',name:d.wrongReceivedProduct?.name||wrongReceived||'Producto recibido por error (identificar al llegar)',expectedQuantity:wrongReceivedQuantity}]:d.type==='order_crossing'&&d.relatedContext?d.relatedContext.products.flatMap(p=>selectedPhysicalLines({...p,affectedQuantity:p.orderedQuantity},p.orderedQuantity)):products.flatMap(p=>selectedPhysicalLines(p))),origin:i.origin,state:'awaiting',driveFileIds:[]});const physical=new Map<string,CustomerReturn['products'][number]>();for(const row of i.returns[0].products){const prior=physical.get(row.sku);physical.set(row.sku,prior?{...prior,expectedQuantity:prior.expectedQuantity+row.expectedQuantity,kitParentSku:[...new Set([prior.kitParentSku,row.kitParentSku].filter(Boolean))].join(' + ')||undefined}:row);}i.returns[0].products=[...physical.values()];addEvent(i,'reception_created',`${devId} · recibir y revisar mercancía${d.type==='wrong_product'?` · producto equivocado ${wrongReceived||'pendiente de identificar'} × ${wrongReceivedQuantity}`:''}`,actor);if(d.type!=='return_to_origin')cost('pickup','Recogida / transporte de vuelta');if(d.type==='late_delivery_rejected')cost('return_shipping','Transporte de ida por entrega tardía');const incoming=i.returns[0].products.map(p=>({sku:p.sku,quantity:p.expectedQuantity}));stock('receive_on_physical_arrival','Entrada solo de la mercancía devuelta y cuando vuelva físicamente; validar unidades, estado y destino',incoming);}
 if(['wrong_product','missing_product'].includes(d.type)||(d.type==='wrong_quantity'&&!more))stock('correct_recorded_vs_physical','Conciliar salida registrada con lo que salió realmente; corregir A y registrar B si se identifica');
 attachOmittedStockCorrectionReturn(i,devId,actor,now);
 if(more){stock('record_extra_outbound','Registrar salida física sobrante una única vez');if(s==='keep_extra')cost('lost_product','Unidades sobrantes conservadas por el cliente',i.productCostSnapshot);}
 if(s==='cross_direct')proc('follow_up','Confirmar traslado directo cliente A → cliente B; sin entrada intermedia en almacén');
 if(s==='warranty_receive'){proc('diagnosis','Diagnóstico obligatorio de garantía',receive?[receive]:[]);}
 if(/resend|reship/.test(s)||s==='customer_exchange'){
 const wait=['wait_resend','cross_wait','origin_resend','customer_exchange'].includes(s);proc('reshipment','Crear albarán REX en Odoo y completar expedición',wait&&receive?[receive]:[]);cost('reshipment','Nuevo envío');
 i.stockRegularized=false;if(s!=='customer_exchange'){const outbound=selectedOutboundLines(products);if(!outbound.some(line=>line.quantity>0))throw Error('Selecciona al menos un componente con cantidad para el REX');i.stockPlan.push(...outbound.map(line=>({sku:line.sku,action:'new_outbound',quantity:line.quantity,reason:'Salida de componentes confirmados en la incidencia; no se mueve stock del producto fabricado'})));}if(!i.processes.some(p=>p.kind==='stock_adjustment'))proc('stock_adjustment','Verificar salida real del reenvío en Odoo');addEvent(i,'reshipment_created','Reenvío pendiente, no enviado todavía',actor);
 }
 if(/refund/.test(s)){proc('refund','Ejecutar y confirmar reembolso',receive?[receive]:[]);cost('refund','Reembolso al cliente',products.reduce((n,p)=>n+p.affectedQuantity*(p.unitSalePrice||0),0));}
 if(['delivery_delay','delivered_not_received'].includes(d.type))proc('follow_up',d.type==='delivery_delay'?'Resolver el envío original (entrega, retorno o pérdida)':'Investigar entrega y obtener POD');
 if(d.type==='lost')cost('lost_product','Producto perdido (salida original conservada; no descontar de nuevo)',i.productCostSnapshot);
 if(d.type==='damage'&&d.scope!=='package_only')cost('lost_product','Producto dañado',i.productCostSnapshot);
 if(d.type==='lost'||(d.type==='damage'&&d.scope!=='package_only'))stock('scrap_lost_or_damaged','Desecho vinculado a la salida original desde Clientes; sin segundo descuento del almacén');
 const needsClaim=i.origin==='carrier'&&!(d.type==='damage'&&d.scope==='package_only');
 if(needsClaim){i.claims.push({id:uid(),carrier:i.order.carrier||'Por identificar',tracking:i.order.tracking||'',type:types[d.type],createdAt:now,status:'pending',driveFileIds:i.evidence.map(e=>e.id)});i.claimIds=i.claims.map(c=>c.id);addEvent(i,'claim_opened','Reclamación pendiente de solicitud; no enviada a agencia',actor);}
 if(d.type==='wrong_packaging'&&s==='pack_record')proc('follow_up','Registrar corrección de embalaje / formación');
 updateIncidentDerivedState(i);addEvent(i,'created',`${types[i.type]} · ${solutions(d).find(x=>x[0]===s)?.[1]}`,actor);return i;
}
export type Action={kind:string;[key:string]:unknown};
function nonempty(v:unknown,label:string){const s=String(v??'').trim();if(!s)throw Error(label);return s;}
function positive(v:unknown){const n=Number(v);if(!Number.isFinite(n)||n<0)throw Error('Importe o cantidad no válidos');return n;}
export function canIdentifyWrongReceived(i:Incident){return i.type==='wrong_product'&&!i.odooOperations?.some(op=>op.kind!=='reshipment')&&i.returns.every(r=>r.state==='awaiting');}
export function applyAction(original:Incident,a:Action,actor:string):Incident{
 const i=structuredClone(original);if(i.status==='Cerrada'&&a.kind!=='cost')throw Error('La incidencia está cerrada');
 if(a.kind==='note'){const text=nonempty(a.text,'Escribe la nota');if(text.length>6000)throw Error('La nota es demasiado larga');i.notes.push({id:uid(),createdAt:iso(),createdBy:actor,text});addEvent(i,'note_added',text,actor);}
 else if(a.kind==='client'){if(!['Pendiente','En gestión','Esperando cliente','Solucionado'].includes(String(a.value)))throw Error('Estado cliente inválido');const previousClientStatus=i.clientStatus;i.clientStatus=a.value as Incident['clientStatus'];if(a.value==='Solucionado'){if(!['resend_recover','cross_resend_recover'].includes(i.solution||'')&&i.returns.some(r=>r.state!=='cancelled'&&(r.state!=='processed'||!r.stockCorrection&&!r.receivedBy||i.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy)||!i.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'))))throw Error('Completa DEV desde Productos → Recepciones con operario y entrada Odoo validada');if(i.processes.some(p=>p.kind==='reshipment')&&!incidentShipments(i).allSent)throw Error('REX pendiente de etiqueta del operario en Expediciones');if(i.processes.some(p=>['refund','reshipment','diagnosis','repair'].includes(p.kind)&&!['resolved','assumed'].includes(p.state)))throw Error('Completa la solución al cliente antes de marcarlo solucionado');i.status='Resuelta';addEvent(i,'client_solved','Cliente solucionado; la parte interna sigue independiente',actor);addEvent(i,'incident_resolved','Incidencia resuelta para el cliente',actor);}else {i.status='En gestión';}addEvent(i,'client_status_changed',`Estado cliente confirmado: ${previousClientStatus} → ${i.clientStatus}`,actor);i.timeline[i.timeline.length-1].details={previous:previousClientStatus,value:i.clientStatus};}
 else if(a.kind==='cost'){
 const category=String(a.category) as IncidentCost['category'];if(!['lost_product','reshipment','pickup','return_shipping','refund','other','indemnity','recovery'].includes(category))throw Error('Categoría inválida');
 if(!['estimated','pending','confirmed','assumed'].includes(String(a.state)))throw Error('Estado de coste inválido');
 const existing=i.costs.find(x=>x.id===a.id);if(existing?.source==='carrier')throw Error('Edita la recuperación desde su reclamación para mantener importes conciliados');if(a.id&&!existing)throw Error('Coste no encontrado');const categoryLabels:Record<IncidentCost['category'],string>={lost_product:'Producto perdido',reshipment:'Nuevo envío',pickup:'Recogida',return_shipping:'Devolución',refund:'Reembolso',other:'Otros gastos',indemnity:'Indemnización',recovery:'Recuperación'};const description=String(a.description??'').trim()||categoryLabels[category];const cost:IncidentCost={id:existing?.id||uid(),description,category,amount:positive(a.amount),direction:['indemnity','recovery'].includes(category)?'recovery':'cost',state:a.state as IncidentCost['state'],occurredAt:String(a.occurredAt||iso()),source:'manual',recordedAt:iso(),recordedBy:actor};
 if(i.status==='Cerrada'){const previousClosedAt=i.closedAt;i.status=i.clientStatus==='Solucionado'?'Resuelta':'En gestión';delete i.closedAt;addEvent(i,'incident_reopened','Cierre económico reabierto al actualizar costes; se conserva la solución del cliente',actor);i.timeline[i.timeline.length-1].details={previousClosedAt:previousClosedAt||null,reason:'additional_cost',clientStatus:i.clientStatus};}
 if(existing)i.costs[i.costs.indexOf(existing)]=cost;else i.costs.push(cost);addEvent(i,existing?'cost_updated':'cost_added',cost.description,actor);i.timeline[i.timeline.length-1].details={costId:cost.id,amount:cost.amount,state:cost.state,category:cost.category};
 }
 else if(a.kind==='claim'){
 const c=i.claims.find(c=>c.id===a.id);if(!c)throw Error('Reclamación no encontrada');
 if(['compensated','closed'].includes(c.status)&&!['compensated','closed'].includes(String(a.status)))throw Error('No se puede reabrir una compensación confirmada sin reconciliación');
 if((c.recoveredAmount||0)>0&&!(Number(a.recoveredAmount)>0))throw Error('No se puede borrar una recuperación confirmada sin reconciliación');
 const status=String(a.status);if(!['pending','filed','accepted','rejected','compensated','closed'].includes(status))throw Error('Estado reclamación inválido');
 if(status==='closed'&&!a.assumed&&!['compensated','closed'].includes(c.status))throw Error('Para cerrar sin compensación hay que asumir la pérdida expresamente');
 if(status==='closed'&&!a.assumed&&!(Number(a.recoveredAmount)>0))throw Error('Cierre sin recuperación requiere asumir pérdida');
 if(['filed','accepted'].includes(status)&&!String(a.caseNumber||'').trim())throw Error('Registra el número de expediente de la agencia');
 if(!['compensated','closed'].includes(status)&&Number(a.recoveredAmount)>0)throw Error('Una recuperación efectiva requiere estado indemnizada');
 if(a.driveFileIds!==undefined){if(!Array.isArray(a.driveFileIds)||a.driveFileIds.some(id=>!i.evidence.some(e=>e.id===id)))throw Error('Documento de reclamación ajeno a la incidencia');c.driveFileIds=[...new Set(a.driveFileIds)] as string[];}
 c.status=status as typeof c.status;c.caseNumber=String(a.caseNumber||'');c.claimedAmount=positive(a.claimedAmount??0);c.recoveredAmount=positive(a.recoveredAmount??0);c.observations=String(a.observations||'');c.assumed=Boolean(a.assumed);
 if(status==='compensated'&&!(c.recoveredAmount>0))throw Error('Indica el importe efectivamente recuperado');
 if(['compensated','closed'].includes(status)&&c.recoveredAmount>0){const id=`indemnity-${c.id}`;const line:IncidentCost={id,description:`Indemnización ${c.carrier} ${c.caseNumber}`,category:'indemnity',amount:c.recoveredAmount,direction:'recovery',state:'confirmed',occurredAt:iso(),source:'carrier'};i.costs=i.costs.filter(x=>x.id!==id);i.costs.push(line);}
 addEvent(i,['closed','compensated'].includes(status)?'claim_resolved':'note_added',`Reclamación ${c.carrier}: ${status}${c.assumed?' · pérdida asumida':''}`,actor);
 }
 else if(a.kind==='create_claim'){if(i.claims.some(c=>!['closed','compensated'].includes(c.status)))throw Error('Ya hay una reclamación activa; actualiza su expediente');if(!i.order.carrier||!i.order.tracking)throw Error('Se necesita agencia y tracking');i.claims.push({id:uid(),carrier:i.order.carrier,tracking:i.order.tracking,type:types[i.type],createdAt:iso(),status:'pending',driveFileIds:[]});i.claimIds=i.claims.map(c=>c.id);addEvent(i,'claim_opened','Reclamación creada (sin envío externo)',actor);}
 else if(a.kind==='wrong_received'){
 if(!canIdentifyWrongReceived(i))throw Error('Identificación bloqueada tras recepción o contabilización Odoo');
 const product=a.product as any;if(product?.productType==='service')throw Error('Los servicios se registran en Costes, no como mercancía');const quantity=positive(a.quantity);if(!product?.sku||!product?.name||!Number.isInteger(product.productId)||quantity<=0)throw Error('Identifica producto y cantidad realmente expedidos');
 i.wrongReceivedProduct={sku:product.sku,quantity,productId:product.productId,name:product.name,barcode:String(product.barcode||'')};
 for(const r of i.returns)r.products=[{sku:product.sku,name:product.name,expectedQuantity:quantity}];
 i.stockPlan=i.stockPlan.filter(p=>p.action!=='receive_on_physical_arrival');i.stockPlan.push({sku:product.sku,quantity,action:'receive_on_physical_arrival',reason:'Mercancía real identificada; entrada únicamente tras llegada física'});
 addEvent(i,'note_added',`Producto realmente expedido identificado: ${product.sku} × ${quantity}. Sin movimiento Odoo`,actor);
 }
 else if(a.kind==='replacement'){
 if(i.odooOperations?.some(x=>x.key===`${i.id}:reshipment`))throw Error('La salida alternativa ya está confirmada en Odoo');
 if(i.solution!=='customer_exchange')throw Error('Esta incidencia no tiene un cambio por alternativa');
 if(i.processes.some(p=>p.kind==='reshipment'&&['resolved','assumed'].includes(p.state)))throw Error('El cambio ya está finalizado');
 if((a.product as any)?.productType==='service')throw Error('No se puede reenviar un servicio; registra el gasto en Costes');
 const product=a.product as any;const quantity=positive(a.quantity);if(!product||!Number.isInteger(product.productId)||product.productId<=0||!product.sku||!product.name||quantity<=0)throw Error('Selecciona producto y cantidad de la alternativa');
 i.replacementProduct={product:{productId:product.productId,sku:product.sku,name:product.name,barcode:String(product.barcode||'')},quantity};
 i.stockPlan=i.stockPlan.filter(p=>p.action!=='new_outbound');i.stockPlan.push({sku:product.sku,action:'new_outbound',quantity,reason:'Alternativa elegida para el cambio; salida solo al reenviar físicamente'});
 addEvent(i,'note_added',`Alternativa del cambio: ${product.sku} × ${quantity}. No se ha enviado ni creado un albarán Odoo`,actor);
 }
 else if(a.kind==='process'){
 const p=i.processes.find(p=>p.id===a.id);if(!p)throw Error('Proceso no encontrado');
 if(p.kind==='reshipment')throw Error('No se puede finalizar una reexpedición con una referencia manual; requiere picking Odoo auditado y validación desde la etiqueta de Expediciones');
 if(p.kind==='stock_adjustment')throw Error('Stock Odoo bloqueado: no se regulariza con una referencia manual; requiere una operación Odoo auditada');
 if(p.kind==='reception')throw Error('Valida cantidades y estado desde Devoluciones');
 if(p.kind==='diagnosis')throw Error('Registra el diagnóstico desde Garantía');
 if(!['pending','in_progress','blocked'].includes(p.state))throw Error('Proceso ya finalizado');
 if(p.dependsOn?.some(id=>!['resolved','assumed'].includes(i.processes.find(x=>x.id===id)?.state||'')))throw Error('Hay procesos anteriores pendientes');
 if(a.assume)throw Error('Opción dar por perdido retirada');
 if(a.assume&&p.kind!=='follow_up')throw Error('Solo se puede asumir la pérdida de un seguimiento; no una operación física o financiera');
 p.resultReference=nonempty(a.reference,'Registra justificante o motivo antes de finalizar');p.state=a.assume?'assumed':'resolved';p.updatedAt=iso();addEvent(i,p.kind==='refund'?'refund_executed':'note_added',`${p.title}: ${p.resultReference}${a.assume?' · pérdida asumida':''}`,actor);
 }
 else if(a.kind==='return'){
 const worker=a.operator as {id?:string;code?:string;name?:string}|undefined;
 if(!worker?.id||!worker.code||!worker.name)throw Error('Identifica un operario activo desde Productos → Recepciones');
 const r=i.returns.find(r=>r.id===a.id);if(!r||r.warehouseConfirmedAt||['processed','cancelled'].includes(r.state))throw Error('Devolución inexistente o ya finalizada');
 if(r.stockCorrection)throw Error('La DEV correctiva se valida automáticamente en Odoo; no registrar una recepción física del cliente');
 const conditions=['perfect','used','damaged','incomplete','wrong_product','needs_review'];const destinations=['stock','discard','not_ours'];
 if(!conditions.includes(String(a.condition))||!destinations.includes(String(a.destination)))throw Error('Estado y destino son obligatorios');
 if(a.condition==='perfect'&&!['stock','not_ours'].includes(String(a.destination)))throw Error('Un producto perfecto debe reincorporarse a stock');
 const overrides=(Array.isArray(a.itemOverrides)?a.itemOverrides:[]) as Array<{expectedSku?:unknown;mode?:unknown;quantity?:unknown;product?:any;description?:unknown}>;
 if(overrides.some(override=>!r.products.some(product=>product.sku===override.expectedSku&&unidentifiedReturnProduct(product)))&& !['incomplete','wrong_product'].includes(String(a.condition)))throw Error('La identificación de otro producto solo está disponible para una recepción incompleta o distinta');
 const overrideSkus=new Set<string>();for(const override of overrides){
  const expectedSku=String(override.expectedSku||'');if(!r.products.some(product=>product.sku===expectedSku)||overrideSkus.has(expectedSku))throw Error('La línea de devolución seleccionada no es válida');overrideSkus.add(expectedSku);
  if(!Number.isFinite(Number(override.quantity))||Number(override.quantity)<=0)throw Error('Indica la cantidad realmente recibida del producto distinto');
  if(override.mode==='catalog'){const product=override.product;if(product?.productType==='service')throw Error('Un servicio no es mercancía recibida; selecciona un artículo de stock');if(!product||!Number.isInteger(product.productId)||product.productId<=0||!product.sku||!product.name)throw Error('Selecciona el producto recibido desde el catálogo Odoo');}
  else if(override.mode==='not_ours'){if(String(override.description||'').trim().length<2)throw Error('Describe brevemente la mercancía ajena al catálogo');}
  else throw Error('Indica si el producto distinto pertenece al catálogo');
 }
 if(r.products.some(product=>unidentifiedReturnProduct(product)&&!overrideSkus.has(product.sku)))throw Error('Identifica el producto recuperado antes de confirmar la recepción');
 if(a.destination==='not_ours'&&(overrides.length!==r.products.length||overrides.some(item=>item.mode!=='not_ours')))throw Error('Usa “Mercancía ajena” solo cuando todas las líneas recibidas estén identificadas como ajenas');
 if(['damaged','wrong_product','incomplete'].includes(String(a.condition))&&!i.evidence.some(e=>e.returnId===r.id&&e.mimeType.startsWith('image/')))throw Error('Añade fotos de esta devolución en Drive');
 const quantities=a.quantities as Record<string,unknown>;if(!quantities)throw Error('Valida las cantidades recibidas');
 const overrideBySku=new Map(overrides.map(item=>[String(item.expectedSku),item]));
 const missing=r.products.filter(p=>!overrideBySku.has(p.sku)).map(p=>({sku:p.sku,quantity:p.expectedQuantity-positive(quantities[p.sku])})).filter(p=>p.quantity>0);
 r.products.forEach(p=>{const override=overrideBySku.get(p.sku);p.receivedQuantity=override?p.expectedQuantity:positive(quantities[p.sku]);if(!override&&p.receivedQuantity>p.expectedQuantity)throw Error('Cantidad superior a la esperada: revisar diferencia antes de procesar');});
 if(r.products.some(p=>(p.receivedQuantity||0)>0))i.stockRegularized=false;
 r.receivedBy={id:worker.id,code:worker.code,name:worker.name};r.receivedAt=iso();
 r.condition=a.condition as typeof r.condition;r.destination=a.destination as typeof r.destination;r.itemOverrides=overrides.map(item=>({expectedSku:String(item.expectedSku),mode:item.mode as 'catalog'|'not_ours',quantity:Number(item.quantity),...(item.mode==='catalog'?{product:{productId:Number(item.product.productId),sku:String(item.product.sku),name:String(item.product.name),barcode:String(item.product.barcode||''),...(item.product.imageUrl?{imageUrl:String(item.product.imageUrl)}:{})}}:{description:String(item.description).trim()})}));r.observations=String(a.observations||'');r.updatedAt=iso();
 // Physical confirmation unlocks warehouse work; Odoo stock stays separately pending.
 r.state='arrived';
 const p=i.processes.find(p=>p.kind==='reception'&&p.title.startsWith(r.id));if(p){p.state='in_progress';p.updatedAt=iso();}
 confirmWarehouseReceipt(i,r);
 const overrideSummary=overrides.map(item=>item.mode==='catalog'?`${item.expectedSku} sustituido por ${item.product.sku} × ${item.quantity}`:`${item.expectedSku}: mercancía ajena ${String(item.description).trim()} × ${item.quantity}, sin stock Odoo`).join('; ');
 addEvent(i,'goods_received',`${r.id}: ${r.condition} → ${r.destination}. Recepción física guardada${missing.length?`; ${a.condition==='incomplete'?'faltan':'pendientes de llegar'} ${missing.map(p=>`${p.sku} × ${p.quantity}`).join(', ')}${a.condition==='incomplete'?' (kit/producto incompleto)':''}` : ''}${overrideSummary?`; ${overrideSummary}`:''}; pendiente de confirmación`,actor);
 }
 else if(a.kind==='assume_return'){throw Error('Opción retirada: registra recepción y estado dañado → desechar desde Productos → Recepciones');}
 else if(a.kind==='review_return'){
 throw Error('La devolución se valida automáticamente solo tras confirmar su destino y los movimientos Odoo. No existe una validación manual alternativa.');
 }
 else if(a.kind==='diagnosis'){
 const p=i.processes.find(p=>p.kind==='diagnosis');if(!p||p.dependsOn?.some(id=>i.processes.find(x=>x.id===id)?.state!=='resolved'))throw Error('Recepción y revisión obligatorias antes del diagnóstico');
 if(p.state==='resolved')throw Error('Diagnóstico ya registrado');const diagnosis=nonempty(a.text,'Escribe el diagnóstico');if(!['repair','replace','refund'].includes(String(a.solution)))throw Error('Elige reparación, sustitución o reembolso');i.diagnosis=diagnosis;p.state='resolved';
 const kind=a.solution==='refund'?'refund':a.solution==='replace'?'reshipment':'repair';i.processes.push({id:uid(),kind,title:{repair:'Reparación y entrega al cliente',replace:'Sustitución tras diagnóstico',refund:'Reembolso tras diagnóstico'}[String(a.solution)]!,state:'pending',requiredToClose:true,updatedAt:iso()});if(a.solution==='refund')i.costs.push({id:uid(),category:'refund',description:'Reembolso tras diagnóstico',amount:i.products.reduce((n,p)=>n+p.affectedQuantity*(p.unitSalePrice||0),0),direction:'cost',state:'estimated',occurredAt:iso(),source:'manual'});
 if(a.solution==='replace'){
  i.costs.push({id:uid(),category:'reshipment',description:'Envío de sustitución tras diagnóstico',amount:0,direction:'cost',state:'pending',occurredAt:iso(),source:'manual'});
  i.stockRegularized=false;i.stockPlan.push(...i.products.map(p=>({sku:p.sku,action:'new_outbound',quantity:p.affectedQuantity,reason:'Sustitución tras diagnóstico: registrar solo la salida física real'})));
  if(!i.processes.some(p=>p.kind==='stock_adjustment'))i.processes.push({id:uid(),kind:'stock_adjustment',title:'Verificar salida de sustitución en Odoo',state:'pending',requiredToClose:true,updatedAt:iso()});
 }
 p.updatedAt=iso();addEvent(i,'note_added',`Diagnóstico: ${diagnosis}. Solución: ${a.solution}`,actor);
 }
 else if(a.kind==='document'){if(!i.returns.some(r=>r.id===a.id))throw Error('DEV no encontrado');addEvent(i,'return_document_generated',`Albarán ${a.id}`,actor);}
 else if(a.kind==='close'){const c=getIncidentClosureChecklist(i);if(!c.canClose)throw Error(`No se puede cerrar todavía: ${c.missing.join(', ')}`);i.status='Cerrada';i.closedAt=iso();addEvent(i,'incident_closed','Incidencia cerrada',actor);}
 else throw Error('Acción no admitida');
 updateIncidentDerivedState(i);i.updatedAt=iso();i.revision++;return i;
}

export function updateIncidentDerivedState(i:Incident){
 if(i.status==='Cerrada'){i.substatus=null;i.pendingSummary='Sin pendientes';return;}
 const shipping=incidentShipments(i);
 if(shipping.operations.length)for(const p of i.processes.filter(p=>p.kind==='reshipment')){
  if(shipping.allSent){p.state='resolved';p.updatedAt=shipping.sent.map(op=>op.shippedAt!).sort().at(-1)!;}
  else if(p.state!=='blocked')p.state='in_progress';
 }
 for(const p of i.processes)if(p.state==='blocked'&&p.dependsOn?.every(id=>['resolved','assumed'].includes(i.processes.find(x=>x.id===id)?.state||'')))p.state='pending';
 i.status=i.clientStatus==='Solucionado'?'Resuelta':shipping.allSent?'Reenvío enviado':i.processes.some(p=>p.kind!=='stock_adjustment'&&p.state==='blocked')?'Esperando':'En gestión';
 const pending=incidentPendingWork(i);i.substatus=pending.substatus;i.pendingSummary=pending.summary;return i;
}
