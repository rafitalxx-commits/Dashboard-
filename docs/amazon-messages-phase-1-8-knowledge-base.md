# Amazon Messages FASE 1.8 - Base de conocimiento

Fecha: 2026-06-22

## Objetivo

Crear una base de conocimiento interna para almacenar ejemplos aprobados y preparar futuras fases de IA sin generar respuestas automaticas ni enviar nada al comprador.

## Restricciones

- No se enviaron correos.
- No se respondio a compradores.
- No se toco SP-API.
- No se toco Odoo.
- No se toco Sendcloud.
- No se toco Roger.
- Se mantiene `externalSend=false`.
- La base de conocimiento no modifica plantillas automaticamente.
- La base de conocimiento no cambia respuestas automaticamente.

## Backend

Modelo persistente ampliado para `knowledgeExamples` con:

- mensaje original del cliente
- idioma
- categoria
- marketplace
- pedido Amazon
- plantilla usada
- borrador inicial
- respuesta final aprobada
- diferencias respecto al borrador
- aprobador
- fecha de aprobacion
- calidad/confianza
- etiquetas
- estado

Endpoints implementados:

- `GET /api/amazon-messages/knowledge`
- `POST /api/amazon-messages/knowledge/examples`
- `PUT /api/amazon-messages/knowledge/examples/{exampleId}/tags`
- `PATCH /api/amazon-messages/knowledge/examples/{exampleId}/category`

Filtros soportados:

- texto libre: `q`
- pedido: `order`
- categoria: `category`
- idioma: `language`
- plantilla: `templateId`
- aprobador: `approver`

Auditoria registrada:

- `knowledge_example_created`
- `knowledge_tags_updated`
- `knowledge_category_changed`

## UI

La seccion `Amazon Messages -> Base de conocimiento` ahora carga datos del backend cuando esta disponible.

Incluye:

- ejemplos recientes
- categoria
- idioma
- fecha
- plantilla usada
- aprobador
- respuesta final aprobada
- diferencias respecto al borrador
- pedido Amazon
- calidad/confianza
- etiquetas editables
- cambio controlado de categoria

Busqueda y filtros:

- texto libre
- pedido Amazon
- categoria
- idioma

En la revision humana de un borrador aprobado se anadio accion:

- `Guardar ejemplo`

La accion solo persiste conocimiento interno y mantiene `externalSend=false`.

## Supervisor

El panel Supervisor muestra:

- ejemplos almacenados
- ejemplos por categoria
- ejemplos por idioma

## Archivos modificados

- `backend/amazonMessages/schema.ts`
- `backend/amazonMessages/repository.ts`
- `backend/amazonMessages/routes.ts`
- `backend/amazonMessages/seed.ts`
- `src/modules/amazonMessages/amazonMessagesTypes.ts`
- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `src/modules/amazonMessages/amazonMessagesDemoData.ts`
- `src/modules/amazonMessages/amazonMessages.css`
- `scripts/test-amazon-messages-backend.ts`
- `docs/amazon-messages-phase-1-8-knowledge-base.md`

## Verificaciones

Pruebas locales:

```bash
npm run test:amazon-backend
npm run build
```

Resultados:

- `npm run test:amazon-backend`: OK.
- `npm run build`: OK.

Casos cubiertos en test backend:

- guardar ejemplo aprobado
- recuperar ejemplo con busqueda/filtros
- filtrar por categoria
- filtrar por idioma
- filtrar por plantilla
- filtrar por aprobador
- editar etiquetas
- cambiar categoria
- persistencia backend
- auditoria de creacion/etiquetas/categoria
- rechazo de `externalSend=true`

## Produccion

Frontend desplegado en produccion:

- URL: `https://dashboard.todoelectrico.net/#/amazon-messages`
- Backup frontend previo: `/backup/dashboard-frontend/2026-06-22_1725/`
- Backup store previo: `/backup/dashboard-amazon-messages-store/2026-06-22_1725/amazon-messages-store.json`
- Store backup SHA256: OK.
- Assets desplegados:
  - `/var/www/odoo-v18-dashboard/index.html`
  - `/var/www/odoo-v18-dashboard/assets/index-DLB9pQtw.js`
  - `/var/www/odoo-v18-dashboard/assets/index-B7kIp0wm.css`

Validacion produccion:

- HTTP frontend: 200.
- `index.html` apunta a los nuevos assets: OK.
- Servicio `odoo-v18-dashboard`: activo.
- API autenticada `GET /api/amazon-messages/knowledge`: OK.
- Ejemplos disponibles por API: 1 ejemplo seed/aprobado normalizado.
- Filtro texto libre: OK.
- Filtro categoria `seguimiento`: OK.
- Filtro idioma `de`: OK.
- Filtro aprobador `Soporte`: OK.
- Filtro pedido `301-0000001`: OK.

Nota: no se creo un ejemplo falso en produccion porque no habia borradores reales en estado `APROBADO_MANUALMENTE`; la operacion de guardado queda verificada por test backend y disponible en UI para el primer borrador real aprobado.

## Resultado

FASE 1.8 deja preparada una base de conocimiento operativa para ejemplos aprobados, sin aprendizaje automatico destructivo y sin envio externo.
