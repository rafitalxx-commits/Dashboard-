# Entregas y ubicación preferente — LAB 2026-10-13

## Comportamiento

- Toda salida completada hacia cliente desde `ALM/Stock` descuenta su cantidad de la ubicación preferente del producto en Dashboard, aunque el saldo quede negativo. Otras ubicaciones no se consumen automáticamente; un traslado posterior salda la deuda.
- Un proceso de lectura Odoo cada 60 segundos detecta salidas hechas tanto en Odoo como desde Dashboard. No modifica Odoo. La identidad `stock.move.id` evita repetir descuentos; el botón manual comparte ese registro y sigue pudiendo sincronizar entradas y salidas.
- El proceso automático usa `write_date` para captar entregas confirmadas aunque su `date` se antedate. Sólo se activa con `DASHBOARD_AUTO_LOCATION_MOVEMENTS=true`; está desactivado por defecto.
- Al activarse por primera vez se guarda un corte nuevo para ambos cursores: no se vuelven a aplicar entregas históricas ni ajustes manuales anteriores. Las diferencias previas requieren revisión por movimiento; no se debe retroceder el corte a ciegas. Desde el corte, los cursores automático y manual son independientes.

## Validación y límites

- LAB: prueba `scripts/test-preferred-deliveries.ts` cubre saldo a cero, negativo, traslado, duplicado y cursores independientes. Suite de recepciones y build pasan.
- Lectura real: la consulta Odoo con `state=done`, `write_date` y destino `customer` devuelve un movimiento con todos los campos requeridos. No se hizo una entrega real de prueba ni se escribieron datos Odoo.
- Si un producto no tiene ubicación preferente, el movimiento queda en advertencias y no se descuenta. Revisar esos avisos antes de afirmar cobertura completa del catálogo.
- El corte inicial y la activación en producción requieren aprobación separada, copia de datos/config y verificación del proceso y de una entrega posterior.

## Caso observado

Producto `EPR4A063300` (Odoo ID 43306): salida `stock.move` 277280 de 4 unidades hacia cliente, albarán `ALM-OUT-106067`. La corrección puntual del Dashboard se hizo por separado con copia previa; Odoo quedó en 0 y la ubicación preferente C102 pasó de 4 a 0 sin avanzar el cursor general.

## Auditoría histórica de solo lectura (2026-10-13)

Desde el 8 de octubre Odoo registra 496 salidas completadas hacia cliente desde ALM. De ellas, 495 no constaban en el ledger de ubicaciones antes de un eventual backfill: 393 corresponden a 135 productos con ubicación preferente y 102 a productos sin ella. Entre las 393, 26 movimientos tienen un cambio local posterior en la misma ubicación preferente; los otros 367 no. La ausencia del ID en el ledger **no demuestra** por sí sola que todas esas salidas deban descontarse ahora: un ajuste o inventario pudo haberlas incorporado. No se aplicó ninguna corrección masiva. La activación automática empieza con un corte nuevo y la reparación histórica exige un cotejo aparte por producto/movimiento.

## Comparación del área afectada

| Área | Producción actual | LAB | Resultado / riesgo |
| --- | --- | --- | --- |
| Descuento de entrega hacia cliente | ⚠ Sólo botón manual; puede repartir por otras ubicaciones | ✅ Automático y siempre preferente | 100 % en casos sintéticos; falta prueba de entrega real posterior al despliegue |
| Idempotencia y saldo negativo | ⚠ Ledger de IDs pero no deuda preferente | ✅ Repetición sin doble descuento; saldo negativo y traslado | 100 % en prueba aislada |
| Histórico omitido | ❌ Salidas no registradas | ⚠ Corte nuevo; auditoría pendiente | Reparación histórica fuera del despliegue automático |
