# Handoff — Inicio operativo LAB — 2026-10-02

## Instrucción de continuidad

Rafa pidió que **Raskibot, con Luna**, continúe implementación y pruebas desde este estado. Juanito/GPT-6 Sol solo hace este checkpoint y la revisión final. No rediseñar Inicio, rehacer componentes, replantear requisitos resueltos, refactorizar otros módulos ni tocar producción. No desplegar al terminar: devolver resultado a Rafa para revisión final con Sol.

## Git y límites

- LAB: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-home-lab-20261002`.
- Rama: `lab/home-operational-20261002`; HEAD `1e82c13` (`fix(expeditions): write label and activity ledgers atomically`, 2026-09-25). **No hay commit de esta tarea**; el avance está en el working tree.
- Modificados: `src/App.tsx`, `src/modules/products/ProductsCatalogView.tsx`, `src/modules/receptions/InventoryReceptionsView.tsx`, `src/modules/receptions/ReceptionsView.tsx`, `src/services/odooClient.ts`, `src/services/odooTypes.ts`, `vite.config.ts`.
- Nuevos sin seguimiento antes de este handoff: `backend/home/metrics.ts`, `docs/home-operational-lab-20261002.md`, `scripts/test-operational-home.ts`, `src/modules/home/HomePage.tsx`, `src/modules/home/home.css`. Este handoff también es nuevo.
- Producción: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard`, `main` en `1e82c13`, adelantada 29 commits respecto a `origin/main`, con múltiples cambios ajenos sin confirmar. **No editar ni limpiar ese árbol**.
- Alcance autorizado: solo el Inicio principal en LAB. `Inicio V2` y producción quedan fuera. Sin escrituras Odoo.

## Implementado a nivel de código (no equivale a validación funcional)

- `HomePage` reemplaza `DashboardView` solo en `activeView === "dashboard"`; `dashboardV2` conserva la vista anterior. Se suprimieron las cargas antiguas del Home principal (resumen, bloques de pedidos, facturas) en `App.tsx`.
- Seis tarjetas visibles: Pedidos sin imprimir, Pedidos sin enviar, Recepciones, Compras Bajo pedido, Productos sin stock, Compras pendientes (presupuestos de compra). Cada una usa `count`, `ids` y posible `error` de una carga agregada `GET /api/odoo/dashboard/home`.
- Fuentes reutilizadas: `orders-cache.json` y ledger `genei-shipping-labels.json`; `getOdooInventoryReceptions`, `getOdooSalesPurchaseAlerts`, `getOdooPurchaseReceptions`; catálogo y ubicaciones locales. Predicados de pedidos y agrupación de etiquetas en `backend/home/metrics.ts`.
- Dos gráficas con cargas separadas: `GET /api/odoo/dashboard/home/charts/shipments` (ledger de etiquetas con tracking/transportista admitido) y `.../sales` (`sale.order`/`read_group`, importes sin impuestos). Periodos `48H`, día, semana y mes; ventas además canal. La estructura se renderiza sin esperar a las gráficas, aunque estas **se solicitan inmediatamente al montar**: validar si la prioridad/diferimiento pedido por Rafa queda satisfecha.
- Caché: KPI 45 s en backend con deduplicación de promesa y 45 s en cliente; ventas 45 s por periodo/canal. Envíos lee ledger por solicitud, sin caché específica. Refresh manual pasa `refresh=1` a KPI y gráficas; control muestra carga/deshabilita doble clic. AbortController evita aplicar respuestas anteriores al desmontar/cambiar controles.
- Skeletons de números y gráficas en `home.css`; error por KPI en vez de cero ficticio cuando fallan las tres fuentes Odoo (`Promise.allSettled`).
- Ajuste de concordancia: Productos sin stock ahora parte de todo el catálogo y suma las ubicaciones físicas (producto sin fila = 0), igual que el destino; Compras Bajo pedido deduplica `purchaseId` antes de calcular `count` e `ids`, igual que la lista de presupuestos.
- Las tarjetas entregan IDs al destino y muestran una banda de «Filtro de Inicio» con opción de quitarlo: pedidos en `App.tsx`; productos, recepciones y presupuestos en sus vistas existentes.

## Estado de navegación por tarjeta

