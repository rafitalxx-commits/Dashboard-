# Plan para Hermes: modulo de tareas

## Objetivo

Crear una evolucion avanzada de tareas para el Dashboard, estilo Notion/operaciones, manteniendo compatibilidad con la version actual y trabajando primero en paralelo.

## Estado actual

La vista existe como `Tareas` dentro de `src/App.tsx`.

Tipos actuales:

```ts
type DashboardTaskCategory =
  | "Dashboard"
  | "Odoo"
  | "Compras"
  | "Gmail"
  | "Amazon"
  | "Dominio"
  | "IA"
  | "Operaciones";

type DashboardTaskPriority = "Alta" | "Media" | "Baja";
type DashboardTaskStatus = "Pendiente" | "En curso" | "Bloqueada" | "Hecha";
```

Endpoints actuales:

- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:taskId`
- `DELETE /api/tasks/:taskId`

Persistencia:

- Env override: `DASHBOARD_TASK_STORE`.
- Debe mantenerse compatible con los datos existentes.

## Arquitectura recomendada

Crear modulos nuevos y mover gradualmente:

- `src/modules/tasks/tasksTypes.ts`
- `src/modules/tasks/TasksView.tsx`
- `src/modules/tasks/tasks.css`
- `backend/tasks/repository.ts`
- `backend/tasks/routes.ts`

Evitar meter mas logica en `src/App.tsx` y `vite.config.ts` salvo el cableado minimo.

## Modelo ampliado sugerido

Campos compatibles a anadir:

- `assigneeId`
- `assigneeName`
- `team`
- `tags`
- `source`
- `sourceRef`
- `parentTaskId`
- `subtasks`
- `comments`
- `attachments`
- `checklist`
- `position`
- `archivedAt`
- `completedAt`

Regla: los campos nuevos deben ser opcionales o tener migracion clara.

## Vistas esperadas

- Lista operativa.
- Kanban por estado.
- Calendario.
- Vista equipo.
- Ficha de tarea con comentarios, checklist e historial.
- Filtros por responsable, prioridad, categoria, fecha, origen y estado.

## Integraciones

### Calendario

- Relacionar tarea con eventos.
- Crear evento desde tarea.
- Mostrar eventos en ficha.
- Guardar `googleEventId` para evitar duplicados.
- Actualizar/borrar Google Calendar solo tras validar OAuth y permisos.

### Telegram

No enviar mensajes desde frontend. Disenar backend con cola/audit:

- `task_notifications`.
- Estados: `pending`, `sent`, `failed`, `dismissed`.
- Worker/cron controlado.
- Endpoint interno para marcar aviso enviado.

### Odoo / Amazon / compras

Usar backlinks:

- Pedido Odoo.
- Entrega Odoo.
- Conversacion Amazon.
- Factura.
- Compra.
- Incidencia.

No modificar pedidos reales desde tareas en la primera fase.

## Fases

1. Extraer tipos y UI actual sin cambiar comportamiento.
2. Anadir modelo ampliado compatible.
3. Crear repositorio backend separado para tareas.
4. Anadir Kanban y filtros.
5. Anadir ficha de tarea.
6. Integrar calendario.
7. Preparar notificaciones.
8. Validar con Rafa en lab.
9. Integrar en produccion tras aprobacion.

## Criterios de aceptacion

- `npm run build` OK.
- Tests de repositorio de tareas.
- Datos antiguos siguen cargando.
- No hay secretos en Git.
- No hay envios Telegram/Gmail reales sin aprobacion.
- UI usable en escritorio y movil.
- Documentacion actualizada.
