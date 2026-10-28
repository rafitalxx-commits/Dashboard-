import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerIncidentRoutes } from '../backend/incidents/routes.ts';
const dir=mkdtempSync(join(tmpdir(),'incidents-upload-test-'));
writeFileSync(join(dir,'tokens.json'),JSON.stringify({refresh_token:'DUMMY-NOT-A-CREDENTIAL'}));
writeFileSync(join(dir,'client.json'),JSON.stringify({web:{client_id:'DUMMY',client_secret:'DUMMY'}}));
let user={id:'tester',name:'Tester',role:'admin',permissions:['products']};let handler:any;let folder=0;
const made:any[]=[];let parents=['folder-3'];let size=900;let appProperties:any={};let calls=0;let uploadPosts=0;let fileComplete=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,init:any={})=>{
 calls++;url=String(url);
 if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'DUMMY',expires_in:3600});
 if(url.includes('/drive/v3/about?'))return Response.json({user:{emailAddress:'test@example.test'}});
 if(url.includes('/files?q='))return Response.json({files:url.includes('appProperties')&&fileComplete?[{id:'PHOTO'}]:[]});
 if(url==='https://www.googleapis.com/drive/v3/files'){const data=JSON.parse(init.body);made.push(data);return Response.json({id:`folder-${++folder}`});}
 if(url.startsWith('https://www.googleapis.com/upload/drive/v3/files')){
  uploadPosts++;const body=JSON.parse(init.body);assert.equal(init.headers.Origin,'https://dashboard.test');assert.equal(body.parents[0],'folder-3');assert(!init.body.includes('base64'));appProperties=body.appProperties;
  return new Response('',{status:200,headers:{location:'https://www.googleapis.com/upload/test-only-session'}});
 }
 if(url.includes('/files/PHOTO'))return Response.json({id:'PHOTO',name:'foto.jpg',mimeType:'image/jpeg',size:String(size),parents,appProperties,trashed:false});
 throw Error('Unexpected mocked URL');
}) as any;
const env={DASHBOARD_DATA_DIR:dir,INCIDENTS_GOOGLE_ACCOUNT:'test@example.test',INCIDENTS_SPREADSHEET_ID:'TEST-NOT-REAL',INCIDENTS_SHEETS_WRITE_ENABLED:'true',INCIDENTS_DRIVE_WRITE_ENABLED:'true',INCIDENTS_DRIVE_ROOT_ID:'TEST-ROOT',INCIDENTS_GOOGLE_TOKENS_PATH:join(dir,'tokens.json'),INCIDENTS_GOOGLE_CLIENT_PATH:join(dir,'client.json')};
const register=()=>registerIncidentRoutes({middlewares:{use:(_path:any,fn:any)=>handler=fn}},{getSessionUser:()=>user},env,{catalog:async()=>({products:[],hasMore:false}),lookup:async()=>{throw Error('unused');},statistics:async()=>({}),image:async()=>Buffer.alloc(0)});
async function call(path:string,body?:unknown){const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method:body?'POST':'GET',url:path,headers:{origin:'https://dashboard.test',host:'dashboard.test'}});const res:any={statusCode:200,setHeader:()=>{},end:(data:any)=>res.value=JSON.parse(data)};await handler(req,res);return res;}
try{
 register();const requestId=crypto.randomUUID();
 const pdf=await call('/uploads/init',{requestId,name:'albaran.pdf',mimeType:'application/pdf',size:900});assert.equal(pdf.statusCode,400);assert.match(pdf.value.message,/solo se admiten fotos/i);assert.equal(calls,0,'Reject PDFs before any Drive request');
 const init=await call('/uploads/init',{requestId,name:'foto.jpg',mimeType:'image/jpeg',size:900});assert.equal(init.statusCode,200,init.value.message);
 assert.equal(made.length,3);assert.equal(made[1].name,'BORRADOR-'+requestId);assert.equal(made[1].appProperties.incidentDraftRequestId,requestId);assert.equal(made[2].name,'Fotos');assert.deepEqual(made[2].parents,['folder-2']);
 const body={uploadId:init.value.uploadId,fileId:'PHOTO'};
 parents=['WRONG-PARENT'];assert.equal((await call('/uploads/complete',body)).statusCode,400);parents=['folder-3'];
 size=901;assert.equal((await call('/uploads/complete',body)).statusCode,400);size=900;
 const originalProps=appProperties;appProperties={incidentUploadId:'OTHER'};assert.equal((await call('/uploads/complete',body)).statusCode,400);appProperties=originalProps;
 user={...user,id:'other-id'};assert.equal((await call('/uploads/complete',body)).statusCode,400);assert.equal((await call('/uploads/pending?requestId='+requestId)).value.uploads.length,0);user={...user,id:'tester'};
 // Restart before finalization: original metadata must survive without tokens or file bytes.
 register();assert.equal((await call('/uploads/pending?requestId='+requestId)).value.uploads.length,1);
 assert((await call('/uploads/recover',{uploadId:body.uploadId})).statusCode>=400,'Incomplete upload must never be success');
 fileComplete=true;
 const complete=await call('/uploads/recover',{uploadId:body.uploadId});assert.equal(complete.statusCode,200,complete.value.message);assert.equal(complete.value.evidence.id,'PHOTO');assert.equal(complete.value.driveFolderId,'folder-2');assert.equal(complete.value.photosFolderId,'folder-3');
 register();const replay=await call('/uploads/complete',body);assert.equal(replay.statusCode,200);assert.deepEqual(replay.value,complete.value);
 assert.equal((await call('/uploads/pending?requestId='+requestId)).value.uploads.length,0);
 assert.equal(uploadPosts,1,'Reconciliation must never create another upload');
 const journal=readFileSync(join(dir,'incidents-uploads.json'),'utf8');assert(!journal.includes('DUMMY')&&!journal.includes('upload/test-only-session')&&!journal.includes('base64'));
 console.log(`PASS Drive interceptado: padre/tamaño/sesión/usuario, reinicio antes y después, subida incompleta bloqueada, recuperación y reintento idempotente; ${calls} llamadas simuladas, una sesión y cero APIs reales.`);
}finally{globalThis.fetch=originalFetch;}
