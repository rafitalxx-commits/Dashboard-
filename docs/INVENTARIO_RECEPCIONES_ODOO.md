# Inventario y Recepciones Odoo

## Regla de arquitectura

Odoo es la fuente de verdad de productos, compras, ventas, movimientos y stock oficial. El Dashboard es la interfaz operativa para consultar, escanear, contar, ubicar, revisar y, en fases posteriores, ejecutar acciones mediante el flujo normal de Odoo.

El Dashboard no mantiene una copia paralela de los pedidos de compra ni modifica directamente el stock.

## Objetivo funcional

El flujo completo previsto es:

`Necesidad → compra → pedido Odoo → recepción → conteo → ubicación → revisión → validación → stock Odoo`

Recepciones pertenece al área de Productos para el operario de almacén. Los pedidos de compra todavía abiertos se consultan por separado en `Compras → Compras pendientes`.

## Tipos de necesidad

La clasificación debe admitir cantidades mixtas dentro de una misma línea de compra.

- **Bajo pedido:** unidades vinculadas a uno o varios pedidos de venta. Deben mostrar la referencia SO y dirigirse a una zona de preparación, no necesariamente a la estantería habitual.
- **Reposición:** unidades compradas por reglas de stock o reaprovisionamiento. Se dirigen a la ubicación preferente.
- **Abastecimiento:** compras grandes, importaciones y pruebas de producto. Inicialmente se podrán clasificar manualmente.

No se debe guardar un único tipo obligatorio en `purchase.order`. Una cantidad puede repartirse entre varios tipos o pedidos de venta.

## Compras pendientes

La pantalla `Compras → Compras pendientes` consulta exclusivamente presupuestos
de compra editables (`draft` y `sent`). Los pedidos confirmados no aparecen y no
pueden modificarse desde esta pantalla.

Datos visibles:

- referencia del PO;
- proveedor;
- fecha del pedido y fecha prevista;
- estado borrador o presupuesto enviado;
- importe y moneda del PO;
- imagen, nombre, SKU y EAN del producto;
- cantidad pedida, recibida y pendiente.

La pantalla permite buscar por PO, proveedor, SKU o EAN y filtrar por estado. Se apoya en `purchase.order`, `purchase.order.line` y `product.product`.

No se ocultan por fecha porque pueden representar presupuestos todavía vigentes
o datos que deben revisarse en Odoo.

### Editor de presupuestos de compra (LAB)

La primera fase editable muestra exclusivamente presupuestos Odoo en estado
`draft` o `sent`. La edición de cantidades y precios y la incorporación de
productos se prepara localmente antes de cualquier escritura.

Al buscar un producto, el Dashboard consulta la tarifa del proveedor del
presupuesto en `product.supplierinfo`, respetando variante, plantilla, cantidad
mínima, vigencia y moneda. Un precio cero o inexistente se trata como tarifa no
válida y exige introducir un precio manual.

El precio definitivo se guarda en `purchase.order.line.price_unit`, de modo
que forme parte del histórico real de compras. El Dashboard no escribirá
directamente `standard_price`: al recibir, Odoo aplicará su método de coste. En
AVCO/FIFO la compra interviene en la valoración; con coste estándar se mostrará
un aviso porque la recepción no modifica automáticamente ese coste.

El guardado usa un contrato restringido a líneas de presupuestos editables:
cantidad, precio unitario, fecha prevista, alta de producto y eliminación de
línea. Antes de escribir vuelve a comprobar el estado y la composición del
presupuesto para impedir que se sobrescriban cambios realizados en paralelo.
En LAB, `ODOO_WRITE_ENABLED=false` bloquea la operación antes de la primera
escritura; la prueba real requiere autorización y un presupuesto concreto.

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

## Punto 2: trazabilidad real

Antes de clasificar automáticamente se deben inspeccionar tres casos reales:

1. Una compra generada por Bajo pedido para determinar la relación exacta `SO → procurement → PO → línea/cantidad`.
2. Una compra generada por Reposición para identificar la regla, ruta o grupo de aprovisionamiento disponible.
3. Una compra manual de Abastecimiento para decidir si basta con información existente o hace falta un campo pequeño.

No se implementarán supuestos sobre rutas MTO, grupos de aprovisionamiento u orígenes sin verificar los campos reales de esta instalación de Odoo.

### Reparto automático por cantidad (LAB)

Una línea de recepción puede dividirse entre unidades pendientes de envío y
unidades destinadas a stock. El Dashboard conserva intacta la cantidad pedida
al proveedor y presenta el reparto, por ejemplo: `100 pedidas = 30 pendientes
de envío + 70 para stock`.

