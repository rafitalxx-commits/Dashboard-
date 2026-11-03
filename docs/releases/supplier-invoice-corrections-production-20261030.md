# Correcciones de facturas — PUBLICADO 2026-10-30

## Autorización y alcance

Rafa autorizó en WebChat: «lo pasas a produccion». Publicadas exclusivamente las correcciones validadas: fechas/importes del PDF, NIF false vacío, declaración humana de ausencia de identificador, diálogo de edición local y envío excepcional explícito de borrador con pendientes. Se preservan pendientes/auditoría, revisión humana, protección de duplicados y concurrencia. No valida, contabiliza ni archiva automáticamente; no se creó factura real ni se movió PDF durante el despliegue.

## Baseline y selectividad

- Worktree aislado: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-invoice-corrections-release-20261030`.
- Base frontend pública `90d6266`: los seis assets reconstruidos coincidieron byte a byte antes de incorporar cambios. La instantánea backend actual se conservó separada; las dependencias frontend de Incidencias retienen su versión pública, no la versión antigua del árbol backend productivo.
- Fuente publicada `725d10472a0f2b17228d9af6047ef47f19861484`; backend HEAD `9a343d2d2263fd32e85392019355db8d9ee419bc` permanece unchanged/dirty, no identifica por sí solo el runtime. Los SHA de los diez archivos aprobados constan en `approved-manifest.json` y `deployment.json`.
- Solo se copiaron los diez archivos del manifiesto, nunca todo el árbol dirty ni datos LAB. Backend reiniciado: PID 1137881 → 1161672, activo.
- JS público `index-DQENf6yK.js`, CSS `index-qdbkGWUa.css`. Assets primero y HTML atómico, conservando meta/iconos/location-incidents.js y assets anteriores.
- Configuración, gates efectivos, cron, autenticación y permisos intactos. No push remoto.

## Verificación

- Build baseline y candidato exit 0. Aviso conocido de chunk grande.
- Cuatro suites exit 0: `node --experimental-strip-types scripts/test-supplier-invoice-corrections.ts`, `scripts/test-supplier-invoices-phase2.ts`, `scripts/test-supplier-invoice-automation.ts`, `scripts/test-supplier-invoice-scan-safety.ts` (todas con node --experimental-strip-types). Fase2 omite cinco fixtures antiguas ausentes, no verificadas.
- `INVOICE_QA_EVIDENCE=<evidencia> node scripts/qa-invoice-corrections-ui.mjs`: exit 0, componente real con API interceptadas.
- `INVOICE_QA_EVIDENCE=<evidencia> node scripts/qa-invoice-corrections-compiled.mjs` y la misma orden con `--public-assets`: exit 0 sobre App compilada candidata y pública. Teclado, Escape, guardado lento/fallido, conservación de edición, doble envío, escritorio/móvil y accesibilidad de acciones. Creación Odoo exclusivamente simulada. Capturas revisadas visualmente.
- Typecheck global heredado no verde, no se afirma aprobación global. `git diff --check` exit 0.
- `node /root/.openclaw/workspace/releases/invoice-corrections-20261030/verify-live.cjs`: exit 0. Sesión existente de Rafa, auth/inbox/verificación 200; sin sesión 401; nueva ruta correcciones con GET 405 e ID inválido 400. Bandeja con 19 documentos (no confundir con el lote previo de 17). Abierta factura `Invoice_MS-2026-1013_Todoelectrico.pdf`, NIF sin FALSE, pendientes reales y diálogo desktop/mobile correctos, Escape sin guardar.
- APIs adyacentes y PDF interceptados. La UI intenta su POST automático de scan al montar; el verificador lo bloqueó antes de llegar a producción. Cero peticiones mutantes reenviadas, cero pageerror. Primer intento del verificador falló por exigir cero intentos en vez de cero mutaciones reenviadas; no fue un fallo de producto ni ejecutó el scan. Se corrigió la aserción a permitir únicamente ese intento bloqueado y se repitió con exit 0.
- Descarga pública HTTPS de HTML y seis assets: SHA exactos al candidato. 35/35 archivos de datos/configuración idénticos desde antes de publicar hasta después de la comprobación autenticada. Ningún store reemplazado/restaurado.

## Evidencia, rollback y cierre

Evidencia privada: `/root/.openclaw/workspace/releases/invoice-corrections-20261030/`. `rollback/index.html`, `rollback/source/` guardan originales; `rollback/data-before/` es evidencia comparativa, **no debe restaurarse sobre datos posteriores**. Para rollback: comprobar que HTML/fuentes aún pertenecen a esta release; restaurar solo HTML y siete fuentes preexistentes, desactivar los tres archivos nuevos de esta release si procede y reiniciar odoo-v18-dashboard. Conservar assets y datos/configuración ajenos.

La capacidad de crear borradores sigue siendo la puerta dedicada ya existente; la escritura amplia Odoo sigue cerrada. No cambió ninguna puerta efectiva. Prueba transaccional real Odoo no incluida ni realizada. Sin servidores QA, lotes, agentes o continuaciones activas. Solicitud terminada.


## Seguimiento de Validar

Corrección posterior de guardas/popup publicada: ver `supplier-invoice-validation-popup-20261030.md`. Fuente b81d3ba, JSindex-B1r2ZY7n; PID backend sin cambio.
