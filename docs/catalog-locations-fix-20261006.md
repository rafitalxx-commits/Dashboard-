# Catálogo · ubicaciones Dashboard (6 octubre 2026)

## Causa y alcance

La columna «Ubicaciones» y las exportaciones CSV/PDF leen `CatalogProduct.localLocations`, pero la API GET y POST de sincronización de Catálogo solo devolvían `physicalLocations` (códigos) y `locationSummary`. Las asignaciones seguían intactas en `product-locations.json`; la interfaz interpretaba la propiedad ausente como lista vacía.

Se añade una única unión, solo de lectura, para ambas respuestas. Cada producto recibe sus ubicaciones Dashboard con código, cantidad y marca `preferred`; la ubicación preferida se conserva y etiqueta incluso cuando su cantidad es cero. El filtro por código y la información de reposición existente se mantienen. La columna permite envolver las etiquetas para que se lea «Preferida» sin depender de un tooltip. CSV y vista de impresión usan la misma descripción.

## Comparación de áreas afectadas

| Área | Antes | LAB | Resultado |
| --- | --- | --- | --- |
| Catálogo GET | Códigos sin `localLocations` | Lista completa por producto | ✅ Equivalente a store · 100% de filas vinculadas |
| Catálogo POST sync | Perdía `localLocations` en la respuesta | Misma unión que GET | ✅ 100% en antes/sync/después |
| Columna y exportaciones | Todos parecían sin ubicación | Código, cantidad y preferida; vacío solo si no hay registro | ✅ Comportamiento solicitado |
| Datos/stock Odoo | Sin cambio | Sin cambio | ✅ Solo lectura Odoo |

## Validación LAB

- Copia aislada de los stores: 5.491 productos; 1.647 con ubicaciones; 1.758 filas vinculadas, incluidas 434 preferidas con cantidad cero y 96 productos multiubicación.
- Antes de sincronizar, respuesta de sincronización incremental con Odoo y lectura posterior: las 1.758 filas y los dos productos de muestra mantuvieron exactamente sus ubicaciones. El store de ubicaciones no cambió de hash.
- Prueba `scripts/test-catalog-locations.ts`: varias ubicaciones, preferida a cero, sin ubicación, reposición y no mutación del store.
- UI LAB local: ubicación preferida a cero, dos ubicaciones en una fila, vacío real, contenido generado en CSV y vista de impresión PDF; sin errores de página. Vista estrecha conserva desplazamiento horizontal. La descarga de Chromium controlada por Playwright no expuso un archivo local ni siquiera con un enlace de control; se verificó el Blob CSV generado y el documento de impresión.
- `npm run build`: OK. `npx tsc --noEmit` sigue fallando por errores globales preexistentes, sin errores en los archivos de este cambio.

No se crean ni modifican ubicaciones o cantidades reales.
