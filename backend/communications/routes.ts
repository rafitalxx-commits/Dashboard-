import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Communications } from './repository.ts';
import type { Actor } from './types.ts';
import { CommError, check } from './types.ts';
type Auth = {
    getSessionUser: (cookie?: string) => Actor | null | undefined;
    listUsers: () => Actor[];
};
export function registerCommunicationRoutes(server: any, auth: Auth, env: Record<string, string>) {
    const repo = new Communications(env.COMMUNICATIONS_DATA_DIR || join(env.DASHBOARD_DATA_DIR || '.dashboard-data', 'communications'), () => auth.listUsers());
    const send = (res: ServerResponse, status: number, value: any) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(value)); };
    async function body(req: IncomingMessage) { let size = 0; const chunks: Buffer[] = []; for await (const c of req) {
        size += c.length;
        check(size <= 71 * 1024 * 1024, 'Petición demasiado grande', 413);
        chunks.push(c);
    } try {
        return JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }
    catch {
        throw new CommError('JSON inválido');
    } }
    server.middlewares.use('/api/communications', async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const u = auth.getSessionUser(req.headers.cookie);
            check(u, 'Login requerido', 401);
            repo.assert(u);
            const url = new URL(req.url || '/', 'http://local');
            const path = url.pathname.replace(/\/$/, '') || '/';
            const supervision = url.searchParams.get('supervision') === 'true';
            if (!['GET', 'HEAD'].includes(req.method || '')) {
                const origin = req.headers.origin;
                check(origin && new URL(origin).host === req.headers.host && req.headers['sec-fetch-site'] !== 'cross-site', 'Origen no autorizado', 403);
                check(String(req.headers['content-type'] || '').includes('application/json'), 'Se requiere JSON', 415);
            }
            if (req.method === 'GET' && path === '/events') {
                repo.assert(u, 'consult');
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
                res.write('retry: 1500\n\n');
                let last = -1, ticks = 0;
                const tick = () => { try {
                    const current = auth.getSessionUser(req.headers.cookie);
                    if (!current) {
                        res.write('event: expired\ndata: {}\n\n');
                        res.end();
                        clearInterval(timer);
                        return;
                    }
                    repo.assert(current, 'consult');
                    if (++ticks % 10 === 0) {
                        repo.heartbeat(current);
                        repo.escalate();
                    }
                    const version = Number(repo.one("SELECT COALESCE(MAX(seq),0) AS v FROM events WHERE type NOT LIKE 'supervision_%'").v);
                    if (last !== version || ticks % 10 === 0) {
                        res.write(`event: refresh\ndata: ${JSON.stringify({ version })}\n\n`);
                        last = version;
                    }
                }
                catch {
                    res.write('event: expired\ndata: {}\n\n');
                    res.end();
                    clearInterval(timer);
                } };
                const timer = setInterval(tick, 1000);
                tick();
                req.on('close', () => clearInterval(timer));
                return;
            }
            if (req.method === 'GET' && path === '/bootstrap')
                return send(res, 200, repo.bootstrap(u));
            if (req.method === 'GET' && path === '/groups')
                return send(res, 200, { groups: repo.groupsForAdministration(u) });
            const profileGroups = path.match(/^\/profiles\/([^/]+)\/groups$/);
            if (req.method === 'PUT' && profileGroups)
                return send(res, 200, repo.saveUserGroups(u, profileGroups[1], await body(req)));
            if (req.method === 'GET' && path === '/feed')
                return send(res, 200, repo.feed(u, Object.fromEntries(url.searchParams), supervision));
            if (req.method === 'GET' && path === '/conversations')
                return send(res, 200, { conversations: repo.conversations(u, supervision) });
            const history = path.match(/^\/conversations\/([^/]+)\/messages$/);
            if (req.method === 'GET' && history)
                return send(res, 200, repo.history(u, history[1], { before: url.searchParams.get('before') || '', supervision }));
            if (req.method === 'POST' && path === '/conversations')
                return send(res, 201, repo.createConversation(u, await body(req)));
            const group = path.match(/^\/conversations\/([^/]+)$/);
            if (req.method === 'PATCH' && group)
                return send(res, 200, repo.updateConversation(u, group[1], await body(req)));
            const archive = path.match(/^\/conversations\/([^/]+)\/archive$/);
            if (req.method === 'POST' && archive)
                return send(res, 200, repo.archive(u, archive[1], Boolean((await body(req)).archived)));
            const draft = path.match(/^\/conversations\/([^/]+)\/draft$/);
            if (req.method === 'PUT' && draft) {
                const input = await body(req);
                return send(res, 200, repo.draft(u, draft[1], input.body, input.details || {}));
            }
            if (req.method === 'POST' && path === '/messages')
                return send(res, 201, repo.send(u, await body(req)));
            const receipt = path.match(/^\/messages\/([^/]+)\/receipt$/);
            if (req.method === 'POST' && receipt) {
                const input = await body(req);
                return send(res, 200, repo.receipt(u, receipt[1], input.action, input.body ?? '', input.requestId ?? ''));
            }
            const close = path.match(/^\/messages\/([^/]+)\/close$/);
            if (req.method === 'POST' && close)
                return send(res, 200, repo.closeMessage(u, close[1]));
            const detail = path.match(/^\/messages\/([^/]+)$/);
            if (req.method === 'GET' && detail) {
                const m = repo.message(u, detail[1], supervision);
                if (supervision)
                    repo.event(u, 'supervision_message_access', m.id);
                return send(res, 200, { message: repo.render(u, m), events: repo.q('SELECT * FROM events WHERE message_id=? ORDER BY seq', m.id) });
            }
            if (req.method === 'GET' && path === '/admin/files')
                return send(res,200,repo.administrationFiles(u,Object.fromEntries(url.searchParams)));
            const adminFile=path.match(/^\/admin\/files\/([a-z0-9-]+)(\/content)?$/);
            if (adminFile && req.method === 'POST' && !adminFile[2]) {
                const input=await body(req);check(typeof input.deleted==='boolean','Indica si se envía a papelera o se restaura');
                return send(res,200,repo.trashAttachment(u,adminFile[1],input.deleted));
            }
            if (adminFile && req.method === 'GET' && adminFile[2]) {
                const {attachment:a,bytes}=repo.administrationFile(u,adminFile[1]);
                res.writeHead(200,{'Content-Type':a.mime,'Content-Length':bytes.length,'Content-Disposition':`${a.mime.startsWith('image/')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; img-src 'self'"});res.end(bytes);return;
            }
            if (req.method === 'POST' && path === '/files')
                return send(res, 201, repo.upload(u, await body(req)));
            const file = path.match(/^\/files\/([a-z0-9-]+)$/);
            if (req.method === 'GET' && file) {
                const { attachment: a, bytes } = repo.file(u, file[1], supervision);
                res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': bytes.length, 'Content-Disposition': `${a.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'" });
                res.end(bytes);
                return;
            }
            if (req.method === 'POST' && path === '/departments')
                return send(res, 200, repo.saveDepartment(u, await body(req)));
            const profile = path.match(/^\/profiles\/([^/]+)$/);
            if (req.method === 'PATCH' && profile)
                return send(res, 200, repo.saveProfile(u, profile[1], await body(req)));
            if (req.method === 'DELETE' && path.match(/^\/profiles\/([^/]+)\/photo$/))
                return send(res, 200, repo.removePhoto(u, path.split('/')[2]));
            if (req.method === 'PATCH' && path === '/settings')
                return send(res, 200, repo.saveSettings(u, await body(req)));
            if (req.method === 'PATCH' && path === '/preferences')
                return send(res, 200, repo.savePreferences(u, await body(req)));
            if (req.method === 'POST' && path === '/notifications/read') {
                const input = await body(req);
                repo.run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', new Date().toISOString(), input.id, u.id);
                repo.event(u, 'notification_read', null);
                return send(res, 200, { ok: true });
            }
            if (req.method === 'GET' && path === '/audit') {
                repo.supervise(u);
                return send(res, 200, { events: repo.q('SELECT * FROM events ORDER BY seq DESC LIMIT 200') });
            }
            return send(res, 404, { message: 'Ruta de comunicaciones no encontrada' });
        }
        catch (error) {
            send(res, error instanceof CommError ? error.status : 500, { message: error instanceof CommError ? error.message : 'No se pudo completar la operación. Reintenta con el mismo identificador de envío.' });
            if (!(error instanceof CommError))
                console.error('communications', error);
        }
    });
    server.httpServer?.once('close', () => repo.close());
    return repo;
}
