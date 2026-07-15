# Amazon Messages - Propuesta PendingReply

Fecha: 2026-06-26

## Objetivo

Preparar una respuesta saliente desde el Dashboard sin enviarla. `PendingReply` es una entidad interna y auditable que nace de un borrador aprobado manualmente y queda lista para validacion operativa.

No crea borrador Gmail real todavia, no envia correo, no llama SP-API y no cambia scopes.

## Modelo propuesto

```ts
type AmazonPendingReplyStatus =
  | "SIN_RESPUESTA"
  | "RESPUESTA_PREPARADA"
  | "PENDIENTE_VALIDACION"
  | "APROBADA_PARA_BORRADOR"
  | "NECESITA_CAMBIOS"
  | "RECHAZADA"
  | "CANCELADA";

type AmazonPendingReplyRecord = {
  pendingReplyId: string;
  conversationId: string;
  draftId: string;
  replyBody: string;
  status: AmazonPendingReplyStatus;
  validationNotes?: string;
  preparedBy: string;
  preparedAt: string;
  updatedBy: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  source: "APPROVED_INTERNAL_DRAFT";
  channel: "GMAIL_DRAFT_PENDING";
  externalSend: false;
  gmailDraftId?: string;
  amazonMessageActionId?: string;
  attachments: AmazonPendingReplyAttachmentRecord[];
  history: AmazonPendingReplyReviewEvent[];
};
```

## Estados

- `SIN_RESPUESTA`: valor vacio para conversaciones sin respuesta pendiente.
- `RESPUESTA_PREPARADA`: respuesta creada desde borrador aprobado.
- `PENDIENTE_VALIDACION`: texto listo para una segunda revision humana.
- `APROBADA_PARA_BORRADOR`: autorizada para una fase futura de creacion de borrador Gmail, no envio.
- `NECESITA_CAMBIOS`: requiere edicion.
- `RECHAZADA`: no usar.
- `CANCELADA`: descartada por operador.

## Guardrails

- Solo puede crearse desde `InternalDraft.status === "APROBADO_MANUALMENTE"`.
- `externalSend=true` debe fallar siempre.
- No debe existir endpoint `send`.
- No debe tocar Gmail OAuth scopes.
- No debe escribir `gmailDraftId` hasta una fase futura explicita.
- Debe registrar auditoria en cada creacion, edicion y revision.
- Debe conservar el texto final aprobado y su origen (`draftId`).

## Endpoints seguros propuestos

- `GET /conversations/:conversationId/pending-reply`
- `POST /conversations/:conversationId/pending-reply`
- `PUT /conversations/:conversationId/pending-reply`
- `POST /conversations/:conversationId/pending-reply/review`

Todos son internos. Ninguno envia.

## Criterios de aceptacion

- Crear respuesta pendiente falla si no hay borrador aprobado.
- Crear respuesta pendiente desde borrador aprobado guarda `externalSend=false`.
- Actualizar texto cambia estado a `PENDIENTE_VALIDACION` por defecto.
- Revision humana puede aprobar, rechazar o pedir cambios.
- `externalSend=true` falla en todos los endpoints.
- Tests prueban que no se crea ningun envio real ni campo de Gmail draft.