| Tarjeta | Enlace/filtro codificado | Estado real |
| --- | --- | --- |
| Sin imprimir | Pedidos, 4 días, FBM + Website, no entregados, sin imprimir, intersección de IDs KPI | Implementado; **concordancia no validada**. Revisar equivalencia de `isHomeOrderChannel` frente a `matchesChannelOption` y de `isHomeOrderUnprinted` frente al filtro de entrega. |
| Sin enviar | Pedidos, 4 días, FBM + Website, IDs KPI que no tienen etiqueta en ledger | Implementado mediante IDs; **concordancia no validada**. No existe filtro autónomo «sin etiqueta» fuera del contexto de Home. |
| Recepciones | `InventoryReceptionsView`, IDs de `Pendiente + Esperando`, excluye importaciones; arranca en «Todos» | Implementado; **concordancia no validada**. La vista también carga pendientes simulados, ocultos con el filtro Home. |
| Bajo pedido | `PendingPurchasesView`, IDs `purchaseId` de alertas draft/sent | Implementado; **concordancia no validada**. Comprobar IDs/duplicados y si todas las alertas existen en la lista de presupuestos. |
| Sin stock | `ProductsCatalogView`, IDs de productos con suma de ubicaciones físicas <=0 y no MTO | Implementado; el cálculo ya incluye productos sin fila de ubicación como stock 0. **Concordancia con datos reales no validada**. |
| Presupuestos pendientes | `PendingPurchasesView`, IDs de recepciones devueltas por `getOdooPurchaseReceptions` | Implementado; **concordancia no validada**. Comprobar `total` vs longitud de IDs/lista y paginación. |

Prioridad inmediata: comprobar con datos reales de lectura que **cada cifra coincide exactamente con los registros visibles al pulsar la tarjeta**. Corregir solo los desajustes comprobados. Confirmar que refrescar/limpiar filtros, cambiar de destino y volver al Home no deja filtros/IDs obsoletos.

## Pruebas y problemas conocidos

- Pasó `node --experimental-strip-types scripts/test-operational-home.ts` (predicados de pedidos y límites de 48H de etiquetas).
- Pasó `npm run build` el 02/10 (Vite, 1718 módulos). Aviso no bloqueante: bundle JS >500 kB. `git diff --check` sin errores.
- **No comprobado**: API real autenticada, lectura real Odoo, UI en navegador, responsive, tiempos/carga y consola, regresión de módulos afectados. Se validó un arranque efímero del LAB sin sesión, detallado abajo; no hubo despliegue.
- Validación de cierre en LAB: `node --experimental-strip-types scripts/test-operational-home.ts` OK; `npm run build` OK (1718 módulos; aviso no bloqueante de bundle JS >500 kB); `git diff --check` OK. La concordancia estática fue revisada para las seis tarjetas; no hubo datos autenticados disponibles en esta ejecución para una medición de API/UI.
- Seguimiento 02/10: se comprobó que este worktree no tiene servicio LAB persistente ni `.env` local (solo `.env.example`); los procesos en puertos 5173/5193–5199 pertenecen a otros worktrees/LAB y no se reutilizaron. Se levantó una instancia efímera del worktree en `127.0.0.1:5201`, sin tocar producción: `/` → `200` (0,373 s), `/api/auth/me` → `200 {"authenticated":false}` (0,023 s), `/api/odoo/dashboard/home` → `401 Login requerido` (1,077 s) y `/api/odoo/dashboard/home/charts/shipments?period=48H` → `401 Login requerido` (0,156 s). La instancia se detuvo al terminar.
- Seguimiento navegador: el navegador gestionado estaba disponible pero parado y sin pestañas; al iniciar, la navegación a `http://127.0.0.1:5201/` fue bloqueada por política tras un timeout. No había navegador conectado con cookies/sesión LAB reutilizable. Por tanto no se pudo comprobar UI autenticada, clic de las seis tarjetas, consola, responsive renderizado ni prioridad/tiempo real de cargas.
- Pruebas reproducibles pendientes: arrancar este worktree con un `.env`/servicio LAB autorizado y una sesión de solo lectura, abrir el Home autenticado en Chromium, registrar Network/Console, comparar cada `count`/`ids` del KPI con las filas visibles del destino, repetir en viewport móvil y escritorio, y medir waterfall de KPI frente a gráficas. Las pruebas estáticas sí confirman media queries del Home a `900px`/`620px`, estados `disabled`/`Actualizando…`, skeletons y `aria-busy`; no sustituyen la validación visual autenticada.
- Riesgos pendientes: datos pueden variar entre lectura KPI y destino; granularidad/husos de 48H y ventas; las dos gráficas arrancan a la vez que KPI.
- El código de Home antiguo permanece en `App.tsx` para `Inicio V2`; no borrar servicios/hook/componentes compartidos.

