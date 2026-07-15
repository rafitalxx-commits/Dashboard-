# Amazon Messages FASE 1.6 - Auto-sync Gmail readonly

Fecha: 2026-06-21

## Objetivo

Activar sincronizacion automatica de Gmail readonly cada 30 minutos para Amazon Messages, cuenta `juanitoopenclaw@gmail.com`, etiqueta `AmazonSeller`, manteniendo `externalSend=false` y sin tocar SP-API, Odoo, Sendcloud ni Roger.

## Archivos modificados

- `backend/amazonMessages/schema.ts`
- `backend/amazonMessages/repository.ts`
- `backend/amazonMessages/gmailSync.ts`
- `backend/amazonMessages/routes.ts`
- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `src/modules/amazonMessages/amazonMessages.css`
- `scripts/test-amazon-messages-backend.ts`
- `docs/amazon-messages-phase-1-6-auto-gmail-sync.md`

## Backend

- Job automatico configurado al registrar las rutas del modulo.
- Intervalo: 30 minutos.
- Estado persistido en `.dashboard-data/amazon-messages-store.json`.
- Estados: `OK`, `ERROR`, `EN_CURSO`.
- Lock anti-solapamiento: si hay un run `EN_CURSO`, otro sync devuelve modo `locked`.
- Historial persistido de runs con:
  - trigger `manual` / `auto`
  - leidos
  - importados
  - actualizados
  - duplicados
  - errores
  - duracion
  - `externalSend=false`
- Auditoria interna para inicio, completado, error y bloqueo por solapamiento.

## UI Supervisor

- Boton manual: `Sincronizar ahora`.
- Muestra cuenta, etiqueta, importados, actualizados, duplicados, errores, pendientes.
- Muestra estado actual, ultimo sync, proximo sync y configuracion `Cada 30 min`.
- Muestra historial reciente de sincronizaciones.
- Mantiene visible fuente `Gmail readonly` y modo seguro `Sin envio externo`.

## Produccion

URL validada:

- `https://dashboard.todoelectrico.net/#/amazon-messages`

Backup frontend previo al despliegue:

- `/backup/dashboard-frontend/2026-06-21_2205`

Archivos frontend desplegados:

- `/var/www/odoo-v18-dashboard/index.html`
- `/var/www/odoo-v18-dashboard/assets/index-I3nP4U5T.js`
- `/var/www/odoo-v18-dashboard/assets/index-CeIvH6NN.css`

Capturas de validacion:

- `docs/amazon-messages-phase-1-6-production-supervisor.png`
- `docs/amazon-messages-phase-1-6-production-inbox-403.png`

## Pruebas realizadas

```bash
npm run test:amazon-backend
npm run build
```

Resultado:

- `npm run test:amazon-backend`: OK.
- `npm run build`: OK.

Build generado:

- `dist/index.html`
- `dist/assets/index-I3nP4U5T.js`
- `dist/assets/index-CeIvH6NN.css`

## Validacion API produccion

Prueba manual contra el backend de produccion con sesion temporal autenticada:

```json
{
  "status": 200,
  "ok": true,
  "mode": "gmail_readonly",
  "scanned": 1,
  "imported": 1,
  "updated": 0,
  "duplicates": 0,
  "errors": 0
}
```

Estado posterior:

```json
{
  "status": "OK",
  "jobEnabled": true,
  "intervalMinutes": 30,
  "lastFinishedAt": "2026-06-21T20:05:08.914Z",
  "nextSyncAt": "2026-06-21T20:35:08.914Z",
  "historyHead": {
    "status": "OK",
    "trigger": "manual",
    "scanned": 1,
    "imported": 1,
    "updated": 0,
    "duplicates": 0,
    "errors": 0,
    "externalSend": false
  }
}
```

Validacion de datos:

- Conversaciones totales en store: 18.
- Conversaciones reales no semilla: 16.
- Conversacion `403-9628163-5791508`: presente.
- Mensajes: 24.
- Plantillas: 2.
- Auditoria: 50 eventos.

## Validacion visual produccion

Comprobado con navegador headless autenticado:

- `REAL API`: visible.
- `DEMO FALLBACK`: no aparece.
- Conversacion `403-9628163-5791508`: visible.
- Workflow: visible.
- Revision/borrador: visible.
- Plantillas: visibles.
- Supervisor: visible.
- Boton `Sincronizar ahora`: visible.
- Auto-sync `Cada 30 min`: visible.

## Seguridad

- No se enviaron correos.
- No se respondio a compradores.
- No se toco SP-API.
- No se toco Odoo.
- No se toco Sendcloud.
- No se toco Roger ni configuracion de modelos.
- Las llamadas Gmail siguen en readonly.
- Las pruebas y el historial mantienen `externalSend=false`.
- No se imprimieron secretos ni tokens.

## Riesgos pendientes

- El job automatico corre dentro del proceso Vite/backend actual; si el proceso se reinicia, el scheduler se reconfigura al arrancar.
- La siguiente prueba natural del run automatico queda para el proximo vencimiento de `nextSyncAt`.
- Conviene vigilar logs tras el primer run automatico real para confirmar que no hay errores OAuth intermitentes.
