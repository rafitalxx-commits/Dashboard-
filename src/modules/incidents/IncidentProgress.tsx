import type { CSSProperties } from 'react';
import { Check, Clock3, ChevronRight, ClipboardCheck, FileWarning, Package, Truck, Camera, Coins, MessageSquareText, LockKeyhole, Flag, UserRound, Boxes, ShieldCheck, CircleHelp, type LucideIcon } from 'lucide-react';
import type { Incident } from '../../../backend/incidents/types';
import { getIncidentNetLoss } from '../../../backend/incidents/domain';
import { date, money } from './components';
import { getIncidentProgress, type ProgressKey, type ProgressRequirement, type ProgressSection } from './incidentProgress';
import './incidentProgress.css';

const icons: Record<ProgressKey, LucideIcon> = {clientSolved:UserRound,goodsRegularized:Package,logisticsResolved:Truck,warrantyResolved:ShieldCheck,claimsResolvedOrAssumed:ClipboardCheck,costsClosed:Coins};
type Navigation = (section:ProgressSection,target?:string)=>void;
function RequirementLink({item,onNavigate,children,className}:{item:ProgressRequirement;onNavigate:Navigation;children:React.ReactNode;className:string}) {
  return item.href ? <a className={className} href={item.href}>{children}</a> : <button type="button" className={className} onClick={()=>onNavigate(item.section,item.target)}>{children}</button>;
}
function Heading({icon:Icon,children}:{icon:LucideIcon;children:React.ReactNode}) {return <h3 className="ip-heading"><span><Icon size={22} aria-hidden="true"/></span>{children}</h3>;}

