import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export type PendingUpload = {
 id:string; actor:string; incidentId?:string; requestId?:string; returnId?:string;
 name:string; mimeType:string; size:number; parentId:string; baseFolderId:string; photosFolderId?:string;
 createdAt:string; completedFileId?:string;
};
/** Metadata only. Never persist photo bytes, OAuth tokens or resumable URLs. */
export class UploadJournal {
 private path:string;
 constructor(directory:string){this.path=join(directory,'incidents-uploads.json');}
 all():PendingUpload[]{return existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):[];}
 get(id:string,actor:string){const entry=this.all().find(x=>x.id===id&&x.actor===actor);if(!entry)throw Error('Sesión de subida no encontrada para este usuario');return entry;}
 put(entry:PendingUpload){const entries=this.all().filter(x=>x.id!==entry.id);entries.push(entry);mkdirSync(join(this.path,'..'),{recursive:true});const tmp=this.path+'.'+crypto.randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(entries),{mode:0o600});renameSync(tmp,this.path);}
}
