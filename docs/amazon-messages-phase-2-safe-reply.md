# Amazon Messages FASE 2 - Respuesta segura pendiente

Fecha: 2026-06-26

## Objetivo

Permitir que el Dashboard prepare una respuesta saliente revisable desde un borrador aprobado, sin envio automatico y sin cambios de alcance externo.

## Fuera de alcance

- No Gmail send.
- No creacion de borrador Gmail real todavia.
- No cambios de Gmail OAuth scopes.
- No Amazon SP-API.
- No produccion.
- No credenciales.
- No cambio de safe mode.

## Flujo objetivo

1. Gmail readonly importa mensaje desde etiqueta `AmazonSeller`.
2. Parser crea conversacion, mensaje, adjuntos metadata-only, clasificacion y auditoria.
3. Operador genera o edita borrador interno.
4. Humano aprueba el borrador.
5. FASE 2 crea `PendingReply` desde ese borrador aprobado.
6. Humano valida la respuesta pendiente.
7. El sistema queda preparado para una fase futura de borrador Gmail controlado.

## Implementacion segura

- Nueva entidad persistida: `pendingReplies`.
- Nuevos endpoints internos bajo `/pending-reply`.
- No se anade ningun endpoint de envio.
- El estado visible debe dejar claro que la respuesta esta pendiente y no enviada.
- La auditoria debe registrar preparacion, edicion y revision.

## Validacion requerida

- Tests backend de permisos, estados, rechazo de `externalSend=true` y auditoria.
- Test Gmail readonly corregido para que la metrica `importedCount` sea explicita.
- Build frontend.
- Revision manual de que no aparecen scopes, SP-API ni send.

## Riesgos controlados

- Confusion entre respuesta preparada y enviada: mitigado con labels y `externalSend=false`.
- Uso de borradores no aprobados: mitigado bloqueando creacion si el draft no esta `APROBADO_MANUALMENTE`.
- Crecimiento del store JSON: aceptable para fase actual; revisar SQLite/Postgres antes de operacion intensiva.
- Adjuntos salientes: en esta fase solo metadata interna, sin subida ni envio.
