# Amazon Messages - FASE 0.4 Parser y clasificador operativo

Fecha: 2026-06-20

## Alcance

FASE 0.4 convierte el prototipo Amazon Messages en un clasificador operativo por tipo de notificacion Amazon.

No se ha conectado mailbox real. No se ha conectado Amazon SP-API real. No se han enviado mensajes. No se han guardado `.eml` reales en el repositorio.

## Campo principal

El clasificador usa como senal principal:

```text
X-Space-Notification-Type
```

Tipos soportados:

- `BBC_MESSAGE_SENT_TO_MERCHANT`: conversacion comprador-vendedor.
- `BRC_SELLER_NOTIFICATION`: solicitud de cancelacion.
- `RETURN_REQUEST`: solicitud/devolucion autorizada.
- `A_Z_CLAIM_RESPONDENT_CLOSE`: A-to-Z / riesgo ODR.
- `UNKNOWN`: sin clasificar.

## Colas operativas

- Conversaciones
- Logistica
- Cancelaciones
- Devoluciones
- A-to-Z / Criticas
- Facturas
- Sin clasificar

## Extraccion implementada

El parser extrae:

- Amazon Order ID
- marketplace y marketplace ID
- idioma inferido
- SKU
- ASIN
- cantidad
- importe y moneda
- motivo
- estado operativo
- buyer alias
- adjuntos
- cola operativa
- prioridad
- accion recomendada
- riesgo de direccion de devolucion internacional/local return address

## Regla critica A-to-Z

Cuando `X-Space-Notification-Type` es `A_Z_CLAIM_RESPONDENT_CLOSE`, la cola pasa a `A-to-Z / Criticas` y la prioridad a `urgent`.

Si el cuerpo menciona direccion de devolucion internacional, politica local, `international return` o `local return address`, se marca:

```text
isInternationalReturnAddressRisk = true
```

Accion recomendada: revisar de inmediato, preparar apelacion si procede y corregir la causa raiz de direccion local de devolucion.

## Fixtures

Se han creado fixtures sanitizados dentro del modulo demo. No contienen emails reales ni alias reales de compradores.

Cobertura funcional de fixtures:

- Mensaje comprador-vendedor logistico.
- Mensaje comprador-vendedor con reposicion/tracking.
- Solicitud de cancelacion.
- Solicitud de devolucion autorizada.
- A-to-Z con riesgo de devolucion internacional.
- Solicitud de factura.
- Caso sin `X-Space-Notification-Type`.

## Tests

Comando:

```bash
npm run test:amazon-parser
```

Resultado actual:

```text
Amazon email parser tests passed: 4 fixtures, 27 field checks.
```

Porcentaje de extraccion correcta en tests automatizados: 27/27 campos esperados, 100%.

## Archivos principales

- `src/modules/amazonMessages/amazonEmailParser.ts`
- `src/modules/amazonMessages/amazonMessagesTypes.ts`
- `src/modules/amazonMessages/amazonMessagesDemoData.ts`
- `src/modules/amazonMessages/AmazonMessagesView.tsx`
- `scripts/test-amazon-email-parser.ts`
