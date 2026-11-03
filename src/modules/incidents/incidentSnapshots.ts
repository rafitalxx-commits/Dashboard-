import type {Incident} from '../../../backend/incidents/types';

/** A delayed reader must never roll back a mutation already acknowledged by the server.
 * Incidences have no delete action: retain records absent from an older list snapshot. */
export function mergeIncidentSnapshots(current:Incident[],incoming:Incident[]):Incident[]{
 const byId=new Map(current.map(i=>[i.id,i]));
 for(const next of incoming){const prior=byId.get(next.id);if(!prior||next.revision>=prior.revision)byId.set(next.id,next);}
 return [...byId.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
