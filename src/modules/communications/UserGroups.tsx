import { useEffect, useRef, useState } from 'react';
import type { CommModel } from './useCommunications';
import { api } from './api';

export function UserGroups({ model: m, userId }: { model: CommModel; userId: string }) {
    const [groups, setGroups] = useState<any[] | null>(null), [selected, setSelected] = useState<string[]>([]);
    const [error, setError] = useState(''), [message, setMessage] = useState(''), [saving, setSaving] = useState(false);
    const lock = useRef(false), dirty = useRef(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let live = true;
        api('/groups').then(result => {
            if (!live) return;
            setGroups(result.groups); setError('');
            if (!dirty.current) setSelected(result.groups.filter((g: any) => g.memberIds.includes(userId)).map((g: any) => g.id));
        }).catch(e => { if (live) setError(e.message); });
        return () => { live = false; };
    }, [userId, retry, m.data?.version]);
    return <form className="comm-user-groups" onSubmit={async e => {
        e.preventDefault(); if (lock.current || m.busy) return;
        lock.current = true; setSaving(true); setError(''); setMessage('');
        try { await m.act('/profiles/' + userId + '/groups', 'PUT', { groupIds: selected }); dirty.current = false; setMessage('Grupos del usuario guardados.'); }
        catch (e: any) { setError(e.message); }
        finally { lock.current = false; setSaving(false); }
    }}>
        <fieldset disabled={saving || m.busy || !groups}><legend>Grupos del usuario</legend>
            <p>Selecciona sus grupos. Las altas no dan acceso al historial anterior; las bajas conservan los avisos individuales pendientes.</p>
            <div className="comm-user-group-list">{groups?.map(g => <label className="comm-check" key={g.id}><input type="checkbox" aria-label={'Grupo: ' + g.name} checked={selected.includes(g.id)} onChange={e => { dirty.current = true; setMessage(''); setSelected(ids => e.target.checked ? [...ids, g.id] : ids.filter(id => id !== g.id)); }}/>{g.name}</label>)}</div>
            {!groups && !error && <p role="status">Cargando grupos…</p>}
            {groups && !groups.length && <p>No hay grupos. Puedes crearlos en Comunicaciones → Grupos.</p>}
            <button className="comm-primary" disabled={!groups || !dirty.current || saving || m.busy}>{saving ? 'Guardando grupos…' : 'Guardar grupos'}</button>
        </fieldset>
        {error && <p role="alert" className="comm-error">{error}<button type="button" onClick={() => setRetry(n => n + 1)}>Reintentar carga</button></p>}
        {message && <p role="status">{message}</p>}
    </form>;
}