export function IncidentJourney({incident}:{incident:Incident}) {
  const {checks,pending,shipping} = getIncidentProgress(incident);
  const stages = [
    {label:'Creada',done:true,detail:date(incident.createdAt)},
    {label:shipping.required?'Reenvío':'Procesos de solución',done:shipping.required?shipping.allSent:checks.logisticsResolved,detail:shipping.required?shipping.label:checks.logisticsResolved?'Finalizados':'Pendientes'},
    {label:'Cliente solucionado',done:checks.clientSolved,detail:incident.clientStatus},
    ...(incident.returns.length?[{label:'Recepción devolución',done:checks.goodsRegularized,detail:checks.goodsRegularized?'Devolución procesada':incident.returns.some(r=>r.warehouseConfirmedAt&&r.state!=='processed')?'Finalizando recepción':'Recepción / revisión pendiente'}]:[]),
    {label:'Cierre de incidencia',done:incident.status==='Cerrada',detail:incident.status==='Cerrada'?'Cerrada':checks.canClose?'Lista para cerrar':`${pending.length} ${pending.length===1?'requisito pendiente':'requisitos pendientes'}`},
  ];
  const current=stages.findIndex(stage=>!stage.done);
  return <section className="ip-journey" aria-label="Recorrido de la incidencia">
    <div className="ip-journey-caption"><span><FileWarning size={19} aria-hidden="true"/> Progreso de la incidencia</span><span className={`ip-pill ${incident.status==='Cerrada'||shipping.allSent?'is-done':'is-pending'}`}><Clock3 size={15} aria-hidden="true"/>{incident.status==='Cerrada'?'Cerrada':checks.canClose?'Lista para cerrar':incident.status}</span></div>
    {shipping.sent.length>0&&<div className="ip-shipment-status" role="status" aria-label="Estado del reenvío"><Truck size={24} aria-hidden="true"/><div><strong>{shipping.label}{shipping.simulated?' · Simulado DEMO':''}</strong>{shipping.sent.map(op=><small key={op.key}>{op.dispatchReference||op.externalReference} · {date(op.shippedAt!)} · {op.shippedBy}</small>)}<small>{shipping.allSent?'Expedición completada automáticamente. No requiere otra confirmación.':'Quedan reenvíos por expedir.'}</small></div></div>}
    <ol className="ip-track" style={{'--ip-stage-count':stages.length} as CSSProperties}>{stages.map((stage,index)=><li className={`${stage.done?'is-done':index===current?'is-current':'is-pending'}`} key={stage.label} aria-current={index===current?'step':undefined}><span className="ip-milestone">{stage.done?<Check size={22} aria-label="Completado"/>:index===current?<Clock3 size={23} aria-hidden="true"/>:index+1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}</ol>
    <p className="ip-track-help">Cada paso refleja su estado real. Algunas gestiones pueden avanzar en paralelo; un envío no confirma la entrega al cliente.</p>
  </section>;
}

export function IncidentOverview({incident,onNavigate,onNote,locked,costLocked=locked,driveEnabled}:{incident:Incident;onNavigate:Navigation;onNote:()=>void;locked:boolean;costLocked?:boolean;driveEnabled:boolean}) {
  const {checks,pending,activeReturn,shipment,shipping} = getIncidentProgress(incident);
  const priority:ProgressKey[]=['goodsRegularized','warrantyResolved','logisticsResolved','clientSolved','claimsResolvedOrAssumed','costsClosed'];
  const tasks=[...pending].sort((a,b)=>priority.indexOf(a.key)-priority.indexOf(b.key));
  const next=tasks[0];
  const latest=incident.notes[incident.notes.length-1];
  const primary=activeReturn?{title:`Abrir recepción ${activeReturn.id}`,help:activeReturn.warehouseConfirmedAt?'Consultar la sincronización Odoo pendiente sin repetir la recepción física.':'Registrar llegada, revisar producto y confirmar destino.',href:`#/productos/recepciones?dev=${encodeURIComponent(activeReturn.id)}`,icon:Package}:shipment?{title:`Gestionar ${shipment.dispatchReference}`,help:'Consultar el reenvío y su gestión desde Expediciones.',href:`#/expediciones?pedido=${encodeURIComponent(shipment.dispatchReference!)}`,icon:Truck}:next?{title:next.task,help:next.help,icon:icons[next.key]}:{title:'Revisar cierre de incidencia',help:'Todos los requisitos están cumplidos. Revisa la regla de cierre.',icon:ClipboardCheck};
  return <div className="ip-overview">
    <section className="ip-panel"><Heading icon={ClipboardCheck}>Resumen rápido</Heading><dl className="ip-summary">
      <div><dt><UserRound/>Estado cliente</dt><dd><span className={`ip-pill ${checks.clientSolved?'is-done':'is-info'}`}>{checks.clientSolved?<Check/>:<Clock3/>}{incident.clientStatus}</span></dd></div>
      <div><dt><CircleHelp/>Estado interno</dt><dd><span className={`ip-pill ${incident.status==='Cerrada'||shipping.allSent?'is-done':'is-info'}`}>{incident.status}</span></dd></div>
      <div><dt><Package/>Pendiente principal</dt><dd><span className={`ip-pill ${next?'is-pending':'is-done'}`}>{incident.status==='Cerrada'?'Sin pendientes':next?.task||'Revisar cierre'}</span></dd></div>
      <div><dt><ShieldCheck/>Reclamación</dt><dd><span className={`ip-pill ${checks.claimsResolvedOrAssumed?'is-done':'is-pending'}`}>{!incident.claimIds.length&&checks.claimsResolvedOrAssumed?'No aplica':checks.claimsResolvedOrAssumed?'Resuelta / asumida':'Pendiente'}</span></dd></div>
      <div><dt><Coins/>{checks.costsClosed?'Costes registrados':'Sin costes registrados'}</dt><dd><span className="ip-pill is-info">{money(getIncidentNetLoss(incident))}</span></dd></div>
    </dl></section>
    <section className="ip-panel"><Heading icon={Flag}>Acciones siguientes</Heading><div className="ip-action-grid">
      {primary.href?<a className="ip-action tone-green" href={primary.href}><span className="ip-action-icon"><primary.icon/></span><span><strong>{primary.title}</strong><small>{primary.help}</small></span><ChevronRight/></a>:<button type="button" className="ip-action tone-green" onClick={()=>onNavigate(next?.section||'General',next?.target)}><span className="ip-action-icon"><primary.icon/></span><span><strong>{primary.title}</strong><small>{primary.help}</small></span><ChevronRight/></button>}
      <button type="button" className="ip-action tone-blue" disabled={locked||!driveEnabled} onClick={()=>onNavigate('Documentos / fotos')}><span className="ip-action-icon"><Camera/></span><span><strong>Añadir foto</strong><small>{driveEnabled?'Documentar el estado del producto.':'Subida no disponible: comprueba Drive.'}</small></span><ChevronRight/></button>
      <button type="button" className="ip-action tone-purple" disabled={costLocked} onClick={()=>onNavigate('Costes')}><span className="ip-action-icon"><Coins/></span><span><strong>Registrar / revisar coste</strong><small>{incident.status==='Cerrada'?'Añadir un coste reabre solo el cierre económico.':'Puedes añadir más costes aunque esté Resuelta.'}</small></span><ChevronRight/></button>
      <button type="button" className="ip-action tone-pink" disabled={locked} onClick={onNote}><span className="ip-action-icon"><MessageSquareText/></span><span><strong>Añadir nota</strong><small>Dejar indicaciones al siguiente operario.</small></span><ChevronRight/></button>
    </div></section>
    <section className="ip-panel"><Heading icon={ClipboardCheck}>Qué falta por hacer</Heading>{tasks.length?<ol className="ip-tasks">{tasks.map((item,index)=>{const Icon=icons[item.key];return <li key={item.key}><RequirementLink item={item} onNavigate={onNavigate} className={`ip-task tone-${item.tone}`}><span className="ip-task-number">{index+1}</span><Icon size={20}/><span><strong>{item.task}</strong><small>{item.help}</small></span><span className="ip-pill is-pending">Pendiente</span><ChevronRight size={18}/></RequirementLink></li>;})}</ol>:<p className="ip-clear"><Check/>{incident.status==='Cerrada'?'Incidencia cerrada. No quedan requisitos pendientes.':'Todos los requisitos están cumplidos. Revisa el cierre.'}</p>}</section>
    <section className="ip-panel ip-notes"><div className="ip-panel-title"><Heading icon={MessageSquareText}>Notas internas</Heading><button className="btn soft" disabled={locked} onClick={onNote}>+ Añadir nota</button></div>{latest?<article><p className="inc-note-text">{latest.text}</p><small>{latest.createdBy} · {date(latest.createdAt)}</small></article>:<p className="ip-empty">Todavía no hay notas. Añade lo que deba conocer el siguiente operario.</p>}<button type="button" className="link ip-notes-link" onClick={()=>onNavigate('General','notes')}>Ver historial y todas las notas ({incident.notes.length}) →</button></section>
  </div>;
}

export function IncidentCloseRule({incident,locked,onClose,onNavigate}:{incident:Incident;locked:boolean;onClose:()=>void;onNavigate:Navigation}) {
  const {checks,requirements,pending} = getIncidentProgress(incident);
  const closed=incident.status==='Cerrada';
  return <section className="ip-panel ip-close" aria-label="Regla de cierre"><Heading icon={Flag}>Regla de cierre</Heading><p>La incidencia solo se puede cerrar cuando se cumplan todos los requisitos.</p><div className="ip-close-body"><ul className="ip-close-checks">{requirements.map(item=><li key={item.key} data-requirement={item.key} data-done={item.done}><RequirementLink item={{...item,href:undefined}} onNavigate={onNavigate} className={`ip-check ${item.done?'is-done':'is-pending'}`}><span className="ip-check-icon">{item.done?<Check size={19}/>:<Clock3 size={19}/>}</span><span><strong>{item.label}</strong><small>{!item.applicable?'No aplica':item.done?'Completado':'Pendiente'}</small></span></RequirementLink></li>)}</ul><div className="ip-close-action"><button type="button" className={`btn ${checks.canClose&&!closed?'primary':''}`} disabled={locked||!checks.canClose||closed} onClick={onClose}>{checks.canClose?<Check size={23}/>:<LockKeyhole size={25}/>}<span><strong>{closed?'Incidencia cerrada':checks.canClose?'Cerrar incidencia':'No se puede cerrar todavía'}</strong><small>{closed?'Gestión finalizada':pending.length?`${pending.length} ${pending.length===1?'requisito':'requisitos'} por completar`:'Requisitos cumplidos'}</small></span></button><small>Puedes añadir más costes aunque la incidencia esté resuelta; se incluirán en las estadísticas.</small></div></div></section>;
}
