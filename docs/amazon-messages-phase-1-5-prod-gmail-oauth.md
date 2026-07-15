# Amazon Messages - FASE 1.5 OAuth Gmail readonly produccion

Fecha: 2026-06-21

## Objetivo

Conectar Gmail readonly al backend de produccion del Dashboard para que:

```text
POST /api/amazon-messages/gmail/sync
```

pueda leer nuevos mensajes Amazon desde:

- Cuenta: `juanitoopenclaw@gmail.com`
- Etiqueta: `AmazonSeller`
- Max: `20`
- Modo operativo: readonly
- `externalSend=false`

## Restricciones mantenidas

- No se enviaron correos.
- No se respondio a compradores.
- No se toco SP-API.
- No se toco Odoo.
- No se toco Sendcloud.
- No se borraron datos.
- No se guardaron secretos en git.
- No se imprimieron tokens completos en logs ni salida.

## Gestion de variables de entorno

Servicio de produccion:

- `odoo-v18-dashboard.service`
- Usuario: `admin`
- Working directory: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard`
- API local: `127.0.0.1:5173`

Metodo usado:

- systemd drop-in
- `EnvironmentFile` externo al repo

Ficheros:

- Drop-in: `/etc/systemd/system/odoo-v18-dashboard.service.d/amazon-messages-gmail.conf`
- EnvironmentFile: `/etc/odoo-v18-dashboard/amazon-messages-gmail.env`
- Permisos EnvironmentFile: `600`

Variables configuradas:

- `AMAZON_MESSAGES_GMAIL_ACCOUNT`
- `AMAZON_MESSAGES_GMAIL_LABEL`
- `AMAZON_MESSAGES_GMAIL_MAX_MESSAGES`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN`

Los valores secretos no estan en git.

Backup previo de systemd:

- `/backup/dashboard-systemd/2026-06-21_1850/odoo-v18-dashboard.service`

## Origen de credenciales

OpenClaw/gog tenia OAuth valido para:

- `juanitoopenclaw@gmail.com`

Se verifico:

- cuenta presente en `gog auth list`
- lectura Gmail funcional con `gog gmail messages search`
- refresh OAuth valido antes de configurar el backend

Nota de seguridad:

- El token existente de gog tiene scope Gmail mas amplio que readonly (`gmail.modify`).
- El backend solo implementa lectura mediante Gmail API y no tiene flujo de envio.
- Riesgo pendiente: reautorizar en una fase posterior con scope Gmail readonly minimo si se quiere reducir alcance OAuth.

## Servicio reiniciado

Unico servicio reiniciado:

```text
odoo-v18-dashboard
```

Comandos operativos realizados:

- `systemctl daemon-reload`
- `systemctl restart odoo-v18-dashboard`

Estado posterior:

- `active (running)`
- Drop-in cargado correctamente.

## Prueba sync controlada

Endpoint:

```text
POST https://dashboard.todoelectrico.net/api/amazon-messages/gmail/sync
```

Body usado:

```json
{
  "label": "AmazonSeller",
  "max": 20,
  "readonly": true,
  "externalSend": false
}
```

Resultado:

```json
{
  "httpStatus": "200",
  "ok": true,
  "mode": "gmail_readonly",
  "account": "juanitoopenclaw@gmail.com",
  "labelName": "AmazonSeller",
  "scanned": 20,
  "imported": 14,
  "updated": 6,
  "duplicates": 0,
  "errors": 0,
  "processMs": 1198,
  "resultCount": 20
}
```

No hubo envio externo.

## Validacion API posterior

Endpoint:

```text
GET https://dashboard.todoelectrico.net/api/amazon-messages/conversations
```

Resultado:

```json
{
  "httpStatus": "200",
  "total": 17,
  "realCount": 15,
  "has403": true,
  "conversation403": {
    "conversationId": "amz-gmail-403-9628163-5791508",
    "workflowStatus": "NUEVO",
    "assignedUser": "Soporte",
    "messageCount": 1
  }
}
```

Estado del store tras sync:

```json
{
  "conversations": 17,
  "realConversations": 15,
  "messages": 23,
  "templates": 2,
  "internalDrafts": 0,
  "auditLogs": 45,
  "gmailSync": {
    "account": "juanitoopenclaw@gmail.com",
    "labelName": "AmazonSeller",
    "importedCount": 21,
    "duplicateCount": 0,
    "errorCount": 1,
    "pendingCount": 0,
    "averageProcessMs": 7,
    "lastHistoryId": "3345"
  }
}
```

La conversacion real previa se conserva:

- `amz-gmail-403-9628163-5791508`
- Pedido: `403-9628163-5791508`
- Workflow: `NUEVO`
- Asignado: `Soporte`

## Revision de logs

Periodo revisado:

- desde `2026-06-21 18:57:00`

Resultado:

```json
{
  "secretValuesFound": false,
  "oauthTokenLiteralFound": false,
  "envFilePathMentioned": false
}
```

## Estado final

- Gmail readonly del backend de produccion queda operativo.
- Sync manual por API funciona.
- REAL API conserva la conversacion 403 y ahora tiene mas conversaciones reales.
- No se hizo push.
- Secretos permanecen fuera de git.

## Riesgos pendientes

- Reducir el scope OAuth a Gmail readonly estricto. El token actual de gog es funcional pero mas amplio que readonly.
- Definir si la sync debe ejecutarse manualmente o programarse con cron/job interno.
- Revisar en una fase posterior la deduplicacion operativa tras varias syncs reales.
