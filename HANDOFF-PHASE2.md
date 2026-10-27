# Handoff implementación Fase 2 — Facturas de proveedor (SOLO LAB)

Worktree: /home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-supplier-invoices-phase2-lab-20260912
Rama: feature/supplier-invoices-phase2-20260912 (base fa479a1 = Fase 1 completada, NO fusionada a main)
Git limpio. node_modules OK (pdf-parse ya presente). Puerto DEV 5197. Base path sugerido: /supplier-invoices-lab/.

## REGLAS DURAS (de Rafa / skills)
- SOLO LECTURA en Odoo y Drive: NUNCA escribir/borrar/renombrar en Drive; NUNCA escribir en Odoo (sin execute_kw create/write, sin button_confirm). Ningún endpoint debe escribir fuera de .dashboard-data/ del LAB.
- Renombrar/mover PDFs en Drive o avanzar estados queda PROHIBIDO hasta aprobación expresa de Rafa.
- Sin tocar main worktree ni producción. Sin push remoto. Sin publicar dist.
- UI: cada botón asíncrono con spinner + disabled + resultado/error visible (skill dashboard-frontend-ux-ui). No marcar éxito antes de confirmación del backend.
- API LAB: usar helper cliente base-aware como purchases routes (rutas /api/supplier-invoices/... tras strip del base path en Caddy).

## Estado actual
- Fase 1 ya implementada en backend/supplierInvoices/ (service.ts, routes.ts, odooClient.ts, types.ts) + src/modules/supplierInvoices/ (view+css). Mantener todo lo funcionando (tests scripts/test-supplier-invoices.ts deben seguir pasando).
- .env.development.local ya configurado con SUPPLIER_INVOICES_DRIVE_* (account/folder ID 1Bpil.../client secret path/tokens path). NO COMMIT de envs.
- .dashboard-data/supplier-invoices.json tiene cache real (fase 1). NO subir a git (ya está en .gitignore).
- Origen de facturas: cron de raskibot sube adjuntos "Factura/Invoice" a carpeta Drive '00 Facturas SIN REVISAR/SIN REVISAR' (ID 1BpilKyLGF9WKQspYW-UuBXT0iqNw7H1-, cuenta todoelectrico.es@gmail.com, auth via gog-rtk wrapper /root/.openclaw/scripts/gog-rtk.sh, tokens en /root/.openclaw/secrets/gog-tokens.json, client secret en /root/.openclaw/secrets/gog-client-secret.json).

## OBJETIVO FASE 2 — dos vistas dentro del módulo existente
### Vista A: "Bandeja documental" (subtítulo: Fase 2 - Bandeja documental - Drive + OCR/IA + cotejo con Odoo)
- KPIs (6): Facturas sin revisar (azul; botón Ver documentos), Pendientes de cotejo (9, icono reloj arena, fondo amarillo), Pedidos de compra sin facturar (17 + 43.820 €), y 3 KPIs más a elegir coherentes (p.ej. Importe pendiente de cotejo, Sin coincideNcia Odoo, Facturación parcial).
- Flujo visual de pasos con flechas: Drive SIN REVISAR → Descarga PDF → OCR/IA extrae datos → Cotejo con Odoo → Decisión (Revisar / Enlazar / Descartar).
- Tabla bandeja: columnas nombre archivo, proveedor detectado, Nº factura, fecha, importe, moneda, pedido Odoo vinculado, coincidencia % (chip color), estado (Sin revisar/Procesando/Cotejado/Incidente/Descartado), acciones (Ver PDF, Cotejar, Descartar).
- Panel lateral detalle (al seleccionar fila): previsualización/datos extraídos, cotejo candidato (pedido+factura Odoo, por qué coincide), resumen de discrepancias, acciones (Marcar revisado, Descartar duplicado).
- Filtros: estado, proveedor, fecha, coincidencia (alta/media/baja/sin).
- Acción "Cotejar ahora": re-ejecuta matching contra cache local, marca estado, botón con feedback (skill UX).

### Vista B: "Pedidos de compra sin facturar" (subtítulo: Fase 2 - Pedidos de compra sin facturar - control pedido/recepción/factura)
- KPIs (5): Pedidos sin factura (12 + 31.400 € verde), Facturación parcial (5 + 12.420 € naranja), Recibidos sin factura > 15 días (4, rojo, "→ Ver pedidos"), Importaciones (AZUL/AMARILLO según importe), 5º coherente (p.ej. Importe total sin facturar).
- Tabla: Nº pedido, proveedor, fecha pedido, importe, estado (Confirmado/Parcialmente facturado...), recepciones (nº, última fecha), recibido íntegro sí/no, días desde recepción, facturas vinculadas, importe facturado, % facturado, acciones (Ver pedido, Ver facturas).
- Panel lateral: estado del flujo pedido→recepción→factura (pasos con checks), factura candidata (si hay PDF en bandeja matching), resumen cotejo (recepciones vs factura), líneas del pedido con cantidades pedidas/recibidas/facturadas, discrepancias detectadas.
- Filtros: proveedor, estado facturación, recibido sí/no, >15 días, importaciones.

