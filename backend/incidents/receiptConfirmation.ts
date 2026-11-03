import type {Incident,CustomerReturn} from './types.ts';

export function warehouseReceived(r:CustomerReturn){return r.state==='processed'||Boolean(r.warehouseConfirmedAt);}

/** Validate the saved inspection, never infer an Odoo stock movement. Partial arrivals stay open. */
export function confirmWarehouseReceipt(i:Incident,r:CustomerReturn){
 if(r.state!=='arrived'||!r.receivedBy?.id||!r.receivedBy.code||!r.receivedBy.name||!r.receivedAt||!r.condition||!r.destination)throw Error('Falta inspección de almacén confirmada con operario, estado y destino');
 if(!r.products.length||r.products.some(p=>!Number.isFinite(p.receivedQuantity)||p.receivedQuantity!<0||p.receivedQuantity!>p.expectedQuantity))throw Error('Cantidades de recepción inválidas');
 if(r.condition!=='incomplete'&&r.products.some(p=>p.receivedQuantity!==p.expectedQuantity))return false;
 r.warehouseConfirmedAt ||= r.receivedAt;
 const process=i.processes.find(p=>p.kind==='reception'&&p.title.startsWith(r.id));
 if(process){process.state='resolved';process.updatedAt=r.warehouseConfirmedAt;process.resultReference='Producto recepcionado en almacén · sincronización Odoo pendiente';}
 return true;
}
