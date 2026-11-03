# Confirmación manual de envío — PUBLICADO, 2026-11-03

## Aprobación y alcance

Rafa aceptó la revisión LAB y autorizó expresamente producción con «ok» tras la petición de publicación. Publicado el botón «Resolver · enviado confirmado» en Pedidos, diálogo con seguimiento/motivo/casilla obligatorios, auditoría local, respuesta autoritativa e idempotencia. El mismo fallo no reabre una confirmación manual; nuevos datos de envío/error pueden reabrir y conservan auditoría anterior. El escritor de caché protege confirmaciones frente a snapshots de sync concurrentes.

No crea ni valida albaranes Odoo; no marca recepción del cliente; no modifica stock, transportistas, configuración, permisos ni write gates. No se confirmó ningún pedido real para probar el despliegue. KPI «Pedidos sin enviar» sigue dependiendo de Odoo.

## Baselines y fuentes

- LAB probado: `cc8ae13af071e60bcc7673f788777cda4d7517c7`, worktree `odoo-v18-dashboard-shipped-confirm-lab-20261103`.
- Frontend público anterior: `4f3fc81`; reconstrucción sin cambios coincide byte a byte con JS `index-BLhlaGiv.js` y CSS `index-C6J5MsJq.css` servidos por HTTPS.
- Candidato frontend: worktree `odoo-v18-dashboard-shipped-confirm-release-20261103`, rama `release/shipped-confirm-incidents-20261103`. Conserva todas las fuentes públicas fuera de `src/App.tsx`, `src/services/odooClient.ts`, `src/styles/app.css` y nuevo `src/components/ConfirmIncidentShipment.tsx`. Las tres fuentes existentes coincidían exactamente entre baseline público y baseline LAB.
- Backend productivo: HEAD `10dc64ff587ea5b70ff25c38fd1b13821f5964e8`; `vite.config.ts` comparado byte a byte con ese pre-change antes de instalar la versión LAB; nuevo `backend/deliveryIncidentResolution.ts`. No se cambia HEAD ni se sobrescriben archivos ajenos no rastreados. Fuente runtime documentada por SHA-256 en `deployed-source-sha256.json`, no por HEAD.
- Se instalaron también las cuatro fuentes frontend aprobadas en producción, pero NO se reconstruyó allí el frontend: sus otras fuentes no equivalen al baseline público.
- Sin push remoto.

## Publicación y verificación

Evidencia/rollback: `/root/.openclaw/workspace/releases/shipped-confirm-production-20261103/`.

- Raíz pública inspeccionada: `/var/www/odoo-v18-dashboard`, Caddy intacto.
- Backup de código, HTML/JS/CSS y snapshots privados para inspección; publicación de assets con hash primero, después sustitución atómica de HTML. Se conservaron iconos/manifest/HTML ajeno y todos los assets viejos.
- Backend reiniciado: servicio `odoo-v18-dashboard.service`, MainPID `1499210`, activo/running. Configuración y gates efectivos antes/después idénticos.
- Nuevos assets públicos HTTPS, comparación byte a byte con candidato: JS `index-Cn4TdmTk.js`, SHA-256 `d2564c7c0078d86bc076a1d809096586e6dfdca257812e2ff0fde1123e52f7fd`; CSS `index-CaNChVAM.css`, SHA-256 `e0659943928a688681ad128db35eb3e86bb041e2268c6d154025653fb308d699`.
- HTML público SHA-256 `d543eb7fd8a5324711655c2ab9b79c9da5a13ea13de4f6920e72d48b9413c956`.
- API real: POST sin sesión 401; GET autenticado 405; POST autenticado con ID sintético inexistente 400. Sesión existente autorizada usada solo en memoria, no impresa ni migrada. Estas pruebas no crean confirmaciones.
- UI pública real con autenticación real y APIs adyacentes/de incidencia interceptadas: escritorio/móvil, límites geométricos y capturas revisadas, Escape sin cambios, confirmación de fixture retira su fila, estado de éxito y control Actualizar conservado, cero pageerrors; una mutación interceptada y cero mutaciones reenviadas a producción. Ver `public-ui.json`. No confundir esta fixture con una confirmación real.
- Candidato compilado: 9 grupos de comprobaciones UI/HTTP local, reinicio/persistencia y escritura concurrente correctos. Datos/auth/HOME desechables y sin bypass; procesos del harness detenidos y listener cerrado. Ver `compiled-qa/result.json`.
- Build LAB y release exit 0; reglas de entrega e incidencias y pruebas de confirmación exit 0.
- Integridad 61 stores/config: 60 exactamente idénticos; `product-locations.json` cambió solo `odooMovementSync.customerReturnsLastSyncedAt` y `automaticLastSyncedAt` por el proceso automático existente. Igualdad semántica restante y reconstrucción raw en ambas direcciones acreditadas en `integrity-final.json`. No se restauró ningún store para ocultar el avance.

## Rollback acotado

`rollback/web/index.html` y assets anteriores conservados. Para revertir, restaurar atómicamente ese HTML; restaurar solo las fuentes aprobadas desde `rollback/code/`, retirar del import el módulo nuevo mediante el `vite.config.ts` anterior y reiniciar backend. El módulo nuevo puede quedar sin uso para evitar borrados. No restaurar los snapshots `rollback/inspection-only/`: son evidencia privada, no una migración ni permiso para borrar actividad posterior. Preservar cambios concurrentes antes de cualquier reversión.

**TERMINADO.** Sin tareas, servidores LAB ni monitores pendientes. Runtime productivo normal activo. No requiere continuación.