## DATOS / BACKEND (plan)
1. Extender types.ts: DocumentInboxItem (driveFileId, name, provider, invoiceNumber, dates, amounts, currency, linkedPurchaseOrder, matchScore, status, extracted (OCR/IA fields), attachments), DocComparison, estado Fase 2.
2. Nuevo backend/supplierInvoices/documentInbox.ts:
   - DriveClient mínimo: list files in folder (Drive API v3, oauth token refresh con refresh_token como gog-rtk, NO keyring), download file bytes a cache local .dashboard-data/supplier-invoices/inbox/<id>.pdf (solo lectura).
   - Extracción: pdf-parse sobre bytes descargados; para texto vacío/escaneado marcar status="needs_ocr" y NO llamar APIs externas (LAB: extracción local únicamente; integración OCR/IA real queda para fase siguiente con aprobación).
   - Matching local: proveedor→res.partner (normalizando nombre/email/dominio), número factura→invoice_ref/name, importe→amount_untaxed/tax, fecha. matchScore 0-100 con bandas: >=80 alta, 50-79 media, <50 baja. Guardar resultado en store local (nuevo archivo .dashboard-data/supplier-invoices/docInbox.json).
3. Extender routes.ts: GET /api/supplier-invoices/inbox (lista + filtros), GET /inbox/detail?id=, POST /inbox/scan (descarga+extrae+coteja, NO muta Drive/Odoo; actualizar solo store local), GET /unbilled (pedidos sin facturar desde cache fase 1 + stock.picking si necesario ampliar sync), GET /unbilled/detail?id=.
4. Vista A/B en src/modules/supplierInvoices/ (sub-tabs dentro de la vista existente, p.ej. tabs "Bandeja documental" | "Pedidos sin facturar" | lista existente como "Facturas").
5. Tests scripts/test-supplier-invoices-phase2.ts: (a) matching unit con fixtures sintéticos (proveedor/número/importe/fecha), (b) bandas de score, (c) sin escrituras Drive/Odoo (assert paths), (d) inbox store round-trip, (e) PDF real de /tmp: /tmp/factura-efectoLED-GZLKYPHJJ.pdf, /tmp/feuvert_factura.pdf, /tmp/atmoss_factura.pdf, /tmp/ledme_factura.pdf, /tmp/diru_factura.pdf.
6. npm run build debe pasar.

## CRITERIOS DE ACEPTACIÓN
- Ninguna escritura Drive/Odoo (solo lecturas API + archivos locales LAB).
- Fase 1 sigue pasando tests.
- Bandeja muestra PDFs reales de SIN REVISAR con matching contra cache Odoo local.
- KPIs/flujo/tablas/paneles según diseño descrito (imágenes de referencia de Rafa).
- Todos los botones asíncronos con feedback UX obligatorio.

## PASOS SUGERIDOS
1. types + documentInbox backend (Drive list/download/extract/match/store) con tests unit aislados.
2. routes + verificación con LAB en 5197 (curl autenticado; mirar cómo fase 1 hace auth de sesión dashboard en routes.ts).
3. Frontend sub-tabs + KPIs + flujo + tablas + paneles + filtros.
4. build + test suite completa + arranque dev en 5197 para verificación final de Juanito.
## 2026-10-12 noche — Facturas autorrelleno en producción

- Rafa autorizó explícitamente avanzar en una misma versión de producción y realizar la inspección con un acceso temporal limitado, sin pedirle login. Se mantuvo el login público. Para las pruebas se creó una sesión temporal `viewer` con `dashboard`, `supplierBilling`, `purchases`; ya fue retirada y la API sin sesión vuelve a 401.
- Promoción **selectiva** del LAB: nuevo `backend/supplierInvoices/autoFill.ts`, integración en `/inbox/raskibot-extract`, campo `sourcePurchaseLineId` en tipos y sincronización del panel React tras un escaneo. No se cambiaron puertas de escritura ni el modelo Facturas (`openai/gpt-5.5`). El agente sigue proponiendo PDF/JSON; un segundo pase Odoo solo lectura demuestra NIF único, ausencia de duplicado, pedidos por referencia literal incluso si el ledger está atrasado, producto/línea exactos por código, recepción, precio/descuentos, impuesto único y cuenta del producto o categoría. Soporta varios pedidos con líneas inequívocas; deja dudas visibles para el operario. El botón final de crear borrador Odoo y mover PDF permanece bajo confirmación humana.
- Pruebas LAB y producción: `test-supplier-auto-fill.ts` (incluye ledger desactualizado, multi-pedido y cuenta heredada), `test-supplier-auto-verifier.ts`, `test-supplier-invoices-phase2.ts`, build y `git diff --check` pasaron. Typecheck global conserva errores ajenos preexistentes; sin errores de autoFill/phase2Routes. El build público quedó con `assets/index-DuCA-mES.js`; servicio productivo activo y ruta sin sesión 401.
- Clic real autenticado en producción para `efectoLED.pdf`: API 200; borrador local conserva 7 líneas, identifica proveedor Odoo #126759 y P05089, coteja línea 4 con producto #32934, purchase line #17231, impuesto #4 y cuenta de categoría #358 (`600000 Compras de mercaderías`). Verificador `ready=false`, 23 bloqueos: las demás identidades, una línea no recibida, importes/IVA pendientes. Lectura externa posterior: **0 facturas Odoo** con proveedor/referencia, `odooDraftMoveId=null`, PDF aún en carpeta Drive de entrada, `movedTo=null`. No se creó borrador Odoo ni se movió el PDF.
- Rollback reversible: `rollback/supplier-autofill-20261012-2150/` contiene código, store y `public-index.html` anteriores; los assets públicos antiguos siguen presentes. Git productivo base `170a581` con otros cambios previos sin commit: no hacer commit/reset en bloque. Si hay regresión, restaurar exclusivamente los archivos de ese rollback, retirar `autoFill.ts`/test añadido, reconstruir, restaurar índice público y reiniciar servicio; preservar los cambios operativos posteriores en el store si los hubiera.
