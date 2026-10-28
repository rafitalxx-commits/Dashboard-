import {createHash} from 'node:crypto';
import {automationContactCreate,assertInternalAutomationNote} from './automationAuthor.ts';
import {existsSync,mkdirSync,writeFileSync,unlinkSync,renameSync} from 'node:fs';
import {demoWorkflowWritable,TEST_TARGET} from './odooRuntime.ts';
/** Dedicated connection: never inherits the Dashboard production credentials. */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
export type DemoTarget = { url: string; database: 'odoo-todoelectrico18-demo-01'; username: string; apiKey: string };
type Env = Record<string, string | undefined>;
function testCredentials(env: Env): { username: string; apiKey: string } {
 // systemd supplies a private read-only directory. Never copy credentials to env.
 // A configured directory is authoritative: fail closed rather than use stale env.
 const directory = env.CREDENTIALS_DIRECTORY;
 if (directory !== undefined) {
  try {
   if (!isAbsolute(directory)) throw Error();
   const read = (name: string) => {
    const value = readFileSync(join(directory, name), 'utf8');
    if (!value.trim() || value.length > 16384 || value.includes('\0')) throw Error();
    return value.trim();
   };
   return { username: read('incidents-odoo-test-user'), apiKey: read('incidents-odoo-test-key') };
  } catch { throw Error('Credenciales systemd de Odoo TEST ausentes o inválidas'); }
 }
 return { username: env.INCIDENTS_ODOO_USERNAME?.trim() || '', apiKey: env.INCIDENTS_ODOO_API_KEY?.trim() || '' };
}
export function demoTarget(env: Env): DemoTarget {
 const database = env.INCIDENTS_ODOO_DATABASE?.trim();
 if (database !== 'odoo-todoelectrico18-demo-01') throw Error('Configura la base TEST odoo-todoelectrico18-demo-01; producción no está permitida');
 const raw = env.INCIDENTS_ODOO_URL?.trim();
 if (!raw) throw Error('Falta la URL exclusiva de Odoo demo');
 let url: URL;
 try { url = new URL(raw); } catch { throw Error('URL de Odoo demo inválida'); }
 if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '')) {
  throw Error('Odoo demo requiere un origen HTTPS sin credenciales, ruta ni parámetros');
 }
 if (url.origin !== 'https://demo-todoelectrico.odoo.rgbconsulting.com') throw Error('Solo se permite el origen TEST confirmado');
 const { username, apiKey } = testCredentials(env);
 if (!username || !apiKey) throw Error('Faltan credenciales exclusivas para Odoo demo');
 return Object.freeze({ url: url.origin, database, username, apiKey });
}

