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

## Publicación

Pendiente al crear este documento. El destino es el root estático confirmado por Caddy `/var/www/odoo-v18-dashboard`; no reiniciar `odoo-v18-dashboard.service`. Antes de publicar, archivar HTML/assets previos, guardar hashes de API/config y stores locales, copiar los nuevos assets hashados y actualizar atómicamente solo la referencia de entrada. Verificar HTTP público, assets, estado del servicio, gates sin cambios y los mismos hashes de stores tras la publicación.

## Rollback

El rollback restaura el `index.html` previo desde el archivo de evidencia y conserva los assets anteriores (no eliminar assets). No cambiar Caddy, backend ni los stores de negocio.
