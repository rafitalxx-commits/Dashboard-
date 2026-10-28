import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoTarget, OdooDemoReader } from '../backend/incidents/odooDemo.ts';
const env = { INCIDENTS_ODOO_URL: 'https://demo-todoelectrico.odoo.rgbconsulting.com/', INCIDENTS_ODOO_DATABASE: 'odoo-todoelectrico18-demo-01', INCIDENTS_ODOO_USERNAME: 'qa', INCIDENTS_ODOO_API_KEY: 'test-only' };
assert.equal(demoTarget(env).url, 'https://demo-todoelectrico.odoo.rgbconsulting.com');
const credentialDirectory = mkdtempSync(join(tmpdir(), 'incidents-test-credentials-'));
try {
 const serviceEnv = { ...env, CREDENTIALS_DIRECTORY: credentialDirectory };
 // Missing/partial systemd provisioning must not fall back to valid env credentials.
 assert.throws(() => demoTarget(serviceEnv), /systemd/);
 writeFileSync(join(credentialDirectory, 'incidents-odoo-test-user'), 'qa-systemd\n', { mode: 0o600 });
 assert.throws(() => demoTarget(serviceEnv), /systemd/);
 writeFileSync(join(credentialDirectory, 'incidents-odoo-test-key'), 'synthetic-test-key\n', { mode: 0o600 });
 const supplied = demoTarget(serviceEnv);
 assert.equal(supplied.username, 'qa-systemd');
 assert.equal(supplied.apiKey, 'synthetic-test-key');
 assert.equal(serviceEnv.INCIDENTS_ODOO_API_KEY, 'test-only');
 assert.throws(() => demoTarget({ ...serviceEnv, INCIDENTS_ODOO_DATABASE: 'erp2' }), /producción/);
 for (const invalid of ['', ' \n', 'secret\0invalid', 'x'.repeat(16385)]) {
  writeFileSync(join(credentialDirectory, 'incidents-odoo-test-key'), invalid);
  assert.throws(() => demoTarget(serviceEnv), error => String(error).includes('systemd') && !String(error).includes('secret'));
 }
 assert.throws(() => demoTarget({ ...env, CREDENTIALS_DIRECTORY: 'relative' }), /systemd/);
 console.log('PASS systemd: credenciales sintéticas, precedencia, no fallback, destino TEST fijo, valores inválidos y errores sanitizados');
} finally { rmSync(credentialDirectory, { recursive: true, force: true }); }
assert.throws(() => demoTarget({ ODOO_URL: env.INCIDENTS_ODOO_URL, ODOO_DATABASE: 'erp2', ODOO_USERNAME: 'qa', ODOO_API_KEY: 'test-only' }));
for (const database of ['erp2', '', 'demo-other', 'demo']) assert.throws(() => demoTarget({ ...env, INCIDENTS_ODOO_DATABASE: database }));
for (const url of ['http://demo.example.test', 'https://qa:secret@demo.example.test', 'https://demo-todoelectrico.odoo.rgbconsulting.com/?key=secret', 'https://demo-todoelectrico.odoo.rgbconsulting.com/jsonrpc', 'https://demo-todoelectrico.odoo.rgbconsulting.com/#erp2']) assert.throws(() => demoTarget({ ...env, INCIDENTS_ODOO_URL: url }));
const calls: any[] = [];
const transport: typeof fetch = async (url, init) => {
 const body = JSON.parse(String(init?.body)); calls.push({ url, init, body });
 const result = body.params.service === 'common' ? 7 : body.params.args[4] === 'fields_get' ? { quantity: { type: 'float' } } : [{ id: 1 }];
 return new Response(JSON.stringify({ result }));
};
const reader = new OdooDemoReader(env, transport);
for (const method of ['create', 'write', 'unlink', 'button_validate', 'action_confirm']) await assert.rejects(reader.read('stock.picking', method, []), /solo permite/);
await assert.rejects(reader.read('ir.cron', 'search_read', []), /solo permite/);
assert.equal(calls.length, 0);
const report = await reader.inspect();
assert.equal(report.writesEnabled, false); assert.equal(calls.length, 6);
assert.equal(calls.filter(c => c.body.params.service === 'common').length, 1);
for (const call of calls) { assert.equal(call.url, 'https://demo-todoelectrico.odoo.rgbconsulting.com/jsonrpc'); assert.equal(call.init.redirect, 'error'); assert.equal(call.body.params.args[0], 'odoo-todoelectrico18-demo-01'); }
assert(!JSON.stringify(report).includes('test-only'));
const failure = async (payload: any) => { const r = new OdooDemoReader(env, async () => new Response(JSON.stringify(payload))); await assert.rejects(r.inspect(), error => !String(error).includes('VERY_SECRET')); };
await failure({ error: { data: { debug: 'VERY_SECRET' } } });
await failure({ result: false });
await assert.rejects(new OdooDemoReader(env, async () => { throw Error('VERY_SECRET'); }).inspect(), /No se pudo conectar/);
console.log('PASS demo: configuración exclusiva, sin fallback erp2, HTTPS, sin redirecciones, solo lectura, autenticación y errores sin secretos');
