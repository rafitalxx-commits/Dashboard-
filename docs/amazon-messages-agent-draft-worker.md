# Amazon Messages: worker de borradores por agente

## Objetivo

Procesar de forma recurrente las solicitudes de borrador creadas por mensajes reales de clientes o por el botón `Solicitar al agente`.

## Seguridad

- Desactivado por defecto mediante `AMAZON_MESSAGES_AGENT_DRAFT_WORKER_ENABLED=false`.
- Procesa una única solicitud pendiente por ciclo.
- Reutiliza el análisis seguro de Juanito con mensaje, pedido, tracking, plantillas y conocimiento aprobado.
- El resultado siempre queda en `BORRADOR_INTERNO` y requiere revisión humana.
- Fuerza `externalSend=false` en generación, finalización y error.
- No crea borradores Gmail, no responde al cliente y no llama a rutas de envío.
- Registra `COMPLETED` o `FAILED`; nunca deja una solicitud reclamada sin resultado por un error controlado.

## Configuración

```text
AMAZON_MESSAGES_AGENT_DRAFT_WORKER_ENABLED=false
AMAZON_MESSAGES_AGENT_DRAFT_WORKER_INTERVAL_MS=15000
```

La activación en producción requiere aprobación separada después de validar LAB.

## Verificación

```bash
npm run test:amazon-agent-draft-worker
npm run test:amazon-agent-draft-auto
npm run test:amazon-backend
npm run build
```
