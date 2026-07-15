# Amazon Messages - Endpoints actuales

Fecha: 2026-06-26

Base API: `/api/amazon-messages`

Este mapa refleja `backend/amazonMessages/routes.ts`. No existe endpoint de envio real, Gmail send, Amazon SP-API send ni cambio de scopes OAuth.

## Conversaciones

- `GET /conversations`: lista conversaciones con filtros opcionales `status`, `workflowStatus`, `priority`, `category`, `marketplace`.
- `GET /conversations/pending`: lista conversaciones no resueltas.
- `GET /conversations/critical`: lista conversaciones urgentes.
- `GET /conversations/:conversationId`: devuelve conversacion, mensajes, adjuntos, clasificaciones, auditoria y asignaciones.
- `GET /conversation/:conversationId`: alias legacy de detalle.

## Borradores internos

- `GET /conversations/:conversationId/draft`: devuelve borrador interno o borrador vacio.
- `POST /conversations/:conversationId/draft`: crea borrador interno.
- `PUT /conversations/:conversationId/draft`: actualiza borrador interno.
- `POST /conversations/:conversationId/draft/from-template`: aplica plantilla interna.
- `POST /conversations/:conversationId/draft/review`: registra revision humana.
- `POST /conversations/:conversationId/draft/smart`: genera borrador inteligente determinista desde plantilla/conocimiento.

Todos mantienen `externalSend=false` y no responden al comprador.

## Workflow

- `POST /conversations/:conversationId/workflow`: cambia estado de workflow.
- `PUT /conversations/:conversationId/assign`: asigna responsable visible de workflow.

## Conocimiento y plantillas

- `GET /templates`: lista plantillas internas.
- `POST /template`: crea plantilla interna.
- `GET /knowledge`: lista ejemplos aprobados con filtros `q`, `order`, `category`, `language`, `templateId`, `approver`.
- `POST /knowledge/examples`: guarda ejemplo aprobado.
- `PUT /knowledge/examples/:exampleId/tags`: actualiza etiquetas.
- `PATCH /knowledge/examples/:exampleId/category`: actualiza categoria.

## Clasificacion y asignacion legacy

- `POST /classification`: registra clasificacion manual.
- `POST /assignment`: registra asignacion legacy.

## Gmail readonly

- `GET /gmail/status`: devuelve estado de sincronizacion Gmail.
- `POST /gmail/sync`: sincronizacion manual readonly desde etiqueta configurada.

La ruta rechaza `externalSend=true` y `readonly=false`.

## Supervisor

- `GET /stats`: devuelve resumen operativo.
- `GET /operators`: devuelve estadisticas por operador para roles con supervision.

## Seguridad observada

- Todas las rutas requieren usuario autenticado.
- Los permisos salen de roles Amazon Messages (`ADMIN`, `SUPERVISOR`, `OPERADOR`, `LECTURA`, `AGENTE_IA`).
- Las operaciones mutables usan permisos `manage`, `validate` o `admin`.
- Los puntos de mutacion existentes escriben auditoria.
- No hay rutas de envio externo.
