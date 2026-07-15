# Amazon Messages - FASE 1.1 Backend Drafts

Fecha: 2026-06-21

## Objetivo

Persistir los borradores internos de Amazon Messages en backend, asociados a la conversacion real importada desde Gmail readonly, dejando `localStorage` solo como fallback temporal.

## Restricciones aplicadas

- No se enviaron correos.
- No se respondio a compradores.
- No se llamo a SP-API Messaging.
- No se modifico Odoo.
- No se modifico Sendcloud.
- No se borraron datos.
- Los endpoints de draft fuerzan `externalSend: false`.

## Cambios realizados

- `backend/amazonMessages/schema.ts`
  - Nuevo tipo `AmazonInternalDraftRecord`.
  - Nuevo estado `SIN_BORRADOR / BORRADOR_INTERNO / LISTO_PARA_REVISAR`.
  - Nuevo campo `internalDrafts` en `AmazonMessagesStore`.
  - Definicion SQL documental `amazon_internal_drafts`.

- `backend/amazonMessages/seed.ts`
  - Inicializa `internalDrafts: []`.

- `backend/amazonMessages/repository.ts`
  - Normaliza stores existentes con `internalDrafts`.
  - Anade persistencia JSON backend para drafts internos.
  - Anade auditoria persistente para generacion y actualizacion.
  - Bloquea cualquier payload con `externalSend: true`.

- `backend/amazonMessages/routes.ts`
  - `GET /api/amazon-messages/conversations/{id}/draft`
  - `POST /api/amazon-messages/conversations/{id}/draft`
  - `PUT /api/amazon-messages/conversations/{id}/draft`

- `src/modules/amazonMessages/AmazonMessagesView.tsx`
  - Carga borradores desde backend como fuente principal.
  - Guarda generacion via `POST`.
  - Guarda ediciones via `PUT`.
  - Mantiene `localStorage` solo como fallback si falla backend.
  - Muestra auditoria y trazabilidad de persistencia.

- `src/modules/amazonMessages/amazonMessages.css`
  - Distintivos visuales `BACKEND DRAFT` y `LOCAL FALLBACK`.

## Verificacion API

Conversacion real verificada:

- `amz-gmail-403-9628163-5791508`
- Pedido Amazon: `403-9628163-5791508`
- Fuente: Gmail readonly
- Etiqueta: AmazonSeller

Pruebas realizadas:

- `GET /api/amazon-messages/conversations/amz-gmail-403-9628163-5791508/draft`
  - Devuelve draft backend.
  - Estado final: `LISTO_PARA_REVISAR`.
  - `externalSend: false`.

- `POST /api/amazon-messages/conversations/amz-gmail-403-9628163-5791508/draft`
  - Crea/actualiza borrador interno.
  - Estado: `BORRADOR_INTERNO`.
  - Auditoria: `internal_draft_generated`.

- `PUT /api/amazon-messages/conversations/amz-gmail-403-9628163-5791508/draft`
  - Persiste edicion.
  - Estado: `LISTO_PARA_REVISAR`.
  - Auditoria: `internal_draft_updated`.

- Proteccion de envio externo:
  - Payload con `externalSend: true` rechazado con HTTP 400.
  - Mensaje: `Envio externo deshabilitado para borradores internos`.

## Verificacion UI

URL temporal:

- `http://212.47.76.180:5176/#/amazon-messages`

Comprobaciones:

- La bandeja mantiene `REAL API`.
- La conversacion real importada aparece en la lista principal.
- El detalle muestra el borrador persistido.
- Estado visible: `LISTO PARA REVISAR`.
- Persistencia visible: `BACKEND DRAFT`.
- Trazabilidad visible: Gmail readonly, AmazonSeller, parser, adjuntos, duplicado, remitente, asunto y fecha.
- El panel Supervisor mantiene:
  - Importados
  - Duplicados
  - Errores
  - Fuente: Gmail readonly
  - Modo seguro: Sin envio externo

Persistencia sin `localStorage`:

- Se abrio una sesion Chromium fresca sin `localStorage`.
- La UI siguio mostrando `BACKEND DRAFT` y estado `LISTO PARA REVISAR`.
- El borrador aparecio desde backend, no desde almacenamiento local.

Capturas generadas:

- `/tmp/amazon-phase-1-1-ui-backend-draft.png`
- `/tmp/amazon-phase-1-1-ui-backend-draft-fresh-profile.png`
- `/tmp/amazon-phase-1-1-ui-supervisor.png`

## Pruebas ejecutadas

- `npm run build` OK.
- `npm run test:amazon-backend` OK.
- `npx tsc --noEmit` revisado: falla por errores TypeScript ya presentes en zonas no bloqueantes del proyecto (`matchesControlChannel`, tipos demo de `suggestionMode`, referencias `AmazonSupportMessage`). No impide `npm run build`.

## Resultado

FASE 1.1 completada en modo seguro.

El borrador interno ya se guarda en backend y persiste entre sesiones. `localStorage` queda como fallback visualizado con `LOCAL FALLBACK` si el backend no responde. Ningun flujo envia mensajes ni toca sistemas externos.