const models = new Set(['res.partner', 'res.country', 'res.users', 'res.company', 'stock.location', 'stock.warehouse', 'stock.picking.type', 'stock.picking', 'stock.scrap', 'stock.move', 'stock.move.line', 'stock.return.picking', 'stock.return.picking.line', 'product.product', 'sale.order', 'sale.order.line', 'mrp.bom', 'mrp.bom.line', 'crm.team', 'stock.quant', 'uom.uom', 'stock.backorder.confirmation', 'stock.backorder.confirmation.line', 'mail.message']);
const methods = new Set(['read', 'search_read', 'fields_get', 'check_access_rights', 'read_group', 'search_count']);
export class OdooDemoReader {
 private isolationQueue:Promise<unknown>=Promise.resolve();
 private isolationActive=false;
 private uid?: number;
 private readonly target: DemoTarget;
 constructor(private env: Env, private readonly transport: typeof fetch = fetch) { this.target = demoTarget(env); }
 private async rpc(service: string, method: string, args: unknown[]): Promise<any> {
  let response!: Response;
  const readOnly=service==='common'&&method==='authenticate'||service==='object'&&method==='execute_kw'&&methods.has(String(args[4]));
  for(let attempt=0;attempt<(readOnly?3:1);attempt++){
  try {
   response = await this.transport(`${this.target.url}/jsonrpc`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: crypto.randomUUID(), params: { service, method, args } }),
   });
  } catch { if(readOnly&&attempt<2)continue;throw Error('No se pudo conectar con Odoo demo; revisa URL y acceso'); }
  if(readOnly&&[502,503,504].includes(response.status)&&attempt<2)continue;
  break;
  }
  if (!response.ok) throw Error(`Odoo demo devolvió HTTP ${response.status}`);
  let data: any;
  try { data = await response.json(); } catch { throw Error('Odoo demo no devolvió JSON válido'); }
  // Odoo error debug/data may contain credentials or customer data: never echo it.
  if (data.error || !Object.hasOwn(data, 'result')) throw Error('Odoo demo rechazó la consulta; revisa base, permisos y credenciales');
  return data.result;
 }
 async read(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<any> {
  if (!models.has(model) || !methods.has(method)) throw Error('El diagnóstico demo solo permite consultas de lectura');
  if (!this.uid) {
   const uid = await this.rpc('common', 'authenticate', [this.target.database, this.target.username, this.target.apiKey, {}]);
   if (!Number.isInteger(uid) || uid <= 0) throw Error('Autenticación rechazada en Odoo demo');
   this.uid = uid;
  }
  return this.rpc('object', 'execute_kw', [this.target.database, this.uid, this.target.apiKey, model, method, args, kwargs]);
 }
 async controlledWrite(model:string,method:string,args:unknown[],kwargs:Record<string,unknown>={}) {
  if(!demoWorkflowWritable(this.env,TEST_TARGET)&&(this.env.INCIDENTS_ODOO_WRITE_ENABLED!=='true'||!this.env.INCIDENTS_ODOO_APPROVED_DIGEST||!this.env.INCIDENTS_ODOO_APPROVED_OPERATION))throw Error('Escritura TEST bloqueada');
  if(demoWorkflowWritable(this.env,TEST_TARGET)&&!this.isolationActive)throw Error('DEMO requiere aislamiento transaccional de comunicaciones');
  const labelTrackingWrite=model==='stock.picking'&&method==='write'&&args.length===2&&Object.keys((args[1]||{}) as object).length===1&&Object.hasOwn((args[1]||{}) as object,'carrier_tracking_ref');
  const scrapWrite=model==='stock.scrap'&&['create','action_validate'].includes(method)&&this.env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED==='true';
  const backorder=model==='stock.backorder.confirmation'&&['create','process'].includes(method)&&this.isolationActive;
  const standardReturn=model==='stock.return.picking'&&['create','write','action_create_returns'].includes(method)&&this.isolationActive&&this.env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED==='true';
  const returnOriginWrite=model==='stock.picking'&&method==='write'&&args.length===2&&Object.keys((args[1]||{}) as object).join(',')==='origin'&&typeof (args[1] as any)?.origin==='string'&&/^INC-\d{4}-\d{5,}:return:DEV-\d{4}-\d{5,}$/.test(String((args[1] as any).origin))&&this.isolationActive&&this.env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED==='true';
  const internalNote=['stock.picking','stock.scrap'].includes(model)&&method==='message_post'&&kwargs.subtype_xmlid==='mail.mt_note'&&Array.isArray(kwargs.partner_ids)&&kwargs.partner_ids.length===0;
  if(internalNote)await assertInternalAutomationNote(this.read.bind(this),kwargs);
  if(!automationContactCreate(model,method,args)&&!internalNote&&!backorder&&!standardReturn&&!returnOriginWrite&&!((model==='stock.picking'&&['create','action_confirm','action_assign','button_validate'].includes(method))||labelTrackingWrite||(model==='stock.move'&&method==='write')||scrapWrite))throw Error('Operación TEST no permitida');
  if(!this.uid)await this.read('res.users','read',[[8]],{fields:['id']});
  return this.rpc('object','execute_kw',[this.target.database,this.uid,this.target.apiKey,model,method,args,kwargs]);
 }
 /** SMTP is trapped only during this serialized DEMO transaction and restored exactly. */
 async isolated<T>(scope:string,task:()=>Promise<T>):Promise<T>{
  if(!demoWorkflowWritable(this.env,TEST_TARGET))return task();
  const work=this.isolationQueue.then(async()=>{
   if(!/^INC-\d{4}-\d{5,}:(return:DEV-\d{4}-\d{5,}|reshipment|[^\s]+)$/.test(scope))throw Error('Operación DEMO sin referencia estable');
   const file=join(this.env.DASHBOARD_DATA_DIR||'.dashboard-data','incidents-smtp-isolation-pending.json');

   await this.read('res.company','search_read',[[]],{fields:['id'],limit:1});
   const read=async(model:string,domain:unknown[],fields:string[],limit=250)=>this.rpc('object','execute_kw',[this.target.database,this.uid,this.target.apiKey,model,'search_read',[domain],{fields,limit}]);
   const maintain=async(model:string,id:number,values:object)=>this.rpc('object','execute_kw',[this.target.database,this.uid,this.target.apiKey,model,'write',[[id],values],{context:{tracking_disable:true,mail_notify_force_send:false}}]);
   const restore=async(snapshot:{scope:string;servers:Array<{id:number;smtp_host:string;smtp_port:number}>})=>{
    if(!/^INC-\d{4}-\d{5,}:[^\s]+$/.test(snapshot.scope)||!Array.isArray(snapshot.servers)||snapshot.servers.length>=100||new Set(snapshot.servers.map(s=>s.id)).size!==snapshot.servers.length||snapshot.servers.some(s=>!Number.isInteger(s.id)||s.id<=0||typeof s.smtp_host!=='string'||!s.smtp_host||!Number.isInteger(s.smtp_port)||s.smtp_port<=0||s.smtp_port>65535))throw Error('Diario de aislamiento SMTP inválido; no restaurar automáticamente');
    const current=await read('ir.mail_server',[['id','in',snapshot.servers.map(s=>s.id)]],['id','smtp_host','smtp_port'],100);
    for(const previous of snapshot.servers){const now=current.find((s:any)=>s.id===previous.id);if(!now||!(now.smtp_host==='127.0.0.1'&&now.smtp_port===9||now.smtp_host===previous.smtp_host&&now.smtp_port===previous.smtp_port))throw Error('SMTP cambió durante la prueba; restauración requiere conciliación');}
    const incidentId=snapshot.scope.split(':')[0],rex=incidentId.replace('INC-','REX-')+'-01';
    const picks=await read('stock.picking',['|',['origin','in',[snapshot.scope,rex]],['origin','=like',incidentId+':return:%']],['id'],100);
    if(picks.length>=100)throw Error('Revisión de correo incompleta; SMTP permanece aislado');
    const domain=[['model','=','stock.picking'],['res_id','in',picks.map((p:any)=>p.id)],['state','in',['outgoing','exception']]];
    const mails=picks.length?await read('mail.mail',domain,['id'],1000):[];
    if(mails.length>=1000)throw Error('Cola de correo incompleta; SMTP permanece aislado');
    for(const mail of mails)await maintain('mail.mail',mail.id,{state:'cancel'});
    if(picks.length&&(await read('mail.mail',domain,['id'],1000)).length)throw Error('Correo de prueba aún pendiente; SMTP permanece aislado');
    for(const previous of snapshot.servers){const now=current.find((s:any)=>s.id===previous.id);if(now.smtp_host!==previous.smtp_host||now.smtp_port!==previous.smtp_port)await maintain('ir.mail_server',previous.id,{smtp_host:previous.smtp_host,smtp_port:previous.smtp_port});}
    const restored=await read('ir.mail_server',[['id','in',snapshot.servers.map(s=>s.id)]],['id','smtp_host','smtp_port'],100);
    if(!snapshot.servers.every(old=>restored.some((now:any)=>now.id===old.id&&now.smtp_host===old.smtp_host&&now.smtp_port===old.smtp_port)))throw Error('No se confirma restauración SMTP');
   };
   if(existsSync(file)){
    const pending=JSON.parse(readFileSync(file,'utf8'));
    const age=Date.now()-Date.parse(pending.startedAt);
    if(!Number.isFinite(age)||age<60000)throw Error('Aislamiento SMTP aún en curso; no se solapan pruebas');
    if(pending.ownerPid&&pending.ownerPid!==process.pid){let active=false;try{process.kill(pending.ownerPid,0);active=true;}catch{}if(active)throw Error('Otro proceso conserva el aislamiento SMTP; no se restaura mientras siga activo');}
    await restore(pending);
    renameSync(file,file+'.recovered-'+Date.now());
   }
   const companies=await read('res.company',[],['id','stock_move_email_validation','stock_move_sms_validation']);
   const crons=await read('ir.cron',[['active','=',true]],['id','name','model_id']);const automations=await read('base.automation',[['active','=',true]],['id','model_id']);
   const ids=[...new Set([...crons,...automations].map((r:any)=>r.model_id?.[0]).filter(Boolean))];const models=ids.length?await read('ir.model',[['id','in',ids]],['id','model']):[];const names=new Map(models.map((r:any)=>[r.id,r.model]));
   if(companies.length>=250||crons.length>=250||automations.length>=250||companies.some((c:any)=>c.stock_move_email_validation||c.stock_move_sms_validation)||[...crons,...automations].some((r:any)=>/stock\.|delivery|mail\.|carrier|amazon|gls/i.test(String(names.get(r.model_id?.[0])||'')+' '+String(r.name||''))))throw Error('Efectos externos DEMO activos: no se permite escribir');
   const servers=await read('ir.mail_server',[['active','=',true]],['id','smtp_host','smtp_port'],100);if(servers.length>=100)throw Error('Listado SMTP incompleto');
   mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,JSON.stringify({scope,servers,ownerPid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600,flush:true});
   try{
    for(const server of servers)await maintain('ir.mail_server',server.id,{smtp_host:'127.0.0.1',smtp_port:9});
    const trapped=await read('ir.mail_server',[['active','=',true]],['id','smtp_host','smtp_port'],100);if(trapped.length!==servers.length||trapped.some((s:any)=>s.smtp_host!=='127.0.0.1'||s.smtp_port!==9))throw Error('Aislamiento SMTP no confirmado');
    this.isolationActive=true;return await task();
   }finally{
    this.isolationActive=false;
    await restore({scope,servers});
    unlinkSync(file);
   }
  });this.isolationQueue=work.catch(()=>{});return work;
 }
 async communicationState(){
  if(!this.uid)await this.identity();
  const rows=await this.rpc('object','execute_kw',[this.target.database,this.uid,this.target.apiKey,'ir.mail_server','search_read',[[['active','=',true]]],{fields:['id','smtp_host','smtp_port'],limit:100}]);
  if(rows.length>=100)throw Error('Snapshot SMTP incompleto');
  const servers=rows.map((s:any)=>({id:s.id,smtp_host:s.smtp_host,smtp_port:s.smtp_port})).sort((a:any,b:any)=>a.id-b.id);
  return {smtpFingerprint:createHash('sha256').update(JSON.stringify(servers)).digest('hex'),serverCount:servers.length,isolationPending:existsSync(join(this.env.DASHBOARD_DATA_DIR||'.dashboard-data','incidents-smtp-isolation-pending.json'))};
 }
 async identity(){if(!this.uid)await this.read('res.company','search_read',[[]],{fields:['id'],limit:1});const rows=await this.read('res.users','read',[[this.uid!]],{fields:['id','name','partner_id']});if(rows.length!==1)throw Error('Usuario técnico Odoo no identificado');return {id:rows[0].id,name:String(rows[0].name),partnerId:Array.isArray(rows[0].partner_id)?Number(rows[0].partner_id[0]):0};}
 async inspect() {
  // Sequential: authenticate once; field presence is evidence, not proof of stock-write behavior.
  const companies = await this.read('res.company', 'search_read', [[]], { fields: ['id', 'name'], limit: 20 });
  const locations = await this.read('stock.location', 'search_read', [[['usage', 'in', ['internal', 'customer', 'supplier', 'inventory']]]], { fields: ['id', 'complete_name', 'usage', 'company_id'], limit: 100 });
  const pickingTypes = await this.read('stock.picking.type', 'search_read', [[]], { fields: ['id', 'name', 'code', 'default_location_src_id', 'default_location_dest_id', 'company_id'], limit: 100 });
  const moveFields = await this.read('stock.move', 'fields_get', [], { attributes: ['type', 'required', 'readonly'] });
  const moveLineFields = await this.read('stock.move.line', 'fields_get', [], { attributes: ['type', 'required', 'readonly'] });
  return { target: { url: this.target.url, database: this.target.database }, readOnly: true,
   writesEnabled: demoWorkflowWritable(this.env,TEST_TARGET)||(this.env.INCIDENTS_ODOO_WRITE_ENABLED==='true'&&Boolean(this.env.INCIDENTS_ODOO_APPROVED_DIGEST)&&Boolean(this.env.INCIDENTS_ODOO_APPROVED_OPERATION)), companies, locations, pickingTypes, moveFields, moveLineFields,
   note: 'Lectura del destino configurado. Pendiente verificar aislamiento de correo, tareas y conectores antes de escribir. No certifica movimientos ni albaranes.' };
 }
}
