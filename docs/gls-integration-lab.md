# Integración GLS · LAB

Conector directo GLS ASMRed para Expediciones. El servicio usa SOAP 1.1: `GrabaServicios` crea el envío, `EtiquetaEnvioV2` recupera PDF/ZPL y `Anula` permite solicitar la cancelación por código de barras.

## Seguridad y configuración

- `GLS_LAB_MOCK` está en modo simulado por defecto (todo valor distinto de `false`). Las pruebas usan el mock y no llaman a GLS.
- En modo mock, el endpoint de creación rechaza por defecto las solicitudes para impedir que una etiqueta ficticia se registre como envío real o active validación posterior. `GLS_LAB_MOCK_CREATE_ENABLED=true` se reserva a pruebas aisladas.
- Para permitir una llamada real hacen falta simultáneamente `GLS_LAB_MOCK=false` y `GLS_REAL_ENABLED=true`. La segunda variable permanece desactivada por defecto y no se ha configurado en este worktree.
- La anulación real comparte la protección `GLS_REAL_ENABLED`; por defecto, el cliente responde con el resultado simulado. No activar la escritura real sin una validación separada.
- `GLS_API_URL`: endpoint entregado por GLS; el fallback es `https://ws-customer.gls-spain.es/b2b.asmx`.
- Secretos fuera de Git: `GLS_UID_CLIENTE`.
- Datos del remitente requeridos al salir del mock: `GLS_REMIT_NAME`, `GLS_REMIT_ADDRESS`, `GLS_REMIT_TOWN`, `GLS_REMIT_POSTAL_CODE`. Opcionales: `GLS_REMIT_PROVINCE`, `GLS_REMIT_PHONE`, `GLS_REMIT_MOBILE`, `GLS_REMIT_EMAIL`, `GLS_REMIT_PLAZA`, `GLS_REMIT_COUNTRY`.
- Opcionales de expedición: `GLS_PORTES` (por defecto `P`), `GLS_HORARIO` (por defecto `18`), `GLS_PLATFORM`.
- Servicio y bultos se toman de la regla de transporte y de Expediciones. El código `96` procede del XML de ejemplo antiguo recibido; debe validarse con GLS antes de habilitar escrituras reales.

## Comportamiento

- Las peticiones requieren sesión y permiso `expeditions`.
- Se persiste primero el estado `pending`; las referencias `created`, `pending` o `unknown` se bloquean para evitar duplicados. Timeout o resultado ambiguo requiere revisión manual.
- La ruta autenticada `POST /api/gls/shipments/:barcode/cancel` solo acepta envíos confirmados localmente como `created`. Persiste `cancel_pending` antes de llamar y marca `cancelled` únicamente con `Resultado return="0"`. Respuestas GLS distintas de cero restauran `created`; timeout o respuesta ambigua queda en `unknown` y bloquea reintentos automáticos.
- Expediciones pide confirmación, muestra progreso y bloquea dobles pulsaciones. Tras la confirmación GLS deshabilita impresión/descarga desde la vista. La anulación del envío no cancela el pedido, el albarán de Odoo ni revierte mensajes de seguimiento enviados a Amazon/PrestaShop.
- Solo aparecen acciones de anulación para envíos presentes en el ledger local GLS; expediciones previas no registradas quedan en modo solo consulta.
- La etiqueta se guarda en el almacén local protegido; el API público devuelve metadatos sin Base64.
- Una etiqueta creada se registra en el ledger de Expediciones con procedencia `gls-label-created`, tracking y enlace Odoo para conservar la elegibilidad genérica de entrega.
- No se despliega, no se modifica producción y no se crean envíos/etiquetas GLS reales en esta implementación.

## Verificación

```bash
npm run test:gls-lab
npm run build
```

Las pruebas son simuladas, incluyendo retorno correcto y rechazo por tracking operativo. Queda pendiente una validación autorizada contra credenciales de prueba/UID de GLS y confirmar con GLS los códigos de servicio y campos específicos de remitente/etiqueta.
