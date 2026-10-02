# Inicio operativo — LAB (02/10/2026)

## Alcance autorizado

Rafa autorizó la remodelación del **Inicio principal** solo en LAB. `Inicio V2` y producción quedan fuera. No hay escrituras Odoo.

## Inspección previa

- El Inicio antiguo vive dentro de `src/App.tsx` (`DashboardView`) y es exclusivo de Inicio, pero comparte servicios y filtros con Pedidos. No deben borrarse esos servicios.
- Al entrar, `App.tsx` pide resumen, factura cliente y pagina hasta 5.000 pedidos de cuatro días para calcular tarjetas en el navegador. Esa carga debe desaparecer del Inicio principal.
- `orders-cache.json` alimenta pedidos y el resumen cuando `ORDERS_FAST_CACHE_ENABLED` está activo. La caché contiene canal, `fulfillmentBy`, impresión y estado de transporte, pero la fecha serializada del pedido solo tiene precisión diaria.
- El ledger `genei-shipping-labels.json` conserva el instante `createdAt` de las etiquetas y sirve para envíos por hora. La actividad de operarios omite etiquetas sin QR y no debe usarse como fuente completa.
- Recepciones lee `stock.picking` mediante `getOdooInventoryReceptions`; su estado distingue `Pendiente` y `Esperando` y excluye importaciones mediante `isImportation`.
- Presupuestos pendientes ya se leen de `purchase.order` en `draft`/`sent` mediante `getOdooPurchaseReceptions`; el vínculo Bajo pedido está en `getOdooSalesPurchaseAlerts`, mediante relaciones explícitas con ventas.
- Las cantidades por ubicación son locales al Dashboard (`createProductLocations().summary()`), no quants de Odoo. El catálogo tiene el indicador `mto` que identifica Bajo pedido.
- El filtro actual de Pedidos no expresa «FBM + Website» ni «sin etiqueta» como un filtro propio. Se necesitan cambios mínimos en ese destino para cumplir KPI = listado.

## Diseño de implementación

1. Una ruta agregada de KPI con caché en memoria de 45 s y deduplicación de promesas; combinar caché de pedidos/ledger/ubicaciones y las consultas existentes de Recepciones, alertas y presupuestos. Si un origen falla, exponer error por KPI, nunca un cero ficticio.
2. Dos rutas independientes para gráficas, con cubetas ya agregadas. Envíos desde el ledger; ventas netas desde Odoo `amount_untaxed` con agrupación temporal de servidor. `48H` es una ventana móvil de 48 horas y cubetas por hora.
3. Home React separado en presentación, obtención de datos y navegación; controles de cada gráfica aislados, `AbortController`/secuencia para respuestas obsoletas y skeletons de geometría estable.
4. Filtrado de destino usando los mismos predicados/fuentes que el KPI. Recepciones necesita vista combinada `Pendiente + Esperando` sin importaciones; Productos necesita cantidad total de ubicaciones `<=0` y excluir MTO; Bajo pedido y presupuestos deben poder abrir su listado filtrado.
5. Validar build, pruebas relevantes, respuesta API y concordancia entre cada cifra y sus registros. No promover sin otro OK explícito.

## Estado

Worktree limpio creado desde producción `1e82c13`: `lab/home-operational-20261002`. El árbol de producción tiene cambios ajenos sin confirmar y no debe editarse.
