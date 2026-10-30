# Facturas: aceptar un destino Drive alternativo — PUBLICADO

## Alcance y autorización

Rafa pidió aplicar a producción el cambio aprobado: permitir la carpeta que el operario eligió y, si no coincide con proveedor/año/trimestre recomendado, advertir y pedir aceptación explícita antes del movimiento. La carpeta sigue teniendo que estar dentro de `FACTURAS`; el backend verifica de nuevo la ruta real seleccionada en Drive. Sin aceptación no mueve el PDF. El flujo combinado de borrador muestra el aviso antes de crear el borrador y transporta esa aceptación a la operación de archivo.

## Identidad y despliegue

- Base pública reproducible: commit `5f28797e9a49616c39b115e0baf9b36e4ccbdd2c`, assets reconstruidos byte a byte con el público antes del cambio.
- Candidato aislado: `release/supplier-invoice-drive-destination-20261030`; código publicado en `3d7cbf49fb6758038697b414601ac0e2f8309226`.
- Frontend servido desde `/var/www/odoo-v18-dashboard`: publicado el bundle `index-CCfXgZ4y.js`, `index.es-CaZmvZRW.js`, `jspdf.es.min-C9hjwsjx.js` y HTML actualizado. CSS `index-qdbkGWUa.css` permanece idéntico. Assets previos conservados; HTML reemplazado atómicamente.
- Backend runtime actualizado selectivamente en `backend/supplierInvoices/phase2Routes.ts` y `shared/supplierInvoiceArchiveGate.ts`; fuentes guardadas bajo `/root/.openclaw/workspace/releases/invoice-drive-destination-20261030/rollback/`.
- Servicio reiniciado: PID `1174521` → `1196694`, `odoo-v18-dashboard.service` activo. No se cambió configuración, identidad, cron ni puertas de escritura.

## Verificación

- `npm run build`: exit 0 (advertencia existente de bundle grande).
- `node --experimental-strip-types scripts/test-supplier-invoice-archive-gate.ts`: exit 0; destinos recomendados, alternativos y fecha ausente.
- `node --experimental-strip-types scripts/test-supplier-invoices-phase2.ts`: exit 0; cinco fixtures PDF opcionales ausentes, omitidas y no verificadas.
- Suites de correcciones, automatización y seguridad de escaneo: exit 0.
- Playwright del `SupplierInvoicesView` con APIs interceptadas, contra candidato y assets públicos: PASS; carpeta fuera de recomendación recibió `409 confirmationRequired`, primer envío sin aceptación no archivó, botón explícito envió `acceptNonRecommendedDestination: true`, respuesta confirmada actualizó el estado visible. Cero errores de página; operaciones Odoo/Drive simuladas, no reenviadas.
- HTTPS público devuelve el HTML y cada asset con SHA-256 idéntico al publicado. API pública POST sin sesión devuelve `401`; no se hizo una petición autenticada de movimiento.

## Integridad, límites y rollback

No se ejecutó ninguna creación de borrador Odoo ni movimiento de PDF en producción. El POST de prueba sin autenticación fue rechazado antes de procesar el cuerpo. No se modificaron stores de facturas ni permisos/configuración. Los hashes y capturas están en `/root/.openclaw/workspace/releases/invoice-drive-destination-20261030/`.

Para revertir, verifica que `index.html` conserva el hash desplegado y restaura solo `rollback/static/index.html`; conserva todos los assets. Restaura los dos archivos de backend desde `rollback/source/` y reinicia el servicio únicamente si se necesita volver atrás el backend. No restaures stores ni configuración.
