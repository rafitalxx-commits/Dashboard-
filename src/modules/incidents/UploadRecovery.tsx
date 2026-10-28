import { useEffect, useState, useRef } from 'react';
import type { Incident } from '../../../backend/incidents/types';
import { api } from './api';
import { Message,OperationStatus } from './components';

export function UploadRecovery({incidentId,signal,disabled,onUpdated}:{incidentId:string;signal:string;disabled:boolean;onUpdated:(i:Incident)=>void}){
 const [pending,setPending]=useState<Array<{uploadId:string;name:string}>>([]);const [busy,setBusy]=useState('');const [error,setError]=useState('');const lock=useRef(false);
 useEffect(()=>{let active=true;api('/uploads/pending?'+new URLSearchParams({incidentId})).then(v=>{if(active)setPending(v.uploads);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[incidentId,signal]);
 const recover=async(uploadId:string)=>{if(lock.current)return;lock.current=true;setBusy(uploadId);setError('');try{const result=await api('/uploads/recover',{uploadId});onUpdated(result.incident);setPending(xs=>xs.filter(x=>x.uploadId!==uploadId));}catch(e){setError((e as Error).message);}finally{setBusy('');lock.current=false;}};
 return <>{error&&<Message error>{error}</Message>}{pending.length>0&&<section className="callout"><h3>Subidas pendientes de confirmar</h3><p>Si el archivo ya llegó a Drive, recupera su enlace sin volver a subirlo. Una subida incompleta no se dará por guardada.</p>{pending.map(p=><div className="gen-item" key={p.uploadId}><span>{p.name}</span><button className="btn" disabled={disabled||Boolean(busy)} onClick={()=>void recover(p.uploadId)}>{busy===p.uploadId?'Comprobando Drive…':'Recuperar enlace sin repetir subida'}</button></div>)}<OperationStatus message={busy?'Verificando el archivo original y guardando su enlace…':''}/></section>}</>;
}
