# Expediciones: navegación/estadísticas — publicación 2026-10-28

## Autorización y alcance

Rafa solicitó explícitamente pasar a producción la modificación de Estadísticas dentro de Expediciones. Se publica la navegación aprobada en LAB: Estadísticas junto a Reglas de envío, sin módulo lateral independiente; se retiran las vistas simuladas Puesto e impresión e Integraciones. Se conserva la selección/impresión operativa y los conectores de reglas.

No incluye los avisos/traspasos de reposición, su API, stores ni fotos de prueba: permanecen únicamente en LAB.

La inspección detectó tres usuarios activos de Expediciones sin permiso dashboard; las dos lecturas de estadísticas aún exigían dashboard. Cambio mínimo de backend permite GET a dashboard **o** expeditions, conservando acceso previo y sin modificar ninguna guarda de escritura/administración. Probado en paralelo antes de promoción.

## Identidad y aislamiento

- Worktree de publicación: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-expeditions-nav-release-20261028`, rama `release/expeditions-navigation-20261028`, base122abad.
- Baseline reconstruida sin cambios: HTML y los assets `index-DnI1CUfi.js` y `index-BasP4Vx9.css` coinciden byte a byte con `/var/www/odoo-v18-dashboard` (y archivos públicos verificados anteriormente). No se compila el árbol productivo sucio.
- Los cinco archivos objetivo de producción coinciden byte a byte con la base122abad antes de editar; se preservan todos los cambios ajenos.
- Web estática Caddy `/var/www/odoo-v18-dashboard`; backend `odoo-v18-dashboard.service`, puerto5173, WorkingDirectory original. No se cambia Caddy, config, credenciales ni gates.

## Pruebas anteriores a promoción

- `node --experimental-strip-types scripts/test-warehouse-statistics-permissions.ts`: exit0. HTTP sobre datos temporales: estadísticas GET para Expediciones/dashboard; 401 anónimo/403 permiso ajeno; gestión POST/PATCH/DELETE continúa bloqueada; ledger idéntico.
- `npm run build`: baseline y candidato exit0. Diff-check limpio.
- `verify-navigation.cjs` con candidato compilado/API totalmente interceptada: exit0. Cuatro botones, sin lateral Estadísticas ni Puesto/Integraciones, sin reposición, impresora conservada; datos de estadísticas; enlaces heredado/nuevo y cambios de hash montado/recarga; editor de reglas; móvil; usuario solo Expediciones y rechazo sin Expediciones. Sin errores JS ni escrituras.
- Preflight público real GET con sesión existente de Rafa, sin bypass: 6.068 actividades y 4 operarios; última actividad 2026-10-28T14:28:56.256Z. Esto es lectura de datos real, separado de las fixtures UI.

## Evidencia y rollback

Directorio privado `/root/.openclaw/workspace/releases/expeditions-navigation-20261028/`: `baseline.json`, logs build, `candidate-ui.json`, capturas, `api-before.json`, hashes stores, scripts de validación. `rollback/web` contiene web previa completa; `rollback/source` los cinco archivos originales; Caddy guardado solo como evidencia, sin editarlo.

Publicar assets con nombre nuevo primero, preservar los anteriores y sustituir index.html atómicamente solo al estar sano el backend. Antes de cada copia revalidar ausencia de drift contra originales. Para rollback restaurar index.html y únicamente los cinco originales si sus hashes siguen correspondiendo al despliegue, reiniciar servicio afectado. No restaurar datos/stores ni borrar assets previos. Registrar el resultado final y las identidades tras la verificación pública.

## Corrección durante validación pública

La inspección de la captura móvil detectó recorte interno al anidar Estadísticas en el grid de Expediciones: el documento no desbordaba porque el contenedor superior lo ocultaba. Se restauraron temporalmente HTML y los cinco archivos originales (sin restaurar stores). Se añadió dimensionado scoped al contenedor/grid y cabecera responsive, primero en los worktrees LAB/publicación. La QA exige ahora que nav, estadísticas, cabecera, controles, KPIs, gráficos y detalle queden dentro del viewport, además del ancho del documento. No afecta cálculos ni datos.
