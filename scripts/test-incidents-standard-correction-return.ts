import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ControlledStockExecutor,StockJournal,TEST_TARGET,type OdooCall,type StockProposal} from '../backend/incidents/odooStock.ts';

const originalPicking={id:30,name:'OUT/00030',origin:'S-TEST',state:'done',sale_id:[20,'S-TEST'],company_id:[1,'LAB'],location_id:[5,'Stock'],location_dest_id:[6,'Customer'],picking_type_id:[9,'Delivery'],return_id:false};
const originalMove={id:40,picking_id:[30,'OUT/00030'],product_id:[10,'A'],product_uom:[1,'Units'],product_uom_qty:1,quantity:1,sale_line_id:[15,'A line'],to_refund:false,state:'done',scrapped:false,location_id:[5,'Stock'],location_dest_id:[6,'Customer']};
const line={productId:10,sku:'A',quantity:1,uomId:1,sourceId:6,destinationId:5,saleLineId:15,toRefund:true,originMoveId:40};
const key='INC-2026-00123:return:DEV-2026-00123';
const proposal:StockProposal={incidentId:'INC-2026-00123',revision:1,target:TEST_TARGET,orderId:20,companyId:1,partnerId:2,customerLocationId:6,outgoingPickingTypeId:9,operations:[{key,kind:'return',returnId:'DEV-2026-00123',standardReturn:true,originalPickingId:30,dispatchReference:key,lines:[line],blockers:[],stageOnly:false}],blockers:[],digest:'digest-001',originalPickingIds:[30],openOutgoingPickings:[]};
let wizard:any,returnPicking:any,returnMove:any,writes=0;
const read:OdooCall=async(model,method,args)=>{
 if(model==='stock.picking'){
  if(method==='read'){const id=Number((args[0] as number[])[0]);return id===30?[originalPicking]:id===81&&returnPicking?[returnPicking]:[];}
  if(method==='search_read')return returnPicking&&returnPicking.origin===key?[{id:81}]:[];
 }
 if(model==='stock.move'){
  if(method==='read')return (args[0] as number[]).includes(40)?[originalMove]:[];
  if(method==='search_read'){
   const domain=args[0] as any[];
   if(domain.some(d=>d[0]==='origin_returned_move_id'))return returnMove&&returnMove.state!=='cancel'?[{id:90,origin_returned_move_id:[40,'Original A'],state:returnMove.state,quantity:returnMove.quantity,product_uom_qty:1}]:[];
   if(domain.some(d=>d[0]==='picking_id'&&d[1]==='='&&d[2]===81))return returnMove?[returnMove]:[];
  }
 }
 if(model==='stock.return.picking.line'&&method==='fields_get')return {to_refund:{type:'boolean'}};
 if(model==='stock.return.picking.line'&&method==='search_read')return [{id:71,wizard_id:[70,'Wizard'],product_id:[10,'A'],move_id:[40,'OUT/00030'],quantity:0}];
 throw Error(`Unexpected read ${model}.${method}`);
};
const write:OdooCall=async(model,method,args)=>{
 writes++;
 if(model==='stock.return.picking'&&method==='create'){wizard={id:70,picking_id:30};return 70;}
 if(model==='stock.return.picking'&&method==='write'){wizard.lines=(args[1] as any).product_return_moves;return true;}
 if(model==='stock.return.picking'&&method==='action_create_returns'){
  const values=wizard.lines[0][2];returnMove={id:90,picking_id:[81,'WH/RET/00081'],product_id:[10,'A'],product_uom:[1,'Units'],product_uom_qty:values.quantity,quantity:0,sale_line_id:[15,'A line'],to_refund:values.to_refund,origin_returned_move_id:[40,'OUT/00030'],state:'assigned',location_id:[6,'Customer'],location_dest_id:[5,'Stock']};
  returnPicking={id:81,name:'WH/RET/00081',origin:'Return of OUT/00030',state:'assigned',sale_id:[20,'S-TEST'],company_id:[1,'LAB'],return_id:[30,'OUT/00030'],partner_id:[2,'Customer']};return {res_id:81};
 }
 if(model==='stock.picking'&&method==='write'){Object.assign(returnPicking,args[1]);return true;}
 if(model==='stock.move'&&method==='write'){Object.assign(returnMove,args[1]);return true;}
 if(model==='stock.picking'&&method==='button_validate'){returnPicking.state='done';returnMove.state='done';returnMove.quantity=1;return true;}
 throw Error(`Unexpected write ${model}.${method}`);
};
const env={INCIDENTS_ODOO_MODE:'test',INCIDENTS_ODOO_WRITE_ENABLED:'true',INCIDENTS_DEMO_WORKFLOW_ENABLED:'true',INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED:'true'};
const executor=new ControlledStockExecutor(read,write,new StockJournal(mkdtempSync(join(tmpdir(),'inc-standard-return-'))),env);
const result=await executor.execute(proposal,key,'QA');
assert.equal(result.status,'done');assert.equal(result.kind,'return');assert.equal(result.pickingId,81);assert.deepEqual(result.lines?.map(x=>[x.productId,x.quantity,x.originMoveId,x.toRefund]),[[10,1,40,true]]);
assert.equal(returnPicking.return_id[0],30);assert.equal(returnMove.origin_returned_move_id[0],40);assert.equal(returnMove.quantity,1);assert.equal(returnMove.to_refund,true);
const writesAfterCreate=writes;const recovered=await executor.execute(proposal,key,'QA');assert.equal(recovered.pickingId,81);assert.equal(writes,writesAfterCreate);
console.log('PASS DEV correctiva: asistente estándar, origen Odoo enlazado, to_refund, cantidades y ruta comprobadas, DEV validada una sola vez y repetición idempotente.');
