import { useState, useEffect, useRef, useCallback } from 'react';
import { api, commURL } from './api';
export function useCommunications(user: any) {
    const [data, setData] = useState<any>(null), [error, setError] = useState(''), [denied, setDenied] = useState(false), [online, setOnline] = useState(false);
    const ticket = useRef(0);
    const uid = user?.id;
    const enabled = Boolean(uid) && !/raskibot/i.test(user?.username || '');
    const refresh = useCallback(async () => { if (!enabled)
        return; const id = ++ticket.current; try {
        const d = await api('/bootstrap');
        if (id === ticket.current) {
            setData(d);
            setError('');
            setDenied(false);
            setOnline(true);
        }
    }
    catch (e: any) {
        if (id === ticket.current) {
            setError(e.message);
            setOnline(false);
            if (e.status === 401 || e.status === 403) {
                setDenied(true);
                setData(null);
            }
        }
    } }, [uid, enabled]);
    useEffect(() => { setData(null); setDenied(false); setError(''); setOnline(false); if (!enabled)
        return; void refresh(); const events = new EventSource(commURL('/events'), { withCredentials: true }); let timer: any; const change = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 100); }; events.addEventListener('refresh', change); events.addEventListener('expired', () => { setDenied(true); setData(null); setOnline(false); }); events.onerror = () => setOnline(false); events.onopen = () => { setOnline(true); change(); }; const fallback = setInterval(() => void refresh(), 15000); window.addEventListener('online', change); return () => { ticket.current++; events.close(); clearInterval(fallback); clearTimeout(timer); window.removeEventListener('online', change); }; }, [refresh]);
    const mutationLock = useRef(false);
    const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
    const act = async (path: string, method = 'POST', body?: any) => { if (mutationLock.current)
        throw new Error('Hay una operación en curso'); mutationLock.current = true; setBusy(true); setActionError(''); try {
        const result = await api(path, method, body);
        await refresh();
        return result;
    }
    catch (e: any) {
        setActionError(e.message);
        throw e;
    }
    finally {
        mutationLock.current = false;
        setBusy(false);
    } };
    useEffect(() => { if (!data)
        return; const undelivered = data.inbox.filter((m: any) => m.mine && !m.mine.delivered_at); if (!undelivered.length)
        return; let stop = false; (async () => { for (const m of undelivered) {
        if (stop)
            break;
        try {
            await api(`/messages/${m.id}/receipt`, 'POST', { action: 'delivered' });
        }
        catch {
            break;
        }
    } if (!stop)
        void refresh(); })(); return () => { stop = true; }; }, [data?.version]);
    return { data, error, denied, online, enabled, refresh, act, busy, actionError, setActionError };
}
export type CommModel = ReturnType<typeof useCommunications>;
export { enableAudio, sound } from './audio';