## Secuencia para Raskibot

1. Leer este archivo, `docs/home-operational-lab-20261002.md`, `AGENTS.md` y las reglas LAB pertinentes. Partir del working tree actual, sin reset/rebase ni recreación.
2. Terminar y probar concordancia de las seis tarjetas con destinos. Priorizar causas concretas anteriores y pruebas representativas/lectura real cuando sea seguro.
3. Validar rutas API, UI funcional, responsive y rendimiento/prioridad de carga. Corregir solo lo necesario. Ejecutar test relevante y build de cierre; documentar resultados y diferencias.
4. Entregar a Juanito/Rafa resumen de cambios, pruebas, evidencias, riesgos pendientes, rama/commit/estado Git y ruta LAB. **No producción ni despliegue.**

## Validación local adicional — 02/10, tras autorización de Rafa

- Se habilitó el bypass **ya existente** `DASHBOARD_DEV_BYPASS_AUTH=true` solo en una instancia efímera de este worktree, ligada a `127.0.0.1:5201`. No se modificó la lógica de autenticación ni producción. `ODOO_WRITE_ENABLED=false` y `SUPPLIER_INVOICES_ODOO_WRITE_ENABLED=false`; las cuatro fuentes locales (caché de pedidos, ledger, catálogo, ubicaciones) se copiaron a un directorio temporal aislado. Se usaron credenciales Odoo de lectura ya configuradas en otro LAB sin exponerlas en este documento.
- La API `/api/auth/me` respondió autenticada en esa instancia. `GET /api/odoo/dashboard/home` respondió 200 con conteos/longitudes de IDs iguales: sin imprimir 2/2, sin enviar 11/11, recepciones 10/10, Bajo pedido 1/1, sin stock 3102/3102, compras pendientes 18/18. Son datos de la instantánea local más lecturas Odoo actuales; los números pueden cambiar.
- Chromium local: las seis tarjetas abrieron sus destinos y filtros. Filas visibles: 2, 11, 10, 1, 50 en la primera página de 3102 productos, y 18, respectivamente. El total de Productos indicaba 3102 resultados. No hubo excepciones JavaScript de página. En 1440, 768 y 390 px se mostraron seis tarjetas y dos gráficas, sin desbordamiento horizontal del documento. Esto valida **el bypass local**, no un login ni la ruta pública.
- La gráfica de ventas fallaba con 500 al parsear el grupo horario: Odoo devuelve `__range["date_order:hour"]`, no `__range.date_order`. Corregido en `vite.config.ts`. Los canales fallaban por la protección de modelos de lectura al consultar `crm.team`; añadido `crm.team` al conjunto de modelos **solo lectura**. Las 20 combinaciones de cuatro periodos × cinco canales de ventas respondieron 200; los cuatro periodos de envíos también respondieron 200.
- `node --experimental-strip-types scripts/test-operational-home.ts` OK; `npm run build` OK (1718 módulos); `git diff --check` OK. Aviso de bundle >500 kB no bloqueante.
- Al cerrar, se detuvo el servidor efímero; se eliminaron el `.env.local` temporal y la copia de datos en `/tmp`. El puerto 5201 dejó de responder. El bypass no queda activo en este worktree.
- Pendiente para aceptación pública: servicio/URL LAB persistente con sesión normal, verificación visual a través del proxy real, consola/network allí y prueba de equivalencia con datos locales plenamente sincronizados. **No desplegar a producción sin revisión final y OK explícito de Rafa.**

## Promoción a producción completada — 2026-10-02

Rafa autorizó explícitamente la promoción en la conversación actual. La integración se reconstruyó en `/tmp/odoo-home-release-20261002`, sin editar ni limpiar el worktree productivo hasta tener build verde.

