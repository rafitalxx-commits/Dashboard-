# Hermes Gmail — Preparacion conexion real para rafitalxx@gmail.com

**Fecha:** 2026-07-19  
**Autor:** Glemo (subagente)  
**Revision:** Juanito / Rafa

---

## 1. Situacion actual

### 1.0 Integracion implementada en desarrollo

El modulo Tareas/Hermes ya tiene una base OAuth multicuenta para Google:

- `GET /hermes-updated/api/google/accounts`
- `GET /hermes-updated/api/google/connect/personal`
- `GET /hermes-updated/api/google/connect/work`
- `GET /oauth2/callback` (callback real en dominio sin puerto)
- `GET /hermes-updated/api/google/callback` (callback alternativo si la ruta Hermes llega al backend)
- `DELETE /hermes-updated/api/google/accounts/personal`
- `DELETE /hermes-updated/api/google/accounts/work`

Las cuentas soportadas son:

- `personal` -> `rafitalxx@gmail.com`
- `work` -> `todoelectrico.es@gmail.com`

Los tokens se guardan en un store separado y cifrado:

```bash
HERMES_GOOGLE_OAUTH_STORE=/ruta/segura/hermes-google-oauth-store.json
HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY=<secreto-largo-fuera-de-git>
HERMES_GOOGLE_OAUTH_REDIRECT_URI=https://dashboard.todoelectrico.net/oauth2/callback
HERMES_GOOGLE_PERSONAL_CLIENT_ID=<client-id-web-rafitalxx>
HERMES_GOOGLE_PERSONAL_CLIENT_SECRET=<client-secret-web-rafitalxx>
HERMES_GOOGLE_WORK_CLIENT_ID=<client-id-web-todoelectrico>
HERMES_GOOGLE_WORK_CLIENT_SECRET=<client-secret-web-todoelectrico>
```

Sin `HERMES_GOOGLE_OAUTH_ENCRYPTION_KEY`, la UI mostrara `Config pendiente` y no permitira completar OAuth. Esta clave no debe estar en frontend ni en Git.

Si existen las variables `HERMES_GOOGLE_PERSONAL_*` o `HERMES_GOOGLE_WORK_*`, Hermes usa esas credenciales para conectar y refrescar cada cuenta. Si faltan, mantiene el fallback historico `GMAIL_*` / `GOOGLE_*`.

### 1.1 Endpoint Hermes

```
GET /hermes-updated/api/inbox
```

Respuesta observada hoy (2026-07-19):

```json
{"message":"Token has been expired or revoked."}
```

El token de refresco configurado en produccion (para `juanitoopenclaw@gmail.com`) esta revocado o expirado. No hay fallback automatico.

### 1.2 Cuenta objetivo

Rafa quiere usar `rafitalxx@gmail.com` para el modulo Tareas/Hermes.

### 1.3 Bloqueo anterior (403 access_denied)

La app OAuth de `todoelectrico.net` estaba en modo **Testing** en Google Cloud Console. La cuenta `rafitalxx@gmail.com` no estaba anadida como **test user**. Google devolvio:

```
Error 403 — access_denied
```

### 1.4 Cuenta que funcionaba antes

`juanitoopenclaw@gmail.com` funcionaba previamente con el mismo OAuth client. Ahora su refresh token esta revocado.

---

## 2. Arquitectura revisada

### 2.1 Modulo Hermes (Tareas) — `vite.config.ts`

**Funciones relevantes (lineas 1469–1860):**

| Funcion | Linea | Proposito |
|---|---|---|
| `registerHermesUpdatedRoutes` | 1469 | Registra todas las rutas `/hermes-updated/api/*` |
| `loadHermesGmailEnv` | 1668 | Lee `/etc/odoo-v18-dashboard/amazon-messages-gmail.env` + `process.env` + env del servidor Vite |
| `hermesGmailConfigFromEnv` | 1707 | Resuelve cuenta/clientId/clientSecret/refreshToken con fallbacks |
| `listHermesGmailInbox` | 1729 | `GET /hermes-updated/api/inbox` — lista 10 mensajes recientes (30 dias) |
| `createHermesGmailDraft` | 1772 | `POST /hermes-updated/api/mail/draft` — crea borrador real en Gmail |
| `sendHermesGmailDraft` | 1818 | `POST /hermes-updated/api/mail/send` — envia borrador (solo si `HERMES_GMAIL_SEND_ENABLED=true`) |
| `getHermesGmailAccessToken` | 1832 | Intercambia refresh token por access token via `oauth2.googleapis.com/token` |

### 2.2 Modulo Amazon Messages — `backend/amazonMessages/`

**Archivos relevantes:**

