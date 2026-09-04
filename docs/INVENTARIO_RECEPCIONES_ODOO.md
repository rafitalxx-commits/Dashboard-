# Inventario y Recepciones Odoo

## Regla de arquitectura

Odoo es la fuente de verdad de productos, compras, ventas, movimientos y stock oficial. El Dashboard es la interfaz operativa para consultar, escanear, contar, ubicar, revisar y, en fases posteriores, ejecutar acciones mediante el flujo normal de Odoo.

El Dashboard no mantiene una copia paralela de los pedidos de compra ni modifica directamente el stock.

## Objetivo funcional

El flujo completo previsto es:

`Necesidad → compra → pedido Odoo → recepción → conteo → ubicación → revisión → validación → stock Odoo`

Recepciones pertenece al área de Productos para el operario de almacén. Los pedidos de compra todavía abiertos se consultan por separado en `Compras → Compras pendientes`.

La navegación recuperada del Dashboard queda organizada así:

- `Compras → Compras pendientes`;
- `Productos → Catálogo`;
- `Productos → Escanear`;
- `Productos → Etiquetas`;
- `Productos → Recepciones`;
- `Productos → Inventario → Nuevo, En curso, Pendientes de revisión, Finalizados e Historial`.

Las pantallas de Productos proceden de la rama `chore/clean-dashboard-github-20260828`, que estaba por delante de `main`. Se han portado sin incorporar los cambios no relacionados de expediciones y transportistas.

## Clasificación de la Fase 2

Cada línea pendiente se muestra con una de estas dos clasificaciones:

- **Bajo pedido:** existe una relación técnica de Odoo con uno o varios pedidos de venta. Se muestran sus referencias.
- **Reposición:** no existe esa relación. Incluye compras manuales, reglas de stock, previsiones y compras grandes destinadas al almacén.

La clasificación se calcula por movimiento de recepción, no se guarda en `purchase.order` y no utiliza el texto de `origin`, el nombre del pedido ni otras heurísticas.

## Compras pendientes

La pantalla `Compras → Compras pendientes` consulta pedidos de compra confirmados y conserva únicamente las líneas con cantidad pendiente.

Datos visibles:

- referencia del PO;
- proveedor;
- fecha del pedido y fecha prevista;
- estado pendiente, parcial o retrasado;
- importe y moneda del PO;
- imagen, nombre, SKU y EAN del producto;
- cantidad pedida, recibida y pendiente.

La pantalla permite buscar por PO, proveedor, SKU o EAN y filtrar por estado. Se apoya en `purchase.order`, `purchase.order.line` y `product.product`.

La primera lectura real devolvió pedidos antiguos todavía abiertos en Odoo. No se ocultan por fecha porque pueden representar pendientes reales o datos que deben cerrarse.

## Punto 1: Recepciones de Inventario en solo lectura

Estado: implementado en `feature/odoo-mobile-receptions`.

La pantalla `Productos → Recepciones` consulta operaciones de entrada de Inventario vinculadas a pedidos de compra. La fuente principal es `stock.picking`, no el pedido de compra.

Datos visibles:

- referencia de la recepción y del PO de origen;
- proveedor;
- fecha prevista, estado y ubicación de destino;
- imagen, nombre, SKU y EAN del producto;
- cantidad esperada, procesada y pendiente por movimiento.

La pantalla permite buscar por recepción, PO, proveedor, SKU o EAN y filtrar entre preparada y esperando. Solo incluye entradas con pedido de compra en estado `assigned`, `confirmed` o `waiting`. Excluye borradores, devoluciones, operaciones terminadas y canceladas. No contiene botones de validación ni endpoints de escritura.

### Cálculo actual

`cantidad pendiente = max(cantidad esperada - cantidad procesada, 0)`

Se consultan estos modelos mediante métodos de lectura:

- `stock.picking`;
- `stock.move`;
- `product.product`.

La comprobación real confirmó recepciones y líneas de movimiento activas. Los totales cambian cuando almacén procesa entradas, por lo que no se fijan en esta documentación. Las cantidades reservadas no se cuentan como procesadas mientras el movimiento no esté marcado como realizado.

## Punto 2: Bajo pedido y destino de almacén

Estado: implementado en `feature/odoo-mobile-receptions`.

### Relación utilizada para obtener el pedido de venta

La instalación dispone de campos directos en la línea de compra:

`stock.move.purchase_line_id → purchase.order.line.sale_order_id`

y, como variante, `purchase.order.line.sale_line_id → sale.order.line.order_id`. Se consultan primero porque son relaciones explícitas. En las recepciones abiertas comprobadas estos campos directos existen, pero no están rellenados.

La trazabilidad real encontrada y utilizada actualmente es:

`stock.move (recepción).move_dest_ids → stock.move.sale_line_id → sale.order.line.order_id`

`move_dest_ids` se recorre hasta encontrar los movimientos destino vinculados a una línea de venta. Se controlan cadenas de varios niveles y ciclos. Si se encuentra `order_id`, la línea se marca **Bajo pedido** y se muestra el nombre real del pedido. Si no existe ninguna relación, se marca **Reposición**. No hay búsqueda por prefijos `S`/`SO`, `origin`, grupos de aprovisionamiento ni reglas de abastecimiento.

