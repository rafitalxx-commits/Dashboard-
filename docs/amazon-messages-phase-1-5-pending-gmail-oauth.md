# Amazon Messages - FASE 1.5 pendiente OAuth Gmail readonly

Fecha: 2026-06-21

## Pendiente

FASE 1.5: conectar OAuth Gmail readonly al backend de produccion mediante variables seguras.

## Contexto

La cuenta correcta para Amazon Messages es:

- `juanitoopenclaw@gmail.com`

OpenClaw/gog ya tiene Gmail conectado para esa cuenta, pero el backend de produccion del Dashboard todavia no tiene credenciales OAuth disponibles para ejecutar sincronizaciones nuevas desde:

```text
POST /api/amazon-messages/gmail/sync
```

## Variables necesarias

El backend espera recibir estas variables por entorno seguro:

- `GMAIL_CLIENT_ID` o `GOOGLE_CLIENT_ID`
- `GMAIL_CLIENT_SECRET` o `GOOGLE_CLIENT_SECRET`
- `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN` o `GMAIL_REFRESH_TOKEN`

La configuracion funcional esperada es:

- Cuenta: `juanitoopenclaw@gmail.com`
- Etiqueta: `AmazonSeller`
- Modo: Gmail readonly
- `externalSend=false`

## Restricciones

- No enviar correos.
- No responder compradores.
- No tocar SP-API.
- No tocar Odoo.
- No tocar Sendcloud.
- Mantener Gmail en readonly.
- Mantener `externalSend=false`.

## Estado antes de FASE 1.5

Produccion ya contiene una conversacion real importada en el store del backend:

- `amz-gmail-403-9628163-5791508`
- Pedido Amazon: `403-9628163-5791508`

El frontend de Amazon Messages puede mostrar REAL API con ese dato. FASE 1.5 solo debe resolver nuevas sincronizaciones automaticas Gmail readonly desde produccion.
