import {automationContactCreate} from './automationAuthor.ts';
export const TEST_TARGET='https://demo-todoelectrico.odoo.rgbconsulting.com/odoo-todoelectrico18-demo-01';
type Env=Record<string,string|undefined>;
export function operationalTargetMatches(env:Env,target?:string){
 try{return env.INCIDENTS_ODOO_MODE==='operational'&&Boolean(target)&&target===operationalOdooTarget(env);}catch{return false;}
}
/** Production workflow is opt-in, independent from the generic Dashboard write switch. */
export function operationalWorkflowWritable(env:Env,target?:string){
 if(env.INCIDENTS_ODOO_MODE!=='operational'||env.INCIDENTS_OPERATIONAL_WORKFLOW_ENABLED!=='true'||env.INCIDENTS_ODOO_WRITE_ENABLED!=='true')return false;
 try{return Boolean(target)&&target===operationalOdooTarget(env);}catch{return false;}
}
export function physicalWorkflowWritable(env:Env,target:string){
 return operationalWorkflowWritable(env,target)||(env.INCIDENTS_ODOO_MODE!=='operational'&&target===TEST_TARGET&&env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED==='true');
}
/** The operational connection is the same configured Odoo used by Dashboard, never a demo alias. */
export function operationalOdooTarget(env:Env){
 const url=new URL(env.ODOO_URL||'');const database=(env.ODOO_DATABASE||'').trim();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')||!database||database.includes('/')||url.hostname.includes('demo-')||database.includes('demo-'))throw Error('La conexión operativa requiere el origen HTTPS y la base real configurados en Dashboard');
 return `${url.origin}/${database}`;
}
export function operationalRexWritable(env:Env,target?:string){
 if(operationalWorkflowWritable(env,target))return true;
 if(env.INCIDENTS_ODOO_MODE!=='operational'||env.INCIDENTS_REX_WRITE_ENABLED!=='true')return false;
 try{return Boolean(target)&&target===operationalOdooTarget(env);}catch{return false;}
}
/** Separate future production gate: document registration only, never physical validation. */
export function operationalDocumentsWritable(env:Env,target?:string){
 if(operationalWorkflowWritable(env,target))return true;
 if(env.INCIDENTS_ODOO_MODE!=='operational'||env.INCIDENTS_DOCUMENTS_WRITE_ENABLED!=='true')return false;
 try{return Boolean(target)&&target===operationalOdooTarget(env);}catch{return false;}
}
/** Dedicated REX authorization does not enable Dashboard generic Odoo writes.
 * Low-level allowlist. The executor additionally restricts creation to a staged REX only. */
export function assertOperationalRexRpc(env:Env,target:string,model:string,method:string,args:unknown[]){
 if(!operationalRexWritable(env,target)&&!operationalDocumentsWritable(env,target))throw Error('Preparación REX operativa deshabilitada');
 const value=args[1] as Record<string,unknown>|undefined;
 const tracking=model==='stock.picking'&&method==='write'&&value&&Object.keys(value).length===1&&typeof value.carrier_tracking_ref==='string';
 const quantities=model==='stock.move'&&method==='write'&&value&&Object.keys(value).sort().join(',')==='picked,quantity'&&((value.picked===true&&typeof value.quantity==='number'&&value.quantity>0)||(operationalWorkflowWritable(env,target)&&value.picked===false&&value.quantity===0));
 const note=model==='stock.picking'&&method==='message_post';
 if(operationalWorkflowWritable(env,target)){
  const values=args[1] as Record<string,unknown>|undefined;
  const origin=model==='stock.picking'&&method==='write'&&values&&Object.keys(values).join(',')==='origin'&&/^INC-\d{4}-\d{5,}:return:DEV-\d{4}-\d{5,}$/.test(String(values.origin));
  const workflowRpc=(model==='stock.return.picking'&&['create','write','action_create_returns'].includes(method))||(model==='stock.backorder.confirmation'&&['create','process'].includes(method))||(model==='stock.scrap'&&['create','action_validate'].includes(method));
  const audit=['stock.picking','stock.scrap'].includes(model)&&method==='message_post';
  if(origin||workflowRpc||audit)return;
 }
 const registration=operationalDocumentsWritable(env,target)&&model==='stock.picking'&&['create','action_confirm','action_assign'].includes(method);
 if(!automationContactCreate(model,method,args)&&!registration&&!note&&(!operationalRexWritable(env,target)||!(model==='stock.picking'&&['create','action_confirm','action_assign','button_validate'].includes(method))&&!tracking&&!quantities))throw Error('RPC fuera del alcance REX operativo');
}

/** Explicit user-enabled LAB workflow; never grants the generic Dashboard write capability. */
export function demoWorkflowWritable(env:Env,target:string){
 return env.INCIDENTS_ODOO_MODE==='test'&&target===TEST_TARGET&&env.INCIDENTS_ODOO_WRITE_ENABLED==='true'&&env.INCIDENTS_DEMO_WORKFLOW_ENABLED==='true';
}