| Archivo | Proposito |
|---|---|
| `gmailClient.ts` | Cliente Gmail API: readonly (listar mensajes por label), draft (crear/actualizar), final send (enviar draft) |
| `gmailSync.ts` | Sincronizacion automatica/manual de mensajes Amazon desde Gmail al backend |
| `routes.ts` | Endpoints `/api/amazon-messages/*` |
| `repository.ts` | Persistencia de conversaciones, mensajes, drafts, sync state |

### 2.3 Que esta compartido y que es especifico

| Aspecto | Amazon Messages | Hermes (Tareas) |
|---|---|---|
| **Endpoint base** | `/api/amazon-messages/*` | `/hermes-updated/api/*` |
| **Env file** | `/etc/odoo-v18-dashboard/amazon-messages-gmail.env` | Mismo file (via `loadHermesGmailEnv`) |
| **Client ID/Secret** | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Mismas variables (via `hermesGmailConfigFromEnv`) |
| **Refresh token** | `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN` | Mismo (fallback a `GMAIL_REFRESH_TOKEN`) |
| **Cuenta** | `AMAZON_MESSAGES_GMAIL_ACCOUNT` | `GMAIL_ACCOUNT` → `AMAZON_MESSAGES_GMAIL_ACCOUNT` → `AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT` → default `rafitalxx@gmail.com` |
| **Scopes usados** | `gmail.readonly` + `gmail.compose` | Los mismos (mismo OAuth client) |
| **Label** | `AmazonSeller` (filtrado por label) | Sin label — lista `in:inbox newer_than:30d` |
| **Draft store** | Backend repository persistente | `~/.openclaw/workspace/.openclaw/hermes-mail-drafts.json` (max 200) |
| **Send flag** | `AMAZON_MESSAGES_OUTBOUND_MODE` | `HERMES_GMAIL_SEND_ENABLED` |

**Conclusion clave:** Hermes y Amazon Messages **comparten el mismo OAuth client y el mismo env file**. Cambiar la cuenta o las credenciales afecta a ambos modulos.

### 2.4 Variables env necesarias

Resolucion de `hermesGmailConfigFromEnv` (orden de prioridad):

```
account:
  GMAIL_ACCOUNT
  → AMAZON_MESSAGES_GMAIL_ACCOUNT
  → AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT
  → "rafitalxx@gmail.com"  (default hardcoded)

clientId:
  GMAIL_CLIENT_ID
  → GOOGLE_CLIENT_ID
  → GOOGLE_CALENDAR_CLIENT_ID

clientSecret:
  GMAIL_CLIENT_SECRET
  → GOOGLE_CLIENT_SECRET
  → GOOGLE_CALENDAR_CLIENT_SECRET

refreshToken:
  GMAIL_REFRESH_TOKEN
  → AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN
  → AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN
```

**Env file de produccion** (`/etc/odoo-v18-dashboard/amazon-messages-gmail.env`) contiene actualmente:

```
AMAZON_MESSAGES_GMAIL_ACCOUNT=juanitoopenclaw@gmail.com
GOOGLE_CLIENT_ID=***
GOOGLE_CLIENT_SECRET=***
AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN=***
AMAZON_MESSAGES_GMAIL_DRAFT_ACCOUNT=juanitoopenclaw@gmail.com
AMAZON_MESSAGES_GMAIL_DRAFT_REFRESH_TOKEN=***
```

**No existe** variable `GMAIL_ACCOUNT` ni `GMAIL_REFRESH_TOKEN` independiente. Si se anade `GMAIL_ACCOUNT=rafitalxx@gmail.com` con su propio `GMAIL_REFRESH_TOKEN`, Hermes usaria esa cuenta sin afectar el `AMAZON_MESSAGES_GMAIL_ACCOUNT` de Amazon Messages.

### 2.5 Send flag

```
HERMES_GMAIL_SEND_ENABLED=true  → POST /mail/send envia el borrador real
HERMES_GMAIL_SEND_ENABLED≠true  → POST /mail/send solo crea borrador, no envia
```

Actualmente **no definido** → envio deshabilitado por defecto. Seguro.

---

## 3. Checklist para activar rafitalxx@gmail.com

### 3.1 Google Cloud Console (lo hace Juanito/Rafa manualmente)

- [ ] **P1 — OAuth Consent Screen**: Publicar la app (mover de "Testing" a "In production") **O** anadir `rafitalxx@gmail.com` como **Test user** en la OAuth consent screen.
  - Ruta: Google Cloud Console → APIs & Services → OAuth consent screen → Test users
  - Sin este paso, cualquier intento de OAuth con `rafitalxx@gmail.com` devuelve `403 access_denied`.
