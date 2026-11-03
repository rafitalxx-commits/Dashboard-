import assert from 'node:assert/strict';
import {operationalOdooTarget,operationalWorkflowWritable,physicalWorkflowWritable,assertOperationalRexRpc,operationalDocumentsWritable,operationalRexWritable,TEST_TARGET} from '../backend/incidents/odooRuntime.ts';
import {AUTOMATION_CONTACT} from '../backend/incidents/automationAuthor.ts';
const env={ODOO_URL:'https://erp.example.invalid',ODOO_DATABASE:'fixture',ODOO_WRITE_ENABLED:'false',INCIDENTS_ODOO_MODE:'operational',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_OPERATIONAL_WORKFLOW_ENABLED:'true'};
const target=operationalOdooTarget(env);
assert(operationalWorkflowWritable(env,target));assert(physicalWorkflowWritable(env,target));assert(operationalRexWritable(env,target));assert(operationalDocumentsWritable(env,target));
for(const other of [TEST_TARGET,'https://other.example.invalid/fixture',target+'/other',undefined])assert.equal(operationalWorkflowWritable(env,other),false);
for(const key of ['INCIDENTS_ODOO_MODE','INCIDENTS_ODOO_WRITE_ENABLED','INCIDENTS_OPERATIONAL_WORKFLOW_ENABLED'])assert.equal(operationalWorkflowWritable({...env,[key]:'false'},target),false);
assert.equal(operationalWorkflowWritable({...env,INCIDENTS_ODOO_MODE:'test'},target),false);
assert.equal(operationalWorkflowWritable({...env,ODOO_URL:'https://demo-erp.example.invalid'},target),false);
for(const [model,method,args] of [
 ['stock.picking','create',[{}]],['stock.picking','action_confirm',[[1]]],['stock.picking','action_assign',[[1]]],['stock.picking','button_validate',[[1]]],
 ['stock.picking','write',[[1],{origin:'INC-2026-00123:return:DEV-2026-00123'}]],['stock.picking','write',[[1],{carrier_tracking_ref:'tracking'}]],
 ['stock.move','write',[[1],{quantity:1,picked:true}]],['stock.return.picking','create',[{}]],['stock.return.picking','write',[[1],{product_return_moves:[]}]],['stock.return.picking','action_create_returns',[[1]]],
 ['stock.backorder.confirmation','create',[{}]],['stock.backorder.confirmation','process',[[1]]],['stock.scrap','create',[{}]],['stock.scrap','action_validate',[[1]]],['res.partner','create',[AUTOMATION_CONTACT]],
] as Array<[string,string,unknown[]]>)assert.doesNotThrow(()=>assertOperationalRexRpc(env,target,model,method,args));
for(const [model,method,args] of [
 ['sale.order','write',[[1],{state:'done'}]],['stock.quant','write',[[1],{quantity:2}]],['stock.picking','unlink',[[1]]],['stock.picking','action_cancel',[[1]]],['stock.picking','write',[[1],{origin:'arbitrary'}]],
 ['stock.move','write',[[1],{quantity:1,picked:true,product_id:8}]],['stock.move','write',[[1],{quantity:-1,picked:true}]],['res.partner','create',[{name:'other'}]],['res.users','create',[{}]],['mail.mail','send',[[1]]],['ir.mail_server','write',[[1],{active:false}]],
] as Array<[string,string,unknown[]]>)assert.throws(()=>assertOperationalRexRpc(env,target,model,method,args));
assert.throws(()=>assertOperationalRexRpc({...env,INCIDENTS_OPERATIONAL_WORKFLOW_ENABLED:'false'},target,'stock.return.picking','create',[{}]));
assert.throws(()=>assertOperationalRexRpc(env,TEST_TARGET,'stock.picking','create',[{}]));assert.equal(env.ODOO_WRITE_ENABLED,'false');
console.log('PASS operational workflow: exact real target + two dedicated switches, explicit RPC allowlist, TEST/cross-target rejection, no generic Odoo writes or SMTP/admin RPC');
