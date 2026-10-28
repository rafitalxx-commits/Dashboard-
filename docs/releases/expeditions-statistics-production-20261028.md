# Estadísticas de Expediciones — publicación selectiva 2026-10-28

## Autorización y frontera

Rafa pidió explícitamente «puedes aplicarlo a produccion» tras recibir el resumen LAB de horas, mes y reparto por operario. Esta autorización cubre exclusivamente estadísticas. La pregunta posterior sobre reposición recibió respuesta: permanece LAB; no autoriza publicarla.

Se promueven tres archivos de `src/modules/warehouseStats/`: vista, cálculos y CSS. Hoy/7 días muestran24horas; mes con total/días y clic para detalle; círculo porcentual con color por operario y mismo filtro. Pedidos únicos por primera etiqueta real global, no pedidos totales Odoo. Etiquetas adicionales conservadas por separado. QR/paginación/error explícito conservados. No cambia backend/configuración/gates/stores. No se ejecutan etiquetas, stock, correos ni pruebas transaccionales.

## Baseline y pruebas

Worktree real aislado `odoo-v18-dashboard-statistics-release-20261028`, rama `release/expeditions-statistics-20261028`, baseb8509b2 (última navegación publicada). Reconstrucción baseline coincide byte a byte con HTML y todos los assets de producción. Los cinco archivos de implementación/tests se copiaron desde LAB solo tras comprobar identidad con el manifiesto QA anterior. No se arrastró ningún cambio de reposición.

- `npm run build`: baseline exit0 y candidato exit0.
- `node --experimental-strip-types scripts/test-warehouse-statistics.ts`: exit0, dedupe/atribución, Madrid/DST,7días, meses/bisiesto/reconciliación.
- Typecheck enfocado de vista+statistics con Bundler/React/ES2020:noEmit exit0. No afirma typecheck global.
- `git diff --check`:exit0.
- `node /root/.openclaw/workspace/releases/expeditions-statistics-20261028/verify.cjs`:exit0, candidato compilado con snapshot real mediante APIs interceptadas.6069actividades/6032pedidos únicos;56hoy/375semana/1628octubre. Totales reconciliados independientemente,24horas, selección de hora/día/operario, suma mensual exacta,QR,geometría1440/390px,impresora/reglas/enlaces antiguos, sin reposición/erroresJS/escrituras. Capturas desktop/móvil inspeccionadas.
- Lectura autenticada real previa: sesión existente autorizada, GET auth y ambos endpoints estadísticas, sin bypass ni crear/modificar sesiones. QA LAB anterior sigue distinguida de esta verificación de candidato.

## Publicación y rollback

Evidencia privada `/root/.openclaw/workspace/releases/expeditions-statistics-20261028/`. Respaldo `rollback/web` completo, tres archivos fuente originales/ausentes y Caddy solo como evidencia. Revalidar hashes baseline antes de publicar. Assets nuevos primero, index atómico después; preservar archivos anteriores. No reiniciar backend sin cambio. Si falla la verificación, restaurar únicamente HTML/fuentes; nunca restaurar stores de negocio.

La comprobación pública usa autenticación y ambos GET de estadísticas reales; intercepta GET ajenos y bloquea toda mutación para evitar efectos secundarios de sondeos Odoo. La validación adyacente de impresora/reglas verifica interfaz con fixtures, no hardware/transacciones. Registrar hashes/config/stores tras publicación y estado de servicios.

Rama local únicamente; no push/merge en este alcance. PR remoto anterior de baseline quedó rechazado por usuario; esta publicación no intenta eludirlo ni cambia main remoto.

## Resultado

Pendiente despliegue controlado y verificación pública. Véase deployment.json y production-verification.json para el resultado observado; no interpretar este estado preparatorio como publicación terminada.
