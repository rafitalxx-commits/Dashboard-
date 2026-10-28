import type { Incident } from './types.ts';
import type { OdooCall } from './odooStock.ts';
import { TEST_TARGET } from './odooRuntime.ts';

export function reshipmentReference(incidentId: string, ordinal = 1) {
 if (!/^INC-\d{4}-\d{5,}$/.test(incidentId) || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 99) throw Error('Referencia de reexpedición inválida');
 return incidentId.replace(/^INC-/, 'REX-') + '-' + String(ordinal).padStart(2, '0');
}
export function incidentFromReshipment(reference: string) {
 const match = reference.match(/^REX-(\d{4}-\d{5,})-(0[1-9]|[1-9]\d)$/);
 if (!match) throw Error('Escanea una referencia REX completa');
 return 'INC-' + match[1];
}
const relation = (value: any) => Array.isArray(value) ? Number(value[0]) : 0;
/** One contract for a local document versus an audited external dispatch. No writes. */
export function reshipmentPreparation(incident: Incident, reference = reshipmentReference(incident.id), target = TEST_TARGET) {
 if (incidentFromReshipment(reference) !== incident.id) throw Error('La reexpedición no pertenece a esta incidencia');
 const operations = (incident.odooOperations || []).filter(op => op.kind === 'reshipment' && op.dispatchReference === reference);
 if (operations.length) return null; // External verification, including ambiguity/target checks, is mandatory.
 if (reference !== reshipmentReference(incident.id) || !incident.processes.some(p => p.kind === 'reshipment')) throw Error('Referencia REX inexistente en esta incidencia');
 const blockers=reshipmentPrerequisites(incident,target);
 return {reference, incidentId:incident.id, orderReference:incident.order.odooReference, revision:incident.revision, state:(blockers.length?'waiting_dependencies':'pending_preparation') as 'pending_preparation'|'waiting_dependencies', blockers, labelCreationEnabled:false as const, notice:blockers.length ? blockers.join('. ') : 'Documento REX localizado. Falta preparar o conciliar el albarán de salida en Odoo desde la incidencia. No se ha creado ningún envío.'};
}
/** Physical receipt and stock posting are separate prerequisites; a manual process flag is insufficient. */
export function returnBeforeReshipmentBlockers(incident:Incident,target=TEST_TARGET){
 if(!['wait_resend','cross_wait','origin_resend','customer_exchange','warranty_receive'].includes(incident.solution||''))return [];
 const returns=incident.returns.filter(r=>r.state!=='cancelled'&&!r.stockCorrection);
 if(!returns.length)return ['REX bloqueado: falta una DEV activa que debe recibirse y validarse en almacén antes de enviar'];
 return returns.flatMap(r=>{
  if(!r.receivedBy?.id||!r.receivedBy.code||!r.receivedBy.name||!r.receivedAt||!r.condition||!r.destination)return [`REX bloqueado: esperamos recibir ${r.id} y la comprobación y validación del producto por el operario de almacén. No se puede generar la etiqueta ni enviar`];
  if(r.state!=='processed'||!incident.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'&&(op.target||TEST_TARGET)===target)||incident.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy))return [`REX bloqueado: ${r.id} ya está recibida y revisada por almacén; falta confirmar la entrada completa y todos sus lotes en Odoo.${r.odooSyncError?` Error de sincronización: ${r.odooSyncError}. Requiere conciliación; no vuelvas a registrar la recepción física.`:' La etiqueta se habilitará automáticamente al completar la recepción.'}`];
  return [];
 });
}
/** Shared preparation prerequisites; existing picking verification never waives them. */
export function reshipmentPrerequisites(incident:Incident,target=TEST_TARGET){
 const process = incident.processes.find(p => p.kind === 'reshipment');
 const blockers: string[] = [];
 if (incident.status === 'Cerrada') blockers.push('Incidencia cerrada; no se puede preparar una nueva salida');
 if (!process || process.dependsOn?.some(id => !['resolved','assumed'].includes(incident.processes.find(p => p.id === id)?.state || ''))) blockers.push('Pendiente de recepción o diagnóstico previo');
 blockers.push(...returnBeforeReshipmentBlockers(incident,target));
 if(incident.returns.some(r=>r.stockCorrection&&r.state!=='cancelled'&&!incident.odooOperations?.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'&&(op.target||TEST_TARGET)===target)))blockers.push('Primero validar la DEV correctiva de la salida original en Odoo');
 if (!incident.stockPlan.some(p => p.action === 'new_outbound' && p.quantity > 0)) blockers.push('Pendiente de identificar producto y cantidad del reenvío');
 return blockers;
}
/** Read-only resolution. Never substitute the original order or its full product list. */
export async function resolveReshipment(reference: string, incident: Incident, read: OdooCall,target=TEST_TARGET) {
 if (incidentFromReshipment(reference) !== incident.id) throw Error('La reexpedición no pertenece a esta incidencia');
 const operations = incident.odooOperations?.filter(op => op.kind === 'reshipment' && op.dispatchReference === reference) || [];
 if (operations.length !== 1 || !operations[0].lines?.length) throw Error('No hay un único picking REX auditado; crea o concilia el albarán primero');
 const operation = operations[0];
 if((operation.target||TEST_TARGET)!==target)throw Error('El albarán auditado pertenece a otra base Odoo. No se reutilizan albaranes TEST en la conexión operativa.');
 const orders = await read('sale.order', 'search_read', [[['name', '=', incident.order.odooReference]]], {fields:['id'], limit:2});
 if (orders.length !== 1) throw Error('Pedido Odoo inexistente o ambiguo');
 const rows = await read('stock.picking', 'search_read', [[['origin', '=', reference]]], {fields:['id','name','origin','state','sale_id','company_id','partner_id','picking_type_id','location_id','location_dest_id','carrier_tracking_ref'], limit:2});
 if (rows.length !== 1 || rows[0].id !== operation.pickingId || relation(rows[0].sale_id) !== orders[0].id) throw Error('Picking REX inexistente, duplicado o vinculado a otro pedido');
 const picking = rows[0];
 if (!['confirmed','waiting','assigned','done'].includes(picking.state)) throw Error('La reexpedición todavía no está reservada para Expediciones');
 const types = await read('stock.picking.type','read',[[relation(picking.picking_type_id)]],{fields:['code']});
 if (types.length !== 1 || types[0].code !== 'outgoing') throw Error('REX no corresponde a una salida');
 const moves = await read('stock.move','search_read',[[['picking_id','=',picking.id],['state','!=','cancel']]],{fields:['product_id','product_uom','product_uom_qty','location_id','location_dest_id','state'],limit:1000});
 const expected = operation.lines!.map(l=>`${l.productId}:${l.uomId}:${l.quantity}:${l.sourceId}:${l.destinationId}`).sort();
 const actual = moves.map((m:any)=>`${relation(m.product_id)}:${relation(m.product_uom)}:${Number(m.product_uom_qty)}:${relation(m.location_id)}:${relation(m.location_dest_id)}`).sort();
 if (JSON.stringify(expected) !== JSON.stringify(actual) || moves.some((m:any)=>picking.state==='done'?m.state!=='done':!['confirmed','waiting','assigned'].includes(m.state))) throw Error('Las líneas del picking cambiaron; concilia antes de expedir');
 if (!relation(picking.partner_id) || !relation(picking.company_id)) throw Error('El picking no tiene destinatario o compañía');
 const partners=await read('res.partner','read',[[relation(picking.partner_id)]],{fields:['name','street','street2','zip','city','country_id','phone','mobile','email']});
 if(partners.length!==1)throw Error('No se puede leer el destinatario real del picking');
 const partner=partners[0];const countries=relation(partner.country_id)?await read('res.country','read',[[relation(partner.country_id)]],{fields:['code']}):[];
 const destination={name:String(partner.name||''),address:[partner.street,partner.street2].filter(Boolean).join(' '),postalCode:String(partner.zip||''),city:String(partner.city||''),country:String(countries[0]?.code||''),phone:String(partner.mobile||partner.phone||''),email:String(partner.email||'')};
 return {reference,incidentId:incident.id,orderReference:incident.order.odooReference,pickingId:picking.id,pickingName:String(picking.name),state:picking.state,destination,partnerId:relation(picking.partner_id),companyId:relation(picking.company_id),lines:operation.lines,tracking:String(picking.carrier_tracking_ref||''),labelCreationEnabled:picking.state==='assigned'&&moves.every((m:any)=>m.state==='assigned'),notice:picking.state!=='done'&&picking.state!=='assigned'?'Albarán creado en Odoo; falta reserva completa de stock antes de expedir.':picking.state==='done'?'Picking completado; no se debe crear otra etiqueta de transporte.':'Picking verificado para crear una etiqueta desde Expediciones. Revisa destinatario, bultos y servicio antes de confirmar el envío.'};
}

/** Packing-slip facts come from the audited REX picking's shipping partner, not billing/order guesses. */
export async function reshipmentPrintData(reference:string,incident:Incident,read:OdooCall,target=TEST_TARGET){
 const dispatch=await resolveReshipment(reference,incident,read,target);
 const ids=[...new Set(dispatch.lines!.map(l=>l.productId))];
 const products=await read('product.product','read',[ids],{fields:['id','name','default_code']});
 const lines=dispatch.lines!.map(line=>{const product=products.find((p:any)=>p.id===line.productId);if(!product||product.default_code!==line.sku)throw Error('El producto del REX cambió; revisa su identidad antes de imprimir');return {productId:line.productId,sku:line.sku,name:String(product.name||line.sku),quantity:line.quantity};});
 return {reference,incidentId:incident.id,orderReference:incident.order.odooReference,pickingId:dispatch.pickingId,pickingName:dispatch.pickingName,destination:dispatch.destination,lines,createdAt:incident.odooOperations!.find(op=>op.dispatchReference===reference)!.confirmedAt,test:target===TEST_TARGET};
}

/** Stable application document, valid before the Odoo picking exists. No external IDs needed. */
export function incidentReshipmentDocument(i:Incident,target=TEST_TARGET){
 if(!i.processes.some(p=>p.kind==='reshipment'))throw Error('La solución no requiere REX');
 const destination=i.order.shippingDestination;if(!destination?.name||!destination.address)throw Error('Falta el destinatario de envío verificado para el albarán');
 const plan=i.stockPlan.filter(p=>p.action==='new_outbound');
 const lines=plan.map(line=>{const direct=i.replacementProduct?.product.sku===line.sku?i.replacementProduct.product:i.products.find(p=>p.sku===line.sku);const selected=i.products.flatMap(p=>p.selectedKitComponents||[]).find(component=>component.sku===line.sku);const bom=i.products.flatMap(p=>p.kitComponents||[]).find(component=>component.sku===line.sku);const product=direct?.productId?{productId:direct.productId,name:direct.name}:selected?{productId:selected.productId,name:selected.name}:bom?{productId:bom.productId,name:bom.name}:undefined;if(!product?.productId||!(line.quantity>0))throw Error('Identifica producto y cantidad del reenvío antes de generar su albarán');return {productId:product.productId,sku:line.sku,name:product.name,quantity:line.quantity};});
 if(!lines.length)throw Error('Selecciona el producto de sustitución para generar REX');
 return {reference:reshipmentReference(i.id),incidentId:i.id,orderReference:i.order.odooReference,pickingId:0,pickingName:'',destination,lines,createdAt:i.createdAt,test:target===TEST_TARGET};
}
