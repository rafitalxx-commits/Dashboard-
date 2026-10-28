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

## Resultado final — publicado y verificado

- Fuente desplegada `66358446e6b5e263f363f06edbeb9204423acd1b` (incluye navegación `e7f7cd1` y corrección responsive). Backend HEAD productivo sigue `9a343d2`; identidad efectiva de los cinco archivos en `deployment.json`. No se atribuye todo el árbol sucio a esa revisión.
- HTML publicado SHA256 `68bc3c584cbf91880218cb54900b9521c56a086fa2dd52b99b938dbe86c285a3`.
- JS público `/assets/index-Bi08qsGx.js`, SHA256 `7966a670fd2888da5e78c5fd407a028abab6e71e2944a1a3e48088dc76b37b29`.
- CSS público `/assets/index-98ekMsfY.css`, SHA256 `e426e555228db2a796a083d94560728d635799018acd8c6e73e16ce19df08779`.
- Candidato corregido build/UI exit0. Assets públicos con APIs interceptadas exit0: navegación/permisos/impresora/reglas/enlaces/mobile, sin JS errors ni mutaciones. Verificación pública autenticada **sin bypass** exit0: estadísticas reales, 55 etiquetas hoy y 2 operarios con actividad, escritorio/móvil con bounding boxes dentro del viewport, enlace heredado y selector de impresora; cero llamadas mutantes y cero fallos en las lecturas de estadísticas. Fuente total 6.068 actividades, 4 operarios. Sesión real solo-Expediciones también lee ambos endpoints correctamente.
- Ocho stores comparados byte a byte sin cambios durante la publicación final, incluidos actividad, operarios, reglas, configuración, ubicaciones y expedientes de transportistas disponibles. En el intento inicial hubo únicamente avance de `odooMovementSync.automaticLastSyncedAt` por el sondeo preexistente: se verificó criptográficamente que revertir solo ese campo recuperaba el hash previo exacto; ninguna cantidad/auditoría cambió. Nunca se restauró ni rebobinó el store.
- Servicio productivo activo; Caddy/configuración/gates de escritura existentes conservados. No se activó ninguna nueva escritura ni se ejecutó una transacción/etiqueta/comunicación real para probar. Assets anteriores conservados y rollback inicial disponible.
- LAB sigue activo con reposición y datos aislados; esa función no está en el bundle ni en las rutas de producción.
- Evidencia final: `production-verification.json`, `public-ui-fixture.json`, `api-after.json`, `final-integrity.json`, capturas `production-statistics-desktop.png`/`production-statistics-mobile.png` y `deployment.json` en el directorio privado de la publicación.
- Rama/commits locales; no push ni merge remoto en este alcance. No quedan harnesses o procesos de desarrollo temporales; solo los servicios gestionados habituales.

URL final: https://dashboard.todoelectrico.net/#/expediciones/estadisticas . Publicación terminada; no hay continuidad pendiente para esta navegación. La aceptación/publicación de la reposición continúa como tarea LAB separada.
