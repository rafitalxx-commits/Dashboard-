import { useEffect, useRef, useState } from 'react';
import { normalizeInvoiceVat } from '../../../shared/supplierInvoiceEvidence';

type Review = { fingerprint: string | null; blockers: string[]; loading?:boolean; error?:string };
type Props = {
  doc: any; apiPath: string; review: Review;
  taxes: Array<{id:number;name:string}>; accounts: Array<{id:number;name:string;code?:string}>;
  pendingEditor?:()=>Promise<any>; onRetry?:()=>void;
  onSaved: (doc:any)=>void; onClose: ()=>void; onCreated:(doc:any,result:any)=>void;
};
export function InvoiceReviewDialog({ doc, apiPath, review, taxes, accounts, onSaved, onClose, onCreated, pendingEditor, onRetry }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [current,setCurrent] = useState(doc), [check,setCheck] = useState(review);
  const [fields,setFields] = useState<Record<string,string>>(()=>Object.fromEntries(['supplierVat','invoiceNumber','invoiceDate','dueDate','currency','base','taxes','total'].map(k=>[k,k==='supplierVat'?normalizeInvoiceVat(doc.extracted?.[k]):String(doc.extracted?.[k] ?? '')])));
  const [rows,setRows] = useState<Array<{taxId:number|null;accountId:number|null;taxAmount:number|null}>>(()=>doc.extracted.lines.map((l:any)=>({taxId:l.taxId??null,accountId:l.accountId??null,taxAmount:l.taxAmount??null})));
  const [vatAbsent,setVatAbsent] = useState(Boolean(doc.issuerVatAbsence)), [reason,setReason] = useState(doc.issuerVatAbsence?.reason || '');
  const [date,setDate] = useState(''), [ack,setAck] = useState(false), [dirty,setDirty] = useState(false);
  const [editorPending,setEditorPending] = useState(Boolean(pendingEditor));
  const [busy,setBusy] = useState(''), [error,setError] = useState(''), [message,setMessage] = useState('');
  useEffect(()=>{ const node=dialog.current!; node.showModal(); return ()=>node.close(); },[]);
  useEffect(()=>{setCheck(review);setAck(false);},[review]);
  const change = (k:string,v:string)=>{setFields(f=>({...f,[k]:v}));setDirty(true);setAck(false);};
  const refreshCheck = async (id:string) => {
    setCheck({fingerprint:null,blockers:[],loading:true});setAck(false);
    try {
      const response=await fetch(`${apiPath}/verification?id=${encodeURIComponent(id)}`,{cache:'no-store'});
      const result=await response.json();if(!response.ok)throw new Error(result.message||'No se pudo actualizar el cotejo.');
      setCheck({fingerprint:result.fingerprint,blockers:result.verification?.blockers||[]});
    }catch(e){const error=e instanceof Error?e.message:'No se pudo actualizar el cotejo.';setCheck({fingerprint:null,blockers:[],error});throw new Error(error);}
  };
  const run = async (action: 'save'|'send'|'editor')=>{
    if(lock.current)return; lock.current=true;setBusy(action);setError('');setMessage('');
    try {
      if(check.loading||check.error||!check.fingerprint)throw new Error('Completa primero la comprobación de la factura.');
      if(action==='editor') {
        if(!pendingEditor)throw new Error('No hay cambios del editor pendientes.');
        const updated=await pendingEditor();setCurrent(updated);onSaved(updated);setEditorPending(false);setAck(false);setDirty(false);
        setFields(Object.fromEntries(['supplierVat','invoiceNumber','invoiceDate','dueDate','currency','base','taxes','total'].map(k=>[k,k==='supplierVat'?normalizeInvoiceVat(updated.extracted?.[k]):String(updated.extracted?.[k]??'')])));
        setRows(updated.extracted.lines.map((l:any)=>({taxId:l.taxId??null,accountId:l.accountId??null,taxAmount:l.taxAmount??null})));
        setMessage('Cambios del editor guardados en Dashboard. No se ha enviado nada a Odoo.');
        await refreshCheck(updated.driveFileId);
      } else if(action==='save') {
        if(editorPending)throw new Error('Guarda primero los cambios del editor desde esta ventana.');
        const values = Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,['base','taxes','total'].includes(k)?(v.trim()===''?null:Number(v.replace(',','.'))):v]));
        if(Object.values(values).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error('Revisa los importes.');
        const response=await fetch(`${apiPath}/review-corrections`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.driveFileId,fingerprint:check.fingerprint,fields:values,lineCorrections:rows,vatAbsent,reason})});
        const result=await response.json();if(!response.ok)throw new Error(result.message||'No se pudo guardar');
        setCurrent(result.document);onSaved(result.document);setDirty(false);setAck(false);
        setMessage('Datos guardados en el borrador del Dashboard. No se ha enviado nada a Odoo.');
        await refreshCheck(result.document.driveFileId);
      } else {
        if(editorPending||dirty||!ack||reason.trim().length<10||!date)throw new Error('Guarda los cambios y confirma los pendientes, el motivo y la fecha contable.');
        const response=await fetch(`${apiPath}/odoo-draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.driveFileId,accountingDate:date,exception:{acknowledged:true,reason,fingerprint:check.fingerprint,blockers:check.blockers}})});
        const result=await response.json();if(!response.ok)throw new Error(result.message||'Odoo no aceptó el borrador');
        onCreated(result.document,result);onClose();
      }
    }catch(e){setError(e instanceof Error?e.message:'Error de operación');}finally{lock.current=false;setBusy('');}
  };
  return <dialog ref={dialog} className="si-review-dialog" aria-labelledby="si-review-title" onCancel={e=>{e.preventDefault();if(!lock.current)onClose();}} aria-busy={Boolean(busy)}
    onKeyDown={e=>{
      if(e.key!=='Tab')return;
      const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(el=>el.getClientRects().length>0);
      e.preventDefault();
      if(!controls.length)return;
      const index=controls.indexOf(document.activeElement as HTMLElement);
      const next=index<0?(e.shiftKey?controls.length-1:0):(index+(e.shiftKey?-1:1)+controls.length)%controls.length;
      controls[next].focus();
    }}>
    <h3 id="si-review-title">Completar datos de la factura</h3>
    <p><b>{current.name}</b> · {current.extracted?.supplier} · Proveedor Odoo: {current.confirmedOdooPartnerId||'Sin confirmar: selecciónalo en el editor'}</p>
    <p>Completa lo que puedas. Guardar actualiza solo el borrador del Dashboard; el envío con pendientes requiere otra confirmación.</p>
    <div className="si-review-pending" role="status">
      {check.loading ? <b>Comprobando los problemas de la factura…</b> : check.error ? <><p role="alert">{check.error}</p><button type="button" disabled={Boolean(busy)} onClick={onRetry}>Reintentar comprobación</button></> : <><b>{check.blockers.length?'Problemas que impiden validar':'Cotejo sin pendientes'}</b><ul>{check.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul></>}
    </div>
    {editorPending && <section className="si-review-pending"><p>Hay cambios del editor sin guardar. Consérvalos y vuelve a comprobar la factura desde aquí; no se enviará nada a Odoo.</p><button type="button" disabled={Boolean(busy)||check.loading||Boolean(check.error)||!check.fingerprint} onClick={()=>void run('editor')}>{busy==='editor'?'Guardando cambios…':'Guardar cambios del editor y comprobar'}</button></section>}
    <form onSubmit={e=>{e.preventDefault();void run('save');}}>
      <fieldset disabled={Boolean(busy)||editorPending||check.loading||Boolean(check.error)||!check.fingerprint}>
        <div className="si-review-grid">{[
          ['invoiceNumber','Referencia de factura','text'],['invoiceDate','Fecha de factura','date'],['dueDate','Vencimiento (si consta)','date'],['supplierVat','NIF / identificador del emisor','text'],['currency','Moneda ISO','text'],['base','Base impresa','number'],['taxes','Impuestos impresos','number'],['total','Total impreso','number'],
        ].map(([key,label,type])=><label key={key}>{label}<input type={type} step={type==='number'?'0.01':undefined} value={fields[key]} onChange={e=>change(key,e.target.value)}/></label>)}</div>
        <label className="si-review-check"><input type="checkbox" checked={vatAbsent} onChange={e=>{setVatAbsent(e.target.checked);if(e.target.checked)change('supplierVat','');setDirty(true);setAck(false);}}/> Confirmo que el emisor no aporta identificador fiscal; no usar el CIF del cliente.</label>
        <p className="si-note">Es una declaración del operario para este documento, no una exención fiscal automática por país o por ser particular.</p>
        {rows.map((r,i)=><div className="si-review-line" key={i}><b>Línea {i+1}: {current.extracted.lines[i].description}</b><div className="si-review-grid">
          <label>Impuesto de compra<select value={r.taxId||''} onChange={e=>{setRows(xs=>xs.map((x,n)=>n===i?{...x,taxId:Number(e.target.value)||null}:x));setDirty(true);setAck(false);}}><option value="">Pendiente de completar en Odoo</option>{taxes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Cuenta contable<select value={r.accountId||''} onChange={e=>{setRows(xs=>xs.map((x,n)=>n===i?{...x,accountId:Number(e.target.value)||null}:x));setDirty(true);setAck(false);}}><option value="">Pendiente de completar en Odoo</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
          <label>Cuota de la línea<input type="number" step="0.01" value={r.taxAmount??''} onChange={e=>{setRows(xs=>xs.map((x,n)=>n===i?{...x,taxAmount:e.target.value===''?null:Number(e.target.value)}:x));setDirty(true);setAck(false);}}/></label>
        </div></div>)}
        <label>Motivo / datos que se terminarán en Odoo<textarea value={reason} onChange={e=>{setReason(e.target.value);setAck(false);if(vatAbsent)setDirty(true);}} maxLength={1000}/></label>
        <button type="submit">{busy==='save'?'Guardando…':'Guardar datos en Dashboard'}</button>
      </fieldset>
    </form>
    {message&&<p role="status">{message}</p>}
    <section className="si-review-exception"><h4>Crear el borrador en Odoo aunque queden pendientes</h4><p>No valida el cotejo, no contabiliza y no mueve el PDF. Odoo conserva sus requisitos propios. Proveedor, referencia, fecha, líneas válidas y ausencia de duplicados siguen siendo necesarios.</p>
      <label>Fecha contable<input type="date" value={date} disabled={Boolean(busy)} onChange={e=>{setDate(e.target.value);setAck(false);}}/></label>
      <label className="si-review-check"><input type="checkbox" checked={ack} disabled={Boolean(busy)||editorPending||dirty||check.loading||Boolean(check.error)||!check.fingerprint} onChange={e=>setAck(e.target.checked)}/> He revisado estos pendientes y autorizo crear el borrador para corregirlos en Odoo.</label>
      {dirty&&<p role="status">Guarda los cambios de esta ventana para habilitar la confirmación de envío.</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="si-draft-confirm-actions"><button type="button" disabled={Boolean(busy)} onClick={onClose}>Cerrar</button><button type="button" className="si-primary" disabled={Boolean(busy)||editorPending||check.loading||Boolean(check.error)||dirty||!ack||!date||reason.trim().length<10||!check.fingerprint||!current.confirmedOdooPartnerId} onClick={()=>void run('send')}>{busy==='send'?'Enviando a Odoo…':'Confirmar envío con pendientes'}</button></div>
    </section>
  </dialog>;
}
