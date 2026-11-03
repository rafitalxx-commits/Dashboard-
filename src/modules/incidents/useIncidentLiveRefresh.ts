import {useEffect,useRef} from 'react';
import type {Incident} from '../../../backend/incidents/types';
import {api} from './api';

/** Read-only refresh independent of the tab/action that started an external job.
 * Normal reads use the repository cache (invalidated by every saved mutation),
 * rather than force-reading all Sheets every five seconds per operator. */
export function useIncidentLiveRefresh({enabled,isBusy,onSnapshot,onError}:{enabled:boolean;isBusy:()=>boolean;onSnapshot:(items:Incident[])=>void;onError:(message:string)=>void}){
 const latest=useRef({isBusy,onSnapshot,onError});latest.current={isBusy,onSnapshot,onError};
 useEffect(()=>{
  if(!enabled)return;let live=true,inFlight=false;let controller:AbortController|undefined;
  const read=async()=>{
   if(!live||inFlight||document.visibilityState!=='visible'||latest.current.isBusy())return;
   inFlight=true;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),20000);
   try{const data=await api<{incidents:Incident[]}>('/',undefined,controller.signal);if(live){latest.current.onSnapshot(data.incidents);latest.current.onError('');}}
   catch(e){if(live)latest.current.onError(`No se pudo actualizar la incidencia. Se muestran los últimos datos confirmados; se reintentará automáticamente. ${(e as Error).message}`);}
   finally{clearTimeout(timeout);inFlight=false;}
  };
  const resume=()=>void read();const timer=setInterval(resume,5000);
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  return()=>{live=false;controller?.abort();clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
 },[enabled]);
}
