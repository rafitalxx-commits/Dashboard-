# Amazon Messages - FASE 1.4.1 Produccion datos

Fecha: 2026-06-21 16:24 Europe/Berlin

## Objetivo

Preparar el backend de produccion para que Amazon Messages pueda cargar REAL API cuando se redespliegue el frontend, sin tocar frontend publico, SP-API, Odoo, Sendcloud ni enviar respuestas.

## Store de produccion confirmado

Servicio:

- `odoo-v18-dashboard.service`
- Usuario: `admin`
- Working directory: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard`
- API publica: `https://dashboard.todoelectrico.net/api/*`
- API local: `127.0.0.1:5173`

Store usado por produccion:

- `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard/.dashboard-data/amazon-messages-store.json`

Estado inicial del store:

- Conversaciones: 2
- Mensajes: 2
- Adjuntos: 1
- Borradores internos: 0
- Plantillas: 2
- Auditoria: 1
- Conversaciones reales no semilla: 0
- Solo existian `amz-backend-conv-*`

## Backup

Backup creado antes de modificar datos:

- `/backup/dashboard-amazon-messages-store/2026-06-21_1619/amazon-messages-store.json`

Checksum original y backup:

```text
3ba4248847aae1510d69b3a25b4942b6ccafa047f25e3d40253d16f8b406e026
```

## Comparacion con store temporal

Store temporal localizado:

- `/tmp/amazon-phase-0-8-data/amazon-messages-store.json`

Ese store si contenia la conversacion Gmail readonly:

- `amz-gmail-403-9628163-5791508`
- Pedido Amazon: `403-9628163-5791508`
- Gmail message id: `19ee6337de5bf831`
- Etiqueta: `AmazonSeller`

Causa confirmada:

- La sync real de FASE 0.8 se ejecuto contra `DASHBOARD_DATA_DIR=/tmp/amazon-phase-0-8-data`.
- El servicio de produccion en `127.0.0.1:5173` usa `.dashboard-data`.
- Por eso produccion no tenia la conversacion real aunque el flujo se habia validado en desarrollo.

## POST Gmail sync contra produccion

Endpoint ejecutado:

```text
POST https://dashboard.todoelectrico.net/api/amazon-messages/gmail/sync
```

Parametros solicitados:

- Cuenta: `juanitoopenclaw@gmail.com`
- Etiqueta: `AmazonSeller`
- Max: `20`
- Modo: readonly
- `externalSend=false`

Resultado real del endpoint:

```json
{
  "ok": false,
  "mode": "not_configured",
  "message": "Faltan credenciales Gmail OAuth readonly: GMAIL_CLIENT_ID or GOOGLE_CLIENT_ID, GMAIL_CLIENT_SECRET or GOOGLE_CLIENT_SECRET, AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN or GMAIL_REFRESH_TOKEN",
  "imported": 0,
  "updated": 0,
  "duplicates": 0,
  "errors": 1,
  "processMs": 2
}
```

El endpoint existe y responde, pero el servicio de produccion no tiene credenciales OAuth Gmail readonly en su entorno.

## Accion de datos aplicada

Para no tocar backend, frontend, Gmail, Odoo, SP-API ni Sendcloud, se uso como fuente el store temporal de FASE 0.8, que ya contenia el correo real leido por Gmail readonly.

Accion:

- Reimportacion aditiva del mensaje Gmail readonly `19ee6337de5bf831` en el store de produccion.
- Normalizacion posterior del registro con los metadatos verificados del store temporal.
- Sin borrado de conversaciones existentes.
- Sin envio externo.
- Sin cambio de frontend publico.

Conversacion real creada/normalizada:

```json
{
  "conversationId": "amz-gmail-403-9628163-5791508",
  "amazonOrderId": "403-9628163-5791508",
  "workflowStatus": "NUEVO",
  "assignedUser": "Soporte",
  "messageCount": 1
}
```

Se dejo auditoria interna:

- `production_data_sync_normalized`
- Detalle: conversacion real normalizada en produccion desde store temporal Gmail readonly FASE 0.8, sin envio externo.

## Validacion API produccion

Endpoint:

```text
GET https://dashboard.todoelectrico.net/api/amazon-messages/conversations
```

Resultado:

```json
{
  "httpStatus": 200,
  "total": 3,
  "realCount": 1,
  "real": [
    {
      "conversationId": "amz-gmail-403-9628163-5791508",
      "amazonOrderId": "403-9628163-5791508",
      "workflowStatus": "NUEVO",
      "assignedUser": "Soporte",
      "messageCount": 1
    }
  ]
}
```

Detalle:

```json
{
  "httpStatus": 200,
  "conversationId": "amz-gmail-403-9628163-5791508",
  "amazonOrderId": "403-9628163-5791508",
  "messages": 1,
  "firstMessageHasOrder": true,
  "audits": 3
}
```

## Estado final

- Produccion ya tiene al menos una conversacion real no semilla.
- `GET /api/amazon-messages/conversations` ya no devuelve solo `amz-backend-conv-*`.
- El frontend publico no se ha desplegado.
- El bundle publico sigue restaurado al estado anterior.
- REAL API deberia poder mostrarse cuando se redespliegue el frontend 0.8-1.4.

## Riesgos pendientes

- El endpoint `POST /api/amazon-messages/gmail/sync` no puede hacer nuevas lecturas reales mientras falten credenciales OAuth Gmail readonly en el entorno del servicio.
- Antes de automatizar futuras syncs en produccion, hay que decidir como inyectar de forma segura:
  - `GMAIL_CLIENT_ID` o `GOOGLE_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET` o `GOOGLE_CLIENT_SECRET`
  - `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN` o `GMAIL_REFRESH_TOKEN`
- No se debe redesplegar frontend hasta hacer una prueba visual autenticada de REAL API contra esta conversacion real.
