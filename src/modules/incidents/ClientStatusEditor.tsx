import {useEffect,useRef,useState} from 'react';
import type {ClientStatus} from '../../../backend/incidents/types';
import type {Action} from '../../../backend/incidents/workflow';
import {Field,Message,OperationStatus} from './components';

/** A selection is only a draft. Only an explicit submit records the action. */
export function ClientStatusEditor({value,disabled,onSave}:{value:ClientStatus;disabled:boolean;onSave:(action:Action)=>Promise<void>}) {
 const [draft,setDraft]=useState(value),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),touched=useRef(false);
 useEffect(()=>{if(!touched.current)setDraft(value);},[value]);
 const changed=draft!==value;
 return <form className="inc-client-confirm" aria-label="Confirmación del estado del cliente" onSubmit={async event=>{
  event.preventDefault();if(lock.current||disabled||!changed)return;lock.current=true;setSaving(true);setError('');setNotice('');const selected=draft;
  try{await onSave({kind:'client',value:selected});touched.current=false;setNotice(`Estado «${selected}» confirmado y registrado en el historial.`);}catch(e){setError((e as Error).message);}finally{lock.current=false;setSaving(false);}
 }}>
  <Field label="Estado del cliente"><select aria-label="Estado del cliente" disabled={disabled||saving} value={draft} onChange={event=>{const next=event.target.value as ClientStatus;touched.current=next!==value;setDraft(next);setNotice('');setError('');}}>{(['Pendiente','En gestión','Esperando cliente','Solucionado'] as const).map(state=><option key={state}>{state}</option>)}</select></Field>
  <p className="small">Estado guardado: <strong>{value}</strong>. Elegir otro estado no lo guarda.</p>
  <div className="actions"><button type="submit" className="btn primary" aria-label="Aceptar estado del cliente" disabled={disabled||saving||!changed}>{saving?'Guardando estado…':'Aceptar'}</button>{changed&&<button type="button" className="btn" disabled={disabled||saving} onClick={()=>{touched.current=false;setDraft(value);setError('');setNotice('');}}>Descartar cambio</button>}</div>
  {changed&&!saving&&<p className="small" role="status">Cambio pendiente de aceptar. Se registrarán el usuario, la fecha y el estado elegido.</p>}
  <OperationStatus message={saving?'Guardando el estado del cliente y esperando confirmación…':''}/>
  {error&&<Message error>{error}</Message>}{notice&&<Message>{notice}</Message>}
  <p className="small">«Solucionado» requiere completar la solución elegida y confirmar el envío del REX, si lo hay. En “reenviar y recuperar en paralelo”, la devolución puede seguir pendiente como gestión interna. Los costes pendientes no impiden dejar la incidencia Resuelta, pero sí cerrarla.</p>
 </form>;
}
