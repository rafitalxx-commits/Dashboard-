import type {OdooCall} from './odooStock.ts';
export const AUTOMATION_CONTACT={name:'Dashboard · Automático',ref:'DASHBOARD_AUTOMATION_AUTHOR',email:'dashboard-automation@example.invalid',company_type:'person',type:'contact'};
/** This is a contact used to label automation, never a login or a paid user. */
export function automationContactCreate(model:string,method:string,args:unknown[]){
 if(model!=='res.partner'||method!=='create'||args.length!==1)return false;
 const values=args[0];if(!values||typeof values!=='object'||Array.isArray(values))return false;
 return Object.keys(values).sort().join(',')===Object.keys(AUTOMATION_CONTACT).sort().join(',')&&Object.entries(AUTOMATION_CONTACT).every(([key,value])=>(values as any)[key]===value);
}
export function assertAutomationContact(row:any){
 if(!row||row.name!==AUTOMATION_CONTACT.name||row.ref!==AUTOMATION_CONTACT.ref||row.active!==true||!Array.isArray(row.user_ids)||row.user_ids.length)throw Error('El autor automático debe ser el contacto técnico verificado, activo y sin usuario asociado');
 return Number(row.id);
}
export async function assertInternalAutomationNote(read:OdooCall,kwargs:Record<string,unknown>){
 if(kwargs.subtype_xmlid!=='mail.mt_note'||!Array.isArray(kwargs.partner_ids)||kwargs.partner_ids.length)throw Error('Solo notas internas sin destinatarios explícitos');
 if(kwargs.author_id!==undefined){
  if(!Number.isInteger(kwargs.author_id)||Number(kwargs.author_id)<=0)throw Error('Autor automático inválido');
  const rows=await read('res.partner','read',[[kwargs.author_id]],{fields:['id','name','ref','active','user_ids'],context:{active_test:false}});
  if(rows.length!==1||assertAutomationContact(rows[0])!==kwargs.author_id)throw Error('Contacto autor no verificado');
 }
}
