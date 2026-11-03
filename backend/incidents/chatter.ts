import {AUTOMATION_CONTACT,assertAutomationContact} from './automationAuthor.ts';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {OdooCall} from './odooStock.ts';
/** Visible automation author is a contact; native create_uid/write_uid remain the authenticated user. */
export class IncidentChatter {
 private file:string;
 constructor(private read:OdooCall,private write:OdooCall,directory:string){this.file=join(directory,'incidents-chatter-journal.json');}
 private load():Record<string,{state:string;messageId?:number}>{return existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{};}
 private save(key:string,value:{state:string;messageId?:number}){const all=this.load();all[key]=value;mkdirSync(join(this.file,'..'),{recursive:true});const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(all),{mode:0o600,flush:true});renameSync(tmp,this.file);}
 private async author(target:string){
  const key='AUTOMATION-AUTHOR:'+target;
  const rows=await this.read('res.partner','search_read',[[['ref','=',AUTOMATION_CONTACT.ref]]],{fields:['id','name','ref','active','user_ids'],limit:2,context:{active_test:false}});
  if(rows.length>1)throw Error('Contactos de automatización duplicados; no crear otro');
  if(rows.length===1)return assertAutomationContact(rows[0]);
  if(this.load()[key])throw Error('Creación del contacto automático incierta; conciliar por referencia antes de repetir');
  const sameName=await this.read('res.partner','search_read',[[['name','=',AUTOMATION_CONTACT.name]]],{fields:['id'],limit:1,context:{active_test:false}});
  if(sameName.length)throw Error('Ya existe un contacto con el nombre automático sin referencia verificada; revisar sin duplicar');
  this.save(key,{state:'started'});
  try{
   const id=await this.write('res.partner','create',[AUTOMATION_CONTACT],{context:{tracking_disable:true,mail_create_nosubscribe:true,mail_create_nolog:true}});
   if(!Number.isInteger(id)||id<=0)throw Error('Contacto automático no confirmado');
   const verified=await this.read('res.partner','read',[[id]],{fields:['id','name','ref','active','user_ids'],context:{active_test:false}});
   if(verified.length!==1||assertAutomationContact(verified[0])!==id)throw Error('Contacto automático no verificado');
   this.save(key,{state:'confirmed'});return id;
  }catch{this.save(key,{state:'uncertain'});throw Error('Contacto automático incierto; conciliar sin crear usuario ni repetir contacto');}
 }
 async record(input:{target:string;key:string;model:'stock.picking'|'stock.scrap';id:number;status:string;actor:string;reference?:string;lines:Array<{sku:string;quantity:number}>}){
  if(!Number.isInteger(input.id)||input.id<=0||!/^INC-\d{4}-\d{5,}:/.test(input.key))throw Error('Auditoría de movimiento sin identidad estable');
  const token='DASHBOARD-INC-EVENT-'+createHash('sha256').update(JSON.stringify([input.target,input.key,input.model,input.id,input.status])).digest('hex');
  const messages=await this.read('mail.message','search_read',[[['model','=',input.model],['res_id','=',input.id],['body','ilike',token]]],{fields:['id','author_id','date'],limit:2});
  if(messages.length>1)throw Error('Nota de auditoría duplicada; conciliar sin publicar otra');
  if(messages.length===1){this.save(token,{state:'confirmed',messageId:messages[0].id});return messages[0].id;}
  if(this.load()[token])throw Error('Nota de auditoría pendiente o incierta; consultar chatter antes de repetir, sin repetir el movimiento');
  const authorId=await this.author(input.target);
  const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const body=[`Automatización Dashboard · ${input.key.split(':')[0]}`,`Referencia: ${input.reference||input.key}`,`Operación: ${input.key} · ${input.status}`,`Solicitado en Dashboard por: ${input.actor}`,`Registro técnico UTC: ${new Date().toISOString()}`,`Productos: ${input.lines.map(l=>`${l.sku} × ${l.quantity}`).join('; ')}`,token].map(escape).join('\n');
  this.save(token,{state:'started'});
  try{
   const id=await this.write(input.model,'message_post',[[input.id]],{body,author_id:authorId,email_from:`${AUTOMATION_CONTACT.name} <${AUTOMATION_CONTACT.email}>`,message_type:'comment',subtype_xmlid:'mail.mt_note',partner_ids:[],context:{mail_notify_force_send:false,mail_post_autofollow:false,mail_create_nosubscribe:true,tracking_disable:true}});
   if(!Number.isInteger(id)||id<=0)throw Error('Odoo no confirmó la nota');
   this.save(token,{state:'confirmed',messageId:id});return id;
  }catch{this.save(token,{state:'uncertain'});throw Error('Movimiento Odoo conservado; nota de chatter incierta. Conciliar solo la auditoría, nunca repetir el stock');}
 }
}