- [ ] **P2 — Gmail API habilitada**: Confirmar que Gmail API esta habilitada en el proyecto OAuth de `todoelectrico.net`.
  - Ruta: APIs & Services → Enabled APIs & Services → buscar "Gmail API"
- [ ] **P3 — Scopes autorizados**: Confirmar que los siguientes scopes estan en la OAuth consent screen:
  - `https://www.googleapis.com/auth/gmail.readonly` (leer inbox)
  - `https://www.googleapis.com/auth/gmail.compose` (crear/enviar drafts)
  - `https://www.googleapis.com/auth/gmail.send` (enviar drafts existentes — opcional, solo si se quiere `HERMES_GMAIL_SEND_ENABLED=true`)
- [ ] **P4 — OAuth client**: El OAuth client existente (de `todoelectrico.net`) sirve. No crear uno nuevo.
  - Redirect URI actual: `https://dashboard.todoelectrico.net/oauth2/callback` (usado por Calendar, no por Gmail direct OAuth flow)

### 3.2 Obtener refresh token para rafitalxx@gmail.com

- [ ] **P5 — Autorizar cuenta**: Hacer flujo OAuth con `rafitalxx@gmail.com`:
  - URL de consentimiento (con scopes readonly + compose + send):
    ```
    https://accounts.google.com/o/oauth2/v2/auth?
      client_id=<CLIENT_ID>&
      redirect_uri=https://dashboard.todoelectrico.net/oauth2/callback&
      response_type=code&
      scope=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send&
      access_type=offline&
      prompt=consent&
      state=rafitalxx
    ```
  - **Alternativa mas segura**: Usar `gog` CLI en el servidor con `GOG_ACCOUNT=rafitalxx@gmail.com` para hacer el flujo OAuth interactivo y obtener el refresh token sin exponer el client secret en el navegador.
- [ ] **P6 — Guardar refresh token**: Almacenar el refresh token en `/etc/odoo-v18-dashboard/amazon-messages-gmail.env` como:
  ```
  GMAIL_ACCOUNT=rafitalxx@gmail.com
  GMAIL_REFRESH_TOKEN=<nuevo_refresh_token>
  ```
  **No sobreescribir** `AMAZON_MESSAGES_GMAIL_REFRESH_TOKEN` (sigue siendo para Amazon Messages / juanitoopenclaw).
- [ ] **P7 — Permisos**: `chmod 600` en el env file (ya esta).

### 3.3 Reinicio y validacion

- [ ] **P8 — Reiniciar dashboard**: `systemctl restart odoo-v18-dashboard` (carga el env file actualizado).
- [ ] **P9 — Validar inbox readonly**: `curl http://127.0.0.1:5173/hermes-updated/api/inbox` — debe devolver mensajes, no error.
- [ ] **P10 — Validar cuenta activa**: Confirmar que la respuesta incluye `"account":"rafitalxx@gmail.com"`.
- [ ] **P11 — Confirmar Amazon Messages intacto**: `curl http://127.0.0.1:5173/api/amazon-messages/gmail/status` — debe seguir mostrando `juanitoopenclaw@gmail.com`.

---

## 4. Pruebas seguras (sin envio real)

### 4.1 Lectura — segura, no envia nada

```bash
# Listar inbox (10 mensajes, 30 dias) — solo lectura
curl -s http://127.0.0.1:5173/hermes-updated/api/inbox | python3 -m json.tool | head -30
```

**Esperado:** JSON con `account`, `messages[]` (id, threadId, from, to, subject, date, snippet, read, body).

**Si falla:** Mensaje de error de OAuth → revisar P1–P6.

### 4.2 Verificar perfil de cuenta (sin exponer token)

```bash
# Solo confirma que la cuenta responde, sin imprimir tokens
curl -s http://127.0.0.1:5173/hermes-updated/api/inbox | python3 -c "import sys,json; d=json.load(sys.stdin); print('Cuenta activa:', d.get('account','?')); print('Mensajes:', len(d.get('messages',[])))"
```

### 4.3 Crear borrador (solo si Rafa lo aprueba despues)

```bash
# Crea un draft real en Gmail pero NO lo envia
curl -s -X POST http://127.0.0.1:5173/hermes-updated/api/mail/draft \
  -H 'Content-Type: application/json' \
  -d '{"to":"rafitalxx@gmail.com","subject":"TEST HERMES - BORRADOR","body":"Prueba tecnica. No enviar."}' \
  | python3 -m json.tool
```

**Esperado:** `{"ok":true,"draft_id":"gmail-draft-...","mode":"draft","sent":false}`

**Validacion:** El borrador aparece en la carpeta Drafts de `rafitalxx@gmail.com` en Gmail.

