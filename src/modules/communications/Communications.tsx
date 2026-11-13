import { FileAdministration } from './FileAdministration';
import { UserGroups } from './UserGroups';
import { useAudioState } from './audio';
import { NoticeResponse } from './NoticeResponse';
import { NewMessageWizard } from './NewMessageWizard';
import { useEffect, useState, useRef } from 'react';
import { MessageCircle, Send, Paperclip, Users, Mail, Archive, AlertTriangle, ShieldCheck, Search, Plus, X, CheckCheck, Volume2, Settings, Reply, FileText, ChevronLeft, Clock, Download, RefreshCw } from 'lucide-react';
import type { CommModel } from './useCommunications';
import { sound } from './useCommunications';
import { api, upload, commURL } from './api';
import './communications.css';
const priorityName: any = { normal: 'Normal', important: 'Importante', urgent: 'Urgente' };
const confirmName: any = { none: 'Sin confirmación', read: 'Lectura confirmada', understood: 'Recepción y entendimiento', resolution: 'Requiere resolución' };
const when = (s: string) => new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const labels: Record<string, string> = { access: 'Acceso al módulo', privateChat: 'Chats privados', participate: 'Participar en conversaciones', sendNormal: 'Enviar normales', sendImportant: 'Enviar importantes', sendUrgent: 'Enviar urgentes', attachPhoto: 'Adjuntar fotos', attachDocument: 'Adjuntar documentos', consult: 'Consultar comunicaciones', supervise: 'Supervisión global (solo admin)' };
function userOf(d: any, id: string) { return d.people.find((p: any) => p.id === id) || { id, name: 'Usuario no disponible', department: '', username: '' }; }
function title(d: any, c: any) { return c?.kind === 'group' ? c.name : c?.members.filter((m: any) => m.user_id !== d.user.id).map((m: any) => userOf(d, m.user_id).name).join(', ') || 'Conversación'; }
function Avatar({ person }: {
    person: any;
}) { return person?.photoId ? <img className="comm-avatar" src={commURL(`/files/${person.photoId}`)} alt={`Foto de ${person.name}`}/> : <span className="comm-avatar" aria-label={person?.name}>{person?.name?.slice(0, 2).toUpperCase() || 'TE'}</span>; }
function Attachment({ a, supervision = false }: {
    a: any;
    supervision?: boolean;
}) { if(a.deleted_at)return <span className="comm-attachment">{a.name} · Archivo retirado por administración</span>; const href = commURL(`/files/${a.id}${supervision ? '?supervision=true' : ''}`); return <a className="comm-attachment" href={href} target="_blank" rel="noreferrer">{a.mime.startsWith('image/') ? <img src={href} alt={a.name}/> : <FileText size={24}/>}<span>{a.name}<small>{Math.ceil(a.size / 1024)} KB · Abrir/descargar</small></span><Download size={15}/></a>; }
export function CommunicationsGlobal({ model: m, onOpen }: {
    model: CommModel;
    onOpen: () => void;
}) {
    const [open, setOpen] = useState(false), [wizard, setWizard] = useState(false), [soundError, setSoundError] = useState(''), [sent, setSent] = useState(false), [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported'), [notification, setNotification] = useState<any>(null), [quickReply, setQuickReply] = useState<any>(null);
    useEffect(() => {
        const syncPermission = () => setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
        syncPermission();
        window.addEventListener('focus', syncPermission);
        return () => window.removeEventListener('focus', syncPermission);
    }, [open]);
    useEffect(() => { if (!sent) return; const timer = setTimeout(() => setSent(false), 5000); return () => clearTimeout(timer); }, [sent]);
    const d = m.data;
    const audioStatus = useAudioState(), armed = audioStatus === 'running';
    const inputs = useRef({ d, armed }); inputs.current = { d, armed };
    const playing = useRef(new Set<string>()), urgentKey = useRef(''), notified = useRef(new Set<string>());
    const played = useRef(new Set<string>());
    const lastUrgent = useRef(0);
    const blockerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const tick = () => {
            const { d, armed } = inputs.current;
            if (!d || !armed) return;
            const cfg = d.settings;
            const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
            const quiet = cfg.quietStart && cfg.quietEnd && (cfg.quietStart < cfg.quietEnd ? clock >= cfg.quietStart && clock < cfg.quietEnd : clock >= cfg.quietStart || clock < cfg.quietEnd);
            for (const message of d.inbox.filter((x: any) => x.sender_id !== d.user.id && !x.mine?.read_at && x.priority !== 'urgent')) {
                if (played.current.has(message.id) || playing.current.has(message.id)) continue;
                if (!notified.current.has(message.id) && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') new Notification(priorityName[message.priority] + ' · Comunicaciones', { body: message.subject || 'Tienes un nuevo mensaje corporativo', tag: message.id });
                notified.current.add(message.id);
                const allowed = d.preferences.soundEnabled !== false && !quiet && (message.priority === 'important' ? cfg.importantSound : d.preferences.normalSound ?? cfg.normalSound);
                if (!allowed) { played.current.add(message.id); continue; }
                playing.current.add(message.id);
                void sound(message.priority).then(() => { played.current.add(message.id); setSoundError(''); }).catch(e => setSoundError(e.message)).finally(() => playing.current.delete(message.id));
            }
            const urgent = d.blockers.find((b: any) => b.priority === 'urgent');
            if (!urgent) { urgentKey.current = ''; return; }
            if (!playing.current.has('urgent') && (urgentKey.current !== urgent.id || Date.now() - lastUrgent.current >= cfg.urgentRepeatSeconds * 1000) && (cfg.urgentMandatory || cfg.urgentSound && d.preferences.soundEnabled !== false)) {
                playing.current.add('urgent');
                void sound('urgent').then(() => { lastUrgent.current = Date.now(); urgentKey.current = urgent.id; setSoundError(''); }).catch(e => setSoundError(e.message)).finally(() => playing.current.delete('urgent'));
            }
        };
        const timer = setInterval(tick, 500);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => { if (d?.blockers.length) {
        blockerRef.current?.focus();
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
        } if (e.key === 'Tab') {
            const els = blockerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea:not(:disabled),input:not(:disabled),select:not(:disabled)');
            if (!els?.length)
                return;
            const first = els[0], last = els[els.length - 1];
            if (!blockerRef.current?.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
            }
            else if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
            else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        } };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    } }, [d?.blockers[0]?.id]);
    if (!m.enabled || m.denied)
        return null;
    const unread = d?.inbox.filter((x: any) => x.mine && !x.mine.read_at).length || 0;
    const outstanding = d?.inbox.filter((x: any) => x.mine && (!x.mine.read_at || x.pendingForMe)).length || 0;
    const alerts = d?.notifications.filter((n: any) => !n.read_at).length || 0;
    const highest = d?.blockers[0]?.priority || d?.inbox.find((x: any) => x.priority === 'important' && !x.mine?.read_at)?.priority || 'normal';
    return <><button className={`comm-launch comm-${highest}`} aria-label={`Comunicaciones: ${unread} sin leer, ${outstanding + alerts} avisos pendientes`} title="Comunicaciones" onClick={() => setOpen(true)}><MessageCircle size={21}/>{outstanding + alerts > 0 && <b aria-hidden="true">{outstanding + alerts}</b>}</button>
 {sent && <span className="comm-send-success" role="status">Mensaje enviado.</span>}
 {soundError && !d?.blockers.length && <span className="comm-audio-warning" role="alert">{soundError}</span>}
 {!d && !m.denied && <div className="comm-overlay"><section className="comm-dialog" role="alertdialog" aria-modal="true" aria-label="Comprobación de avisos"><h2>Comprobando avisos pendientes…</h2><p>{m.error || 'Conectando con Comunicaciones'}</p><button onClick={() => void m.refresh()}>Reintentar conexión</button></section></div>}
 {open && d && <div className="comm-quick-wrap"><button className="comm-shade" aria-label="Cerrar panel de comunicaciones" onClick={() => { setOpen(false); setQuickReply(null); }}/><aside className="comm-quick"><header><h2>Comunicaciones</h2><button aria-label="Cerrar comunicaciones" onClick={() => { setOpen(false); setQuickReply(null); }}><X /></button></header><p className="comm-status">{m.online ? '● Conectado' : '○ Sin conexión · reintentando'}</p><div className="comm-inline"><button className="comm-primary" onClick={() => { setSent(false); setWizard(true); }} disabled={!d.grants.participate || !['sendNormal','sendImportant','sendUrgent'].some(k => d.grants[k])}><Plus size={17}/>Mensaje</button>{d.grants.access && <button onClick={() => { setOpen(false); onOpen(); }}>Módulo completo →</button>}</div>{m.actionError && <p role="alert">{m.actionError}</p>}{notificationPermission === 'default' && <button onClick={async () => { const permission = await Notification.requestPermission(); setNotificationPermission(permission); }}>Habilitar notificaciones del navegador</button>}{quickReply ? <><button type="button" onClick={() => setQuickReply(null)}><ChevronLeft size={16}/>Volver a pendientes</button><h3>Responder en la conversación</h3><Conversation key={quickReply.id} model={m} id={quickReply.conversation_id} initialReply={quickReply} paused={wizard} onSent={() => { setQuickReply(null); setOpen(false); setSent(true); }}/></> : <><div className="comm-inline"><strong>{unread} sin leer</strong><span>{d.inbox.filter((x: any) => x.pendingForMe).length} pendientes</span></div><h3>Mensajes no leídos o pendientes</h3>{d.notifications.filter((n: any) => !n.read_at).map((n: any) => <article className="comm-notification" key={n.id}><button type="button" className="comm-notification-open" aria-label={'Abrir detalle de aviso: '+n.body} onClick={() => setNotification(n)}><span>{n.body}</span><small>{when(n.created_at)} · Ver detalle →</small></button><button type="button" className="comm-notification-dismiss" aria-label={'Cerrar aviso: '+n.body} title="Cerrar aviso (se conserva en el historial)" disabled={m.busy} onClick={() => void m.act('/notifications/read', 'POST', { id: n.id }).catch(() => {})}><X size={16}/></button></article>)}{d.inbox.filter((x: any) => x.mine && (!x.mine.read_at || x.pendingForMe)).map((x: any) => <MessageCard key={x.id} message={x} model={m} onReply={d.grants.participate && d.grants.sendNormal ? setQuickReply : undefined}/>)}{!d.inbox.some((x: any) => x.mine && (!x.mine.read_at || x.pendingForMe)) && !d.notifications.some((n: any) => !n.read_at) && <p>No tienes mensajes no leídos ni acciones pendientes.</p>}</>}</aside></div>}
 {wizard && d && <NewMessageWizard model={m} onClose={() => setWizard(false)} onSent={() => { setWizard(false); setQuickReply(null); setOpen(false); setSent(true); }}/>}
 {d?.blockers.length > 0 && <div className="comm-overlay"><div ref={blockerRef} className={`comm-dialog comm-blocker comm-${d.blockers[0].priority}`} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="comm-block-title"><header><AlertTriangle /><div><h2 id="comm-block-title">{priorityName[d.blockers[0].priority]} · Confirmación obligatoria</h2><small>{d.blockers.length} aviso(s) por atender</small></div></header><MessageCard key={d.blockers[0].id} message={d.blockers[0]} model={m} blocking/>{!m.online && <p role="alert">Sin conexión. El aviso sigue pendiente y se sincronizará al recuperar la conexión.</p>}{soundError && <p role="alert">{soundError}</p>}{!armed && <p className="comm-audio-warning" role="status">El navegador necesita una interacción para habilitar el audio. Al hacer clic o usar el teclado en el Dashboard se habilita automáticamente; comprueba también el volumen y que la pestaña no esté silenciada.</p>}<small>La confirmación corresponde a la cuenta {d.user.username}. No identifica a la persona de un puesto compartido.</small></div></div>}
 {notification && <CommunicationDetail key={notification.id} model={m} id={notification.message_id} supervision={Boolean(d?.user.role === 'admin' && d?.grants.supervise)} notification={notification} onClose={() => setNotification(null)}/>}
 </>;
}
function MessageCard({ message: x, model: m, blocking = false, supervision = false, readOnly = false, onReply, onRectify }: {
    message: any;
    model: CommModel;
    blocking?: boolean;
    supervision?: boolean;
    readOnly?: boolean;
    onReply?: (x: any) => void;
    onRectify?: (x: any) => void;
}) {
    const d = m.data, livePerson=userOf(d,x.sender_id),p=livePerson.name==='Usuario no disponible'&&x.senderProfile?{...x.senderProfile,photoId:null}:livePerson;
    const mine = x.mine, viewOnly = supervision || readOnly;
    const [events, setEvents] = useState<any[] | null>(null);
    return <article className={`comm-message ${x.sender_id === d.user.id ? 'comm-own' : ''} comm-${x.priority}`} data-message-id={x.id}><header><Avatar person={p}/><span><strong>{p.name}</strong><small>{p.department} · {when(x.created_at)} · {p.online?'Actividad reciente':'Sin actividad reciente'}</small></span><span className="comm-priority">{x.kind === 'notice' ? priorityName[x.priority] : 'Chat'}</span></header>{x.subject && <h3>{x.subject}</h3>}{x.reply_to && <button onClick={async () => { try {
        const original = await api(`/messages/${x.reply_to}${supervision ? '?supervision=true' : ''}`);
        setEvents([{ seq: 'reply', created_at: original.message.created_at, actor_id: original.message.sender_id, type: 'Mensaje original: ' + original.message.body }]);
    }
    catch (e: any) {
        m.setActionError(e.message);
    } }}>↳ Consultar mensaje al que responde</button>}{x.rectifies && <small>✎ Rectificación del mensaje original · {x.rectifies.slice(0, 8)}</small>}<p>{x.isResponseConfirmation ? <><strong className="comm-answer-badge">{x.body.split('\n')[0]}</strong>{x.body.slice(x.body.split('\n')[0].length)}</> : x.body}</p>{x.reference_value && <div className="comm-reference">{({ order: 'Pedido', product: 'Producto', incident: 'Incidencia' } as any)[x.reference_type]}: <strong>{x.reference_value}</strong></div>}<div className="comm-attachments">{x.attachments.map((a: any) => <Attachment key={a.id} a={a} supervision={supervision}/>)}</div>{x.kind === 'notice' && <p className="comm-confirm-type">{confirmName[x.confirmation]} · {mine?.state || 'Enviado'}</p>}
 {!viewOnly && mine && x.kind === 'notice' && !mine.closed_at && <NoticeResponse key={x.id} message={x} model={m} blocking={blocking}/>}
 {!!x.responseHistory?.length && <div className="comm-response-history"><strong>Respuestas registradas</strong>{[...x.responseHistory].reverse().map((r: any) => <p key={r.responseMessageId}><strong>{r.actor?.name || userOf(d, r.actor?.id).name}</strong> · <strong className="comm-answer-badge">{({confirm:x.confirmation==='read'?'Confirmar lectura':'He leído y entendido',help:'Necesito ayuda',cannot:'No puedo cumplir',process:'En proceso',resolve:'Mi parte está resuelta'} as any)[r.action]}</strong> · {when(r.created_at)}{r.body && <span>{r.body}</span>}</p>)}</div>}
 {!blocking && !viewOnly && mine && !mine.read_at && <button disabled={m.busy || !m.online} onClick={() => void m.act(`/messages/${x.id}/receipt`, 'POST', {action:'read'}).catch(() => {})}>Marcar como leído</button>}
 {!blocking && <><footer><span><CheckCheck size={14}/>{x.recipients.filter((r: any) => r.delivered_at).length}/{x.recipients.length} entregados · {x.recipients.filter((r: any) => r.read_at).length} leídos</span>{!viewOnly && onReply && !x.isResponseConfirmation && !(mine && x.kind === 'notice' && ['important', 'urgent'].includes(x.priority)) && <button onClick={() => onReply(x)}><Reply size={14}/>Responder</button>}{!viewOnly && onRectify && !x.isResponseConfirmation && x.sender_id === d.user.id && <button onClick={() => onRectify(x)}>Rectificar</button>}<button onClick={async () => { if (events) {
        setEvents(null);
        return;
    } try {
        setEvents((await api(`/messages/${x.id}${supervision ? '?supervision=true' : ''}`)).events);
    }
    catch (e: any) {
        m.setActionError(e.message);
    } }}>Trazabilidad</button></footer>{events && <div className="comm-events">{x.recipients.map((r: any) => <p key={r.user_id}>{(userOf(d,r.user_id).name==='Usuario no disponible'?r.profile?.name:null)||userOf(d,r.user_id).name}: <strong>{r.state}</strong>{r.confirmed_at && ` · Confirmado ${when(r.confirmed_at)}`}{r.resolved_at && ` · Resuelto ${when(r.resolved_at)}`}</p>)}{[...events].reverse().map((e: any) => <small key={e.seq}>{when(e.created_at)} · {userOf(d, e.actor_id).name} · {e.type}</small>)}</div>}{x.kind === 'notice' && (x.sender_id === d.user.id || d.user.role === 'admin') && !viewOnly && !x.recipients.every((r: any) => r.closed_at) && <button disabled={m.busy} onClick={() => void m.act(`/messages/${x.id}/close`, 'POST', {}).catch(() => { })}>Cerrar aviso (requiere todas las respuestas)</button>}</>}{m.actionError && blocking && <p role="alert">{m.actionError}</p>}
 </article>;
}
function Conversation({ model: m, id, supervision = false, paused = false, initialReply = null, onSent }: {
    model: CommModel;
    id: string;
    supervision?: boolean;
    paused?: boolean;
    initialReply?: any;
    onSent?: () => void;
}) {
    const d = m.data;
    const [messages, setMessages] = useState<any[]>([]), [before, setBefore] = useState<string | null>(null), [hasMore, setMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [body, setBody] = useState(''), [subject, setSubject] = useState(''), [kind, setKind] = useState('chat'), [priority, setPriority] = useState('normal'), [confirmation, setConfirmation] = useState('none'), [files, setFiles] = useState<any[]>([]), [uploading, setUploading] = useState(false), [reply, setReply] = useState<any>(initialReply), [rectify, setRectify] = useState<any>(null), [referenceType, setReferenceType] = useState('order'), [referenceValue, setReferenceValue] = useState(''), [draftStatus, setDraftStatus] = useState('Borrador cargado');
    const seq = useRef(0), draftLoaded = useRef(false), sending = useRef(false), requestId = useRef(crypto.randomUUID());
    const draftTimer = useRef<any>(null);
    const historyStart = useRef<HTMLDivElement>(null);
    const load = async (older = false) => { const n = ++seq.current; try {
        const result = await api(`/conversations/${id}/messages?${supervision ? 'supervision=true&' : ''}${older && before ? 'before=' + before : ''}`);
        if (n !== seq.current)
            return;
        setMessages(old => (older || old.length > 30 ? [...old.filter(x => !result.messages.some((y: any) => x.id === y.id)), ...result.messages] : [...result.messages]).sort((a: any, b: any) => b.created_at.localeCompare(a.created_at) || b.sequence - a.sequence));
        if (older || !before) {
            setBefore(result.nextBefore);
            setMore(result.hasMore);
        }
        if (!draftLoaded.current) {
            setBody(result.draft);
            const saved = result.draftState || {};
            setSubject(saved.subject || '');
            setKind(saved.kind || 'chat');
            setPriority(saved.priority || 'normal');
            setConfirmation(saved.confirmation || 'none');
            setFiles(saved.files || []);
            setReferenceType(saved.referenceType || 'order');
            setReferenceValue(saved.referenceValue || '');
            if (saved.requestId)
                requestId.current = saved.requestId;
            draftLoaded.current = true;
        }
        setError('');
        if (!supervision && document.visibilityState === 'visible') {
            for (const x of result.messages) {
                if (x.mine && !x.mine.read_at)
                    await api(`/messages/${x.id}/receipt`, 'POST', { action: 'read' });
            }
        }
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        if (n === seq.current)
            setLoading(false);
    } };
    useEffect(() => { void load(); return () => { seq.current++; }; }, [id, supervision, d.version]);
    const latestLoad=useRef(load);latestLoad.current=load;useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible')void latestLoad.current()};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible)},[id,supervision]);
    useEffect(() => { if (!draftLoaded.current || supervision || paused || sending.current)
        return; setDraftStatus('Guardando borrador…'); clearTimeout(draftTimer.current); draftTimer.current = setTimeout(() => { void api(`/conversations/${id}/draft`, 'PUT', { body, details: { subject, kind, priority, confirmation, files, referenceType, referenceValue, requestId: requestId.current } }).then(() => setDraftStatus('Borrador sincronizado')).catch((e: any) => { setDraftStatus('Borrador sin sincronizar'); setError('Borrador sin sincronizar: ' + e.message); }); }, 600); return () => clearTimeout(draftTimer.current); }, [body, subject, kind, priority, confirmation, files, referenceType, referenceValue, id, supervision, paused]);
    const send = async (e: any) => { e.preventDefault(); if (sending.current)
        return; sending.current = true; setError(''); clearTimeout(draftTimer.current); try {
        const saved=await m.act('/messages', 'POST', { conversationId: id, body, subject, kind, priority, confirmation, attachments: files.map(x => x.id), referenceType: referenceValue ? referenceType : null, referenceValue, replyTo: reply?.id, rectifies: rectify?.id, requestId: requestId.current });
        setMessages(old=>old.some(x=>x.id===saved.id)?old:[saved,...old]);setDraftStatus('Mensaje enviado y guardado en servidor.');
        setBody('');
        setSubject('');
        setFiles([]);
        setReply(null);
        setRectify(null);
        setReferenceValue('');
        requestId.current = crypto.randomUUID();
        await load();
        setTimeout(() => historyStart.current?.parentElement?.scrollTo({ top: 0 }), 50);
        onSent?.();
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        sending.current = false;
    } };
    return <section className="comm-thread" aria-label="Conversación"><div className="comm-history"><div ref={historyStart}/>{loading && <p>Cargando conversación…</p>}{messages.map(x => <MessageCard key={x.id} message={x} model={m} supervision={supervision} onReply={setReply} onRectify={x => { setRectify(x); setBody('Rectificación: '); setKind(x.kind); setPriority(x.priority); setConfirmation(x.confirmation); }}/>)}{!loading && !messages.length && <div className="comm-empty"><MessageCircle size={36}/><h3>Comienza la conversación</h3><p>Mensajes y archivos quedan guardados en el servidor.</p></div>}{hasMore && <button disabled={loading} onClick={() => void load(true)}>Cargar mensajes anteriores</button>}</div>{error && <div className="comm-error" role="alert">{error}<button type="button" onClick={()=>{setLoading(true);void load()}}>Reintentar conversación</button></div>}{!supervision && <form className="comm-compose" onSubmit={send}><fieldset className="comm-compose-fields" disabled={m.busy || !draftLoaded.current}>{(reply || rectify) && <div className="comm-reference">{rectify ? 'Rectificando' : 'Respondiendo'}: {(rectify || reply).body.slice(0, 90)}<button type="button" onClick={() => { setReply(null); setRectify(null); }}>Cancelar vínculo</button></div>}<div className="comm-inline"><label>Tipo<select aria-label="Tipo de mensaje" value={kind} onChange={e => setKind(e.target.value)}><option value="chat">Chat normal</option><option value="notice">Aviso operativo</option></select></label>{kind === 'notice' && <><label>Prioridad<select aria-label="Prioridad" value={priority} onChange={e => { setPriority(e.target.value); if (e.target.value === 'urgent' && ['none', 'read'].includes(confirmation))
        setConfirmation('understood'); }}>{['normal', 'important', 'urgent'].filter(p => d.grants[p === 'normal' ? 'sendNormal' : p === 'important' ? 'sendImportant' : 'sendUrgent']).map(p => <option value={p} key={p}>{priorityName[p]}</option>)}</select></label><label>Confirmación<select aria-label="Confirmación" value={confirmation} onChange={e => setConfirmation(e.target.value)}>{Object.entries(confirmName).filter(([k]) => priority !== 'urgent' || !['none', 'read'].includes(k)).map(([k, v]) => <option value={k} key={k}>{String(v)}</option>)}</select></label></>}</div>{kind === 'notice' && <input aria-label="Asunto del aviso" placeholder="Asunto del aviso" value={subject} onChange={e => setSubject(e.target.value)} maxLength={160}/>}<textarea aria-label="Escribe un mensaje" placeholder="Escribe un mensaje…" value={body} maxLength={20000} onChange={e => setBody(e.target.value)} rows={3}/><div className="comm-inline"><select aria-label="Tipo de referencia" value={referenceType} onChange={e => setReferenceType(e.target.value)}><option value="order">Pedido</option><option value="product">Producto</option><option value="incident">Incidencia</option></select><input aria-label="Referencia manual" placeholder="Referencia manual (opcional)" value={referenceValue} onChange={e => setReferenceValue(e.target.value)} maxLength={160}/></div><div className="comm-file-list">{files.map(f => <span key={f.id}>{f.name}<button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(a => a.filter(x => x.id !== f.id))}><X size={14}/></button></span>)}</div><div className="comm-inline"><label className="comm-upload"><Paperclip size={18}/>{uploading ? 'Subiendo…' : 'Adjuntar'}<input aria-label="Adjuntar archivos" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.txt,.csv" disabled={uploading || m.busy || !d.grants.attachPhoto && !d.grants.attachDocument} onChange={async (e) => { const chosen = Array.from(e.target.files || []); setUploading(true); try {
        if (files.length + chosen.length > d.settings.maxAttachments)
            throw Error('Demasiados archivos');
        for (const file of chosen) {
            const result = await upload(file);
            setFiles(old => [...old, result]);
        }
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setUploading(false);
        e.target.value = '';
    } }}/></label><small aria-live="polite">{draftStatus} · Referencias sin conexión Odoo</small><button className="comm-primary" type="submit" disabled={m.busy || uploading || !m.online || !body.trim() && !files.length || !(kind==='chat'||priority==='normal'?d.grants.sendNormal:priority==='important'?d.grants.sendImportant:d.grants.sendUrgent)}><Send size={17}/>{m.busy ? 'Enviando…' : 'Enviar'}</button></div></fieldset></form>}</section>;
}
export function CommunicationsView({ model: m }: {
    model: CommModel;
}) {
    const d = m.data;
    const [tab, setTab] = useState('received'), [selected, setSelected] = useState<string | null>(null), [query, setQuery] = useState(''), [priority, setPriority] = useState(''), [state, setState] = useState(''), [create, setCreate] = useState(false), [manage, setManage] = useState<any>(null), [wizard,setWizard]=useState(false), [composerEpoch,setComposerEpoch]=useState(0);
    if (d && !d.grants.access) return <section className="panel"><h2>Comunicaciones</h2><p>Sin permiso para acceder al módulo. Puedes utilizar el bocadillo para enviar mensajes y atender tus pendientes.</p></section>;
    if (!d)
        return <section className="panel"><h2>Comunicaciones</h2><p>{m.denied ? 'Sin permiso para acceder a Comunicaciones.' : m.error || 'Conectando…'}</p></section>;
    const sections: Array<[
        string,
        string,
        any
    ]> = [['received', 'Recibidos', Mail], ['chats', 'Chats', MessageCircle], ['groups', 'Grupos', Users], ['sent', 'Enviados', Send], ['pending', 'Pendientes', Clock], ['important', 'Avisos importantes', AlertTriangle], ['urgent', 'Avisos urgentes', AlertTriangle], ['archive', 'Archivo', Archive], ...(d.user.role === 'admin' ? [['admin', 'Administración', ShieldCheck] as [
                string,
                string,
                any
            ]] : [])];
    const chats = d.conversations.filter((c: any) => tab === 'archive' ? c.archived : !c.archived && (tab !== 'groups' || c.kind === 'group')).filter((c: any) => `${title(d, c)} ${c.lastMessage?.body || ''}`.toLowerCase().includes(query.toLowerCase()));
    const conversation = d.conversations.find((c: any) => c.id === selected);
    return <section className="comm-center"><header className="comm-page-heading"><div><p className="eyebrow">COMUNICACIONES INTERNAS</p><h2>Centro de comunicaciones</h2><p>Mensajes, avisos y equipos de Todoelectrico</p></div><div className="comm-inline"><span className="comm-status">{m.online ? '● Conectado' : '○ Sin conexión'}</span><button className="comm-primary" onClick={() => setWizard(true)}><Plus size={18}/>Nuevo mensaje</button>{d.user.role==='admin'&&<button onClick={()=>setCreate(true)}><Users size={17}/>Crear grupo</button>}</div></header><p className="comm-corporate"><ShieldCheck size={15}/>Comunicaciones corporativas: los administradores autorizados pueden consultar conversaciones y adjuntos. Sus accesos quedan registrados.</p>{m.actionError && <p className="comm-error" role="alert">{m.actionError}</p>}{m.error && <p className="comm-error" role="alert">{m.error} · Reintentando conexión.</p>}<nav className="comm-tabs" aria-label="Secciones de comunicaciones">{sections.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setSelected(null); m.setActionError(''); }}><Icon size={17}/>{label}{key === 'pending' && <b>{d.inbox.filter((m: any) => m.pendingForMe).length}</b>}</button>)}</nav>
 {tab === 'admin' ? <CommunicationsAdministration model={m}/> : <><div className="comm-filters"><label><Search size={17}/><input aria-label="Buscar comunicaciones" placeholder="Buscar mensajes, referencias o conversaciones…" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Filtrar prioridad" value={priority} onChange={e => setPriority(e.target.value)}><option value="">Todas las prioridades</option>{Object.entries(priorityName).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}</select><select aria-label="Filtrar estado" value={state} onChange={e => setState(e.target.value)}><option value="">Todos los estados</option>{['Pendiente de entrega', 'Pendiente de lectura', 'Leído', 'Confirmado', 'En proceso', 'Necesita ayuda', 'No puede cumplir', 'Resuelto', 'Cerrado'].map(s => <option key={s}>{s}</option>)}</select></div>{['chats', 'groups', 'archive'].includes(tab) ? <div className={`comm-workspace ${selected ? 'has-selection' : ''}`}><aside className="comm-list"><h3>{tab === 'groups' ? 'Grupos' : tab === 'archive' ? 'Archivados' : 'Conversaciones recientes'}</h3>{!chats.length && <p>No hay conversaciones que coincidan.</p>}{chats.map((c: any) => <button key={c.id} className={`comm-conversation ${c.id === selected ? 'selected' : ''}`} onClick={() => setSelected(c.id)}><Avatar person={c.kind === 'private' ? userOf(d, c.members.find((x: any) => x.user_id !== d.user.id)?.user_id) : { name: c.name }}/><span><strong>{title(d, c)}</strong><small>{c.lastMessage?.body || 'Sin mensajes'}</small></span>{c.unread > 0 && <b>{c.unread}</b>}</button>)}</aside><div className="comm-detail">{conversation ? <><header className="comm-detail-heading"><button className="comm-back" onClick={() => setSelected(null)}><ChevronLeft size={16}/>Volver</button><div><h3>{title(d, conversation)}</h3><small>{conversation.members.filter((x: any) => !x.left_at).map((x: any) => userOf(d, x.user_id).name).join(' · ')}{conversation.responsible_id && ` · Responsable: ${userOf(d, conversation.responsible_id).name}`}</small></div><button onClick={() => void m.act(`/conversations/${conversation.id}/archive`, 'POST', { archived: !conversation.archived }).catch(() => { })}>{conversation.archived ? 'Restaurar' : 'Archivar'}</button>{d.user.role === 'admin' && conversation.kind === 'group' && <button onClick={() => setManage(conversation)}>Gestionar grupo</button>}</header><Conversation key={`${selected}:${composerEpoch}`} id={selected!} model={m} paused={wizard}/></> : <div className="comm-empty"><MessageCircle size={48}/><h3>Selecciona una conversación</h3><p>El historial, los adjuntos y las confirmaciones están sincronizados entre dispositivos.</p></div>}</div></div> : <Feed key={tab} model={m} scope={tab} query={query} priority={priority} state={state} onConversation={id => { setSelected(id); setTab('chats'); }}/>}</>}{wizard&&<NewMessageWizard model={m} onClose={()=>{setWizard(false);setComposerEpoch(n=>n+1)}} onSent={id=>{setWizard(false);setSelected(id);setComposerEpoch(n=>n+1);setTab('chats')}}/>}{create && <ConversationEditor initialKind="group" model={m} onClose={() => setCreate(false)} onSaved={id => { setCreate(false); setSelected(id); setTab('chats'); }}/>}{manage && <ConversationEditor model={m} conversation={manage} onClose={() => setManage(null)} onSaved={() => setManage(null)}/>}</section>;
}
function Feed({ model: m, scope = '', query = '', priority = '', state = '', supervision = false, onConversation }: {
    model: CommModel; scope?: string; query?: string; priority?: string; state?: string; supervision?: boolean; onConversation?: (id: string) => void;
}) {
    const d = m.data;
    const [result, setResult] = useState<any>(null), [offset, setOffset] = useState(0), [error, setError] = useState(''), [user, setUser] = useState(''), [department, setDepartment] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [cid, setCid] = useState(''), [selected, setSelected] = useState<string | null>(null);
    const seq = useRef(0);
    useEffect(() => { setOffset(0); }, [scope, query, priority, state, user, department, from, to, cid]);
    useEffect(() => {
        const n = ++seq.current;
        const timer = setTimeout(() => {
            const params = new URLSearchParams({ scope, query, priority, state, offset: String(offset), userId: user, departmentId: department, from, to, conversationId: cid, supervision: String(supervision) });
            api('/feed?' + params).then(r => { if (n === seq.current) { setResult(r); setError(''); } }).catch(e => { if (n === seq.current) setError(e.message); });
        }, 180);
        return () => { seq.current++; clearTimeout(timer); };
    }, [scope, query, priority, state, offset, user, department, from, to, cid, d.version, supervision]);
    return <div className={supervision ? 'comm-supervision-feed' : ''}>
        {supervision && <div className="comm-filters comm-supervision-filters"><select aria-label="Supervisar usuario" value={user} onChange={e => setUser(e.target.value)}><option value="">Todos los usuarios</option>{d.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Supervisar departamento" value={department} onChange={e => setDepartment(e.target.value)}><option value="">Todos los departamentos</option>{d.departments.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label="Supervisión desde" type="date" value={from} onChange={e => setFrom(e.target.value)}/><input aria-label="Supervisión hasta" type="date" value={to} onChange={e => setTo(e.target.value)}/></div>}
        {error && <p role="alert" className="comm-error">{error}</p>}
        {!result ? <p role="status">Cargando mensajes…</p> : <>
            <p className="comm-status">{result.total === 0 ? 'Sin mensajes coincidentes' : `${offset + 1}–${Math.min(offset + 30, result.total)} de ${result.total} mensajes`}</p>
            <div className={supervision ? 'comm-feed comm-supervision-list' : 'comm-feed'}>{result.messages.map((x: any) => supervision ?
                <button type="button" key={x.id} className="comm-supervision-row" aria-label={'Ver detalle: ' + (x.subject || x.body.slice(0,55))} onClick={() => setSelected(x.id)}>
                    <Avatar person={userOf(d,x.sender_id)}/><span className="comm-supervision-summary"><strong>{x.subject || x.body.slice(0,90)}</strong><span>{x.body.slice(0,130)}</span><small>{x.senderProfile?.name || userOf(d,x.sender_id).name} · {x.recipients.length} destinatario(s) · {x.recipients.filter((r:any)=>r.confirmed_at).length} confirmado(s)</small></span>
                    <span className="comm-supervision-meta"><span className={'comm-priority comm-' + x.priority}>{x.kind === 'notice' ? priorityName[x.priority] : 'Chat'}</span><time>{when(x.created_at)}</time><small>Ver detalle →</small></span>
                </button> : <div key={x.id}><MessageCard model={m} message={x}/>{onConversation && <button type="button" onClick={() => onConversation(x.conversation_id)}>Abrir conversación →</button>}</div>)}</div>
            <div className="comm-pagination"><button disabled={!offset} onClick={() => setOffset(Math.max(0,offset-30))}>Anterior</button><button disabled={!result.hasMore} onClick={() => setOffset(offset+30)}>Siguiente</button></div>
        </>}
        {selected && supervision && <CommunicationDetail key={selected} model={m} id={selected} onClose={() => setSelected(null)}/>}
    </div>;
}
function CommunicationDetail({ model: m, id, onClose, supervision = true, notification }: { model: CommModel; id: string | null; onClose: () => void; supervision?: boolean; notification?: any }) {
    const ref = useRef<HTMLDialogElement>(null);
    const [detail, setDetail] = useState<any>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [history, setHistory] = useState(false);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const dialog = ref.current;
        dialog?.showModal(); dialog?.querySelector<HTMLButtonElement>('button')?.focus();
        return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
    }, []);
    useEffect(() => {
        let live = true; setError('');
        if (!id) return;
        api(`/messages/${id}?supervision=${supervision}`).then(value => { if (live) setDetail(value); }).catch(e => { if (live) setError(e.message); });
        return () => { live = false; };
    }, [id,retry,supervision]);
    return <dialog ref={ref} className="comm-dialog comm-message-detail" aria-label={notification ? "Detalle de la comunicación" : "Detalle del mensaje supervisado"} onCancel={e => { e.preventDefault(); onClose(); }}>
        <header><div><span className="comm-eyebrow">{notification ? "Aviso recibido · Solo lectura" : "Supervisión · Solo lectura"}</span><h2>Detalle del mensaje</h2></div><button type="button" aria-label="Cerrar detalle del mensaje" onClick={onClose}><X/></button></header>
        {error && <p className="comm-error" role="alert">{error}<button type="button" onClick={() => setRetry(n=>n+1)}>Reintentar</button></p>}
        {notification && <section className="comm-notification-context"><h3>Aviso recibido</h3><p>{notification.body}</p><small>{when(notification.created_at)}</small></section>}{id && !detail && !error && <p role="status">Cargando mensaje completo…</p>}
        {detail && <><MessageCard message={detail.message} model={m} supervision={supervision} readOnly/>
            <section className="comm-recipient-detail"><h3>Estado por destinatario</h3>{detail.message.recipients.map((r:any)=><div key={r.user_id}><strong>{r.profile?.name || userOf(m.data,r.user_id).name}</strong><span>{r.state}</span><small>{r.confirmed_at ? 'Confirmado '+when(r.confirmed_at) : 'Sin confirmar'}{r.resolved_at && ' · Resuelto '+when(r.resolved_at)}</small></div>)}</section>
            <details className="comm-detail-audit"><summary>Historial de eventos ({detail.events.length})</summary>{[...detail.events].reverse().map((event:any)=><p key={event.seq}><time>{when(event.created_at)}</time> · {userOf(m.data,event.actor_id).name} · {event.type.replaceAll('_',' ')}</p>)}</details>
            {supervision && <button type="button" onClick={()=>setHistory(value=>!value)}>{history ? 'Ocultar historial de conversación' : 'Ver historial de conversación'}</button>}
            {history && supervision && <Conversation model={m} id={detail.message.conversation_id} supervision={supervision}/>}
        </>}
    </dialog>;
}
function ConversationEditor({ model: m, conversation, onClose, onSaved,initialKind }: {
    model: CommModel;
    conversation?: any;
    initialKind?: string;
    onClose: () => void;
    onSaved: (id: string) => void;
}) { const d = m.data; const [kind, setKind] = useState(conversation ? 'group' : initialKind||'private'), [name, setName] = useState(conversation?.name || ''), [members, setMembers] = useState<string[]>(conversation?.members.filter((x: any) => !x.left_at).map((x: any) => x.user_id) || []), [responsible, setResponsible] = useState(conversation?.responsible_id || ''), [department, setDepartment] = useState(conversation?.department_id || ''), [error, setError] = useState(''); return <div className="comm-overlay"><form className="comm-dialog" onSubmit={async (e) => { e.preventDefault(); try {
    const result = await m.act(conversation ? `/conversations/${conversation.id}` : '/conversations', conversation ? 'PATCH' : 'POST', { kind, name, members, responsibleId: responsible, departmentId: department });
    onSaved(result.id || conversation.id);
}
catch (e: any) {
    setError(e.message);
} }}><header><h2>{conversation ? 'Gestionar grupo' : 'Nueva conversación'}</h2><button type="button" disabled={m.busy} aria-label="Cerrar nueva conversación" onClick={onClose}><X /></button></header>{!conversation && <label>Tipo<select aria-label="Tipo de conversación" value={kind} onChange={e => { setKind(e.target.value); setMembers(e.target.value==='group'?[d.user.id]:[]); }}><option value="private">Chat privado</option>{d.user.role === 'admin' && <option value="group">Grupo</option>}</select></label>}{kind === 'group' && <><label>Nombre del grupo<input aria-label="Nombre del grupo" required value={name} onChange={e => setName(e.target.value)} maxLength={120}/></label><label>Departamento<select aria-label="Departamento del grupo" value={department} onChange={e => setDepartment(e.target.value)}><option value="">Grupo personalizado</option>{d.departments.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label></>}<fieldset><legend>{kind === 'private' ? 'Destinatario' : 'Participantes'}</legend>{d.people.filter((p: any) => p.active && (kind === 'group' || p.id !== d.user.id)).map((p: any) => <label className="comm-check" key={p.id}><input type={kind === 'private' ? 'radio' : 'checkbox'} name="members" checked={members.includes(p.id)} onChange={e => setMembers(kind === 'private' ? [p.id] : e.target.checked ? [...members, p.id] : members.filter(x => x !== p.id))}/><Avatar person={p}/>{p.name}<small>{p.department}</small></label>)}</fieldset>{kind === 'group' && <label>Responsable<select aria-label="Responsable del grupo" value={responsible} onChange={e => setResponsible(e.target.value)}><option value="">Sin responsable</option>{d.people.filter((p: any) => members.includes(p.id) || p.id === d.user.id && !conversation).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}{error && <p role="alert" className="comm-error">{error}</p>}<button type="submit" className="comm-primary" disabled={m.busy}>{m.busy ? 'Guardando…' : conversation ? 'Guardar grupo' : 'Crear conversación'}</button></form></div>; }
export function CommunicationsAdministration({ model: m }: { model: CommModel }) {
    const d = m.data;
    const [section, setSection] = useState('settings'), [query, setQuery] = useState(''), [priority, setPriority] = useState(''), [state, setState] = useState(''), [audit, setAudit] = useState<any[]>([]), [error, setError] = useState('');
    if (!d || d.user.role !== 'admin') return null;
    const active = !d.grants.supervise && ['supervision', 'audit', 'files'].includes(section) ? 'settings' : section;
    return <section className="comm-center comm-admin comm-admin-compact" aria-label="Configuración general de Comunicaciones">
        <header className="comm-admin-heading"><div><span className="comm-eyebrow">Configuración general</span><h2>Administración de comunicaciones</h2><p>Políticas corporativas, departamentos y seguimiento.</p></div><ShieldCheck size={24}/></header>
        <p className="comm-profile-location">Fotos, departamento, grupos y permisos individuales: Configuración → Gestionar usuario.</p>
        <nav className="comm-tabs" aria-label="Administración de comunicaciones">{[['settings','Sonidos y políticas'], ['departments','Departamentos'], ...(d.grants.supervise ? [['files','Archivos'], ['supervision','Supervisión'], ['audit','Auditoría']] : [])].map(([key, label]) => <button type="button" key={key} aria-pressed={active === key} className={active === key ? 'active' : ''} onClick={() => { setSection(key); setError(''); if (key === 'audit') api('/audit').then(r => setAudit(r.events)).catch(e => setError(e.message)); }}>{label}</button>)}</nav>
        <div className="comm-admin-content">
            {error && <p role="alert" className="comm-error">{error}</p>}
            {active === 'settings' && <SoundSettings model={m}/>}
            {active === 'files' && <FileAdministration model={m}/>}
            {active === 'departments' && <DepartmentSettings model={m}/>}
            {active === 'supervision' && <><div className="comm-filters"><input aria-label="Buscar supervisión" placeholder="Buscar mensaje o referencia…" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="Supervisión prioridad" value={priority} onChange={e => setPriority(e.target.value)}><option value="">Todas las prioridades</option>{Object.entries(priorityName).map(([key, name]) => <option key={key} value={key}>{String(name)}</option>)}</select><select aria-label="Supervisión estado" value={state} onChange={e => setState(e.target.value)}><option value="">Todos los estados</option>{['Pendiente de entrega','Pendiente de lectura','Leído','Confirmado','En proceso','Necesita ayuda','No puede cumplir','Resuelto','Cerrado'].map(name => <option key={name}>{name}</option>)}</select></div><Feed model={m} query={query} priority={priority} state={state} supervision/></>}
            {active === 'audit' && <div className="comm-audit-list">{audit.map(event => <details key={event.seq}><summary><time>{when(event.created_at)}</time><strong>{userOf(d,event.actor_id).name}</strong><span>{event.type.replaceAll('_',' ')}</span></summary><p>{event.detail}</p></details>)}{!audit.length && <p>Sin accesos registrados.</p>}</div>}
        </div>
    </section>;
}
export function CommunicationsUserSettings({ model: m, user }: { model: CommModel; user: { id: string; username: string; active: boolean } }) {
    if (/raskibot/i.test(user.username)) return <section className="comm-center comm-user-settings"><h3>Comunicaciones</h3><p>Raskibot está excluido de las comunicaciones internas por ser un bot.</p></section>;
    if (!user.active) return <section className="comm-center comm-user-settings"><h3>Comunicaciones</h3><p>Activa esta cuenta para configurar sus permisos de Comunicaciones. La cuenta desactivada no puede acceder al Dashboard.</p></section>;
    const person = m.data?.people.find((p: any) => p.id === user.id);
    return <section className="comm-center comm-user-settings" aria-label="Permisos de Comunicaciones"><h3>Comunicaciones</h3>
        <p>El acceso y las acciones de este módulo se guardan aquí para esta misma cuenta del Dashboard.</p>
        {person ? <><ProfileEditor key={person.id + ':' + person.role} model={m} person={person}/><UserGroups key={person.id} model={m} userId={person.id}/></> : <><p role={m.error ? 'alert' : 'status'}>{m.error || 'Cargando perfil de Comunicaciones…'}</p><button type="button" disabled={m.busy} onClick={() => void m.refresh()}>Recargar perfil de Comunicaciones</button></>}
    </section>;
}
function ProfileEditor({ model: m, person: p }: {
    model: CommModel;
    person: any;
}) { const [dept, setDept] = useState(p.departmentId || ''), [grants, setGrants] = useState<any>(p.overrides || {}), [result, setResult] = useState(''), [working, setWorking] = useState(false), [preferences, setPreferences] = useState<any>(p.preferences || {}); const saveLock = useRef(false); const [saving, setSaving] = useState(false), [failed, setFailed] = useState(false); const d = m.data; const effective = { ...Object.fromEntries(Object.keys(labels).map(k => [k, k === 'supervise' ? p.role === 'admin' : true])), ...(d.departments.find((x: any) => x.id === dept)?.permissions || {}), ...grants }; return <form className="comm-profile" onSubmit={async (e) => { e.preventDefault(); if (saveLock.current || working || m.busy) return; saveLock.current = true; setSaving(true); setFailed(false); setResult(''); try {
    await m.act('/profiles/' + p.id, 'PATCH', { departmentId: dept, permissions: grants, preferences });
    setResult('Permisos guardados.');
}
catch (e: any) {
    setFailed(true); setResult(e.message);
} finally { saveLock.current = false; setSaving(false); } }}><fieldset className="comm-profile-fields" disabled={saving || working || m.busy}><h3>{p.name}</h3><p>Usuario existente: {p.username}</p><div className="comm-inline"><Avatar person={p}/><label className="comm-upload">{working ? 'Subiendo foto…' : 'Cambiar fotografía'}<input aria-label="Fotografía de perfil" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={working} onChange={async (e) => { const file = e.target.files?.[0]; if (!file)
    return; setWorking(true); try {
    await upload(file, p.id);
    await m.refresh();
    setResult('Fotografía guardada.');
}
catch (e: any) {
    setResult(e.message);
}
finally {
    setWorking(false);
} }}/></label><button type="button" disabled={!p.photoId || working} onClick={() => void m.act(`/profiles/${p.id}/photo`, 'DELETE', {}).catch(() => { })}>Quitar foto</button></div><label>Departamento<select aria-label="Departamento del usuario" value={dept} onChange={e => setDept(e.target.value)}><option value="">Sin asignar</option>{d.departments.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="comm-check"><input type="checkbox" checked={preferences.soundEnabled !== false} onChange={e => setPreferences((p: any) => ({ ...p, soundEnabled: e.target.checked }))}/>Sonidos habilitados para este usuario (los urgentes obligatorios prevalecen)</label><fieldset><legend>Permisos efectivos · marca una excepción individual</legend>{Object.entries(labels).filter(([k]) => k !== 'supervise' || p.role === 'admin').map(([k, label]) => <label className="comm-check" key={k}><input type="checkbox" aria-label={label} checked={Boolean(effective[k])} disabled={p.id === d.user.id && (k === 'access' || k === 'consult')} onChange={e => setGrants((g: any) => ({ ...g, [k]: e.target.checked }))}/>{label}{Object.prototype.hasOwnProperty.call(grants, k) && <small>Excepción individual</small>}</label>)}</fieldset><div className="comm-inline"><button type="button" onClick={() => setGrants({})}>Restablecer herencia del departamento</button><button className="comm-primary" disabled={m.busy || working}>Guardar permisos</button></div><p role={failed ? "alert" : "status"}>{saving ? "Guardando permisos…" : result}</p><small>Solo admin crea y administra grupos. Raskibot no participa. Las cuentas de almacén compartidas acreditan la cuenta, no a una persona.</small></fieldset></form>; }
function DepartmentSettings({ model: m }: {
    model: CommModel;
}) { const d = m.data; const [selected, setSelected] = useState(''), [name, setName] = useState(''), [grants, setGrants] = useState<any>({}), [result, setResult] = useState(''); return <form className="comm-profile" onSubmit={async (e) => { e.preventDefault(); try {
    await m.act('/departments', 'POST', { id: selected || undefined, name, permissions: grants });
    setResult('Departamento guardado.');
}
catch (e: any) {
    setResult(e.message);
} }}><label>Departamento<select aria-label="Editar departamento" value={selected} onChange={e => { setSelected(e.target.value); const x = d.departments.find((p: any) => p.id === e.target.value); setName(x?.name || ''); setGrants(x?.permissions || {}); }}><option value="">Crear departamento</option>{d.departments.map((x: any) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Nombre<input aria-label="Nombre del departamento" required value={name} onChange={e => setName(e.target.value)}/></label><fieldset><legend>Permisos por departamento</legend>{Object.entries(labels).filter(([k]) => k !== 'supervise').map(([k, v]) => <label className="comm-check" key={k}><input type="checkbox" checked={grants[k] !== false} onChange={e => setGrants((g: any) => ({ ...g, [k]: e.target.checked }))}/>{v}</label>)}</fieldset><button className="comm-primary" disabled={m.busy}>Guardar departamento</button><p role="status">{result}</p></form>; }
function SoundSettings({ model: m }: { model: CommModel }) {
    const [cfg,setCfg]=useState<any>(m.data.settings),[result,setResult]=useState(''),[failed,setFailed]=useState(false),[testing,setTesting]=useState('');
    const lock=useRef(false);
    const toggles:Record<string,string>={importantBlocks:'Los importantes bloquean',normalSound:'Sonido normal por defecto',importantSound:'Sonido importante',urgentSound:'Sonido urgente',urgentMandatory:'Timbre urgente obligatorio'};
    return <form className="comm-profile comm-sound-settings" onSubmit={async e=>{
        e.preventDefault();if(lock.current||m.busy)return;lock.current=true;setFailed(false);setResult('');
        try{await m.act('/settings','PATCH',cfg);setResult('Políticas guardadas.');}catch(e:any){setFailed(true);setResult(e.message);}finally{lock.current=false;}
    }}>
        <section className="comm-bell-preview"><div><strong>Timbre metálico</strong><p>Importante: doble toque. Urgente: cuatro golpes largos y repetición hasta atenderlo.</p></div><div className="comm-inline">{['normal','important','urgent'].map(priority=><button type="button" key={priority} disabled={Boolean(testing)} onClick={()=>{
            setTesting(priority);setFailed(false);setResult('');
            void sound(priority).then(()=>setResult('Prueba reproducida: '+priorityName[priority]+'. Si no la oyes, comprueba el volumen, la pestaña y la salida de audio.')).catch(e=>{setFailed(true);setResult(e.message);}).finally(()=>setTesting(''));
        }}><Volume2 size={16}/>Probar {priorityName[priority]}</button>)}</div></section>
        <p className="comm-status">El timbre se habilita con la interacción habitual en el Dashboard y sigue las políticas configuradas. El navegador debe permanecer abierto; la salida y el volumen del equipo determinan que se escuche.</p>
        <fieldset disabled={m.busy} className="comm-policy-fields"><legend>Notificaciones y bloqueo</legend>
            <div className="comm-policy-toggles">{Object.entries(toggles).map(([key,label])=><label key={key} className="comm-check"><input type="checkbox" checked={key==='urgentSound'&&cfg.urgentMandatory?true:cfg[key]} disabled={key==='urgentSound'&&cfg.urgentMandatory} onChange={e=>setCfg((c:any)=>({...c,[key]:e.target.checked}))}/>{label}</label>)}</div>
            <div className="comm-settings-grid">{[['urgentRepeatSeconds','Repetición urgente (segundos)'],['escalateMinutes','Escalado a admin (minutos)']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="1" max="3600" value={cfg[key]} onChange={e=>setCfg((c:any)=>({...c,[key]:Number(e.target.value)}))}/></label>)}</div>
            <details className="comm-advanced-policy"><summary>Confirmaciones, límites y horarios</summary><div className="comm-settings-grid">
                {[['normalRequiredConfirmation','Confirmación mínima para avisos normales'],['importantRequiredConfirmation','Confirmación mínima para importantes']].map(([key,label])=><label key={key}>{label}<select value={cfg[key]} onChange={e=>setCfg((c:any)=>({...c,[key]:e.target.value}))}>{Object.entries(confirmName).map(([value,name])=><option value={value} key={value}>{String(name)}</option>)}</select></label>)}
                {[['imageMaxMB','Tamaño máximo foto (MB)'],['documentMaxMB','Tamaño máximo documento (MB)'],['maxAttachments','Adjuntos máximos por mensaje']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="1" max={key==='maxAttachments'?20:key.includes('MB')?50:3600} value={cfg[key]} onChange={e=>setCfg((c:any)=>({...c,[key]:Number(e.target.value)}))}/></label>)}
                {[['quietStart','Silencio no urgente desde'],['quietEnd','Silencio no urgente hasta']].map(([key,label])=><label key={key}>{label}<input type="time" value={cfg[key]} onChange={e=>setCfg((c:any)=>({...c,[key]:e.target.value}))}/></label>)}
            </div></details>
        </fieldset>
        <div className="comm-policy-save"><button disabled={m.busy} className="comm-primary">{m.busy?'Guardando políticas…':'Guardar políticas'}</button><p role={failed?'alert':'status'}>{result}</p></div>
    </form>;
}
