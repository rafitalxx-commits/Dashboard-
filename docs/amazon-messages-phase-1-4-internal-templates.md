# Amazon Messages - FASE 1.4 Plantillas internas

Fecha: 2026-06-21

## Objetivo

Anadir plantillas internas de respuesta para preparar borradores sin IA, sin Roger y sin envio externo.

## Responsabilidad

- Juanito/Codex queda como responsable principal de Amazon Messages.
- Roger/Gemini no es responsable del modulo.
- Roger solo puede apoyar de forma temporal en lectura, resumen o borradores internos cuando Codex no este disponible.
- Roger no puede enviar respuestas, tocar SP-API, modificar backend Amazon Messages, cambiar workflow critico, actuar sobre Odoo/Sendcloud ni trabajar con `externalSend=true`.

## Restricciones aplicadas

- No se enviaron correos.
- No se respondio a compradores.
- No se llamo a SP-API.
- No se modifico Odoo.
- No se modifico Sendcloud.
- No se borraron datos.
- Las plantillas y su aplicacion mantienen `externalSend=false`.

## Cambios realizados

- `backend/amazonMessages/schema.ts`
  - Plantillas marcadas como `INTERNAL_RESPONSE`.
  - Campos de seguridad y autoria: `externalSend`, `createdBy`, `updatedBy`.

- `backend/amazonMessages/repository.ts`
  - Normaliza plantillas existentes como internas.
  - Rechaza `externalSend=true` en plantillas.
  - Nuevo flujo para aplicar una plantilla a un borrador interno sin IA.
  - Sustitucion basica de variables seguras: pedido Amazon, marketplace, pedido Odoo, tracking/transportista pendientes de revisar.
  - Auditoria `internal_template_applied`.

- `backend/amazonMessages/routes.ts`
  - Nuevo endpoint seguro: `POST /api/amazon-messages/conversations/{id}/draft/from-template`.

- `backend/amazonMessages/seed.ts`
  - Plantillas internas fixture con `externalSend=false`.

- `src/modules/amazonMessages/AmazonMessagesView.tsx`
  - Carga plantillas desde backend.
  - Selector de plantilla interna en el panel de borrador.
  - Boton `Aplicar plantilla interna`.
  - Mensaje claro: sin IA, sin Roger y sin envio externo.

- `src/modules/amazonMessages/amazonMessages.css`
  - Layout para selector y accion de plantilla interna.

- `scripts/test-amazon-messages-backend.ts`
  - Verifica creacion de plantilla interna, aplicacion a borrador, auditoria y bloqueo de `externalSend=true`.

## Endpoints

- `GET /api/amazon-messages/templates`
- `POST /api/amazon-messages/conversations/{id}/draft/from-template`

## Pruebas realizadas

- `npm run test:amazon-backend` OK.
- `npm run build` OK.

## Resultado

FASE 1.4 completada en modo seguro. El operador puede preparar borradores internos desde plantillas controladas por backend, sin IA, sin Roger y sin envio externo.