El reparto automático utiliza únicamente relaciones explícitas de Odoo entre
el movimiento de entrada, sus movimientos destino y las líneas de venta. Se
ignoran movimientos terminados o cancelados, se evita duplicar cantidades en
rutas de varios pasos y nunca se asigna más que la cantidad pendiente de la
entrada. Si no existe una relación explícita, la línea permanece como reposición
y el operario puede añadir manualmente «Pendiente de envío» durante el reparto.

La propuesta física prioriza las unidades vinculadas a pedidos de venta en
`PENDIENTE_ENVIO`; el resto se propone en la ubicación preferente del producto.
Esta clasificación es informativa y no modifica el pedido de compra en Odoo.

## Fases siguientes

1. Recepciones: lectura Odoo.
2. Analizar trazabilidad de Bajo pedido y Reposición.
3. Clasificación por línea y cantidad.
4. Iniciar recepción e identificar al operario.
5. Escáner de EAN, QR o referencia y conteo.
6. Ubicación preferente, provisional o nueva.
7. Tratamiento de unidades Bajo pedido.
8. Revisión de diferencias e incidencias.
9. Validación mediante movimientos de recepción de Odoo.
10. Recepciones parciales y backorders.
11. Ampliación administrativa de Compras pendientes.
12. Edición de borradores de PO.
13. Creación de PO en Odoo.
14. Confirmación, cierre y cancelación respetando el workflow.
15. Lectura de necesidades y reglas de abastecimiento.
16. Propuesta y generación de pedidos agrupados por proveedor.
17. Métricas y automatizaciones.

## Reglas para recepción física

- El flujo móvil previsto es `escanear → contar → determinar destino → confirmar ubicación → aceptar`.
- Un producto con ubicación preferente puede tener existencias en varias ubicaciones.
- Un producto nuevo sin ubicación debe pedir una ubicación o usar una zona provisional controlada.
- Las unidades Bajo pedido deben mostrar sus pedidos SO y poder ir directamente a preparación.
- Antes de validar se mostrará un resumen de cantidades esperadas, contadas, diferencias, líneas incompletas y productos sin ubicación.
- Las recepciones parciales deben usar los movimientos y backorders de Odoo.

## Límites vigentes

- La rama LAB incorpora el contrato de escritura de recepciones, pero no está fusionada ni desplegada en producción.
- Las rutas de validación y cancelación exigen sesión autenticada, permiso `products` y permiso explícito `odooWrite`.
- No desplegar a producción sin PR, validación funcional y aprobación expresa de Rafa.
- Las credenciales viven en `.env.local` o en el entorno del servidor y nunca se añaden a Git.

## Diseño de auditoría móvil (LAB)

La lista de recepciones se mantiene compacta: pedido de compra, proveedor, referencia del proveedor cuando exista y los totales de esperado, recibido y pendiente. El detalle se abre en un panel lateral en escritorio y ocupa una pantalla completa en móvil.

El operario debe identificarse mediante un QR activo configurado en el Dashboard antes de repartir ubicaciones o editar cantidades. Para una reposición sin ubicación, la primera ubicación confirmada se guarda como preferente solo en Dashboard; no cambia el stock ni la ficha de producto de Odoo.

Una línea Bajo pedido muestra el pedido de venta, avisa de que no debe almacenarse y enlaza la referencia a Expediciones en modo manual. Un reparto con una cantidad inferior a la pendiente se señala como parcial. Al validar, Dashboard escribe las cantidades comprobadas en los movimientos y utiliza el asistente nativo de Odoo para crear o descartar el backorder según la opción elegida.

## Catálogo único de ubicaciones (LAB)

`Productos → Ubicaciones` es el catálogo local único de ubicaciones válidas. Las ubicaciones físicas existentes se incorporan al catálogo al leer el store anterior, sin borrar asignaciones ni cantidades. Las nuevas ubicaciones se crean y activan únicamente desde esta pantalla.

La asignación de un producto, el escáner, los inventarios y los repartos de recepción solo aceptan entradas físicas activas del catálogo. Escanear un código desconocido o inactivo no lo crea. `Pendiente de envío` es una entrada operativa activa del mismo catálogo y se propone por defecto para las líneas Bajo pedido.

Los repartos se editan localmente hasta pulsar `Validar`. Una línea puede guardarse con cero unidades y queda marcada como pendiente local; una cantidad menor queda marcada como parcial. Solo la validación confirmada envía cantidades a Odoo, resuelve el backorder y bloquea la edición; cerrar el panel antes de validar conserva el borrador sin tocar Odoo.
