# Facturas: Validar → popup accionable — PUBLICADO

## Alcance y autorización

Seguimiento del flujo ya autorizado y publicado: Rafa indicó que `Invoice_MS-2026-1013_Todoelectrico` no validaba ni mostraba el popup y pidió corregir pendientes dentro de la ventana, con check explícito para crear borrador en Odoo tal como está. Se corrigió el mismo flujo en LAB aislado antes de promover dos fuentes frontend; no se amplió ninguna puerta ni se realizó una transacción real.

## Diagnóstico y corrección

- Entrada directa Validar sobre sesión limpia sí mostraba popup: pendiente real actual de esta factura, NIF del emisor sin evidencia en PDF. No afirmar que se reprodujo el fallo exacto de la sesión del usuario ni atribuirlo a caché sin prueba.
- Guardas de cambios sin guardar y errores de comprobación podían salir con un mensaje inline sin popup. Ahora la ventana aparece inmediatamente, contiene carga/error/reintento y permite guardar explícitamente los cambios del editor sin salir de ella.
- Fallo parcial campos/líneas conserva la edición y muestra qué se guardó; no remonta el editor ni pierde líneas pendientes. Error posterior a guardado no repite guardado al reintentar solo el cotejo. Reintento correcto limpia error anterior.
- Escape no guarda; respuesta tardía tras cerrar no reabre. Selección de otro documento usa key por ID para no heredar estado local.
- Se conserva formulario de corrección de datos y fiscalidad y declaración humana de NIF ausente, sin asumir exención fiscal. Borrador con pendientes exige check, motivo, fecha, huella actual y proveedor confirmado; cambios no guardados o comprobación fallida bloquean envío. Backend sigue controlando requisitos/duplicados/concurrencia. No valida/contabiliza/archiva automáticamente.

## Identidad y límite de publicación

- Worktree `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-invoice-validation-popup-lab-20261030`, base `572ebc9`, fuentes finales `b81d3ba75521f084848e798b730b49720e784808` (implementación a6a0539 y ajuste b81d3ba).
- Solo `src/modules/supplierInvoices/Phase2Views.tsx` e `InvoiceReviewDialog.tsx`, manifiestos antes/después. Fuentes originales iguales a base antes de promoción. Base pública reproducible ya probada en release anterior; sus seis assets se compararon con público y dist antes de este cambio.
- JS final `index-B1r2ZY7n.js`, CSS `index-qdbkGWUa.css` idéntico al previo. HTML atómico conservando meta/icons y location-incidents.js; assets anteriores retenidos.
- Backend HEAD9a343d2/PID1161672 intacto, sin reinicio, cambios backend, configuración, permisos, gates ni cron. No push.

## Verificación ejecutada

- `npm run build`: exit0, aviso conocido de tamaño de chunk.
- `node --experimental-strip-types scripts/test-supplier-invoice-corrections.ts`: exit0, gates/persistencia/dobleenvío/duplicados y Odoo simulado.
- `INVOICE_QA_EVIDENCE=<dir> node scripts/qa-invoice-validation-popup.mjs` y con `--public-assets`: exit0 sobre App compilada candidata y frontend público. Todos los API interceptados. Verifica entrada Validar lenta/fallida, Escape/respuesta tardía, reintento, campos/líneas no guardados, fallos parciales, doble guardado, fallo posterior al guardado, retiro de error viejo, check obligatorio, teclado y desktop/mobile. Un envío Odoo simulado, cero validaciones/Drive reales.
- QA anterior `scripts/qa-invoice-corrections-compiled.mjs`: exit0 antes de ampliar regresión. Capturas finales inspeccionadas.
- `node /root/.openclaw/workspace/releases/invoice-validation-popup-20261030/check-types.cjs`: exit0, comparación focalizada 1diagnóstico heredado→0, cero nuevos; no se afirma typecheck global verde.
- `node /root/.openclaw/workspace/releases/invoice-validation-popup-20261030/verify-live.cjs`: exit0 final. Sesión existente Rafa; auth/inbox/verificación200, noauth401, GETcorrecciones405/IDinválido400. Entrada por Validar sobre factura real `Invoice_MS-2026-1013_Todoelectrico.pdf` muestra pendiente real y formulario; cambio temporal sin guardar también muestra popup y Escape conserva la edición sin persistir. Desktop y móvil correctos, cero pageerror. Todas las mutaciones bloqueadas; el scan automático al montar se intentó y se bloqueó, no llegó al backend. PDF/opciones/APIs adyacentes interceptadas; no confundir con aceptación transaccional Odoo real.
- Descarga HTTPS final HTML y seis assets: SHA exactos al candidato. Primer verificador finalizó aserciones pero falló al cerrar con un route.fetch pendiente; se corrigió cleanup con `await page.unrouteAll({behavior:'wait'})` y se repitió con exit0.
- Integridad final 28/35 iguales; stores de facturas y toda configuración/gates intactos. Siete stores operativos cambiaron concurrentemente: nuevo envío DHL y sus registros de etiqueta/Amazon/actividad, un pedido pasó a entrega validada, movimiento Odoo sincronizado en ubicación, y metadatos/auditoría de gmailSync. No afirmar 35/35 inmóviles: la aplicación siguió operativa. Se comprobaron prefijos añadidos conservando íntegros los registros previos de envío/actividad, actualización del pedido restringida a deliveryStatus/odooDeliveryValidation y auditoría, y nueva auditoría Odoo de ubicación con delta exacto en su única ubicación. No se restauró ningún dato.

## Rollback y cierre

Evidencia `/root/.openclaw/workspace/releases/invoice-validation-popup-20261030/`. `rollback/` conserva HTML y dos fuentes previos a toda la corrección; `final/rollback/` conserva el punto intermedio antes de retirar el mensaje obsoleto. Para deshacer toda esta tarea, verificar ownership SHA actual y restaurar solo HTML y dos fuentes del rollback raíz. Conservar assets y todos los stores/configuración, especialmente la actividad concurrente. No hace falta reiniciar backend para este frontend.

No queda QA, lote, monitor o continuación activa. Factura real no enviada/validada, PDF no movido. Comprobación transaccional real solo tras la confirmación del operario.
