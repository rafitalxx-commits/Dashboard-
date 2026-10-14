# Primera ubicación al validar una recepción (LAB)

## Regla acordada

Si un producto no tiene ninguna ubicación física en Dashboard, la primera ubicación física confirmada en la recepción pasa a ser preferente. Después de que Odoo valide el albarán, Dashboard lee `qty_available` del producto en `ALM/Stock` y deja la suma de sus ubicaciones físicas en ese valor, salvo la cantidad de la recepción destinada a `PENDIENTE_ENVIO`, que no es una ubicación física. La diferencia (stock anterior sin ubicar) se asigna a la primera ubicación elegida y se registra como cambio de inventario local. No se hace ajuste de inventario en Odoo.

Si la recepción reparte el producto entre varias ubicaciones físicas, se conservan las cantidades explícitas de las demás ubicaciones y la primera absorbe la diferencia. Si ya existía cualquier ubicación para el producto, no se coteja automáticamente y se mantiene la suma de lo recibido. Una recepción ya registrada no duplica el stock.

## Validación

- `node --experimental-strip-types scripts/test-reception-locations.ts`: primera ubicación, reparto múltiple, ubicación existente, idempotencia y deduplicación de movimientos.
- `npm run test:receptions` y `npm run build`: correctos.
- Pendiente: aceptación funcional de Rafa en LAB y aprobación separada antes de promoción a producción.