La comprobación de lectura del 4 de septiembre de 2026 encontró 18 recepciones abiertas, 77 movimientos raíz y una línea Bajo pedido vinculada a `S100224`. Estos totales son dinámicos.

### Ubicación preferente y reparto físico

La ubicación preferente se lee del registro de ubicaciones de producto del Dashboard. Es una propuesta independiente de las ubicaciones reales del reparto de recepción.

El editor local permite:

- aceptar la ubicación preferente para toda la cantidad;
- cambiar la cantidad a recibir;
- añadir, editar o eliminar ubicaciones reales;
- repartir la línea entre varias ubicaciones;
- marcar el reparto como listo únicamente cuando la suma coincide con la cantidad a recibir.

El reparto permanece en el estado de la pantalla durante esta fase. No crea `stock.move.line`, no valida el albarán y no modifica existencias.

### Archivos de la Fase 2

- `backend/receptions/traceability.ts`: resolución pura de relaciones con pedidos de venta.
- `vite.config.ts`: lecturas Odoo y unión con la ubicación preferente.
- `src/services/odooTypes.ts`: clasificación y modelo de reparto de ubicaciones.
- `src/modules/receptions/InventoryReceptionsView.tsx`: clasificación y editor de reparto.
- `src/modules/receptions/inventory-receptions.css`: presentación adaptable a móvil y escritorio.
- `src/modules/receptions/locationPlan.ts`: cálculo y validación local del reparto.
- `scripts/diagnose-reception-traceability.ts`: diagnóstico reproducible de campos y casos reales en solo lectura.
- `scripts/test-reception-phase-2.ts`: pruebas de trazabilidad, ciclos, casos sin venta y suma de ubicaciones.
- `package.json`: comando `test:receptions-phase-2`.

## Punto 3: iniciar recepción e identificar al operario

Estado: implementado en local en `feature/odoo-mobile-receptions`.

Una recepción abierta puede iniciar una sesión operativa desde su detalle. Antes de empezar se exige el nombre del operario. El Dashboard guarda:

- identificador y referencia de la recepción;
- referencia del pedido de compra;
- identificador, código y nombre del operario;
- estado `in_progress`;
- fecha y hora de inicio y actualización.

Las sesiones se guardan en `DASHBOARD_DATA_DIR/reception-sessions.json`. Volver a iniciar la misma recepción devuelve la sesión existente y conserva el primer operario y la hora original. La pantalla muestra `Recepción en curso`, el operario y el momento de inicio después de recargar.

Esta acción solo escribe el estado operativo local del Dashboard. No ejecuta métodos de escritura en Odoo, no crea líneas de movimiento, no cambia cantidades y no valida el albarán.

Archivos añadidos o modificados en la Fase 3:

- `backend/receptions/sessions.ts`: almacenamiento y validación de sesiones.
- `vite.config.ts`: ruta local `GET/POST /api/odoo/reception-sessions`.
- `src/services/odooClient.ts` y `src/services/odooTypes.ts`: contrato de sesión.
- `src/modules/receptions/InventoryReceptionsView.tsx`: inicio e identificación del operario.
- `src/modules/receptions/inventory-receptions.css`: interfaz adaptable del inicio.
- `scripts/test-reception-phase-3.ts`: persistencia, idempotencia y validación del operario.
- `package.json`: comando `test:receptions-phase-3`.

## Fases siguientes

1. Recepciones: lectura Odoo.
2. Bajo pedido, Reposición y propuesta de ubicaciones.
3. Iniciar recepción e identificar al operario.
4. Escáner de EAN, QR o referencia y conteo.
5. Persistencia controlada de la propuesta de ubicación.
6. Tratamiento de unidades Bajo pedido.
7. Revisión de diferencias e incidencias.
8. Validación mediante movimientos de recepción de Odoo.
9. Recepciones parciales y backorders.
10. Ampliación administrativa de Compras pendientes.
11. Edición de borradores de PO.
12. Creación de PO en Odoo.
13. Confirmación, cierre y cancelación respetando el workflow.
14. Lectura de necesidades y reglas de abastecimiento.
15. Propuesta y generación de pedidos agrupados por proveedor.
16. Métricas y automatizaciones.

## Reglas para recepción física

- El flujo móvil previsto es `escanear → contar → determinar destino → confirmar ubicación → aceptar`.
- Un producto con ubicación preferente puede tener existencias en varias ubicaciones.
- Un producto nuevo sin ubicación debe pedir una ubicación o usar una zona provisional controlada.
- Las unidades Bajo pedido deben mostrar sus pedidos SO y poder ir directamente a preparación.
- Antes de validar se mostrará un resumen de cantidades esperadas, contadas, diferencias, líneas incompletas y productos sin ubicación.
- Las recepciones parciales deben usar los movimientos y backorders de Odoo.

## Límites vigentes

- `ODOO_WRITE_ENABLED=false` durante los puntos 1 a 8.
- No validar recepciones, modificar PO, crear compras ni cambiar stock en esta fase.
- No desplegar a producción sin PR, validación y aprobación expresa de Rafa.
- Las credenciales viven en `.env.local` o en el entorno del servidor y nunca se añaden a Git.
