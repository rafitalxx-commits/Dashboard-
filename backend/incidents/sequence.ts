import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type SequenceState = { year: number; incident: number; dev: number };

/** Persistent high-water marks prevent reusing audit-linked IDs after an incident archive is cleared. */
export class IncidentSequence {
 private state: SequenceState;

 constructor(private path: string | undefined, year: number, incidentIds: string[], devIds: string[]) {
  const maximum = (prefix: string, ids: string[]) => {
   const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
   return Math.max(0, ...ids.map(id => Number(id.match(re)?.[1] || 0)));
  };
  let saved: SequenceState | undefined;
  if (path && existsSync(path)) {
   try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(parsed.year) || !Number.isInteger(parsed.incident) || !Number.isInteger(parsed.dev) || parsed.incident < 0 || parsed.dev < 0) throw Error();
    saved = parsed;
   } catch {
    throw Error('Contador de incidencias ilegible; no se crearán IDs potencialmente duplicados');
   }
  }
  this.state = {
   year,
   incident: Math.max(maximum('INC', incidentIds), saved?.year === year ? saved.incident : 0),
   dev: Math.max(maximum('DEV', devIds), saved?.year === year ? saved.dev : 0),
  };
 }

 next(prefix: 'INC' | 'DEV') {
  if (prefix === 'INC') this.state.incident++;
  else this.state.dev++;
  const value = prefix === 'INC' ? this.state.incident : this.state.dev;
  return `${prefix}-${this.state.year}-${String(value).padStart(5, '0')}`;
 }

 persist() {
  if (!this.path) return;
  mkdirSync(dirname(this.path), { recursive: true });
  const temp = `${this.path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600, flush: true });
  renameSync(temp, this.path);
 }
}
