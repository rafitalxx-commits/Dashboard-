import assert from 'node:assert/strict';
import { GoogleApi, HEADERS, SHEETS } from '../backend/incidents/repository.ts';
import { planIncidentSpreadsheet } from '../backend/incidents/spreadsheetStructure.ts';
class Fake extends GoogleApi {
  tabs: any[] = [{ sheetId: 7, title: 'PRUEBA 1', gridProperties: { columnCount: 26 } }];
  rows: any[][] = [];
  configured() { return true; }
  async request(url: string, init: RequestInit = {}) {
    assert(!init.method || init.method === 'GET', 'El plan nunca escribe');
    return url.includes('?fields=') ? { properties: { title: 'Incidencias LAB' }, sheets: this.tabs.map(properties => ({ properties })) } : { values: this.rows };
  }
}
const fake = new Fake({});
const fresh = await planIncidentSpreadsheet(fake, 'test');
assert.equal(fresh.requests.length, 20);
assert.deepEqual(fresh.preservedTabs, ['PRUEBA 1']);
assert(fresh.requests.every(r => !r.updateSheetProperties && !r.deleteSheet));
assert.equal(new Set(fresh.requests.filter(r => r.addSheet).map(r => r.addSheet.properties.sheetId)).size, 10);
fake.tabs.push({ sheetId: 8, title: SHEETS[0], gridProperties: { columnCount: 40 } });
fake.rows = [HEADERS];
assert.equal((await planIncidentSpreadsheet(fake, 'test')).requests.length, 18);
fake.rows = [['cabecera ajena']];
await assert.rejects(planIncidentSpreadsheet(fake, 'test'), /no se sobrescribe/);
fake.rows = [[], ['dato existente']];
await assert.rejects(planIncidentSpreadsheet(fake, 'test'), /no se sobrescribe/);
fake.rows = [];
assert.equal((await planIncidentSpreadsheet(fake, 'test')).requests.length, 20);
console.log('PASS estructura aditiva: preserva pestañas, IDs sin colisión, no sobrescribe, reanudable y plan sin escrituras.');
