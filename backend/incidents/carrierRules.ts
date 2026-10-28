import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {defaultCarrierRules,type CarrierRule} from './carrierPolicy.ts';
const carrierKey=(carrier:string)=>carrier.trim().toLocaleLowerCase('es');
function normalize(input:unknown):CarrierRule[]{
 if(!Array.isArray(input)||input.length>50)throw Error('Reglas inválidas');
 const rules=input.map(r=>{
  if(!r||typeof r.carrier!=='string'||!r.carrier.trim()||r.carrier.length>100||!Number.isFinite(r.hours)||r.hours<1||r.hours>1440||typeof r.enabled!=='boolean'||typeof r.suggestion!=='string'||r.suggestion.length>500||r.observations!==undefined&&(typeof r.observations!=='string'||r.observations.length>6000))throw Error('Regla de transportista inválida');
  const id=r.id||'carrier:'+carrierKey(r.carrier).normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'-');if(typeof id!=='string'||!/^[\w:.-]{1,120}$/.test(id))throw Error('Identificador de regla inválido');
  return {id,carrier:r.carrier.trim(),hours:r.hours,enabled:r.enabled,suggestion:r.suggestion,observations:r.observations||''};
 });
 if(new Set(rules.map(r=>carrierKey(r.carrier))).size!==rules.length||new Set(rules.map(r=>r.id)).size!==rules.length)throw Error('Transportistas duplicados');return rules;
}
/** Accumulative upserts: a new carrier never deletes another agency's instructions. */
export function carrierRuleStore(directory:string){
 const file=join(directory,'incidents-carrier-rules.json');
 const read=():CarrierRule[]=>{
  const stored=existsSync(file)?normalize(JSON.parse(readFileSync(file,'utf8'))):[];
  const missing=normalize(defaultCarrierRules).filter(d=>!stored.some(r=>carrierKey(r.carrier)===carrierKey(d.carrier)||r.id===d.id));return [...stored,...missing];
 };
 return {read,save:(input:unknown)=>{
  const changes=normalize(input),current=read();const merged=[...current];
  for(const rule of changes){const index=merged.findIndex(r=>r.id===rule.id);if(index>=0)merged[index]=rule;else {const sameCarrier=merged.findIndex(r=>carrierKey(r.carrier)===carrierKey(rule.carrier));if(sameCarrier>=0)merged[sameCarrier]={...rule,id:merged[sameCarrier].id};else merged.push(rule);}}
  const result=normalize(merged);mkdirSync(directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(result,null,2),{mode:0o600,flush:true});renameSync(temp,file);return result;
 }};
}
