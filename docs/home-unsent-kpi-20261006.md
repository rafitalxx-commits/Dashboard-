# Inicio · Pedidos sin enviar (6 octubre 2026)

## Regla

- Alcance: pedidos confirmados Amazon FBM y Website de los cuatro días calendario que muestra Inicio.
- Fuente: la misma respuesta paginada de `Pedidos` que ya usa «Pedidos sin imprimir». En producción, `ORDERS_FAST_CACHE_ENABLED=false` la lee directamente de Odoo.
- «Sin enviar» significa que `deliveryStatus` de Odoo **no** es `Entregado`. Incluye albarán reservado, espera de stock, ausencia de albarán y entrega parcial. Imprimir o crear etiqueta no completa la entrega.
- Un estado de entrega ausente produce «Sin dato» para la tarjeta, no un cero engañoso.
- La cifra y el filtro de destino salen de la misma lista de IDs.

## Comparación sobre los mismos registros

| Área | Antes | LAB | Resultado |
| --- | --- | --- | --- |
| Fuente de pedidos | Caché de Inicio, potencialmente incompleta | Listado completo de Pedidos | ✅ Equivalente a Pedidos · 100% de IDs |
| Criterio de envío | Existencia de albarán no cancelado | Entrega Odoo completada | ✅ Comportamiento solicitado · 100% de casos representativos |
| Filtro de destino | Texto decía «sin etiqueta» | Texto «entrega Odoo pendiente» | ✅ Coincide con la tarjeta |

El 6 de octubre, lectura real LAB: 279 pedidos del 3–6 de octubre; 37 FBM/Website sin entrega completada (23 impresos, 14 sin imprimir). Los 37 IDs de la tarjeta coinciden con el listado, que muestra «Filtro aplicado: 37 pedidos de todos los bloques». Son datos dinámicos, no una cifra fija.

## Validación

- `npx tsx scripts/test-operational-home.ts`: OK.
- `npm run build`: OK.
- API LAB local con autenticación de desarrollo y escritura Odoo desactivada: fuente `odoo-live`, 37 IDs coincidentes.
- UI LAB local: tarjeta 37, filtro 37, listado 37, sin errores de página.
- Build previo sin la corrección: JS y CSS idénticos byte a byte a la web pública antes del despliegue. Así, el nuevo bundle no introduce cambios de otras áreas que no estuvieran ya publicados.

No se modifican pedidos ni albaranes en Odoo.
