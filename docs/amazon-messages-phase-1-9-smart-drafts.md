# Amazon Messages FASE 1.9 - Borradores inteligentes seguros

Fecha: 2026-06-22

## Objetivo

Anadir generacion de borradores inteligentes para Amazon Messages usando plantillas activas y Base de Conocimiento, sin envio externo y con revision humana obligatoria.

## Restricciones

- No se enviaron correos.
- No se respondio a compradores.
- No se toco SP-API.
- No se toco Odoo.
- No se toco Sendcloud.
- No se toco Roger.
- Se mantiene `externalSend=false`.
- Todo borrador generado queda como `BORRADOR_INTERNO`.
- La revision humana sigue siendo obligatoria antes de cualquier accion futura.

## Backend

Endpoint seguro creado:

```text
POST /api/amazon-messages/conversations/{id}/draft/smart
```

Comportamiento:

- Lee la conversacion y el primer mensaje entrante.
- Detecta categoria a partir de la clasificacion/conversacion.
- Detecta idioma a partir de conversacion/mensaje.
- Selecciona plantilla activa adecuada si existe.
- Busca ejemplos similares en Base de Conocimiento aprobada.
- Genera un borrador interno determinista, sin llamadas externas de IA.
- Guarda el borrador en backend.
- Registra auditoria.
- Mantiene `externalSend=false`.
- Devuelve confianza, fuentes y advertencias.

Metadatos persistidos en el borrador:

- `draftBody`
- `source: SMART_DRAFT`
- `templateId`
- `knowledgeExampleIds`
- `detectedLanguage`
- `detectedCategory`
- `confidence`
- `warnings`
- `generatedBy`
- `generatedAt`
- `externalSend=false`

Auditoria:

- `smart_draft_generated`
- conversacion
- plantilla usada
- ejemplos usados
- confianza
- usuario
- fecha
- warnings

## Motor de borrador

El motor usa:

1. Mensaje original del cliente.
2. Pedido Amazon si existe.
3. Idioma detectado.
4. Categoria/clasificacion.
5. Plantilla activa mas adecuada.
6. Ejemplos similares de la Base de Conocimiento.
7. Tono profesional de TodoElectrico.

No inventa tracking, fechas, reembolsos, garantias ni informacion no disponible. Si faltan datos, deja advertencias visibles.

Advertencias implementadas:

- `No hay tracking disponible.`
- `No hay ejemplos similares.`
- `No hay plantilla activa adecuada.`
- `Idioma detectado con baja confianza.`
- `No se debe prometer reembolso/entrega/garantia sin validacion humana.`

## UI

En el detalle de conversacion se anadio:

- Boton `Generar borrador inteligente`.
- Visualizacion de confianza.
- Idioma detectado.
- Categoria detectada.
- Plantilla usada.
- Ejemplos usados.
- Advertencias.
- Aviso de modo seguro: no se enviara nada.

## Supervisor

Metricas anadidas:

- borradores inteligentes generados
- confianza media
- borradores con warning
- borradores convertidos a aprobado manualmente

## Archivos modificados

- `backend/amazonMessages/schema.ts`
- `backend/amazonMessages/repository.ts`
- `backend/amazonMessages/routes.ts`
- `src/modules/amazonMessages/amazonMessagesTypes.ts`
- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `src/modules/amazonMessages/amazonMessages.css`
- `scripts/test-amazon-messages-backend.ts`
- `docs/amazon-messages-phase-1-9-smart-drafts.md`

## Verificaciones

Pruebas locales:

```bash
npm run test:amazon-backend
npm run build
```

Resultado inicial:

- `npm run test:amazon-backend`: OK.
- `npm run build`: OK.

Casos cubiertos por test backend:

- generar borrador inteligente
- guardar como `BORRADOR_INTERNO`
- persistir `source: SMART_DRAFT`
- persistir idioma/categoria/confianza/warnings
- persistir fuentes de conocimiento
- confirmar `externalSend=false`
- rechazar `externalSend=true`
- registrar auditoria `smart_draft_generated`

## Produccion

Frontend desplegado en produccion:

- URL: `https://dashboard.todoelectrico.net/#/amazon-messages`
- Backup frontend previo: `/backup/dashboard-frontend/2026-06-22_1754/`
- Backup store previo: `/backup/dashboard-amazon-messages-store/2026-06-22_1754/amazon-messages-store.json`
- Store backup SHA256: OK.
- Assets desplegados:
  - `/var/www/odoo-v18-dashboard/index.html`
  - `/var/www/odoo-v18-dashboard/assets/index-DsWEs6OX.js`
  - `/var/www/odoo-v18-dashboard/assets/index-DM8rfE8N.css`

Validacion produccion:

- HTTP frontend: 200.
- `index.html` apunta a los nuevos assets: OK.
- Servicio `odoo-v18-dashboard`: activo.
- Generacion smart draft autenticada sobre conversacion real `amz-gmail-403-9628163-5791508`: OK.
- Draft creado: `draft-smart-1782143710071-1`.
- Estado: `BORRADOR_INTERNO`.
- `reviewStatus`: `BORRADOR_INTERNO`.
- `source`: `SMART_DRAFT`.
- `externalSend`: `false`.
- `templateId`: `tpl-backend-az`.
- `knowledgeExampleIds`: `kb-backend-1`.
- Idioma detectado: `es`.
- Categoria detectada: `general`.
- Confianza: `0.85`.
- Warnings:
  - `No se debe prometer reembolso/entrega/garantia sin validacion humana.`
  - `No hay tracking disponible.`
- Auditoria `smart_draft_generated`: OK.
- Gmail sync mantiene estado `OK`.

## Resultado

FASE 1.9 deja funcional el boton de borrador inteligente con plantilla, conocimiento, confianza y advertencias visibles, todo en modo seguro y sin envio externo.