### 4.4 Envio real — NUNCA sin flag explicito

```bash
# NO EJECUTAR hasta que Rafa lo apruebe explicitamente
# Requiere HERMES_GMAIL_SEND_ENABLED=true en env file
curl -s -X POST http://127.0.0.1:5173/hermes-updated/api/mail/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"rafitalxx@gmail.com","subject":"TEST HERMES - ENVIO","body":"Prueba tecnica controlada."}'
```

**Sin el flag:** Crea el borrador pero no envia. Devuelve mensaje: `"Envio real Gmail deshabilitado por flag; guardado como borrador real en Gmail."`

---

## 5. Riesgos actuales y mitigaciones

| # | Riesgo | Impacto | Mitigacion |
|---|---|---|---|
| R1 | App OAuth en modo Testing → 403 para rafitalxx | Bloqueo total | P1: Publicar app o anadir tester |
| R2 | Token juanitoopenclaw revocado | Amazon Messages sync rota | Reautorizar juanitoopenclaw por separado o migrar todo a rafitalxx |
| R3 | Mismo OAuth client para Amazon Messages y Hermes | Cambiar credenciales afecta ambos | Usar variables separadas: `GMAIL_ACCOUNT`/`GMAIL_REFRESH_TOKEN` para Hermes, mantener `AMAZON_MESSAGES_*` para Amazon |
| R4 | Scope excesivo (`gmail.modify` heredado de gog) | Mas permisos de los necesarios | Reautorizar rafitalxx con solo `gmail.readonly` + `gmail.compose` (+ `gmail.send` opcional) |
| R5 | Refresh token en env file plano | Exposicion si se lee el file | Permisos 600, fuera de git, solo root/admin |
| R6 | `HERMES_GMAIL_SEND_ENABLED` activado por error | Envio accidental | Mantener desactivado (no definir o =false). Solo activar tras aprobacion explicita de Rafa |
| R7 | No hay auditoria de drafts enviados en Hermes | Dificultad para rastrear | `hermes-mail-drafts.json` guarda hasta 200 drafts. Considerar auditoria mas formal en futuro |
| R8 | Rafitalxx no tiene label AmazonSeller | Amazon Messages sync no traeria sus correos | No aplica si Amazon Messages sigue con juanitoopenclaw. Si se migra, crear label y filter |

---

## 6. Preguntas pendientes

1. **Juanito**: Prefieres mantener Amazon Messages con `juanitoopenclaw@gmail.com` (reautorizar su token) y solo usar `rafitalxx@gmail.com` para Hermes/Tareas? O migrar todo a `rafitalxx@gmail.com`?
2. **Rafa**: Confirmas que `rafitalxx@gmail.com` es la cuenta personal que quieres conectar para leer correos en el Dashboard?
3. **Juanito**: El OAuth client de `todoelectrico.net` se puede publicar (mover a production) o prefieres mantenerlo en testing con rafitalxx como tester?
4. **Rafa**: Para la fase de pruebas, apruebas crear un borrador de prueba en tu cuenta? (no se enviaria)
5. **Juanito**: Hay algun motivo para no usar `gog` CLI para el flujo OAuth de rafitalxx (mas seguro que navegador)?

---

## 7. Archivos leidos

| Archivo | Lineas relevantes |
|---|---|
| `vite.config.ts` | 1469–1860 (funciones Hermes Gmail) |
| `backend/amazonMessages/gmailClient.ts` | Completo (cliente Gmail API) |
| `backend/amazonMessages/gmailSync.ts` | Completo (sync automatica) |
| `docs/amazon-messages-phase-0-8-gmail-readonly.md` | Configuracion readonly |
| `docs/amazon-messages-phase-1-5-pending-gmail-oauth.md` | Pendiente OAuth |
| `docs/amazon-messages-phase-1-5-prod-gmail-oauth.md` | OAuth produccion |
| `docs/amazon-messages-draft-only-oauth-validation.md` | Validacion draft |
| `docs/amazon-messages-final-gmail-draft-send-local.md` | Envio controlado |
| `docs/tasks-hermes-plan.md` | Plan Hermes |
| `src/modules/tasks/TasksView.tsx` | Lineas 78, 1290 (cuenta rafitalxx) |
| `/etc/odoo-v18-dashboard/amazon-messages-gmail.env` | Keys (valores ocultos) |

---

## 8. Comando seguro ejecutado

```bash
curl -s --max-time 5 http://127.0.0.1:5173/hermes-updated/api/inbox
```

**Resultado:**

```json
{"message":"Token has been expired or revoked."}
```

**Interpretacion:** Confirma que el token actual (juanitoopenclaw) esta revocado. No se imprimieron tokens ni secretos.
