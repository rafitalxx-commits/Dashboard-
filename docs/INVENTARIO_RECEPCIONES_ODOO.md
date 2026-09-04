# Inventario y Recepciones Odoo

## Regla de arquitectura

Odoo es la fuente de verdad de productos, compras, ventas, movimientos y stock oficial. El Dashboard es la interfaz operativa para consultar, escanear, contar, ubicar, revisar y, en fases posteriores, ejecutar acciones mediante el flujo normal de Odoo.

El Dashboard no mantiene una copia paralela de los pedidos de compra ni modifica directamente el stock.

## Objetivo funcional

El flujo completo previsto es:

`Necesidad → compra → pedido Odoo → recepción → conteo → ubicación → revisión → validación → stock Odoo`

Recepciones pertenece al área de Productos para el operario de almacén. El futuro módulo Compras cubrirá necesidades, pedidos de compra y proveedores.

## Tipos de necesidad

La clasificación debe admitir cantidades mixtas dentro de una misma línea de compra.

- **Bajo pedido:** unidades vinculadas a uno o varios pedidos de venta. Deben mostrar la referencia SO y dirigirse a una zona de preparación, no necesariamente a la estantería habitual.
- **Reposición:** unidades compradas por reglas de stock o reaprovisionamiento. Se dirigen a la ubicación preferente.
- **Abastecimiento:** compras grandes, importaciones y pruebas de producto. Inicialmente se podrán clasificar manualmente.

No se debe guardar un único tipo obligatorio en `purchase.order`. Una cantidad puede repartirse entre varios tipos o pedidos de venta.

## Punto 1: Recepciones en solo lectura

Estado: implementado en `feature/odoo-mobile-receptions`.

La pantalla `Productos → Recepciones` consulta pedidos de compra confirmados de Odoo y conserva únicamente las líneas con cantidad pendiente.

Datos visibles:

- referencia del PO;
- proveedor;
- fecha del pedido y fecha prevista;
- estado pendiente, parcial o retrasado;
- importe y moneda del PO;
- imagen, nombre, SKU y EAN del producto;
- cantidad pedida, recibida y pendiente.

La pantalla permite buscar por PO, proveedor, SKU o EAN y filtrar por estado. No contiene botones de validación ni endpoints de escritura.

### Cálculo actual

`cantidad pendiente = max(cantidad pedida - cantidad recibida, 0)`

Se consultan estos modelos mediante métodos de lectura:

- `purchase.order`;
- `purchase.order.line`;
- `product.product`.

La primera lectura real devolvió pedidos antiguos todavía abiertos en Odoo. No se ocultan por fecha porque pueden representar pendientes reales o datos que deben cerrarse. Cualquier regla para excluirlos debe decidirse con casos comprobados.

## Punto 2: trazabilidad real

Antes de clasificar automáticamente se deben inspeccionar tres casos reales:

1. Una compra generada por Bajo pedido para determinar la relación exacta `SO → procurement → PO → línea/cantidad`.
2. Una compra generada por Reposición para identificar la regla, ruta o grupo de aprovisionamiento disponible.
3. Una compra manual de Abastecimiento para decidir si basta con información existente o hace falta un campo pequeño.

No se implementarán supuestos sobre rutas MTO, grupos de aprovisionamiento u orígenes sin verificar los campos reales de esta instalación de Odoo.

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
11. Listado administrativo de pedidos de compra.
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

- `ODOO_WRITE_ENABLED=false` durante los puntos 1 a 8.
- No validar recepciones, modificar PO, crear compras ni cambiar stock en esta fase.
- No desplegar a producción sin PR, validación y aprobación expresa de Rafa.
- Las credenciales viven en `.env.local` o en el entorno del servidor y nunca se añaden a Git.
