# Agent API Hermes Access

Fecha: 2026-07-07

## Objetivo

Permitir que un agente externo, por ejemplo Hermes en otro VPS, ayude con tareas y Amazon Messages sin usar cookie de navegador ni credenciales normales del Dashboard.

Esta fase se preparo primero en lab/paralelo y se desplego despues en produccion el 2026-07-07 con autorizacion de Rafa.

## Seguridad

- Autenticacion: `Authorization: Bearer <token>`.
- Configuracion recomendada: guardar solo hash SHA-256 del token en entorno.
- Scopes granulares:
  - `tasks:read`
  - `tasks:write`
  - `amazon:read`
  - `amazon:draft:write`
  - `amazon:pending-reply:write`
- No existen rutas Agent API para:
  - enviar emails;
  - finalizar envio Gmail;
  - crear/actualizar Gmail Draft real;
  - tocar SP-API;
  - tocar Odoo;
  - tocar Sendcloud;
  - gestionar usuarios/configuracion.

## Configuracion de ejemplo

Generar token largo fuera del repo y guardar solo su hash:

```bash
printf '%s' 'TOKEN_LARGO_HERMES' | sha256sum
```

Variable de entorno:

```bash
DASHBOARD_AGENT_API_TOKENS=hermes:sha256:HASH_SHA256:tasks:read,tasks:write,amazon:read,amazon:draft:write,amazon:pending-reply:write
```

Tambien existe modo simple para un unico token:

```bash
DASHBOARD_AGENT_API_TOKEN=TOKEN_LARGO_HERMES
DASHBOARD_AGENT_API_ID=agent-hermes
DASHBOARD_AGENT_API_NAME=Hermes
DASHBOARD_AGENT_API_SCOPES=tasks:read,tasks:write,amazon:read,amazon:draft:write
```

## Endpoints

Base: `/api/agent`

- `GET /health`
- `GET /tasks`
- `POST /tasks`
- `PATCH /tasks/:taskId`
- `GET /amazon/conversations`
- `GET /amazon/conversations/:conversationId`
- `GET /amazon/conversations/:conversationId/draft`
- `POST /amazon/conversations/:conversationId/draft`
- `PUT /amazon/conversations/:conversationId/draft`
- `POST /amazon/conversations/:conversationId/draft/from-template`
- `POST /amazon/conversations/:conversationId/draft/smart`
- `POST /amazon/conversations/:conversationId/pending-reply`

## Ejemplos

Crear tarea:

```bash
curl -X POST https://dashboard.todoelectrico.net/api/agent/tasks \
  -H "Authorization: Bearer TOKEN_LARGO_HERMES" \
  -H "Content-Type: application/json" \
  -d '{"title":"Revisar incidencia Amazon","detail":"Preparar borrador interno","priority":"Alta","category":"Amazon"}'
```

Crear borrador interno:

```bash
curl -X POST https://dashboard.todoelectrico.net/api/agent/amazon/conversations/CONV_ID/draft \
  -H "Authorization: Bearer TOKEN_LARGO_HERMES" \
  -H "Content-Type: application/json" \
  -d '{"draftBody":"Hola, revisamos tu incidencia y te responderemos con la solucion.","status":"BORRADOR_INTERNO"}'
```

## Validacion

Prueba agregada:

```bash
npm run test:agent-api
```

Comprueba:

- token ausente rechazado;
- token valido aceptado;
- creacion de tarea;
- lectura de conversaciones Amazon;
- `externalSend=true` bloqueado;
- creacion de borrador interno permitida;
- ruta de envio final inexistente en Agent API.

## Produccion 2026-07-07

Backup previo:

- `/backup/dashboard-agent-api/2026-07-07_165342`

Token:

- Guardado en `/root/.openclaw/workspace/outbox/hermes-agent-api-token-20260707.txt`
- En entorno solo queda el hash SHA-256 dentro de `/etc/odoo-v18-dashboard/amazon-messages-gmail.env`.

Validacion produccion:

- `GET https://dashboard.todoelectrico.net/api/agent/health`: 200.
- `GET /api/agent/health` sin token: 401.
- `GET /api/agent/tasks`: 200.
- `GET /api/agent/amazon/conversations`: 200.
- `POST /api/agent/amazon/conversations/:id/finalize`: 404.
- `POST /api/agent/amazon/conversations/:id/draft` con `externalSend=true`: 400.

## Restriccion IP 2026-07-07

Rafa indico el origen de Hermes como `sqx-hel.neuravps.com:20350`.

Resolucion DNS aplicada:

- IPv4: `77.42.49.79`
- IPv6: `2a01:4f9:fff1:5f::2`

Configuracion:

- `DASHBOARD_AGENT_API_ALLOWED_IPS=77.42.49.79,2a01:4f9:fff1:5f::2`

La API solo confia en `X-Forwarded-For` cuando la peticion llega desde Caddy/local (`127.0.0.1` o `::1`). Una conexion directa al puerto Vite no puede falsificar `X-Forwarded-For` para saltarse la allowlist.

Validacion:

- `X-Forwarded-For: 77.42.49.79`: 200.
- `X-Forwarded-For: 2a01:4f9:fff1:5f::2`: 200.
- `X-Forwarded-For: 203.0.113.10`: 403.
- Llamada HTTPS local sin origen Hermes: 403.
