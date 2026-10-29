# Incidencias: códigos escaneables DEV/REX — release 2026-10-29

## Alcance aprobado

Rafa autorizó el 2026-10-29 promover a producción el cambio descrito en el chat: DEV y REX deben codificar solo el número de albarán, para que el escáner escriba la referencia y Enter localice el registro. Solo frontend; sin backend, configuración, datos, servicios, puertas de escritura, Odoo, transportistas ni envíos.

## Fuente y allowlist

- Baseline exacto público: `3ecbdf8efe97e5d7ac8ca95ae7ce395dbbe9c404` (`release/expedition-replenishment-20261028`).
- Worktree aislado: `odoo-v18-dashboard-scan-release-20261029`, rama `release/incidents-scan-identifiers-20261029`.
- Únicos fuentes aprobados: `src/modules/incidents/IncidentsView.tsx`, `src/modules/incidents/ReturnDocument.ts`, `src/modules/incidents/ReshipmentDocument.ts`.
- El árbol productivo principal está sucio y no se construye ni se modifica. Solo se publica el frontend estático.

## Cambio

- DEV QR y CODE128 contienen el ID DEV, no la URL del Dashboard. Enter en el buscador de devoluciones amplía el filtro a todas las devoluciones; Enter en búsqueda de incidencias limpia filtros que podían ocultar el resultado.
- REX QR y CODE128 contienen la referencia REX. Expediciones conserva su resolvedor existente por Enter; buscar no crea etiqueta ni expedición.
- Candidato compilado: `npm run build` exit 0. Assets con contenido nuevo: `index-DpwN763U.js`, `index.es-DhjQzhqa.js`, `jspdf.es.min-4PKAmzE3.js`. Sin cambios byte a byte: `index-32v5tlI0.css`, `purify.es-CAi2OJFm.js`, `html2canvas.esm-QH1iLAAe.js`. El HTML solo cambia referencias de entrada/dynamic imports.
- Publicación/verificación pública aún pendientes.

## Pruebas

- Baseline candidato reconstruido desde el commit anterior: `npm run build` exit 0 y sus assets coinciden byte a byte con los archivos públicos actuales; evidencia en `/root/.openclaw/workspace/releases/incidents-scan-promotion-20261029/`.
- Candidato cambiado: `npm run build` exit 0; `git diff --check` exit 0; únicos fuentes modificados, los tres de la allowlist. No se ejecutaron transacciones ni operaciones externas.
