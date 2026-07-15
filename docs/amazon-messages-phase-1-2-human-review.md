# Amazon Messages - FASE 1.2 Human Review

Fecha: 2026-06-21

## Objetivo

Anadir revision y aprobacion humana para borradores internos de Amazon Messages sin enviar nada al comprador.

## Restricciones aplicadas

- No se enviaron correos.
- No se respondio a compradores.
- No se llamo a SP-API.
- No se modifico Odoo.
- No se modifico Sendcloud.
- No se borraron datos.
- Todos los cambios mantienen `externalSend: false`.

## Cambios realizados

- `backend/amazonMessages/schema.ts`
  - Estados de borrador ampliados: `BORRADOR_INTERNO`, `LISTO_PARA_REVISAR`, `APROBADO_MANUALMENTE`, `RECHAZADO`, `NECESITA_CAMBIOS`.
  - Campos de revision: `approvedBy`, `approvedAt`, `rejectedBy`, `rejectedAt`, `reviewNotes`, `reviewStatus`.
  - Historial `reviewHistory` con actor, fecha, estado anterior, estado nuevo y nota interna.

- `backend/amazonMessages/repository.ts`
  - Normaliza borradores existentes sin perder datos.
  - Persiste cambios de revision manual y auditoria.
  - Rechaza cualquier payload con `externalSend: true`, incluso para borradores aprobados.

- `backend/amazonMessages/routes.ts`
  - Nuevo endpoint seguro: `POST /api/amazon-messages/conversations/{id}/draft/review`.
  - Mantiene endpoints de FASE 1.1 para crear/editar borradores internos.

- `src/modules/amazonMessages/AmazonMessagesView.tsx`
  - Acciones UI: aprobar borrador, rechazar borrador, marcar necesita cambios.
  - Campo de nota interna.
  - Estado actual visible.
  - Historial de revision visible.
  - Aviso claro de modo seguro sin envio externo.

- `src/modules/amazonMessages/amazonMessages.css`
  - Estados visuales para aprobado, rechazado y necesita cambios.
  - Panel de revision humana e historial.

- `scripts/test-amazon-messages-backend.ts`
  - Cubre crear borrador, pasarlo a revision, aprobar, marcar cambios, rechazar, auditoria e intento bloqueado de `externalSend: true`.

## Verificacion esperada

- Aprobar borrador persiste `APROBADO_MANUALMENTE`, `approvedBy`, `approvedAt` e historial.
- Rechazar borrador persiste `RECHAZADO`, `rejectedBy`, `rejectedAt` e historial.
- Necesita cambios persiste `NECESITA_CAMBIOS` e historial.
- Las notas internas quedan en backend y en el historial.
- La auditoria registra `internal_draft_reviewed`.
- Ningun flujo envia nada externo.

## Modo seguro

La aprobacion manual no habilita envio. Es solo un estado interno revisable para fases futuras. Cualquier intento de `externalSend: true` sigue devolviendo error.
