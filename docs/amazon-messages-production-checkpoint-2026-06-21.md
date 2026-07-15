# Amazon Messages - checkpoint produccion 2026-06-21

## Objetivo

Dejar guardado de forma segura el estado Amazon Messages 0.8 a 1.4 desplegado en produccion.

## Produccion

URL:

- `https://dashboard.todoelectrico.net/#/amazon-messages`

Frontend publico:

- Root: `/var/www/odoo-v18-dashboard`
- Bundle activo: `/assets/index-BV6_yLXX.js`
- CSS activo: `/assets/index-CpWZcgN9.css`

Backend/API:

- Servicio: `odoo-v18-dashboard`
- Local API: `127.0.0.1:5173`
- Store Amazon Messages: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard/.dashboard-data/amazon-messages-store.json`

Validacion de produccion:

- HTTP frontend: 200
- API conversaciones: 200
- Total conversaciones API: 3
- Conversaciones reales no semilla: 1
- Pedido real visible por API: `403-9628163-5791508`
- REAL API verificado visualmente en produccion: OK
- DEMO FALLBACK ausente: OK
- Workflow, revision humana, plantillas y supervisor: OK

Capturas:

- `/root/amazon-captures/amazon-phase-1-4-prod-final-inbox.png`
- `/root/amazon-captures/amazon-phase-1-4-prod-final-supervisor.png`
- `/root/amazon-captures/amazon-phase-1-4-prod-final-validation.json`

## Backups

Backup frontend previo al despliegue final:

- `/backup/dashboard-frontend/2026-06-21_1829/`

Backup store Amazon Messages:

- `/backup/dashboard-amazon-messages-store/2026-06-21_1619/amazon-messages-store.json`

Backup completo workspace:

- `/backup/lovable-workspace/2026-06-21_1839/lovable-workspace.tgz`
- SHA256: `45642f45300a691e5bca8b312cf70156a1661bc3d631db3063b72a73d9f7546f`

## Commit local

Mensaje:

```text
feat: amazon messages gmail readonly workflow templates
```

Archivos incluidos:

- `backend/amazonMessages/*`
- `src/modules/amazonMessages/*`
- `src/App.tsx`
- `src/services/odooClient.ts`
- `src/services/odooTypes.ts`
- `src/styles/app.css`
- `scripts/test-amazon-*`
- `docs/amazon-messages-*`
- `package.json`
- `package-lock.json`
- `vite.config.ts`
- configuracion basica del proyecto Dashboard necesaria para reproducir el build

Excluido del commit:

- `.env.local`
- `.dashboard-data/`
- `node_modules/`
- `dist/`
- `artifacts/`
- backups y capturas fuera del repo

## Pendiente

No se ha hecho push.

FASE 1.5 sigue pendiente:

- conectar OAuth Gmail readonly al backend de produccion mediante variables seguras.

No se ha tocado Gmail OAuth, SP-API, Odoo ni Sendcloud durante este checkpoint.
