# Amazon Messages - FASE 1.3 Workflow Operativo

Fecha: 2026-06-21

## Objetivo

Convertir Amazon Messages en una bandeja operativa real mediante estados de conversacion, asignacion y filtros de trabajo, manteniendo separados los estados del borrador.

## Restricciones aplicadas

- No se enviaron correos.
- No se respondio a compradores.
- No se llamo a SP-API.
- No se modifico Odoo.
- No se modifico Sendcloud.
- No se borraron datos.
- Todos los endpoints nuevos fuerzan modo seguro con `externalSend: false`.

## Archivos modificados

- `backend/amazonMessages/schema.ts`
  - Nuevo tipo `AmazonConversationWorkflowStatus`.
  - Campos en conversacion: `workflowStatus`, `assignedAt`, `closedAt`, `lastActivityAt`, `workflowHistory`.

- `backend/amazonMessages/repository.ts`
  - Normalizacion de conversaciones antiguas.
  - Cambio de workflow con historial.
  - Asignacion de usuario con auditoria.
  - Metricas basicas de workflow.
  - Rechazo de `externalSend: true`.

- `backend/amazonMessages/routes.ts`
  - `POST /api/amazon-messages/conversations/{id}/workflow`
  - `PUT /api/amazon-messages/conversations/{id}/assign`

- `backend/amazonMessages/seed.ts`
  - Fixtures con workflow inicial y asignacion.

- `src/modules/amazonMessages/amazonMessagesTypes.ts`
  - Tipos frontend para workflow operativo.

- `src/modules/amazonMessages/AmazonMessagesView.tsx`
  - Filtros de bandeja por workflow con contadores.
  - Selector de estado de conversacion separado del estado de borrador.
  - Asignacion inicial a `Soporte` o `Rafa`.
  - Fecha de asignacion y ultima actividad.
  - Historial de workflow visible en auditoria.
  - Supervisor con nuevas, abiertas, cerradas y asignadas.

- `scripts/test-amazon-messages-backend.ts`
  - Verifica transiciones, reapertura manual, asignacion, auditoria y bloqueo de `externalSend: true`.

## Endpoints creados

- `GET /api/amazon-messages/conversations`
- `GET /api/amazon-messages/conversations/{id}`
- `POST /api/amazon-messages/conversations/{id}/workflow`
- `PUT /api/amazon-messages/conversations/{id}/assign`

Los dos primeros ya existian y se mantienen compatibles. Los nuevos no envian nada externo.

## Pruebas realizadas

- `npm run test:amazon-backend`
- `npm run build`

Cobertura verificada:

- Cambio de estados: `NUEVO`, `PENDIENTE_REVISAR`, `EN_REVISION`, `LISTO_PARA_RESPONDER`, `CERRADO`.
- Reapertura manual desde `CERRADO`.
- Asignacion a usuario.
- Persistencia backend.
- Auditoria de workflow y asignacion.
- Bloqueo de `externalSend: true`.
- Filtros y contadores de bandeja compilados en UI.

## Capturas

- `/root/amazon-captures/amazon-phase-1-3-workflow.png`

La captura headless llega hasta la pantalla de login del Dashboard local, asi que la validacion funcional principal de esta fase queda cubierta por build y test backend. La UI queda disponible en la ruta Amazon Messages del Dashboard para comprobacion visual con sesion iniciada.

## Riesgos pendientes

- Los usuarios asignables estan inicialmente limitados a `Soporte` y `Rafa`; la estructura permite anadir mas usuarios.
- La aprobacion del borrador sigue siendo interna y no habilita envio. El envio real queda fuera de esta fase.
- Las metricas del supervisor son basicas y preparadas para ampliarse cuando Roger/IA entre en una fase posterior.

## Resultado

FASE 1.3 completada en modo seguro: bandeja operativa con workflow, asignacion, filtros, contadores, auditoria y metricas basicas, sin envio externo.
