# Recuperación segura de borradores de factura tras timeout — PUBLICADO 2026-10-30

## Autorización y alcance

Rafa autorizó la promoción con «ok para producccion», en respuesta a la corrección concreta preparada en LAB. Se publicaron únicamente el timeout RPC, el estado persistente del intento, la consulta de reconciliación sin crear facturas, la protección contra doble envío y la UI de resultado incierto/reintento manual. No se alteraron gates, configuración, datos de factura, Odoo ni Drive.

## Candidato y verificación

- Worktree aislado: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-invoice-draft-timeout-release-20261030`, rama `release/invoice-draft-timeout-20261030`, basada en la publicación anterior de correcciones y el diálogo de validación ya publicado.
- Delta de runtime: `backend/supplierInvoices/odooClient.ts`, `phase2Routes.ts`, `phase2Types.ts`, `src/modules/supplierInvoices/InvoiceReviewDialog.tsx`.
- Build `npm run build`: exit 0 (aviso existente de chunk >500 kB).
- `node --experimental-strip-types scripts/test-supplier-invoice-corrections.ts`: exit 0; cubre timeout RPC, intento en curso, reconciliación única/vacía/ambigua/antigua, bloqueo de duplicados y ausencia de creación/movimiento adicional.
- `INVOICE_QA_EVIDENCE=... node scripts/qa-invoice-validation-popup.mjs`: exit 0 en el candidato. La misma QA tras publicar assets reales por el proxy local, con APIs interceptadas, exit 0; desktop/móvil, sin errores de navegador, respuesta perdida, reconciliación, doble envío y autorización manual antes de reintentar.
- La prueba de UI simuló las APIs para que ninguna escritura llegara a Odoo/Drive. La API real solo se comprobó en la frontera local: `/api/auth/me` respondió 200 y la nueva ruta protegida rechazó POST sin sesión (401). No había sesión Rafa activa para probar la variante autenticada.

## Publicación

- Baseline de los cuatro ficheros de código comprobado byte a byte contra producción antes de la promoción.
- Servicio `odoo-v18-dashboard` reiniciado (PID 1161672 → 1174521), activo. El primer sondeo coincidió con el arranque; la segunda comprobación confirmó el servicio y la frontera HTTP.
- Static root `/var/www/odoo-v18-dashboard`. Se añadieron tres assets JS únicos y se cambió `index.html` atómicamente al final. CSS sin cambios; los assets anteriores se conservaron. HTML y todos los assets candidatos se descargaron desde Caddy local y sus bytes coinciden con el candidato.
- Código y artefactos desplegados identificados por SHA-256 en `source-after.txt` y `public-assets-after.txt` de la evidencia externa.
- Caddy, systemd, gates, cron y tiendas de facturas/configuración no se modificaron. Los hashes antes/después de stores de facturas y archivo de gates coinciden.
- No se publicó Git remoto. El HEAD productivo no representa este delta; la identidad real son los hashes de los ficheros y assets.

## Límites y rollback

No se creó ni contabilizó ningún borrador, no se reintentó una factura, no se movió ningún PDF. La creación dedicada de borradores sigue habilitada como antes; la escritura Odoo general permanece desactivada. El flujo sigue requiriendo decisión humana explícita.

Evidencia privada y reversión: `/root/.openclaw/workspace/releases/invoice-draft-timeout-20261030/`. Para rollback, detener el servicio, restaurar solo los cuatro ficheros de `rollback/source/`, arrancar y verificar salud; restaurar solo el `rollback/public/index.html` y conservar los assets únicos publicados (inofensivos y versionados). No restaurar stores ni configuración.