- LAB sigue en `lab/home-operational-20261002`, sobre `1e82c13`, con los cambios del Home sin commit.
- Producción sigue en `main`, sobre `1e82c13`, con cambios ajenos sin confirmar (Amazon, facturas proveedor y otros módulos). No se hizo `reset`, `rebase` ni limpieza; solo se editaron los archivos mínimos de Home descritos abajo, preservando los cambios ajenos.
- El servicio productivo `odoo-v18-dashboard.service` está activo, usa el worktree de producción en `127.0.0.1:5173`, y Caddy sirve `/var/www/odoo-v18-dashboard` para `https://dashboard.todoelectrico.net`.
- La configuración efectiva mantiene `ODOO_WRITE_ENABLED=true`; no se modificó ningún flag ni se ejecutó ninguna escritura Odoo.

La primera prueba seca detectó solapes, pero se resolvieron en staging mediante fusión de tres vías, preservando los hunks productivos:

- `src/modules/products/ProductsCatalogView.tsx` (filtro Home por IDs + exportación/ubicaciones productiva)
- `src/services/odooTypes.ts`
- `vite.config.ts`

`odooTypes.ts` y `vite.config.ts` tenían hunks productivos coincidentes con el soporte de ubicaciones usado por Home; quedaron incluidos una sola vez. No se creó un commit en `main`: el worktree productivo contiene cambios ajenos sin commit y no se deben absorber en un commit de release.

Se respaldó y desplegó el alcance mínimo: `App.tsx`, filtro de Productos, vistas de Recepciones/Compras, cliente/tipos Odoo, `vite.config.ts`, `backend/home/` y `src/modules/home/`. Se publicó el build aislado de 1718 módulos en el web root y se reinició únicamente `odoo-v18-dashboard.service`.

Pruebas de release: `node --experimental-strip-types scripts/test-operational-home.ts` OK; `npm run build` OK; `git diff --check` OK; servicio `active`; HTML público 200 con `index-DIbl--wg.js`/`index-S2sEfU9G.css`; el JS público contiene las tarjetas Home («Pedidos sin imprimir», «Pedidos sin enviar», «Recepciones», «Compras pendientes»). `/api/auth/me` responde `authenticated:false` y la API Home sin sesión responde 401, confirmando login normal y protección de datos. No había una sesión autenticada disponible para validar los conteos Odoo en la frontera pública.

Referencia de rollback reversible: `/var/backups/odoo-v18-dashboard-home-20261002T192713Z/`. Incluye `source/prod-source-before.tgz`, `webroot/webroot-before.tgz` y `deployed-dist.txt`; para restaurar también habría que retirar las nuevas rutas `backend/home/` y `src/modules/home/` tras reponer los archivos fuente respaldados. Base de código: `main`/`1e82c13` sigue siendo la referencia Git; no se hizo push remoto.

El flag efectivo `ODOO_WRITE_ENABLED=true` ya existía en el override systemd y no fue modificado; `DASHBOARD_DEV_BYPASS_AUTH=false` y `SUPPLIER_INVOICES_ODOO_WRITE_ENABLED=false` permanecen desactivados. No se ejecutaron escrituras Odoo.

## Commit de release Home-only — 2026-10-02

- Producción `main` apunta ahora a `8b315296251309f1a5938c296c012ee18764351c` (`feat(home): publish operational home`). No se hizo push remoto.
- El commit contiene únicamente el alcance Home validado: backend/módulo Home, rutas y tipos Home, integración en `App.tsx`, destinos Home, prueba operativa y documentación.
- `src/modules/products/ProductsCatalogView.tsx` se tomó de LAB para incluir solo el hunk de destino Home; las mejoras de exportación/ubicaciones ajenas permanecen sin confirmar en el worktree y no entraron en el commit.
- Se verificó que los cambios ajenos siguen presentes como modificaciones sin confirmar y que no hay cambios Home pendientes fuera del commit. El índice quedó limpio; permanecen únicamente los cambios ajenos y respaldos preexistentes.
- Rollback: `/var/backups/odoo-v18-dashboard-home-20261002T192713Z/`. El servicio y el web root ya estaban desplegados desde este mismo contenido; no se republicaron artefactos ajenos.
