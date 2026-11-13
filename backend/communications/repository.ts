import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync, existsSync, copyFileSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Actor, Grants, Priority, Confirmation } from './types.ts';
import { CommError, check, text, now, defaults, permissionKeys } from './types.ts';
export class Communications {
    db: DatabaseSync;
    dir: string;
    users: () => Actor[];
    constructor(dir: string, users: () => Actor[]) {
        this.dir = dir;
        this.users = users;
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        mkdirSync(join(dir, 'files'), { recursive: true, mode: 0o700 });
        const path = join(dir, 'communications.sqlite');
        const existed = existsSync(path) && statSync(path).size > 0;
        this.db = new DatabaseSync(path);
        chmodSync(path, 0o600);
        if (existed && Number((this.db.prepare('PRAGMA user_version').get() as any).user_version) < 4)
            this.db.exec("VACUUM INTO '" + path.replaceAll("'", "''") + '.pre-migration-' + Date.now() + ".bak'");
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        this.db.exec(`
 CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS departments(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,permissions TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY,department_id TEXT REFERENCES departments(id),photo_id TEXT,permissions TEXT NOT NULL DEFAULT '{}',settings TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,department_id TEXT,responsible_id TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS members(conversation_id TEXT NOT NULL REFERENCES conversations(id),user_id TEXT NOT NULL,joined_at TEXT NOT NULL,left_at TEXT,archived INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id));
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),sender_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,kind TEXT NOT NULL,priority TEXT NOT NULL,confirmation TEXT NOT NULL,blocking INTEGER NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,reference_type TEXT,reference_value TEXT,reply_to TEXT REFERENCES messages(id),rectifies TEXT REFERENCES messages(id),created_at TEXT NOT NULL,UNIQUE(sender_id,request_id));
 CREATE TABLE IF NOT EXISTS recipients(message_id TEXT NOT NULL REFERENCES messages(id),user_id TEXT NOT NULL,delivered_at TEXT,read_at TEXT,confirmed_at TEXT,response TEXT,response_at TEXT,resolved_at TEXT,closed_at TEXT,escalated_at TEXT,PRIMARY KEY(message_id,user_id));
 CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,hash TEXT NOT NULL,message_id TEXT REFERENCES messages(id),profile_for TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attachment_trash(id TEXT PRIMARY KEY REFERENCES attachments(id),deleted_at TEXT NOT NULL,deleted_by TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT,actor_id TEXT NOT NULL,type TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,message_id TEXT,body TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL,unique_key TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS drafts(user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,conversation_id));
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS presence(user_id TEXT PRIMARY KEY,last_seen TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS recipients_user ON recipients(user_id,closed_at,confirmed_at);
 CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);
 CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id,created_at);
 CREATE INDEX IF NOT EXISTS members_user ON members(user_id,left_at);
 CREATE INDEX IF NOT EXISTS events_message ON events(message_id,seq);
 CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
 INSERT OR IGNORE INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 `);
        if (!this.q('PRAGMA table_info(members)').some(c => c.name === 'joined_after'))
            this.db.exec('ALTER TABLE members ADD COLUMN joined_after INTEGER NOT NULL DEFAULT 0');
        if (!this.q('PRAGMA table_info(drafts)').some(c => c.name === 'details'))
            this.db.exec("ALTER TABLE drafts ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
        this.db.exec("PRAGMA user_version=4; INSERT OR IGNORE INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now')); INSERT OR IGNORE INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now')); INSERT OR IGNORE INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));");
        this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(defaults));
        for (const name of ['Almacén', 'Oficina', 'Compras', 'Administración'])
            this.db.prepare('INSERT OR IGNORE INTO departments(id,name) VALUES(?,?)').run(randomUUID(), name);
        // Idempotent departmental groups; membership is configured explicitly by admin.
        const admins=this.users().filter(u=>u.role==='admin'&&this.eligible(u));
        if(admins.length)for(const department of this.q("SELECT * FROM departments WHERE name IN ('Almacén','Oficina','Compras','Administración')")){
            if(this.one("SELECT id FROM conversations WHERE kind='group' AND department_id=?",department.id))continue;
            this.tx(()=>{const id=randomUUID(),at=now();this.run("INSERT INTO conversations VALUES(?,'group',?,?,NULL,'system',?)",id,department.name,department.id,at);for(const admin of admins)this.run('INSERT INTO members(conversation_id,user_id,joined_at,left_at,archived,joined_after) VALUES(?,?,?,NULL,0,0)',id,admin.id,at);this.event({id:'system',username:'system',name:'Sistema',role:'system'},'department_group_seeded',null,{conversationId:id,departmentId:department.id})})
        }
    }
    q(sql: string, ...args: any[]): any[] { return this.db.prepare(sql).all(...args); }
    one(sql: string, ...args: any[]): any { return this.db.prepare(sql).get(...args); }
    run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
    tx<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const r = fn();
        this.db.exec('COMMIT');
        return r;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    close() { this.db.close(); }
    eligible(u: Actor) { return u.active !== false && !/raskibot/i.test(u.username); }
    grants(u: Actor): Grants { const p = this.one('SELECT * FROM profiles WHERE user_id=?', u.id); const dept = p?.department_id ? this.one('SELECT * FROM departments WHERE id=?', p.department_id) : null; const g = Object.fromEntries(permissionKeys.map(k => [k, k === 'supervise' ? u.role === 'admin' : this.eligible(u)])) as Grants; Object.assign(g, JSON.parse(dept?.permissions || '{}'), JSON.parse(p?.permissions || '{}')); if (u.role !== 'admin' || !g.access)
        g.supervise = false; if (!this.eligible(u))
        for (const k of permissionKeys)
            g[k] = false; return g; }
    assert(u: Actor, key: keyof Grants = 'consult') { check(this.eligible(u) && this.grants(u)[key], 'Sin permiso de comunicaciones', 403); }
    admin(u: Actor) { this.assert(u, 'access'); check(u.role === 'admin', 'Solo el administrador puede gestionar comunicaciones', 403); }
    supervise(u: Actor) { this.admin(u); this.assert(u, 'supervise'); }
    settings() { return { ...defaults, ...JSON.parse(this.one('SELECT value FROM settings WHERE id=1').value) }; }
    event(u: Actor, type: string, messageId: string | null, detail: any = {}) { this.run('INSERT INTO events(message_id,actor_id,type,detail,created_at) VALUES(?,?,?,?,?)', messageId, u.id, type, JSON.stringify({...detail,actor:{id:u.id,name:u.name,username:u.username}}), now()); }
    people(u: Actor) { this.assert(u); return this.users().filter(x => this.eligible(x)).map(x => { const p = this.one('SELECT * FROM profiles WHERE user_id=?', x.id); return { id: x.id, name: x.name, username: x.username, role: x.role, active: x.active !== false, departmentId: p?.department_id || null, department: this.one('SELECT name FROM departments WHERE id=?', p?.department_id || '')?.name || 'Sin asignar', photoId: p?.photo_id || null, online: Date.now() - Date.parse(this.one('SELECT last_seen FROM presence WHERE user_id=?', x.id)?.last_seen || '') < 45000, ...(u.role === 'admin' ? { grants: this.grants(x), overrides: JSON.parse(p?.permissions || '{}'), preferences: JSON.parse(p?.settings || '{}') } : {}) }; }); }
    heartbeat(u: Actor) { this.assert(u); this.run('INSERT INTO presence VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen', u.id, now()); }
    member(u: Actor, cid: string) { return this.one('SELECT * FROM members WHERE conversation_id=? AND user_id=?', cid, u.id); }
    canSee(u: Actor, m: any, supervision = false) { if (supervision) {
        this.supervise(u);
        return true;
    } this.assert(u, 'consult'); if(this.one('SELECT kind FROM conversations WHERE id=?',m.conversation_id)?.kind==='private'&&!this.grants(u).privateChat)return false; if (m.sender_id === u.id)
        return true; const member = this.member(u, m.conversation_id); const recipient = this.one('SELECT * FROM recipients WHERE message_id=? AND user_id=?', m.id, u.id); if (member && !member.left_at && Number(this.one('SELECT rowid AS n FROM messages WHERE id=?', m.id)?.n) > member.joined_after)
        return true; return Boolean(m.kind === 'notice' && recipient && !recipient.closed_at && !recipient.resolved_at && (m.confirmation === 'resolution' || m.confirmation !== 'none' && !recipient.confirmed_at || ['help', 'cannot', 'process'].includes(recipient.response))); }
    message(u: Actor, id: string, supervision = false) { const m = this.one('SELECT * FROM messages WHERE id=?', id); check(m, 'Mensaje no encontrado', 404); check(this.canSee(u, m, supervision), 'Sin acceso a este mensaje', 403); return m; }
    render(u: Actor, m: any) { const me = this.one('SELECT * FROM recipients WHERE message_id=? AND user_id=?', m.id, u.id); const recipients = this.q('SELECT * FROM recipients WHERE message_id=?', m.id);const sentEvent=this.one("SELECT detail FROM events WHERE message_id=? AND type IN ('message_sent','rectification_sent','receipt_response_sent') ORDER BY seq LIMIT 1",m.id);const snapshot=JSON.parse(sentEvent?.detail||'{}'); const state = (r: any) => r.closed_at ? 'Cerrado' : r.resolved_at ? 'Resuelto' : r.response === 'help' ? 'Necesita ayuda' : r.response === 'cannot' ? 'No puede cumplir' : r.response === 'process' ? 'En proceso' : r.confirmed_at ? 'Confirmado' : r.read_at ? 'Leído' : r.delivered_at ? 'Pendiente de lectura' : 'Pendiente de entrega'; return { ...m,isResponseConfirmation:Boolean(snapshot.originalMessageId),responseHistory:this.q("SELECT detail,created_at FROM events WHERE message_id=? AND type='receipt_response' ORDER BY seq",m.id).map(e=>({...JSON.parse(e.detail),created_at:e.created_at})),senderProfile:snapshot.sender||null, sequence:Number(this.one('SELECT rowid AS n FROM messages WHERE id=?',m.id).n), attachments: this.q('SELECT a.id,a.name,a.mime,a.size,t.deleted_at FROM attachments a LEFT JOIN attachment_trash t ON t.id=a.id WHERE a.message_id=?', m.id), recipients: recipients.map(r => ({ ...r,profile:snapshot.recipientProfiles?.find((p:any)=>p.id===r.user_id)||null, state: state(r) })), mine: me ? { ...me, state: state(me) } : null, blockingForMe: Boolean(m.blocking && me && !me.confirmed_at && !me.response && !me.resolved_at && !me.closed_at), pendingForMe: Boolean(me && !me.closed_at && !me.resolved_at && (m.confirmation === 'resolution' || ['help', 'cannot', 'process'].includes(me.response) || m.confirmation !== 'none' && !me.confirmed_at)) }; }
    conversations(u: Actor, supervision = false) { this.assert(u, 'consult'); if (supervision)
        this.supervise(u); const rows = supervision ? this.q('SELECT * FROM conversations ORDER BY created_at DESC') : this.q('SELECT c.* FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE m.user_id=? AND m.left_at IS NULL ORDER BY c.created_at DESC', u.id); return rows.filter(c=>c.kind!=='private'||supervision||this.grants(u).privateChat).map(c => { const mem = this.member(u, c.id); const msgs = this.q('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC', c.id).filter(m => this.canSee(u, m, supervision)); const last = msgs[0]; return { ...c, archived: Boolean(mem?.archived), members: this.q('SELECT user_id,joined_at,left_at FROM members WHERE conversation_id=?', c.id), lastMessage: last ? this.render(u, last) : null, unread: msgs.filter(m => m.sender_id !== u.id && !this.one('SELECT read_at FROM recipients WHERE message_id=? AND user_id=?', m.id, u.id)?.read_at).length }; }).sort((a, b) => (b.lastMessage?.created_at || b.created_at).localeCompare(a.lastMessage?.created_at || a.created_at)); }
    createConversation(u: Actor, input: any) {
        this.assert(u, 'participate');
        check(['private', 'group'].includes(input.kind), 'Tipo de conversación inválido');
        if (input.kind === 'group')
            this.admin(u);
        else
            this.assert(u, 'privateChat');
        const ids = [...new Set<string>([u.id, ...(Array.isArray(input.members) ? input.members : [])])];
        check(ids.length >= 2 || input.kind === 'group', 'Selecciona un destinatario');
        check(input.kind !== 'private' || ids.length === 2, 'El chat privado requiere dos usuarios');
        for (const id of ids) {
            const person = this.users().find(x => x.id === id);
            check(person && this.eligible(person) && this.grants(person).consult && this.grants(person).participate, 'Destinatario no autorizado');
            if (input.kind === 'private')
                check(this.grants(person).privateChat, 'El destinatario no admite chats privados');
        }
        if (input.kind === 'private') {
            const existing = this.q("SELECT * FROM conversations WHERE kind='private'").find(c => { const members = this.q('SELECT user_id FROM members WHERE conversation_id=? AND left_at IS NULL', c.id); return members.length === 2 && ids.every(id => members.some(m => m.user_id === id)); });
            if (existing)
                return existing;
        }
        const name = input.kind === 'group' ? text(input.name, 120) : '';
        check(input.kind !== 'group' || name, 'Nombre obligatorio');
        const department = input.departmentId || null;
        if (department)
            check(this.one('SELECT id FROM departments WHERE id=?', department), 'Departamento inexistente');
        const responsible = input.responsibleId || null;
        if (responsible)
            check(ids.includes(responsible), 'El responsable debe ser miembro');
        return this.tx(() => { const c = { id: randomUUID(), kind: input.kind, name, department_id: department, responsible_id: responsible, created_by: u.id, created_at: now() }; this.run('INSERT INTO conversations VALUES(?,?,?,?,?,?,?)', ...Object.values(c)); for (const id of ids)
            this.run('INSERT INTO members(conversation_id,user_id,joined_at,left_at,archived) VALUES(?,?,?,NULL,0)', c.id, id, c.created_at); this.event(u, 'conversation_created', null, { conversationId: c.id, members: ids }); return c; });
    }
    updateConversation(u: Actor, cid: string, input: any) { this.admin(u); const c = this.one('SELECT * FROM conversations WHERE id=?', cid); check(c && c.kind === 'group', 'Grupo no encontrado'); const ids = [...new Set<string>(input.members || this.q('SELECT user_id FROM members WHERE conversation_id=? AND left_at IS NULL', cid).map(x => x.user_id))]; for (const id of ids)
        check(this.users().some(x => x.id === id && this.eligible(x)), 'Miembro inválido'); check(!input.responsibleId || ids.includes(input.responsibleId), 'El responsable debe ser miembro'); return this.tx(() => { const at = now(); const name=input.name===undefined?c.name:text(input.name,120);check(name,'Nombre obligatorio');const department=input.departmentId===undefined?c.department_id:input.departmentId||null;if(department)check(this.one('SELECT id FROM departments WHERE id=?',department),'Departamento inexistente');this.run('UPDATE conversations SET name=?,responsible_id=?,department_id=? WHERE id=?',name,input.responsibleId===undefined?(ids.includes(c.responsible_id)?c.responsible_id:null):input.responsibleId||null,department,cid); const old = this.q('SELECT * FROM members WHERE conversation_id=?', cid); for (const m of old)
        if (!ids.includes(m.user_id) && !m.left_at)
            this.run('UPDATE members SET left_at=? WHERE conversation_id=? AND user_id=?', at, cid, m.user_id); for (const id of ids) {
        const m = old.find(x => x.user_id === id);
        if (!m)
            this.run('INSERT INTO members(conversation_id,user_id,joined_at,left_at,archived,joined_after) VALUES(?,?,?,NULL,0,?)', cid, id, at, this.one('SELECT COALESCE(MAX(rowid),0) AS n FROM messages').n);
        else if (m.left_at)
            this.run('UPDATE members SET joined_at=?,left_at=NULL,archived=0,joined_after=? WHERE conversation_id=? AND user_id=?', at, this.one('SELECT COALESCE(MAX(rowid),0) AS n FROM messages').n, cid, id);
    } this.event(u, 'group_updated', null, { conversationId: cid, members: ids }); return { ok: true }; }); }
    history(u: Actor, cid: string, { before = '', limit = 30, supervision = false }: any = {}) { this.assert(u, 'consult'); if (supervision)
        this.supervise(u); const member = this.member(u, cid); check(supervision || member && !member.left_at, 'Sin acceso a la conversación', 403); const rows = this.q('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC', cid).filter(m => this.canSee(u, m, supervision)); const ix = before ? rows.findIndex(x => x.id === before) + 1 : 0; check(!before || ix > 0, 'Cursor inválido'); const page = rows.slice(ix, ix + Math.min(100, limit)); if (supervision)
        this.event(u, 'supervision_access', null, { conversationId: cid }); const storedDraft=this.one('SELECT body,details FROM drafts WHERE user_id=? AND conversation_id=?',u.id,cid); const draftState=JSON.parse(storedDraft?.details||'{}'); const consumed=Boolean(draftState.requestId&&this.one('SELECT id FROM messages WHERE sender_id=? AND request_id=?',u.id,draftState.requestId)); return { messages: page.reverse().map(m => this.render(u, m)), hasMore: rows.length > ix + page.length, nextBefore: page[0]?.id || null, draft: consumed?'':storedDraft?.body||'', draftState: consumed?{}:draftState }; }
    send(u: Actor, input: any) {
        this.assert(u, 'participate');
        const cid = text(input.conversationId, 100);
        const member = this.member(u, cid);
        check(member && !member.left_at, 'No eres miembro del chat', 403);
        const c = this.one('SELECT * FROM conversations WHERE id=?', cid);
        if (c.kind === 'private')
            this.assert(u, 'privateChat');
        const kind = input.kind === 'notice' ? 'notice' : 'chat';
        const priority: Priority = kind === 'chat' ? 'normal' : input.priority || 'normal';
        check(['normal', 'important', 'urgent'].includes(priority), 'Prioridad inválida');
        this.assert(u, priority === 'urgent' ? 'sendUrgent' : priority === 'important' ? 'sendImportant' : 'sendNormal');
        let confirmation: Confirmation = kind === 'notice' ? (input.confirmation || 'none') : 'none';
        check(['none', 'read', 'understood', 'resolution'].includes(confirmation), 'Confirmación inválida');
        const rank = ['none', 'read', 'understood', 'resolution'];
        const required = priority === 'urgent' || priority === 'important' && this.settings().importantBlocks ? 'understood' : priority === 'important' ? this.settings().importantRequiredConfirmation : this.settings().normalRequiredConfirmation;
        if (kind === 'notice' && rank.indexOf(required) > rank.indexOf(confirmation))
            confirmation = required;
        const policy = priority === 'important' ? this.settings().importantRequiredConfirmation : priority === 'normal' ? this.settings().normalRequiredConfirmation : 'understood';
        if (kind === 'notice' && rank.indexOf(policy) > rank.indexOf(confirmation))
            confirmation = policy;
        const body = text(input.body);
        const subject = text(input.subject || '', 160);
        const files = [...new Set<string>(input.attachments || [])];
        check(body || files.length, 'Mensaje vacío');
        check(files.length <= this.settings().maxAttachments, 'Demasiados adjuntos');
        const referenceType = input.referenceType || null;
        check(!referenceType || ['order', 'product', 'incident'].includes(referenceType), 'Referencia inválida');
        const referenceValue = input.referenceValue ? text(input.referenceValue, 160) : null;
        const reply = input.replyTo || null, rectifies = input.rectifies || null;
        if (reply) {
            const m = this.message(u, reply);
            check(m.conversation_id === cid, 'Respuesta ajena al chat');
        }
        if (rectifies) {
            const m = this.message(u, rectifies);
            check(m.sender_id === u.id && m.conversation_id === cid, 'Solo puedes rectificar tus mensajes');
        }
        const requestId = text(input.requestId, 100);
        check(requestId, 'Falta identificador de envío');
        const payloadHash = createHash('sha256').update(JSON.stringify({ cid, kind, priority, confirmation, body, subject, files, referenceType, referenceValue, reply, rectifies })).digest('hex');
        const existing = this.one('SELECT * FROM messages WHERE sender_id=? AND request_id=?', u.id, requestId);
        if (existing) {
            check(existing.payload_hash === payloadHash, 'El identificador ya se usó para otro contenido', 409);
            return this.render(u, existing);
        }
        return this.tx(() => {
            for (const id of files) {
                const a = this.one('SELECT * FROM attachments WHERE id=?', id);
                check(a && a.owner_id === u.id && !a.message_id && !a.profile_for && !this.one('SELECT id FROM attachment_trash WHERE id=?',id), 'Adjunto no disponible');
                this.assert(u, a.mime.startsWith('image/') ? 'attachPhoto' : 'attachDocument');
            }
            const recipients = this.q('SELECT user_id FROM members WHERE conversation_id=? AND left_at IS NULL AND user_id!=?', cid, u.id).map(x => this.users().find(p => p.id === x.user_id)).filter((p): p is Actor => Boolean(p && this.eligible(p) && this.grants(p).consult));
            check(recipients.length, 'No hay destinatarios activos');
            const id = randomUUID(), at = now();
            this.run('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, cid, u.id, requestId, payloadHash, kind, priority, confirmation, kind === 'notice' && (priority === 'urgent' || priority === 'important' && this.settings().importantBlocks) ? 1 : 0, subject, body, referenceType, referenceValue, reply, rectifies, at);
            for (const p of recipients)
                this.run('INSERT INTO recipients(message_id,user_id) VALUES(?,?)', id, p.id);
            for (const file of files)
                this.run('UPDATE attachments SET message_id=? WHERE id=?', id, file);
            this.run('UPDATE members SET archived=0 WHERE conversation_id=? AND left_at IS NULL', cid);
            this.run('DELETE FROM drafts WHERE user_id=? AND conversation_id=?', u.id, cid);
            this.event(u, rectifies ? 'rectification_sent' : 'message_sent', id, { recipientIds: recipients.map(p => p.id),sender:{id:u.id,name:u.name,username:u.username,department:this.one('SELECT d.name FROM profiles p JOIN departments d ON d.id=p.department_id WHERE p.user_id=?',u.id)?.name||'Sin asignar'},recipientProfiles:recipients.map(p=>({id:p.id,name:p.name,username:p.username})) });
            return this.render(u, this.one('SELECT * FROM messages WHERE id=?', id));
        });
    }
    receipt(u: Actor, id: string, action: string, responseBody = '', requestId = '') {
        this.assert(u);
        const m = this.message(u, id);
        const r = this.one('SELECT * FROM recipients WHERE message_id=? AND user_id=?', id, u.id);
        check(r, 'No eres destinatario', 403);
        check(['delivered', 'read', 'confirm', 'help', 'cannot', 'process', 'resolve'].includes(action), 'Acción inválida');
        const body = text(responseBody, 4000), key = text(requestId, 100);
        const automatic = Boolean(this.one("SELECT seq FROM events WHERE message_id=? AND type='receipt_response_sent'", id));
        const explicit = !['delivered', 'read'].includes(action);
        check(explicit || !body, 'La entrega o lectura automática no admite respuestas');
        check(!automatic || ['delivered', 'read', 'confirm'].includes(action) && !body, 'Esta confirmación solo admite acuse de recibo');
        const respond = explicit && !automatic && m.kind === 'notice' && ['important', 'urgent'].includes(m.priority);
        const hash = createHash('sha256').update(JSON.stringify({ id, action, body })).digest('hex');
        const responseKey = key ? 'receipt:' + id + ':' + key : '';
        if (respond && responseKey) {
            const previous = this.one('SELECT payload_hash FROM messages WHERE sender_id=? AND request_id=?', u.id, responseKey);
            if (previous) { check(previous.payload_hash === hash, 'El identificador ya se usó para otra respuesta', 409); return this.render(u, m); }
        }
        if (respond && !key) {
            const previous = this.one("SELECT detail FROM events WHERE message_id=? AND actor_id=? AND type='receipt_response' ORDER BY seq DESC LIMIT 1", id, u.id);
            const detail = JSON.parse(previous?.detail || '{}');
            if (detail.action === action && detail.body === body) return this.render(u, m);
        }
        if (action === 'delivered' && r.delivered_at || action === 'read' && r.read_at || automatic && action === 'confirm' && r.confirmed_at) return this.render(u, m);
        return this.tx(() => {
            const at = now();
            if (action === 'delivered') this.run('UPDATE recipients SET delivered_at=COALESCE(delivered_at,?) WHERE message_id=? AND user_id=?', at, id, u.id);
            else if (action === 'read') this.run('UPDATE recipients SET delivered_at=COALESCE(delivered_at,?),read_at=COALESCE(read_at,?) WHERE message_id=? AND user_id=?', at, at, id, u.id);
            else {
                check(!r.closed_at, 'Aviso cerrado', 409); check(!r.resolved_at || action === 'resolve', 'El aviso ya está resuelto', 409);
                check(m.kind === 'notice', 'Esta acción corresponde a avisos');
                this.run('UPDATE recipients SET delivered_at=COALESCE(delivered_at,?),read_at=COALESCE(read_at,?) WHERE message_id=? AND user_id=?', at, at, id, u.id);
                if (action === 'confirm') {
                    check(!r.confirmed_at || !r.response, 'Ya respondiste este aviso', 409);
                    this.run('UPDATE recipients SET confirmed_at=COALESCE(confirmed_at,?),response=NULL,response_at=? WHERE message_id=? AND user_id=?', at, at, id, u.id);
                } else if (action === 'resolve') this.run('UPDATE recipients SET resolved_at=COALESCE(resolved_at,?),response=NULL,response_at=? WHERE message_id=? AND user_id=?', at, at, id, u.id);
                else {
                    this.run('UPDATE recipients SET response=?,response_at=? WHERE message_id=? AND user_id=?', action, at, id, u.id);
                    if (['help', 'cannot'].includes(action)) {
                        const targets = new Set([m.sender_id, ...this.users().filter(p => p.role === 'admin' && this.eligible(p) && this.grants(p).access && this.grants(p).supervise).map(p => p.id)]);
                        for (const userId of targets) this.notify(userId, id, `${u.name}: ${action === 'help' ? 'necesita ayuda' : 'no puede cumplir'} · ${m.subject || m.body.slice(0, 80)}`, `response:${id}:${u.id}:${action}:${at}`);
                    }
                }
                if (respond) {
                    // Automatic corporate receipt: one recipient, no dependency on sendUrgent,
                    // and no second receipt notification when this notification is acknowledged.
                    const responseId = randomUUID();
                    const names: Record<string, string> = { confirm: m.confirmation === 'read' ? 'Lectura confirmada' : 'He leído y entendido', help: 'Necesito ayuda', cannot: 'No puedo cumplir la instrucción', process: 'En proceso', resolve: 'Mi parte está resuelta' };
                    const subject = ('Respuesta de ' + u.name + ' · ' + (m.subject || 'Aviso operativo')).slice(0, 160);
                    const originalSender = this.users().find(p => p.id === m.sender_id);
                    const originalSnapshot = JSON.parse(this.one("SELECT detail FROM events WHERE message_id=? AND type IN ('message_sent','rectification_sent') ORDER BY seq LIMIT 1", id)?.detail || '{}');
                    const sender = { id: u.id, name: u.name, username: u.username, department: this.one('SELECT d.name FROM profiles p JOIN departments d ON d.id=p.department_id WHERE p.user_id=?', u.id)?.name || 'Sin asignar' };
                    const recipient = originalSender ? { id: originalSender.id, name: originalSender.name, username: originalSender.username } : originalSnapshot.sender || { id: m.sender_id, name: 'Remitente original' };
                    this.run('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', responseId, m.conversation_id, u.id, responseKey || 'receipt:' + randomUUID(), hash, 'notice', 'urgent', 'read', 1, subject, `${names[action]}${body ? '\n\n' + body : ''}`, m.reference_type, m.reference_value, id, null, at);
                    this.run('INSERT INTO recipients(message_id,user_id) VALUES(?,?)', responseId, m.sender_id);
                    this.run('UPDATE members SET archived=0 WHERE conversation_id=? AND user_id=? AND left_at IS NULL', m.conversation_id, m.sender_id);
                    this.event(u, 'receipt_response_sent', responseId, { originalMessageId: id, action, body, sender, recipientProfiles: [recipient] });
                    this.event(u, 'receipt_response', id, { responseMessageId: responseId, action, body, requestId: key, actor: sender });
                }
            }
            this.event(u, action, id, body ? { body } : {});
            return this.render(u, this.one('SELECT * FROM messages WHERE id=?', id));
        });
    }
    closeMessage(u: Actor, id: string) { this.assert(u); const m = this.one('SELECT * FROM messages WHERE id=?', id); check(m, 'Mensaje no encontrado', 404); check(m.sender_id === u.id || u.role === 'admin', 'Solo el remitente o administrador puede cerrar', 403); const recipients = this.q('SELECT * FROM recipients WHERE message_id=?', id); check(recipients.every(r => r.resolved_at || m.confirmation === 'none' || (m.confirmation !== 'resolution' && r.confirmed_at && !['help', 'cannot', 'process'].includes(r.response))), 'Faltan destinatarios por confirmar o resolver', 409); this.run('UPDATE recipients SET closed_at=COALESCE(closed_at,?) WHERE message_id=?', now(), id); this.event(u, 'closed', id); return { ok: true }; }
    notify(uid: string, id: string, body: string, key: string) { this.run('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,NULL,?,?)', randomUUID(), uid, id, body, now(), key + ':' + uid); }
    escalate() { const threshold = new Date(Date.now() - this.settings().escalateMinutes * 60000).toISOString(); const rows = this.q("SELECT r.*,m.subject,m.body,m.sender_id FROM recipients r JOIN messages m ON m.id=r.message_id WHERE m.priority='urgent' AND m.created_at<=? AND r.confirmed_at IS NULL AND r.response IS NULL AND r.resolved_at IS NULL AND r.closed_at IS NULL AND r.escalated_at IS NULL AND NOT EXISTS(SELECT 1 FROM events e WHERE e.message_id=m.id AND e.type='receipt_response_sent')", threshold); for (const r of rows) {
        this.tx(() => { for (const a of this.users().filter(p => p.role === 'admin' && this.eligible(p) && this.grants(p).access && this.grants(p).supervise))
            this.notify(a.id, r.message_id, `Urgente sin confirmar · ${r.subject || r.body.slice(0, 80)}`, `escalation:${r.message_id}:${r.user_id}:${a.id}`); this.run('UPDATE recipients SET escalated_at=? WHERE message_id=? AND user_id=?', now(), r.message_id, r.user_id); });
    } }
    inbox(u: Actor) { this.assert(u, 'consult'); const rows = this.q('SELECT m.* FROM messages m JOIN recipients r ON r.message_id=m.id WHERE r.user_id=? ORDER BY m.created_at DESC,m.rowid DESC', u.id).filter(m => this.canSee(u, m)); return rows.map(m => this.render(u, m)); }
    bootstrap(u: Actor) { this.assert(u); this.heartbeat(u); this.escalate(); const inbox = this.inbox(u); return { user: u, grants: this.grants(u), people: this.people(u), departments: this.q('SELECT * FROM departments').map(d => ({ ...d, permissions: JSON.parse(d.permissions) })), settings: this.settings(), preferences: JSON.parse(this.one('SELECT settings FROM profiles WHERE user_id=?', u.id)?.settings || '{}'), conversations: this.conversations(u), inbox, notifications: this.q('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100', u.id).filter(n=>{if(!n.message_id)return true;const m=this.one('SELECT * FROM messages WHERE id=?',n.message_id);return m&&(this.canSee(u,m)||u.role==='admin'&&this.grants(u).supervise)}), blockers: inbox.filter(m => m.blockingForMe).sort((a, b) => (a.priority === 'urgent' ? -1 : 0) - (b.priority === 'urgent' ? -1 : 0) || a.created_at.localeCompare(b.created_at) || a.sequence-b.sequence), version: this.one("SELECT COALESCE(MAX(seq),0) AS v FROM events WHERE type NOT LIKE 'supervision_%'").v }; }
    visibility(u: Actor) { return { sql: `(m.sender_id=? OR EXISTS(SELECT 1 FROM members cm WHERE cm.conversation_id=m.conversation_id AND cm.user_id=? AND cm.left_at IS NULL AND m.rowid>cm.joined_after) OR (m.kind='notice' AND EXISTS(SELECT 1 FROM recipients cr WHERE cr.message_id=m.id AND cr.user_id=? AND cr.closed_at IS NULL AND cr.resolved_at IS NULL AND (m.confirmation='resolution' OR (m.confirmation!='none' AND cr.confirmed_at IS NULL) OR cr.response IN ('help','cannot','process')))))`, args: [u.id, u.id, u.id] }; }
    feed(u: Actor, input: any = {}, supervision = false) { this.assert(u, 'access'); this.assert(u, 'consult'); if (supervision)
        this.supervise(u); const visible = this.visibility(u);if(!this.grants(u).privateChat)visible.sql='('+visible.sql+") AND m.conversation_id IN (SELECT id FROM conversations WHERE kind!='private')"; let clauses = supervision ? ['1=1'] : [visible.sql]; const args: any[] = supervision ? [] : [...visible.args]; const add = (sql: string, ...values: any[]) => { clauses.push(sql); args.push(...values); }; const query = String(input.query || '').trim(); if (query)
        add('(m.body LIKE ? OR m.subject LIKE ? OR m.reference_value LIKE ?)', '%' + query + '%', '%' + query + '%', '%' + query + '%'); if (input.userId)
        add('(m.sender_id=? OR EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.user_id=?))', input.userId, input.userId); if (input.departmentId)
        add('(m.sender_id IN (SELECT user_id FROM profiles WHERE department_id=?) OR EXISTS(SELECT 1 FROM recipients r JOIN profiles p ON p.user_id=r.user_id WHERE r.message_id=m.id AND p.department_id=?))', input.departmentId, input.departmentId); if (input.conversationId)
        add('m.conversation_id=?', input.conversationId); if (input.from)
        add('m.created_at>=?', input.from); if (input.to)
        add('substr(m.created_at,1,10)<=?', input.to); if (input.priority)
        add('m.priority=?', input.priority); if (input.state)
        add(`EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND CASE WHEN r.closed_at IS NOT NULL THEN 'Cerrado' WHEN r.resolved_at IS NOT NULL THEN 'Resuelto' WHEN r.response='help' THEN 'Necesita ayuda' WHEN r.response='cannot' THEN 'No puede cumplir' WHEN r.response='process' THEN 'En proceso' WHEN r.confirmed_at IS NOT NULL THEN 'Confirmado' WHEN r.read_at IS NOT NULL THEN 'Leído' WHEN r.delivered_at IS NOT NULL THEN 'Pendiente de lectura' ELSE 'Pendiente de entrega' END=?)`, input.state); if (input.scope === 'sent')
        add('m.sender_id=?', u.id);
    else if (input.scope === 'received')
        add('EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.user_id=?)', u.id);
    else if (input.scope === 'pending')
        add(`(EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.user_id=? AND r.closed_at IS NULL AND r.resolved_at IS NULL AND (m.confirmation='resolution' OR r.response IN ('help','cannot','process') OR (m.confirmation!='none' AND r.confirmed_at IS NULL))) OR (m.sender_id=? AND m.kind='notice' AND EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.closed_at IS NULL)))`, u.id, u.id);
    else if (input.scope === 'important')
        add("m.priority='important'");
    else if (input.scope === 'urgent')
        add("m.priority='urgent'"); const where = clauses.join(' AND '); const offset = Math.max(0, Math.trunc(Number(input.offset) || 0)); const total = Number(this.one('SELECT count(*) AS n FROM messages m WHERE ' + where, ...args).n); const rows = this.q('SELECT m.* FROM messages m WHERE ' + where + ' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 30 OFFSET ?', ...args, offset); if (supervision)
        this.event(u, 'supervision_search', null, { query, filters: input }); return { messages: rows.map(m => this.render(u, m)), total, offset, hasMore: total > offset + 30 }; }
    groupsForAdministration(u: Actor) {
        this.admin(u);
        return this.q("SELECT id,name,department_id,responsible_id FROM conversations WHERE kind='group' ORDER BY name").map(g => ({ ...g, memberIds: this.q('SELECT user_id FROM members WHERE conversation_id=? AND left_at IS NULL', g.id).map(m => m.user_id) }));
    }
    saveUserGroups(u: Actor, id: string, input: any) {
        this.admin(u);
        check(this.users().some(p => p.id === id && this.eligible(p)), 'Usuario no disponible');
        check(Array.isArray(input.groupIds) && input.groupIds.length <= 200 && input.groupIds.every((g: any) => typeof g === 'string'), 'Grupos inválidos');
        const ids = [...new Set<string>(input.groupIds)];
        const groups = this.q("SELECT id FROM conversations WHERE kind='group'");
        check(ids.every(cid => groups.some(g => g.id === cid)), 'Grupo inexistente');
        return this.tx(() => {
            const at = now(), boundary = this.one('SELECT COALESCE(MAX(rowid),0) AS n FROM messages').n;
            const previous = this.q("SELECT m.conversation_id FROM members m JOIN conversations c ON c.id=m.conversation_id WHERE m.user_id=? AND m.left_at IS NULL AND c.kind='group'", id).map(m => m.conversation_id);
            for (const group of groups) {
                const member = this.one('SELECT * FROM members WHERE conversation_id=? AND user_id=?', group.id, id);
                if (ids.includes(group.id) && !member) this.run('INSERT INTO members(conversation_id,user_id,joined_at,left_at,archived,joined_after) VALUES(?,?,?,NULL,0,?)', group.id, id, at, boundary);
                else if (ids.includes(group.id) && member.left_at) this.run('UPDATE members SET joined_at=?,left_at=NULL,archived=0,joined_after=? WHERE conversation_id=? AND user_id=?', at, boundary, group.id, id);
                else if (!ids.includes(group.id) && member && !member.left_at) {
                    this.run('UPDATE members SET left_at=? WHERE conversation_id=? AND user_id=?', at, group.id, id);
                    this.run('UPDATE conversations SET responsible_id=NULL WHERE id=? AND responsible_id=?', group.id, id);
                }
            }
            this.event(u, 'group_memberships_profile_changed', null, { userId: id, previousGroupIds: previous, groupIds: ids });
            return { ok: true, groupIds: ids };
        });
    }
    saveProfile(u: Actor, id: string, input: any) { this.admin(u); if (id === u.id)
        check(input.permissions?.access !== false && input.permissions?.consult !== false, 'No puedes retirar tu propio acceso de administración'); const person = this.users().find(p => p.id === id); check(person && this.eligible(person), 'Usuario no disponible'); if (input.departmentId)
        check(this.one('SELECT id FROM departments WHERE id=?', input.departmentId), 'Departamento inexistente'); const grants = input.permissions || {}; for (const [k, v] of Object.entries(grants))
        check(permissionKeys.includes(k as any) && typeof v === 'boolean', 'Permiso inválido'); const old = this.one('SELECT * FROM profiles WHERE user_id=?', id); this.run('INSERT INTO profiles VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET department_id=excluded.department_id,permissions=excluded.permissions', id, input.departmentId === undefined ? old?.department_id || null : input.departmentId || null, old?.photo_id || null, JSON.stringify(grants), input.preferences ? JSON.stringify({ normalSound: Boolean(input.preferences.normalSound), soundEnabled: input.preferences.soundEnabled !== false }) : old?.settings || '{}'); if (input.preferences)
        this.run('UPDATE profiles SET settings=? WHERE user_id=?', JSON.stringify({ normalSound: Boolean(input.preferences.normalSound), soundEnabled: input.preferences.soundEnabled !== false }), id); this.event(u, 'permissions_profile_changed', null, { userId: id, departmentId: input.departmentId, permissions: grants }); return { ok: true }; }
    saveDepartment(u: Actor, input: any) { this.admin(u); const name = text(input.name, 100); check(name, 'Nombre obligatorio'); const id = input.id || randomUUID(); check(!this.one('SELECT id FROM departments WHERE name=? AND id!=?',name,id),'Ya existe un departamento con ese nombre',409); for (const [k, v] of Object.entries(input.permissions || {}))
        check(permissionKeys.includes(k as any) && typeof v === 'boolean', 'Permiso inválido'); this.run('INSERT INTO departments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions', id, name, JSON.stringify(input.permissions || {})); this.event(u, 'department_changed', null, { id, name }); return { id }; }
    saveSettings(u: Actor, input: any) { this.admin(u); const s = { ...this.settings(), ...input }; for (const k of ['urgentRepeatSeconds', 'escalateMinutes', 'imageMaxMB', 'documentMaxMB', 'maxAttachments', 'snoozeMinutes'])
        check(Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= (k === 'maxAttachments' ? 20 : k.includes('MB') ? 50 : 3600), 'Valor de configuración inválido'); for (const k of ['importantBlocks', 'normalSound', 'importantSound', 'urgentSound', 'urgentMandatory', 'allowUrgentSnooze'])
        check(typeof s[k] === 'boolean', 'Configuración inválida'); for (const k of ['normalRequiredConfirmation', 'importantRequiredConfirmation'])
        check(['none', 'read', 'understood', 'resolution'].includes(s[k]), 'Confirmación obligatoria inválida'); for (const k of ['quietStart', 'quietEnd'])
        check(s[k] === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s[k]), 'Horario inválido'); check(Boolean(s.quietStart) === Boolean(s.quietEnd), 'Completa ambos horarios'); this.run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(s)); this.event(u, 'settings_changed', null, s); return s; }
    savePreferences(u: Actor, input: any) { this.assert(u); const old = this.one('SELECT * FROM profiles WHERE user_id=?', u.id); const prefs = { normalSound: Boolean(input.normalSound), soundEnabled: input.soundEnabled !== false }; this.run('INSERT INTO profiles VALUES(?,NULL,NULL,?,?) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings', u.id, '{}', JSON.stringify(prefs)); this.event(u, 'preferences_changed', null); return prefs; }
    archive(u: Actor, cid: string, value: boolean) { this.assert(u); check(this.member(u, cid), 'Conversación no encontrada', 404); this.run('UPDATE members SET archived=? WHERE conversation_id=? AND user_id=?', value ? 1 : 0, cid, u.id); this.event(u, 'archive_changed', null, { conversationId: cid, archived: value }); return { ok: true }; }
    draft(u: Actor, cid: string, body: string, details: any = {}) { this.assert(u); const m = this.member(u, cid); check(m && !m.left_at, 'Sin acceso', 403); check(JSON.stringify(details).length < 12000, 'Borrador demasiado grande'); if(details.requestId&&this.one('SELECT id FROM messages WHERE sender_id=? AND request_id=?',u.id,details.requestId))return{ok:true,alreadySent:true}; this.run('INSERT INTO drafts(user_id,conversation_id,body,updated_at,details) VALUES(?,?,?,?,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at,details=excluded.details', u.id, cid, text(body), now(), JSON.stringify(details)); return { ok: true }; }
    upload(u: Actor, input: {
        name: string;
        data: string;
        profileFor?: string;
    }) { this.assert(u); const name = text(input.name, 160).replace(/[\x00-\x1f/\\]/g, '_'); const ext = name.split('.').pop()?.toLowerCase(); const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', csv: 'text/csv' }; check(ext && types[ext], 'Formato no autorizado'); const mime = types[ext]; if (input.profileFor)
        this.admin(u);
    else
        this.assert(u, mime.startsWith('image/') ? 'attachPhoto' : 'attachDocument'); check(typeof input.data === 'string' && /^[a-zA-Z0-9+/]*={0,2}$/.test(input.data), 'Contenido inválido'); const bytes = Buffer.from(input.data, 'base64'); check(bytes.length > 0 && bytes.length <= (mime.startsWith('image/') ? this.settings().imageMaxMB : this.settings().documentMaxMB) * 1024 * 1024, 'Tamaño de archivo no permitido'); const start = bytes.subarray(0, 16); if (ext === 'jpg' || ext === 'jpeg')
        check(start[0] === 255 && start[1] === 216 && start[2] === 255, 'JPEG inválido'); if (ext === 'png')
        check(start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'PNG inválido'); if (ext === 'webp')
        check(start.toString('ascii', 0, 4) === 'RIFF' && start.toString('ascii', 8, 12) === 'WEBP', 'WEBP inválido'); if (ext === 'pdf')
        check(start.toString('ascii', 0, 5) === '%PDF-', 'PDF inválido'); if (ext === 'docx' || ext === 'xlsx') {
        check(start[0] === 80 && start[1] === 75, 'Documento Office inválido');
        check(bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from(ext === 'docx' ? 'word/' : 'xl/')) && !bytes.includes(Buffer.from('vbaProject.bin')), 'Documento Office no autorizado');
    } if (['txt', 'csv'].includes(ext))
        check(!bytes.includes(0), 'Archivo de texto inválido'); if (input.profileFor)
        check(mime.startsWith('image/') && this.users().some(p => p.id === input.profileFor && this.eligible(p)), 'Perfil inválido'); const id = randomUUID(), path = join(this.dir, 'files', id); writeFileSync(path + '.tmp', bytes, { mode: 0o600 }); renameSync(path + '.tmp', path); this.tx(() => { this.run('INSERT INTO attachments VALUES(?,?,?,?,?,?,NULL,?,?)', id, u.id, name, mime, bytes.length, createHash('sha256').update(bytes).digest('hex'), input.profileFor || null, now()); if (input.profileFor) {
        this.run("INSERT INTO profiles(user_id,photo_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET photo_id=excluded.photo_id", input.profileFor, id);
        this.event(u, 'profile_photo_changed', null, { userId: input.profileFor });
    } }); return { id, name, mime, size: bytes.length }; }
    file(u: Actor, id: string, supervision = false) { this.assert(u); const a = this.one('SELECT * FROM attachments WHERE id=?', id); check(a, 'Archivo no encontrado', 404); if (a.profile_for) {
        check(this.users().some(p => p.id === a.profile_for && this.eligible(p)), 'Perfil no disponible', 404);
    }
    else if (a.message_id)
        this.message(u, a.message_id, supervision);
    else
        check(a.owner_id === u.id, 'Sin acceso al archivo', 403); if (supervision) {
        this.supervise(u);
        this.event(u, 'supervision_file_access', a.message_id, { fileId: id });
    } check(!this.one('SELECT id FROM attachment_trash WHERE id=?',id),'Archivo retirado por administración',410); return { attachment: a, bytes: readFileSync(join(this.dir, 'files', a.id)) }; }
    administrationAttachment(u: Actor, id: string) {
        this.supervise(u);
        const a=this.one('SELECT a.* FROM attachments a WHERE a.id=? AND a.profile_for IS NULL AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.photo_id=a.id)',id);
        check(a,'Adjunto de mensaje no encontrado',404); return a;
    }
    administrationFiles(u: Actor, input: any = {}) {
        this.supervise(u);
        const query=text(input.query??'',160),offset=Math.max(0,Math.trunc(Number(input.offset)||0)),deleted=input.deleted==='true';
        const where="a.profile_for IS NULL AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.photo_id=a.id) AND t.id IS "+(deleted?'NOT NULL':'NULL')+" AND (a.name LIKE ? OR a.owner_id LIKE ?)";
        const args=['%'+query+'%','%'+query+'%'];
        const total=Number(this.one('SELECT COUNT(*) AS n FROM attachments a LEFT JOIN attachment_trash t ON t.id=a.id WHERE '+where,...args).n);
        const files=this.q('SELECT a.*,t.deleted_at,t.deleted_by,m.subject AS message_subject FROM attachments a LEFT JOIN attachment_trash t ON t.id=a.id LEFT JOIN messages m ON m.id=a.message_id WHERE '+where+' ORDER BY a.created_at DESC,a.rowid DESC LIMIT 30 OFFSET ?',...args,offset).map(a=>({...a,uploader:this.users().find(p=>p.id===a.owner_id)?.name||a.owner_id}));
        this.event(u,'supervision_files_list',null,{query,deleted,offset});
        return {files,total,offset,hasMore:offset+files.length<total,folder:'Comunicaciones / Adjuntos'};
    }
    administrationFile(u: Actor,id: string) {
        const a=this.administrationAttachment(u,id);
        check(!this.one('SELECT id FROM attachment_trash WHERE id=?',id),'Archivo en la papelera',410);
        this.event(u,'supervision_file_access',a.message_id,{fileId:id});
        return {attachment:a,bytes:readFileSync(join(this.dir,'files',id))};
    }
    trashAttachment(u: Actor,id: string,deleted: boolean) {
        const a=this.administrationAttachment(u,id);
        return this.tx(()=>{
            const old=this.one('SELECT id FROM attachment_trash WHERE id=?',id);
            if(Boolean(old)===deleted)return {ok:true,deleted};
            if(deleted)this.run('INSERT INTO attachment_trash VALUES(?,?,?)',id,now(),u.id);
            else this.run('DELETE FROM attachment_trash WHERE id=?',id);
            this.event(u,deleted?'attachment_trashed':'attachment_restored',a.message_id,{fileId:id,name:a.name});
            return {ok:true,deleted};
        });
    }
    removePhoto(u: Actor, id: string) { this.admin(u); this.run('UPDATE profiles SET photo_id=NULL WHERE user_id=?', id); this.event(u, 'profile_photo_removed', null, { userId: id }); return { ok: true }; }
}
