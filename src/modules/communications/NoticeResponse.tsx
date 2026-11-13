import { useRef, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import type { CommModel } from './useCommunications';

/** A typed operational response and its chosen action are committed together. */
export function NoticeResponse({ message: x, model: m, blocking }: { message: any; model: CommModel; blocking: boolean }) {
    const [body, setBody] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false), [selectedAction, setSelectedAction] = useState('');
    const lock = useRef(false), requestId = useRef(crypto.randomUUID());
    const mine = x.mine;
    const names: Record<string, string> = { confirm: x.confirmation === 'read' ? 'Confirmar lectura' : 'He leído y entendido', help: 'Necesito ayuda', cannot: 'No puedo cumplir', process: 'En proceso', resolve: 'Mi parte está resuelta' };
    const savedAction = mine.resolved_at ? 'resolve' : mine.response || (mine.confirmed_at ? 'confirm' : '');
    const chosen = selectedAction || savedAction;
    const highlighted = ['important', 'urgent'].includes(x.priority);
    const choiceProps = (action: string) => ({ 'aria-pressed': highlighted && chosen === action, className: highlighted && chosen === action ? 'comm-choice-selected' : undefined });
    const disabled = saving || m.busy || !m.online;
    async function respond(action: string) {
        if (lock.current || disabled) return;
        lock.current = true; setSaving(true); setError(''); setSelectedAction(action);
        try {
            await m.act(`/messages/${x.id}/receipt`, 'POST', { action, body: x.isResponseConfirmation ? '' : body, requestId: requestId.current });
            setBody(''); setSelectedAction(''); requestId.current = crypto.randomUUID();
        } catch (e: any) { setError(e.message || 'No se pudo enviar la respuesta. Conservamos tu texto.'); }
        finally { lock.current = false; setSaving(false); }
    }
    if (x.isResponseConfirmation) return mine.confirmed_at ? <p role="status">Respuesta recibida.</p> : <div className="comm-notice-response">
        <p>Confirmación urgente de la respuesta al aviso original. Este acuse no genera otro aviso.</p>
        <button className="comm-primary" disabled={disabled} onClick={() => void respond('confirm')}><CheckCheck size={16}/>He recibido la respuesta</button>
        {saving && <p role="status">Confirmando recepción…</p>}{error && <p role="alert" className="comm-error">{error}</p>}
    </div>;
    return <div className="comm-notice-response">
        {highlighted && chosen && <p className="comm-response-selection" role="status"><CheckCheck size={15}/>{saving ? 'Enviando: ' : error ? 'Selección sin enviar: ' : 'Tu respuesta registrada: '}<strong>{names[chosen]}</strong></p>}
        {!mine.resolved_at && ['important', 'urgent'].includes(x.priority) && <label>Respuesta al aviso (opcional)
            <textarea aria-label="Respuesta al aviso" maxLength={4000} value={body} disabled={disabled} onChange={e => setBody(e.target.value)} placeholder="Escribe tu respuesta y elige uno de los botones…"/>
            <small>El texto se envía junto con la acción elegida. El remitente recibe una confirmación urgente.</small>
        </label>}
        <div className="comm-actions">
            {!mine.confirmed_at && !mine.resolved_at && <button {...choiceProps('confirm')} className={'comm-primary ' + (highlighted && chosen === 'confirm' ? 'comm-choice-selected' : '')} disabled={disabled} onClick={() => void respond('confirm')}><CheckCheck size={16}/>{x.confirmation === 'read' ? 'Confirmar lectura' : 'He leído y entendido'}</button>}
            {!mine.resolved_at && <>
                <button {...choiceProps('help')} disabled={disabled} onClick={() => void respond('help')}>Necesito ayuda</button>
                <button {...choiceProps('cannot')} disabled={disabled} onClick={() => void respond('cannot')}>No puedo cumplir</button>
                {!blocking && (mine.confirmed_at || mine.response) && <>
                    <button {...choiceProps('process')} disabled={disabled} onClick={() => void respond('process')}>En proceso</button>
                    <button {...choiceProps('resolve')} disabled={disabled} onClick={() => void respond('resolve')}>Marcar mi parte resuelta</button>
                </>}
            </>}
        </div>
        {saving && <p role="status">Enviando respuesta…</p>}
        {error && <p role="alert" className="comm-error">{error}</p>}
    </div>;
}
