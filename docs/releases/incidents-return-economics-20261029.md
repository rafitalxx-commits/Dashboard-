# Incidencias: importe de producto en desistimientos — producción 2026-10-29

## Alcance y autorización

Rafa solicitó publicar en producción la estadística de devoluciones de clientes. Alcance: mostrar **Importe de producto · desistimientos**, sumando precio de venta unitario guardado por la cantidad de cada producto listada en DEV, solo en incidencias normales de cliente tipo desistimiento. No es gasto, reembolso, coste de mercancía ni pérdida extraordinaria. Los reembolsos de desistimientos normales se clasifican como ajuste de venta, preservando intactos su importe, estado e historial; los gastos reales de recogida se siguen contando.

Se cambian únicamente los assets frontend estáticos; no se modifican APIs, runtime backend, configuración, almacenes de negocio ni datos Odoo/Sheets/Drive. No se habilitan permisos ni se hacen transacciones. No se sube código a GitHub.

## Baseline y selectividad

- Baseline de fuentes: `9ea4a7349d01ade5ea299fe1f56c3c6dc5d8cc0e`, worktree aislado `/tmp/incidents-return-stat-public-release-20261029`, rama `release/customer-return-statistics-public-20261029`.
- Antes de editar, `npm ci --ignore-scripts --no-audit --no-fund` y `npm run build` reconstruyeron byte a byte todos los assets referenciados actualmente por producción (JS/CSS principal, JS de PDF, html2canvas y purify). El HTML público conserva meta/iconos y `location-incidents.js` añadidos por despliegue; se preservarán y cambiará solo el nombre del asset JS de entrada.
- Fuentes aprobados: `backend/incidents/analytics.ts`, `backend/incidents/economics.ts`, `backend/incidents/domain.ts`, `src/modules/incidents/IncidentStatistics.tsx`, `src/modules/incidents/IncidentDetail.tsx`. Prueba: `scripts/test-incidents-analytics.ts`.
- Se excluyeron intencionadamente los ajustes ajenos de agrupación/filtro por agencia contenidos en el candidato LAB y los cambios de autenticación/Cookie-path exclusivos de LAB.

## Validación

- `node --experimental-strip-types scripts/test-incidents-analytics.ts`: exit 0.
- `npm run test:incidents`: exit 0, 36/36 suites; red externa denegada por el runner.
- `npm run build`: exit 0. Aviso normal de tamaño de bundle principal (>500 kB minificado).
- `git diff --check`: exit 0.
- QA visual previo LAB aislado con fixture sintética: tarjeta muestra 30,95 €; escritorio 1440 px y móvil 390 px, sin overflow ni errores de consola ni peticiones mutantes. Esa cifra es fixture/cálculo visual, no total real de producción.
- `/api/auth/me` de producción respondió `authenticated:false` en esta sesión. No se verificó con usuario autenticado un importe agregado real; no debe afirmarse que la métrica live se comprobó o que un importe de cero significa ausencia de datos.

## Publicación verificada — 2026-10-29

- Caddy sirve desde `/var/www/odoo-v18-dashboard`. Se publicó el bundle del commit fuente `2e165699ecfae95d1e802e706cd41b11d55025bb` desde el worktree aislado indicado arriba.
- Solo se añadieron tres assets hashados: `index-D8AGridb.js`, `index.es-BUmesscK.js` y `jspdf.es.min-DofTpOOQ.js`. El CSS y las dependencias html2canvas/purify se conservaron byte por byte. `index.html` se reemplazó atómicamente cambiando solo `/assets/index-Y1_YUCRR.js` por `/assets/index-D8AGridb.js`; se conservaron los metadatos/icons y `location-incidents.js` existentes.
- La URL pública respondió HTTP 200. El HTML y todos los assets referenciados se volvieron a descargar por HTTPS; coinciden byte por byte con el candidato (`public-after.sha256`). El bundle público contiene la etiqueta «Importe de producto».
- `odoo-v18-dashboard.service` quedó activo, PID `1094042`, inicio `2026-10-29 17:42:34 CET`; no se reinició. Caddy config sigue con SHA256 `9a8d59dcff9ddb001682e494b17b775fb839553b106e3422d236bc4a76eef868`.
- Los cinco archivos locales de estado Incidencias conservaron sus hashes antes/después. No se llamó a APIs de mutación ni se ejecutaron movimientos, reembolsos, etiquetas o envíos. Las puertas operativas existentes no se cambiaron.
- La comprobación `/api/auth/me` devolvió HTTP 200 con `authenticated:false`; el importe total agregado en una sesión de operario no pudo comprobarse desde esta ejecución. La métrica usa solo precios unitarios guardados y cantidades DEV; un registro histórico sin precio queda fuera de la suma y no prueba valor cero.
- Evidencia y rollback: `/root/.openclaw/workspace/releases/incidents-return-economics-20261029/`; `rollback-public.tar` SHA256 `04b6d141d38fe08ddfd8adcd1cc7f4d445c032a98bb03c4033eff90d029f89fc`. Para revertir, restaurar el `index.html` guardado; los assets anteriores permanecen en el root. No cambiar Caddy, backend ni stores.
