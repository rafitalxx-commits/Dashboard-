# Mapa del proyecto

## Frontend

- `src/main.tsx`: entrada React.
- `src/App.tsx`: shell principal, navegacion y varias vistas actuales.
- `src/styles/app.css`: estilos globales.
- `src/services/odooClient.ts`: cliente HTTP/fallback demo.
- `src/services/odooTypes.ts`: tipos compartidos principales.
- `src/data/demoData.ts`: datos demo/fallback.
- `src/modules/amazonMessages/`: modulo Amazon Messages.

## Backend

- `vite.config.ts`: configura Vite y registra endpoints internos.
- `backend/agentApi/routes.ts`: API para agentes externos con Bearer token y scopes.
- `backend/amazonMessages/`: persistencia, Gmail, rutas y modelo Amazon Messages.
- `backend/odooDeliveryStatus.ts`: estado/incidencias de entregas Odoo.
- `backend/odooOrderContext.ts`: contexto de pedidos Odoo.

## Documentacion existente

- `docs/agent-api-hermes-access.md`: acceso Agent API para Hermes.
- `docs/amazon-messages-*.md`: fases, validaciones y decisiones de Amazon Messages.
- `docs/tasks-hermes-plan.md`: plan de evolucion del modulo tareas.
- `docs/github-workflow.md`: reglas para GitHub.

## Produccion

- `deploy/odoo-v18-dashboard.service`: unidad systemd usada para el Dashboard.
- `.env.example`: variables esperadas sin secretos.
- `.env.local`: solo local, no se sube.

## Stores locales

No se deben commitear. Los defaults actuales viven fuera del repo o en rutas ignoradas:

- Tareas: `DASHBOARD_TASK_STORE`.
- Calendario: `DASHBOARD_CALENDAR_STORE`.
- Datos/cache del dashboard: `.dashboard-data/`.

## Zonas delicadas

- `vite.config.ts`: concentra mucha logica backend; tocarlo con cambios pequenos.
- Pedidos/entregas Odoo: validar con datos reales o fixtures antes de cambiar filtros.
- Gmail/Amazon: no introducir envios finales automaticos sin aprobacion.
- Agent API: mantener scopes y bloqueos de acciones peligrosas.
