# AGENTS.md - Reglas para trabajar en este Dashboard

Este repositorio controla una herramienta operativa real de Todoelectrico. Trabaja con cuidado: el objetivo es mejorar el Dashboard sin romper pedidos, entregas, tareas, Amazon Messages ni integraciones con Odoo.

## Contexto minimo

- Produccion: `https://dashboard.todoelectrico.net`.
- Stack: React + Vite + TypeScript.
- App principal: `src/App.tsx`.
- Cliente API: `src/services/odooClient.ts`.
- Backend Vite: `vite.config.ts`.
- Modulos backend: `backend/`.
- Documentacion tecnica: `docs/`.

## Lineas rojas

- No tocar produccion sin aprobacion explicita de Rafa.
- No activar escrituras reales en Odoo, Gmail, Sendcloud, Amazon o Telegram sin aprobacion explicita.
- No commitear secretos: `.env`, tokens, API keys, OAuth tokens, stores locales, backups o dumps.
- No borrar ni migrar stores existentes sin una migracion reversible y validada.
- No cambiar reglas de negocio de pedidos/entregas sin documentar el caso y probarlo con datos representativos.
- No sustituir el modulo actual por uno nuevo de golpe. Integrar por fases.

## Forma de trabajar

1. Leer primero `README.md`, `docs/github-workflow.md` y la documentacion del modulo afectado.
2. Mantener cambios pequenos y revisables.
3. Usar ramas por feature o bugfix.
4. Anadir o actualizar tests cuando cambie comportamiento compartido.
5. Ejecutar `npm run build` antes de proponer merge.
6. Dejar en el PR: que cambia, como se probo, riesgos, capturas si toca UI.

## Produccion y despliegues

Los cambios deben pasar por:

1. Desarrollo local.
2. Validacion con datos demo/lab.
3. Revision de PR.
4. Aprobacion explicita de Rafa.
5. Despliegue controlado.

Si una mejora afecta carga de datos, arquitectura, rendimiento o flujo de trabajo de negocio, preparar primero una version paralela o feature flag.

## Tareas / Hermes

Hermes puede desarrollar la parte avanzada de tareas en modulos nuevos, preferiblemente:

- `src/modules/tasks/`
- `backend/tasks/`

Debe conservar compatibilidad con el modelo actual y no romper `GET/POST/PATCH /api/tasks`. Ver [docs/tasks-hermes-plan.md](docs/tasks-hermes-plan.md).

## Seguridad de Agent API

La Agent API solo debe exponer acciones seguras y con scopes. No se deben crear rutas de envio final ni endpoints que permitan saltarse revision humana. Ver [docs/agent-api-hermes-access.md](docs/agent-api-hermes-access.md).

## Criterios de calidad

- Build verde.
- Tests relevantes verdes.
- UI sin solapes en movil/escritorio.
- Sin errores en consola relevantes.
- Sin secretos en diff.
- Documentacion actualizada si cambia el flujo.
