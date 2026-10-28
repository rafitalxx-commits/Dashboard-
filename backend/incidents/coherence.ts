import type {Incident} from './types.ts';
import {updateIncidentDerivedState} from './workflow.ts';
import {TEST_TARGET} from './odooRuntime.ts';
/** Repair internal contradictions only. Never invent physical arrival, operator or external state. */
export function coherentIncident(original:Incident,target=TEST_TARGET):Incident{
 const i=structuredClone(original);if(i.status==='Cerrada')return i;
 for(const r of i.returns){
  const entry=i.odooOperations?.find(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy&&(op.target||TEST_TARGET)===target)||i.odooOperations?.filter(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'&&(op.target||TEST_TARGET)===target).at(-1);
  if(entry)r.odooReceiptId=entry.pickingId;
  if(r.stockCorrection){
   if(r.state!=='cancelled')r.state=entry?.status==='done'?'processed':'awaiting';
   const correctionProcess=i.processes.find(p=>p.kind==='reception'&&p.title.startsWith(r.id));
   if(correctionProcess){correctionProcess.state=r.state==='processed'?'resolved':'pending';correctionProcess.title=`${r.id} · corrección Odoo sin recepción física`;}
   continue;
  }
  if(r.state==='processed'&&!r.receivedBy){r.state='arrived';}
  const process=i.processes.find(p=>p.kind==='reception'&&p.title.startsWith(r.id));
  if(process&&r.state!=='cancelled'){
   process.state=(r.state==='processed'||r.warehouseConfirmedAt)&&r.receivedBy?'resolved':r.state==='awaiting'?'pending':'in_progress';
   process.title=`${r.id} · ${!r.receivedBy&&r.state!=='awaiting'?'confirmar recepción y revisión con operario':r.state==='processed'?'recepción y revisión completadas':'recibir y revisar mercancía'}`;
  }
 }
 const entries=i.odooOperations||[];
 const rex=entries.find(op=>op.kind==='reshipment'&&(op.target||TEST_TARGET)===target);
 const returnsDone=i.returns.every(r=>r.state==='cancelled'||r.state==='processed'&&!entries.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='awaiting_arrival'&&!op.receiptConsumedBy)&&entries.some(op=>op.kind==='return'&&op.returnId===r.id&&op.status==='done'&&(op.target||TEST_TARGET)===target));
 if(i.returns.length&&returnsDone&&rex&&(rex.status||'done')!=='done')for(const p of i.processes.filter(p=>p.kind==='stock_adjustment'))p.title='Entrada Odoo confirmada · salida REX pendiente de Expediciones';
 if(!i.returns.length&&rex)for(const p of i.processes.filter(p=>p.kind==='stock_adjustment'&&p.title==='Entrada Odoo confirmada · salida REX pendiente de Expediciones'))p.title='Verificar salida real del reenvío en Odoo';
 // Never claim unrelated stock corrections are complete merely because DEV/REX exist.
 updateIncidentDerivedState(i);return i;
}
