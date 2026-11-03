import {IncidentSubmissions} from './submissions.ts';
import {verifiedIncidentProduct} from './merchandise.ts';
import {prepareIncidentDocuments} from './documents.ts';
import {IncidentBackgroundQueue} from './background.ts';
import {DemoLabelStore,assertDemoLabelScope} from './demoLabel.ts';
import { incidentFromReshipment, resolveReshipment, reshipmentPrintData, incidentReshipmentDocument, reshipmentPreparation, reshipmentPrerequisites } from './reshipment.ts';
import { TEST_TARGET, type OdooCall } from './odooStock.ts';
import { operationalWorkflowWritable,demoWorkflowWritable,operationalRexWritable,operationalDocumentsWritable } from './odooRuntime.ts';
import type { IncidentOdooStock, ControlledStockExecutor } from './odooStock.ts';
import { UploadJournal } from './uploads.ts';
import { carrierRuleStore } from './carrierRules.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SheetsRepository, GoogleApi } from './repository.ts';
import { IncidentService } from './service.ts';
import type { CatalogMatch, OrderContext, WizardDraft } from './types.ts';
export function registerIncidentRoutes(server:any,auth:any,env:Record<string,string>,deps:{catalog:(query:string,id?:number)=>Promise<{products:CatalogMatch[];hasMore:boolean}>;lookup:(q:string)=>Promise<OrderContext>;statistics:(from:string,to:string,channel?:string)=>Promise<unknown>;image:(id:number)=>Promise<Buffer>;odoo?:{mode?:'test'|'operational';target?:string;stock:IncidentOdooStock;executor:ControlledStockExecutor;inspect:()=>Promise<unknown>;read:OdooCall;isolate?:<T>(scope:string,task:()=>Promise<T>)=>Promise<T>}}){
 const incidentDir=env.INCIDENTS_DATA_DIR||env.DASHBOARD_DATA_DIR||'.dashboard-data';
 const rules=carrierRuleStore(incidentDir);
 const repo=new SheetsRepository(env);const service=new IncidentService(repo,join(incidentDir,'incidents-sequence.json'));const google=new GoogleApi(env);
 const send=(r:ServerResponse,n:number,v:unknown)=>{r.statusCode=n;r.setHeader('Content-Type','application/json');r.setHeader('Cache-Control','no-store');r.end(JSON.stringify(v));};
 const read=async(r:IncomingMessage)=>{let text='';for await(const part of r){text+=part;if(text.length>1500000)throw Error('Solicitud demasiado grande');}return JSON.parse(text||'{}');};
 const mode=()=>deps.odoo?.mode||'test';
 const target=()=>deps.odoo?.target||TEST_TARGET;
 const runWrite=<T,>(scope:string,task:()=>Promise<T>)=>deps.odoo?.isolate?deps.odoo.isolate(scope,task):task();
 const testWritable=()=>mode()==='test'&&env.INCIDENTS_ODOO_WRITE_ENABLED==='true'&&env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED==='true'&&(demoWorkflowWritable(env,target())||Boolean(env.INCIDENTS_ODOO_APPROVED_DIGEST)&&Boolean(env.INCIDENTS_ODOO_APPROVED_OPERATION))&&Boolean(deps.odoo);
 const workflowWritable=()=>testWritable()||Boolean(deps.odoo)&&operationalWorkflowWritable(env,target());
 const rexWritable=()=>mode()==='operational'?operationalRexWritable(env,target()):testWritable();
 const reconcileAudited=(proposal:any,key:string,actor:string)=>runWrite(key,async()=>{const result=await deps.odoo!.executor.reconcile(proposal,key);await deps.odoo!.executor.recordAudit(result,actor);return result;});
 type RexPreparation={status:'not_required'|'gate_closed'|'approval_mismatch'|'blocked'|'prepared'|'failed';message:string;reference?:string;pickingId?:number};
 const prepareRex=async(incident:import('./types.ts').Incident,actor:string,user:any):Promise<{incident:import('./types.ts').Incident;rexPreparation:RexPreparation}>=>{
  const finish=(rexPreparation:RexPreparation,updated=incident)=>({incident:updated,rexPreparation});
  const process=incident.processes.find(p=>p.kind==='reshipment');
  if(!process)return finish({status:'not_required',message:'La solución no requiere reexpedición.'});
  const blockers=reshipmentPrerequisites(incident,target());
  if(blockers.length)return finish({status:'blocked',message:blockers.join('. ')});
  if(!deps.odoo)return finish({status:'gate_closed',message:'Conexión Odoo no disponible para comprobar REX.'});
  try{
   const all=await repo.list(true);const current=all.find(x=>x.id===incident.id);if(!current)throw Error('Incidencia no encontrada');
   if(current.status==='Cerrada')throw Error('La incidencia está cerrada');
   const prior=(current.odooOperations||[]).filter(x=>x.kind==='reshipment'&&x.dispatchReference);
   if(prior.length){if(prior.length!==1)throw Error('Hay varias operaciones REX; requiere selección explícita');const dispatch=await resolveReshipment(prior[0].dispatchReference!,current,deps.odoo.read,target());return finish({status:'prepared',reference:dispatch.reference,pickingId:dispatch.pickingId,message:`REX ${dispatch.reference} ya existe en Odoo (${dispatch.pickingName}). No se ha creado otro albarán.`},current);}
   // Looking up an already-audited REX is read-only. The warehouse operator
   // does not need administrator creation permissions to finish the receipt.
   if(!rexWritable()||user.role!=='admin'||!user.permissions.includes('odooWrite'))return finish({status:'gate_closed',message:'Recepción guardada. Falta preparar REX: la creación de salidas no está habilitada para este usuario.'},current);
   if(!repo.status().writable)throw Error('Sheets bloqueado; no se puede auditar el picking');
   const proposal=await deps.odoo.stock.propose(current,all);const ops=proposal.operations.filter(x=>x.kind==='reshipment'&&x.stageOnly);
   if(ops.length!==1||ops[0].blockers.length||!ops[0].lines.length)return finish({status:'blocked',message:`Incidencia guardada. REX no creado: ${ops.map(x=>x.blockers.join('; ')).join('; ')||'la propuesta no contiene una única salida válida'}.`},current);
   const op=ops[0];
   const existing=await deps.odoo.read('stock.picking','search_read',[[['origin','=',op.dispatchReference],['company_id','=',proposal.companyId]]],{fields:['id'],limit:2});
   if(existing.length>1)throw Error('Referencia REX duplicada en Odoo; concilia antes de continuar');
   if(!existing.length&&proposal.blockers.length)return finish({status:'blocked',reference:op.dispatchReference,message:`Incidencia guardada. REX no creado: ${proposal.blockers.join('; ')}.`},current);
   if(!existing.length&&mode()==='test'&&!demoWorkflowWritable(env,target())&&(env.INCIDENTS_ODOO_APPROVED_DIGEST!==proposal.digest||env.INCIDENTS_ODOO_APPROVED_OPERATION!==op.key))return finish({status:'approval_mismatch',reference:op.dispatchReference,message:'Incidencia guardada. La aprobación de pruebas no corresponde a este albarán; no se ha escrito Odoo.'},current);
   const result=existing.length?await reconcileAudited(proposal,op.key,actor):await runWrite(op.key,()=>deps.odoo!.executor.execute(proposal,op.key,actor));
   const updated=await service.confirmOdoo(current.id,current.revision,result,proposal.operations.map(x=>x.key),actor,!proposal.operations.some(x=>x.blockers.length));
   return finish({status:'prepared',reference:op.dispatchReference,pickingId:result.pickingId,message:`REX ${op.dispatchReference} confirmado en Odoo (${result.externalReference||result.pickingId}) y vinculado al pedido ${current.order.odooReference}. Queda pendiente de etiqueta y validación en Expediciones.`},updated);
  }catch(e){return finish({status:'failed',message:`Incidencia guardada, pero REX no confirmado: ${(e as Error).message}. Revisa el historial antes de volver a preparar.`});}
 };
 const processBackground=async(job:{prepareOnly?:boolean;receiptsOnly?:boolean;id:string;actor:string;user:{role:string;permissions:string[]}}):Promise<{state:'done'|'blocked';message:string}>=>{
  if(job.prepareOnly){
   if(!deps.odoo||!(workflowWritable()||operationalDocumentsWritable(env,target())))return {state:'blocked',message:'Preparación automática de documentos bloqueada en esta conexión'};
   return prepareIncidentDocuments(job.id,{
    load:()=>repo.list(true),propose:(i,all,options)=>deps.odoo!.stock.propose(i,all,options),
    run:(proposal,op)=>runWrite(op.key,async()=>{
     const executor=deps.odoo!.executor;
     const prior=await executor.reconcileExisting(proposal,op.key);if(prior){await executor.recordAudit(prior,job.actor);return prior;}
     try{return await executor.execute(proposal,op.key,job.actor);}catch(error){
      // A lost response is not evidence of a lost transaction. This recovery
      // performs reads only; incomplete/ambiguous records still stop, never replay.
      let recovered;try{recovered=await executor.reconcileExisting(proposal,op.key);}catch{throw error;}
      if(!recovered)throw error;await executor.recordAudit(recovered,job.actor);return recovered;
     }
    }),
    confirm:(i,result)=>service.confirmOdoo(i.id,i.revision,result,[],job.actor,false),
   });
  }
  // Inbound is scoped to saved warehouse inspections, not the administrator-only REX action.
  if(!job.user.permissions.includes('odooWrite')||!job.user.permissions.some(p=>['products','receptions'].includes(p)))return {state:'blocked',message:'Sincronización de recepción Odoo requiere permiso de Recepciones y escritura Odoo; la recepción física queda guardada'};
  if(!deps.odoo||!workflowWritable())return {state:'blocked',message:'Preparación Odoo bloqueada en esta conexión'};
  let incident=(await repo.list(true)).find(i=>i.id===job.id);if(!incident)throw Error('Incidencia no encontrada');
  if(incident.status==='Cerrada')return {state:'done',message:'Incidencia ya cerrada; sin movimientos nuevos'};
  // Prepare empty returns; inspected arrivals are processed to completion before DEV is marked valid.
  for(const receipt of incident.returns.filter(r=>r.state!=='cancelled')){
   // Do not stage a return picking before the warehouse knows which physical item arrived.
   if(receipt.state==='awaiting')continue;
   let stalled='';
   for(let attempt=0;attempt<8;attempt++){
    const all=await repo.list(true);incident=all.find(i=>i.id===job.id)!;const current=incident.returns.find(r=>r.id===receipt.id)!;
    if(current.state==='processed'||current.state==='cancelled'||current.state==='awaiting')break;
    const proposal=await deps.odoo.stock.propose(incident,all);
    const pending=proposal.operations.filter(op=>['return','scrap'].includes(op.kind)&&op.returnId===receipt.id&&!incident!.odooOperations?.some(old=>old.key===op.key&&old.status==='done'));
    const op=pending[0];
    if(!op){incident=await service.completeReturnAfterOdoo(incident.id,receipt.id,job.actor);break;}
    const executor=deps.odoo!.executor;
    const recovered=typeof (executor as any).reconcileExisting==='function'?await runWrite(op.key,async()=>{const found=await executor.reconcileExisting(proposal,op.key);if(found&&typeof executor.recordAudit==='function')await executor.recordAudit(found,job.actor);return found;}):null;
    if(!recovered&&(proposal.blockers.length||op.blockers.length||!op.lines.length)){stalled=[...proposal.blockers,...op.blockers].join('; ')||'Operación Odoo sin líneas válidas';break;}
    const result=recovered||await runWrite(op.key,()=>executor.execute(proposal,op.key,job.actor));
    incident=await service.confirmOdoo(incident.id,incident.revision,result,proposal.operations.map(o=>o.key),job.actor,!proposal.blockers.length&&!proposal.operations.some(o=>o.blockers.length));
   }
   const fresh=(await repo.list(true)).find(i=>i.id===job.id)!;const still=fresh.returns.find(r=>r.id===receipt.id);
   if(still?.state==='arrived')return {state:'blocked',message:stalled?`Devolución ${receipt.id} pendiente: ${stalled}`:`Devolución ${receipt.id} aún no confirmada completamente en Odoo; no se marcó validada.`};
   incident=fresh;
  }
  if(job.receiptsOnly)return {state:'done',message:'Producto recepcionado; entrada y destino confirmados en Odoo. Puedes continuar la incidencia.'};
  const result=await prepareRex(incident,job.actor,job.user);
  return {state:['prepared','not_required'].includes(result.rexPreparation.status)?'done':'blocked',message:result.rexPreparation.message};
 };
 const background=new IncidentBackgroundQueue(incidentDir,async job=>{
  try{const result=await processBackground(job);if(result.state==='blocked'&&!job.prepareOnly)await service.recordReceiptSyncFailure(job.id,result.message);return result;}
  catch(e){if(!job.prepareOnly)try{await service.recordReceiptSyncFailure(job.id,(e as Error).message);}catch{}throw e;}
 });
 const enqueue=(incident:import('./types.ts').Incident,actor:string,user:any,receiptsOnly=false,prepareOnly=false)=>background.enqueue(incident.id,actor,user,receiptsOnly,prepareOnly);
 if(workflowWritable()||operationalDocumentsWritable(env,target()))background.startIntentRecovery(()=>repo.list(true),target());
 server.httpServer?.once('close',()=>background.dispose());
 const createIncident=async(d:WizardDraft,actor:string,user:any)=>{
    if(typeof d?.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(d.requestId))throw Error('ID de solicitud inválido');
    if(!repo.status().writable)throw Error(repo.status().message);
    const existing=(await repo.list(true)).find(i=>i.requestId===d.requestId);
    if(existing){for(const item of (await repo.list()).filter(i=>i.id===existing.id||existing.relatedIncidentIds.includes(i.id)))if(item.documentPreparation&&!background.get(item.id))enqueue(item,actor,user,false,true);return existing;}
    const context=await deps.lookup(d.context.order.odooReference);if(context.source!=='odoo')throw Error('Solo pedidos reales para Sheets');
    const originalContext=d.context;
    d.products=d.products.map(p=>{const matches=context.products.filter(x=>x.sku===p.sku&&(!p.saleLineId||x.saleLineId===p.saleLineId));if(matches.length!==1)throw Error('Producto no encontrado de forma unívoca en pedido actual');const verified=verifiedIncidentProduct(matches[0],p);if(d.type==='wrong_quantity')verified.affectedQuantity=Math.abs(verified.orderedQuantity-Number(p.receivedQuantity));return verified;});
    context.products=context.products.map(product=>{const submitted=originalContext.products.find(p=>p.sku===product.sku&&(!p.saleLineId||p.saleLineId===product.saleLineId));return submitted?.selectedKitComponents?verifiedIncidentProduct(product,{...submitted,affectedQuantity:product.orderedQuantity}):product;});d.context=context;
    if(d.wrongReceivedProduct){const id=d.wrongReceivedProduct.productId;if(!Number.isInteger(id)||id<=0)throw Error('Producto recibido inválido');const found=(await deps.catalog('',id)).products[0];if(!found||found.productId!==id||found.sku!==d.wrongReceivedProduct.sku)throw Error('El producto recibido no coincide con el catálogo de la conexión Odoo seleccionada; vuelve a elegirlo');d.wrongReceivedProduct=found;d.wrongReceived=found.sku;}
    if(d.relatedContext){const submitted=d.relatedContext;d.relatedContext=await deps.lookup(submitted.order.odooReference);d.relatedContext.products=d.relatedContext.products.map(product=>{const chosen=submitted.products.find(p=>p.sku===product.sku&&(!p.saleLineId||p.saleLineId===product.saleLineId));return chosen?verifiedIncidentProduct(product,{...chosen,affectedQuantity:product.orderedQuantity}):product;});}
    // Existing Drive evidence must be re-read server-side; arbitrary URLs never prove a photo.
    for(const evidence of d.evidence||[]){const file=await google.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(evidence.id)}?fields=id,name,mimeType,webViewLink,trashed`);if(file.trashed||!file.mimeType?.startsWith('image/'))throw Error('Foto Drive inexistente o formato no válido');Object.assign(evidence,{name:file.name,mimeType:file.mimeType,url:`https://drive.google.com/file/d/${file.id}/view`});}
    const incident=await service.create(d,actor,async created=>{
     for(const item of created)item.documentPreparation={requestedAt:new Date().toISOString(),actor,target:target()};
     if(d.driveDraftFolderId){
      const folder=await google.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(d.driveDraftFolderId)}?fields=id,name,appProperties,trashed`);
      if(folder.trashed||folder.appProperties?.incidentDraftRequestId!==d.requestId)throw Error('Carpeta de borrador Drive no coincide con esta solicitud');
      if(env.INCIDENTS_DRIVE_WRITE_ENABLED!=='true')throw Error('Escritura Drive bloqueada');
      await google.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:created[0].id})});
      created[0].driveFolder={id:folder.id,url:`https://drive.google.com/drive/folders/${folder.id}`};
      if(d.driveDraftPhotosFolderId){const photos=await google.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(d.driveDraftPhotosFolderId)}?fields=id,name,mimeType,parents,trashed`);if(photos.trashed||photos.name!=='Fotos'||photos.mimeType!=='application/vnd.google-apps.folder'||!photos.parents?.includes(folder.id))throw Error('Carpeta de fotos no pertenece al borrador');created[0].drivePhotosFolder={id:photos.id,url:`https://drive.google.com/drive/folders/${photos.id}`};}
     }
    });
    const ids=[incident.id,...incident.relatedIncidentIds];const all=ids.length>1?await repo.list(true):[incident];for(const item of all.filter(item=>ids.includes(item.id)))enqueue(item,actor,user,false,true);return incident;
 };
 const submissions=new IncidentSubmissions(incidentDir,target,createIncident);
 server.httpServer?.once('close',()=>submissions.dispose());
 const present=(incident:import('./types.ts').Incident)=>{const job=background.get(incident.id);return {...incident,...(job?.prepareOnly?{documentPreparationStatus:{state:job.state,message:job.message,updatedAt:job.updatedAt}}:{})};};
 const uploads=new UploadJournal(incidentDir);
 let uploadQueue:Promise<unknown>=Promise.resolve();
 const serialUpload=async<T,>(fn:()=>Promise<T>)=>{const result=uploadQueue.then(fn);uploadQueue=result.catch(()=>{});return result;};
 server.middlewares.use('/api/incidents',async(request:IncomingMessage,response:ServerResponse)=>{
  const user=auth.getSessionUser(request.headers.cookie);if(!user){send(response,401,{message:'Login requerido'});return;}
  const url=new URL(request.url||'/','http://local');
  const expeditionLookup=user.permissions.includes('expeditions')&&((request.method==='GET'&&url.pathname==='/product-image')||(request.method==='GET'&&/^\/reshipments\/REX-\d{4}-\d{5,}-\d{2}\/document$/.test(url.pathname))||(request.method==='POST'&&/^\/reshipments\/REX-\d{4}-\d{5,}-\d{2}\/demo-label-created$/.test(url.pathname))||(request.method==='GET'&&url.pathname==='/reshipments/resolve')||(request.method==='POST'&&/^\/reshipments\/REX-\d{4}-\d{5,}-\d{2}\/label-created$/.test(url.pathname)));
  if(!user.permissions.includes('products')&&!user.permissions.includes('receptions')&&!expeditionLookup){send(response,403,{message:'Sin permiso para incidencias'});return;}
  const actor=user.name||user.username||String(user.id);
  try{
   if(url.pathname==='/rules'){
    if(request.method==='GET'){send(response,200,{rules:rules.read(),canEdit:user.role==='admin'});return;}
    if(request.method==='POST'){if(user.role!=='admin'){send(response,403,{message:'Solo administración puede editar reglas'});return;}send(response,200,{rules:rules.save((await read(request)).rules),canEdit:true});return;}
   }
   if(request.method==='GET'&&url.pathname==='/reshipments/resolve'){
    if(!deps.odoo)throw Error('La conexión Odoo no está disponible');
    const reference=(url.searchParams.get('reference')||'').trim().toUpperCase();
    const id=incidentFromReshipment(reference);const incident=(await repo.list(true)).find(i=>i.id===id);
    if(!incident)throw Error('Incidencia no encontrada');
    const preparation=reshipmentPreparation(incident,reference,target());
    if(preparation){send(response,200,{preparation});return;}
    const blockers=reshipmentPrerequisites(incident,target());
    if(blockers.length&&!incident.odooOperations?.some(op=>op.dispatchReference===reference&&op.status==='done')){send(response,200,{preparation:{reference,incidentId:incident.id,orderReference:incident.order.odooReference,revision:incident.revision,state:'waiting_dependencies',labelCreationEnabled:false,blockers,notice:blockers.join('. ')}});return;}
    const dispatch=await resolveReshipment(reference,incident,deps.odoo.read,target());
    if(blockers.length&&dispatch.state!=='done')send(response,200,{preparation:{reference,incidentId:incident.id,orderReference:incident.order.odooReference,revision:incident.revision,state:'waiting_dependencies',labelCreationEnabled:false,blockers,notice:`Albarán ${dispatch.pickingName} ya creado en Odoo. ${blockers.join('. ')}`}});
    else send(response,200,{dispatch});return;
   }
   const documentMatch=url.pathname.match(/^\/reshipments\/(REX-\d{4}-\d{5,}-\d{2})\/document$/);
   if(request.method==='GET'&&documentMatch){
    if(!deps.odoo)throw Error('Conexión Odoo pendiente');const reference=documentMatch[1];const incident=(await repo.list(true)).find(i=>i.id===incidentFromReshipment(reference));if(!incident)throw Error('Incidencia no encontrada');if(!incident.odooOperations?.some(op=>op.dispatchReference===reference)){if(reference!==incident.id.replace('INC-','REX-')+'-01')throw Error('Referencia REX ajena');const printable=incident.order.shippingDestination?incident:{...incident,order:{...incident.order,shippingDestination:(await deps.lookup(incident.order.odooReference)).order.shippingDestination}};send(response,200,{document:incidentReshipmentDocument(printable,target())});return;}send(response,200,{document:await reshipmentPrintData(reference,incident,deps.odoo.read,target())});return;
   }
   const demoLabelMatch=url.pathname.match(/^\/reshipments\/(REX-\d{4}-\d{5,}-\d{2})\/demo-label-created$/);
   if(request.method==='POST'&&demoLabelMatch){
    if(!deps.odoo||mode()!=='test'||target()!==TEST_TARGET||!user.permissions.includes('expeditions')||!user.permissions.includes('odooWrite')){send(response,403,{code:'demo_label_permission_required',message:'Etiqueta DEMO requiere Expediciones y escritura Odoo en TEST; no exige ser administrador ni está disponible en producción'});return;}
    const reference=demoLabelMatch[1],body=await read(request);const related=await repo.list(true);const incident=related.find(i=>i.id===incidentFromReshipment(reference));if(!incident)throw Error('Incidencia no encontrada');
    const ops=(incident.odooOperations||[]).filter(op=>op.kind==='reshipment'&&op.dispatchReference===reference);if(ops.length!==1||!ops[0].lines?.length)throw Error('Picking REX auditado no unívoco');const op=ops[0];
    const store=new DemoLabelStore(incidentDir);const previous=store.find(reference);
    // Reprinting a completed test is read-only; never reopen a write gate to download it.
    if(previous&&op.status==='done'&&op.simulated&&op.shipmentCode===previous.shipmentCode&&op.pickingId===previous.pickingId&&incident.order.odooReference===previous.orderReference){send(response,200,{incident,status:'done',pickingId:op.pickingId,label:previous,reused:true});return;}
    if(!repo.status().writable)throw Error('Sheets no habilitado: no validar Odoo sin auditoría');
    const dispatch=await resolveReshipment(reference,incident,deps.odoo.read,target());
    if(previous&&dispatch.state==='done'){
     if(incident.status==='Cerrada')throw Error('La incidencia está cerrada; no se modifica su auditoría');
     if(previous.reference!==reference||previous.incidentId!==incident.id||previous.pickingId!==op.pickingId||previous.orderReference!==incident.order.odooReference||!previous.operator||!previous.operatorCode||!previous.operatorId)throw Error('Etiqueta DEMO previa no coincide con la salida auditada');
     const required=await deps.odoo.stock.propose(incident,related);
     const orders=await deps.odoo.read('sale.order','search_read',[[['name','=',incident.order.odooReference]]],{fields:['id'],limit:2});if(orders.length!==1)throw Error('Pedido Odoo no unívoco');
     const result=await deps.odoo.executor.reconcileDemoReshipmentForLabel({key:op.key,digest:op.digest,pickingId:op.pickingId,orderId:orders[0].id,companyId:dispatch.companyId,reference,lines:op.lines!,shipmentCode:previous.shipmentCode,tracking:previous.tracking,target:target()},actor);
     const updated=await service.confirmOdoo(incident.id,incident.revision,{...result,simulated:true,carrier:previous.carrier,shippedAt:previous.createdAt,shippedBy:previous.operator},required.operations.map(o=>o.key),actor,!required.blockers.length&&!required.operations.some(o=>o.blockers.length));
     send(response,200,{incident:updated,status:'done',pickingId:op.pickingId,label:previous,reused:true,reconciled:true});return;
    }
    const blockers=reshipmentPrerequisites(incident,target());if(blockers.length)throw Error(blockers.join('. '));
    assertDemoLabelScope(env,target(),incident,op);
    const required=await deps.odoo.stock.propose(incident,related);if(required.blockers.length||required.operations.some(o=>o.blockers.length))throw Error('Hay bloqueos físicos pendientes; no validar REX');
    const label=store.prepare(incident,op,String(body.operatorCode||''));store.recordActivity(label);
    const orders=await deps.odoo.read('sale.order','search_read',[[['name','=',incident.order.odooReference]]],{fields:['id','company_id'],limit:2});if(orders.length!==1)throw Error('Pedido Odoo no unívoco');
    const result=await runWrite(op.key,()=>deps.odoo!.executor.validateReshipmentForLabel({key:op.key,digest:op.digest,pickingId:dispatch.pickingId,orderId:orders[0].id,companyId:Number(orders[0].company_id[0]),reference,lines:op.lines!,shipmentCode:label.shipmentCode,tracking:label.tracking,target:target()},actor));
    const updated=await service.confirmOdoo(incident.id,incident.revision,{...result,simulated:true,carrier:label.carrier,shippedAt:label.createdAt,shippedBy:label.operator},required.operations.map(o=>o.key),actor,true);
    send(response,200,{incident:updated,status:result.status,pickingId:result.pickingId,label,reused:Boolean(previous)});return;
   }
   const labelMatch=url.pathname.match(/^\/reshipments\/(REX-\d{4}-\d{5,}-\d{2})\/label-created$/);
   if(request.method==='POST'&&labelMatch){
    if(!deps.odoo||!user.permissions.includes('expeditions')||(mode()==='test'&&(user.role!=='admin'||!user.permissions.includes('odooWrite'))))throw Error('Se requiere permiso de Expediciones y una conexión Odoo habilitada');
    const reference=labelMatch[1],body=await read(request),shipmentCode=String(body.shipmentCode||'').trim();if(!shipmentCode||shipmentCode.length>160)throw Error('Código de etiqueta inválido');
    const storePath=join(env.DASHBOARD_DATA_DIR||'.dashboard-data','genei-shipping-labels.json');if(!existsSync(storePath))throw Error('No hay historial de etiquetas verificable; no se valida Odoo');
    let labels:any[];try{const parsed=JSON.parse(readFileSync(storePath,'utf8'));if(!Array.isArray(parsed.labels))throw Error();labels=parsed.labels;}catch{throw Error('El historial de etiquetas no se puede verificar; no se valida Odoo');}
    const matches=labels.filter(x=>x?.shipmentCode===shipmentCode&&x?.source==='incident-reshipment-label-created'&&Array.isArray(x.orderRefs)&&x.orderRefs.includes(reference)&&!x.reissuedAt&&!x.reissuedFrom&&!x.reissueReason&&String(x.odooOrderRef||'').trim());
    if(matches.length!==1)throw Error('No existe una etiqueta REX única y registrada para la referencia exacta');
    const related=await repo.list(true);const incident=related.find(i=>i.id===incidentFromReshipment(reference));if(!incident)throw Error('Incidencia REX no encontrada');
    if(String(matches[0].odooOrderRef||'').trim()!==incident.order.odooReference)throw Error('La etiqueta no está enlazada exactamente al pedido original de la incidencia');
    const ops=(incident.odooOperations||[]).filter(x=>x.kind==='reshipment'&&x.dispatchReference===reference&&['ready_for_expedition','done'].includes(x.status||'')&&Array.isArray(x.lines)&&x.lines.length);
    if(ops.length!==1)throw Error('No hay un único picking REX pendiente y auditado');const op=ops[0];if((op.target||TEST_TARGET)!==target())throw Error('El picking auditado pertenece a otra base Odoo; no se reutiliza TEST en operativo');
    if(op.status!=='done'){const blockers=reshipmentPrerequisites(incident,target());if(blockers.length)throw Error(blockers.join('. '));}
    const orderRows=await deps.odoo.read('sale.order','search_read',[[['name','=',incident.order.odooReference]]],{fields:['id','company_id'],limit:2});if(orderRows.length!==1)throw Error('El pedido original Odoo no es unívoco');
    const pickingRows=await deps.odoo.read('stock.picking','read',[[op.pickingId]],{fields:['id','origin','sale_id','company_id','state']});const row=pickingRows[0];
    if(!row||row.origin!==reference||Number(Array.isArray(row.sale_id)?row.sale_id[0]:row.sale_id)!==Number(orderRows[0].id)||Number(Array.isArray(row.company_id)?row.company_id[0]:row.company_id)!==Number(Array.isArray(orderRows[0].company_id)?orderRows[0].company_id[0]:orderRows[0].company_id))throw Error('Picking REX no coincide con pedido/compañía de la incidencia');
    const required=await deps.odoo.stock.propose(incident,related);
    const label=matches[0];if(!String(label.operator||'').trim()||!Number.isFinite(Date.parse(String(label.createdAt||'')))||!String(label.tracking||'').trim()||!String(label.shipper||label.carrier||'').trim())throw Error('Etiqueta sin operario, agencia, seguimiento o fecha válida de Expediciones');
    const result=await runWrite(op.key,()=>deps.odoo!.executor.validateReshipmentForLabel({key:op.key,digest:op.digest,pickingId:op.pickingId,orderId:Number(orderRows[0].id),companyId:Number(Array.isArray(orderRows[0].company_id)?orderRows[0].company_id[0]:orderRows[0].company_id),reference,lines:op.lines!,shipmentCode,tracking:String(matches[0].tracking||''),target:target()},actor));
    const updated=await service.confirmOdoo(incident.id,incident.revision,{...result,carrier:String(label.shipper||label.carrier||''),shippedAt:String(label.createdAt),trackingUrl:String(label.trackingUrl||''),shippedBy:String(label.operator)},required.operations.map(x=>x.key),actor,true);send(response,200,{incident:updated,pickingId:result.pickingId,status:result.status,shipmentCode});return;
   }
   const backgroundMatch=url.pathname.match(/^\/(INC-\d{4}-\d{5,})\/background$/);
   if(request.method==='POST'&&backgroundMatch){if(user.role!=='admin'||!user.permissions.includes('odooWrite')||!workflowWritable())throw Error('Reanudación requiere conexión habilitada y permiso de administración');const incident=(await repo.list(true)).find(i=>i.id===backgroundMatch[1]);if(!incident)throw Error('Incidencia no encontrada');const job=enqueue(incident,actor,user);send(response,202,{background:{state:job.state,message:job.message}});return;}
   if(request.method==='GET'&&backgroundMatch){const job=background.get(backgroundMatch[1]);send(response,200,{background:job?{state:job.state,message:job.message,updatedAt:job.updatedAt}:null});return;}
   if(request.method==='GET'&&url.pathname==='/status'){send(response,200,{...repo.status(),odooWritable:workflowWritable(),documentsWritable:Boolean(deps.odoo)&&(workflowWritable()||operationalDocumentsWritable(env,target())),documentRecoveryError:background.recoveryError,rexWritable:rexWritable()&&user.role==='admin'&&user.permissions.includes('odooWrite'),odooMode:deps.odoo?mode():'unconfigured',odooTestConfigured:Boolean(deps.odoo)&&mode()==='test',odooConfigured:Boolean(deps.odoo),driveWritable:env.INCIDENTS_DRIVE_WRITE_ENABLED==='true'&&Boolean(env.INCIDENTS_DRIVE_ROOT_ID)&&repo.status().writable});return;}
   if(request.method==='GET'&&url.pathname==='/product-image'){const id=Number(url.searchParams.get('id'));if(!Number.isInteger(id)||id<=0)throw Error('Producto inválido');const bytes=await deps.image(id);response.statusCode=200;response.setHeader('Content-Type',bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':'image/png');response.setHeader('Cache-Control','private, max-age=300');response.end(bytes);return;}
   if(request.method==='GET'&&url.pathname==='/catalog'){const q=(url.searchParams.get('q')||'').trim();if(q.length<2||q.length>120)throw Error('Escribe entre 2 y 120 caracteres de referencia, EAN o nombre');send(response,200,await deps.catalog(q));return;}
   if(request.method==='GET'&&url.pathname==='/orders'){const q=(url.searchParams.get('q')||'').trim();if(q.length<3)throw Error('Escribe una referencia completa o tracking');send(response,200,await deps.lookup(q));return;}
   if(request.method==='GET'&&url.pathname==='/statistics'){const from=url.searchParams.get('from')||new Date().toISOString().slice(0,7)+'-01';const to=url.searchParams.get('to')||new Date().toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Rango de fechas inválido');send(response,200,await deps.statistics(from,to,url.searchParams.get('channel')||undefined));return;}
   if(request.method==='GET'&&url.pathname==='/'){send(response,200,{source:'sheets',incidents:(await repo.list(url.searchParams.get('refresh')==='1')).map(present)});return;}
   if(request.method==='GET'&&url.pathname==='/submissions'){send(response,200,{submissions:submissions.list(String(user.id||user.username))});return;}
   if(request.method==='POST'&&url.pathname==='/submissions/retry'){if(!repo.status().writable)throw Error(repo.status().message);const body=await read(request);send(response,202,{submission:submissions.retry(String(body.requestId),String(user.id||user.username))});return;}
   if(request.method==='POST'&&url.pathname==='/submissions'){if(!repo.status().writable)throw Error(repo.status().message);const submission=submissions.accept(await read(request) as WizardDraft,actor,String(user.id||user.username),user);send(response,202,{submission});return;}
   if(request.method==='POST'&&url.pathname==='/'){
    const incident=await createIncident(await read(request) as WizardDraft,actor,user);const job=background.get(incident.id);send(response,201,{incident:present(incident),...(job?{background:{state:job.state,message:job.message}}:{})});return;
   }
   if(request.method==='GET'&&url.pathname==='/odoo/status'){if(!deps.odoo)throw Error('Conexión Odoo pendiente de configuración');send(response,200,await deps.odoo.inspect());return;}
   const docsMatch=url.pathname.match(/^\/(INC-\d{4}-\d{5,})\/documents\/prepare$/);
   if(request.method==='POST'&&docsMatch){const body=await read(request);const i=(await repo.list(true)).find(i=>i.id===docsMatch[1]);if(!i)throw Error('Incidencia no encontrada');if(i.revision!==Number(body.revision))throw Error('Otro usuario modificó la incidencia. Actualiza antes de recuperar');const ready=await service.ensureOmittedStockCorrection(i.id,i.revision,actor);const job=enqueue(ready,actor,user,false,true);send(response,200,{incident:ready,background:{state:job.state,message:job.message}});return;}
   const rexMatch=url.pathname.match(/^\/(INC-\d{4}-\d{5,})\/rex\/prepare$/);
   if(request.method==='POST'&&rexMatch){const body=await read(request);const incident=(await repo.list(true)).find(i=>i.id===rexMatch[1]);if(!incident)throw Error('Incidencia no encontrada');if(incident.revision!==Number(body.revision))throw Error('Otro usuario modificó la incidencia. Actualiza antes de preparar');send(response,200,await prepareRex(incident,actor,user));return;}
   const odooMatch=url.pathname.match(/^\/(INC-\d{4}-\d{5,})\/odoo\/(proposal|execute|reconcile)$/);
   if(odooMatch){
    if(!deps.odoo)throw Error('Conexión Odoo pendiente de configuración');
    const related=await repo.list(true);const i=related.find(x=>x.id===odooMatch[1]);if(!i)throw Error('Incidencia no encontrada');
    if(request.method==='GET'&&odooMatch[2]==='proposal'){send(response,200,{proposal:await deps.odoo.stock.propose(i,related)});return;}
    if(request.method==='POST'&&['execute','reconcile'].includes(odooMatch[2])){
     if(!user.permissions.includes('odooWrite')||user.role!=='admin'){send(response,403,{message:'Se requiere administración y permiso Odoo'});return;}
     if(odooMatch[2]==='execute'&&mode()==='test'&&env.INCIDENTS_TEST_EXTERNAL_EFFECTS_ISOLATED!=='true')throw Error('Escritura TEST bloqueada: aísla y verifica primero correo, automatizaciones y otros efectos externos');
     if(!repo.status().writable)throw Error('Sheets bloqueado; no se puede auditar Odoo');
     if(i.status==='Cerrada')throw Error('La incidencia está cerrada');
     const b=await read(request);if(i.revision!==Number(b.revision))throw Error('Otro usuario modificó la incidencia. Actualiza antes de guardar');
     const proposal=await deps.odoo.stock.propose(i,related);
     if(odooMatch[2]==='execute'&&b.digest!==proposal.digest)throw Error('Propuesta obsoleta; vuelve a consultar Odoo antes de aprobar');
     if(odooMatch[2]==='reconcile'&&b.key==='no-stock-movement'){if(proposal.blockers.length||proposal.operations.length)throw Error('Existen movimientos o bloqueos pendientes');send(response,200,{incident:await service.confirmNoStockMovement(i.id,i.revision,actor)});return;}
     const result=odooMatch[2]==='execute'?await runWrite(String(b.key),()=>deps.odoo!.executor.execute(proposal,String(b.key),actor)):await reconcileAudited(proposal,String(b.key),actor);
     const updated=await service.confirmOdoo(i.id,i.revision,result,proposal.operations.map(x=>x.key),actor,!proposal.blockers.length&&!proposal.operations.some(x=>x.blockers.length));
     // A receipt confirmed later must resume the same automatic REX preparation as
     // the wizard. Reconciliation is idempotent and never recreates an audited REX.
     send(response,200,await prepareRex(updated,actor,user));return;
    }
   }
   const syncMatch=url.pathname.match(/^\/receipts\/(INC-\d{4}-\d{5,})\/sync$/);
   if(request.method==='POST'&&syncMatch){
    const body=await read(request);
    const updated=await service.confirmStoredReceipt(syncMatch[1],Number(body.revision),String(body.returnId||''),actor);
    const job=enqueue(updated,actor,user,true);send(response,200,{incident:updated,background:{state:job.state,message:job.message}});return;
   }
   const receiptMatch=url.pathname.match(/^\/receipts\/(INC-\d{4}-\d{5,})\/actions$/);
   if(request.method==='POST'&&receiptMatch){
    if(!user.permissions.includes('products')&&!user.permissions.includes('receptions'))throw Error('Sin permiso de Recepciones');
    const b=await read(request);if(!['return','review_return'].includes(b.action?.kind))throw Error('Acción de recepción inválida');
    const workersPath=join(env.DASHBOARD_DATA_DIR||'.dashboard-data','warehouse-workers.json');
    const workers=existsSync(workersPath)?JSON.parse(readFileSync(workersPath,'utf8')):[];
    const worker=workers.find((w:any)=>w.active&&w.code===String(b.action.operatorCode||'').trim().toUpperCase());
    if(!worker)throw Error('QR de operario no activo');
    if(b.action.kind==='return'&&Array.isArray(b.action.itemOverrides))for(const item of b.action.itemOverrides){
     if(item?.mode!=='catalog')continue;const id=Number(item.product?.productId);if(!Number.isInteger(id)||id<=0)throw Error('Selecciona el producto distinto desde el catálogo Odoo');
     const found=(await deps.catalog('',id)).products.find((product:any)=>product.productId===id);if(!found||found.sku!==item.product?.sku)throw Error('El producto recibido ya no coincide con el catálogo Odoo; vuelve a seleccionarlo');item.product=found;
    }
    const updated=await service.action(receiptMatch[1],Number(b.revision),{...b.action,operator:{id:worker.id,code:worker.code,name:worker.name}},`${actor} · Recepciones: ${worker.name} (${worker.code})`);
    const job=enqueue(updated,actor,user);send(response,200,{incident:updated,background:{state:job.state,message:job.message}});return;
   }
   const coherenceMatch=url.pathname.match(/^\/(INC-\d{4}-\d{5,})\/coherence$/);
   if(request.method==='POST'&&coherenceMatch){if(mode()!=='test'||target()!==TEST_TARGET||user.role!=='admin')throw Error('Conciliación de coherencia exclusiva LAB DEMO');const body=await read(request);send(response,200,{incident:await service.reconcileCoherence(coherenceMatch[1],Number(body.revision),actor)});return;}
   const actionMatch=url.pathname.match(/^\/(INC-\d{4}-\d{5,})\/actions$/);
   if(request.method==='POST'&&actionMatch){const b=await read(request);if(['return','review_return','assume_return'].includes(b.action?.kind))throw Error('Procesa DEV desde Productos → Recepciones; operario obligatorio');if(['replacement','wrong_received'].includes(b.action?.kind)){const id=b.action.product?.productId;if(!Number.isInteger(id)||id<=0)throw Error('Producto alternativo inválido');const product=(await deps.catalog('',id)).products.find(p=>p.productId===id);if(!product||product.sku!==b.action.product.sku)throw Error('La alternativa no coincide con el catálogo de esta conexión Odoo');b.action.product=product;}const updated=await service.action(actionMatch[1],Number(b.revision),b.action,actor);if(['diagnosis','replacement','wrong_received'].includes(b.action?.kind)){const job=enqueue(updated,actor,user,false,true);send(response,200,{incident:updated,background:{state:job.state,message:job.message}});}else send(response,200,{incident:updated});return;}
   // Browser sends bytes directly to Google resumable URL; only IDs/metadata reach Dashboard.
   if(request.method==='GET'&&url.pathname==='/uploads/pending'){
    const actorId=String(user.id||user.username);const incidentId=url.searchParams.get('incidentId');const requestId=url.searchParams.get('requestId');
    send(response,200,{uploads:uploads.all().filter(x=>x.actor===actorId&&!x.completedFileId&&((incidentId&&x.incidentId===incidentId)||(requestId&&x.requestId===requestId))).map(x=>({uploadId:x.id,name:x.name,createdAt:x.createdAt,returnId:x.returnId}))});return;
   }
   if(request.method==='POST'&&url.pathname==='/uploads/init'){await serialUpload(async()=>{
    if(env.INCIDENTS_DRIVE_WRITE_ENABLED!=='true'||!repo.status().writable)throw Error('Drive/Sheets no habilitados; pendiente conexión autorizada');
    const b=await read(request);const i=b.incidentId?(await repo.list(true)).find(x=>x.id===b.incidentId):undefined;if(b.incidentId&&(!i||i.status==='Cerrada'))throw Error('Incidencia no editable');if(!i&&!/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId||''))throw Error('Solicitud de borrador inválida');if(b.returnId&&!i?.returns.some(r=>r.id===b.returnId))throw Error('DEV ajeno a incidencia');
    if(!['image/jpeg','image/png','image/webp'].includes(b.mimeType)||!Number.isFinite(b.size)||b.size<=0||b.size>15*1024*1024)throw Error('Solo se admiten fotos JPEG, PNG o WebP (máximo 15 MB); los albaranes y documentos no se guardan en Drive');
    const root=env.INCIDENTS_DRIVE_ROOT_ID;if(!root||!/^[-\w]+$/.test(root))throw Error('Configura carpeta INCIDENCIAS de Drive');
    const folder=async(parent:string,name:string,appProperties?:Record<string,string>)=>{const q=encodeURIComponent(`'${parent}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);const found=await google.request(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=2`);if(found.files.length>1)throw Error('Carpetas duplicadas; revisar Drive');if(found.files[0])return found.files[0].id;return (await google.request('https://www.googleapis.com/drive/v3/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parents:[parent],mimeType:'application/vnd.google-apps.folder',appProperties})})).id;};
    const year=await folder(root,i?.id.split('-')[1]||String(new Date().getFullYear()));const base=await folder(year,i?.id||`BORRADOR-${b.requestId}`,i?undefined:{incidentDraftRequestId:b.requestId});const photosFolder=String(b.mimeType).startsWith('image/')?await folder(base,'Fotos'):undefined;const parent=photosFolder||(b.returnId?await folder(base,b.returnId):base);
    const origin=request.headers.origin;if(origin&&new URL(origin).host!==request.headers.host)throw Error('Origen de subida no coincide con el Dashboard');
    const uploadId=crypto.randomUUID();
    uploads.put({id:uploadId,incidentId:i?.id,requestId:i?undefined:b.requestId,returnId:b.returnId,name:String(b.name).slice(0,160),mimeType:b.mimeType,size:b.size,parentId:parent,baseFolderId:base,photosFolderId:photosFolder,actor:String(user.id||user.username),createdAt:new Date().toISOString()});
    const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink,parents',{method:'POST',headers:{Authorization:`Bearer ${await google.accessToken()}`,...(origin?{Origin:origin}:{}),'Content-Type':'application/json','X-Upload-Content-Type':b.mimeType,'X-Upload-Content-Length':String(b.size)},body:JSON.stringify({name:String(b.name).slice(0,160),parents:[parent],appProperties:{incidentUploadId:uploadId}}),signal:AbortSignal.timeout(20000)});const uploadUrl=r.headers.get('location');if(!r.ok||!uploadUrl)throw Error('Drive no confirmó la sesión de subida');send(response,200,{uploadId,uploadUrl});});return;
   }
   if(request.method==='POST'&&['/uploads/complete','/uploads/recover'].includes(url.pathname)){await serialUpload(async()=>{
    if(env.INCIDENTS_DRIVE_WRITE_ENABLED!=='true'||!repo.status().writable)throw Error('Escrituras bloqueadas');
    const b=await read(request);const pending=uploads.get(String(b.uploadId),String(user.id||user.username));
    let fileId=pending.completedFileId||b.fileId;
    if(!fileId){const query=encodeURIComponent(`'${pending.parentId}' in parents and appProperties has { key='incidentUploadId' and value='${pending.id}' } and trashed = false`);const found=await google.request(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=2`);if(found.files.length!==1)throw Error(found.files.length?'Varios archivos coinciden; revisión manual necesaria':'Drive no confirma ningún archivo completo; no se registra éxito');fileId=found.files[0].id;}
    const file=await google.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(String(fileId))}?fields=id,name,mimeType,size,parents,appProperties,trashed`);
    if(file.trashed||file.mimeType!==pending.mimeType||!file.parents?.includes(pending.parentId)||Number(file.size)!==pending.size||file.appProperties?.incidentUploadId!==pending.id)throw Error('Archivo Drive no coincide con la sesión, tamaño o carpeta');
    const evidence={id:file.id,name:file.name,url:`https://drive.google.com/file/d/${file.id}/view`,mimeType:file.mimeType,returnId:pending.returnId};
    if(!pending.incidentId){uploads.put({...pending,completedFileId:file.id});send(response,200,{evidence,driveFolderId:pending.baseFolderId,photosFolderId:pending.photosFolderId});return;}
    const incident=await service.attachEvidence(pending.incidentId,evidence,{id:pending.baseFolderId,url:`https://drive.google.com/drive/folders/${pending.baseFolderId}`},actor,pending.photosFolderId?{id:pending.photosFolderId,url:`https://drive.google.com/drive/folders/${pending.photosFolderId}`}:undefined);
    uploads.put({...pending,completedFileId:file.id});send(response,200,{incident});
   });return;}
   send(response,404,{message:'Ruta no disponible'});
  }catch(e){const message=e instanceof Error?e.message:'Error de incidencias';send(response,/Otro usuario/.test(message)?409:/bloquead|pendiente|configura|completo|credencial/i.test(message)?503:400,{message});}
 });
}
