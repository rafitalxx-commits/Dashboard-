# Amazon Messages - FASE 1.3.1 Validacion UI autenticada

Fecha: 2026-06-21

## Objetivo

Validar visualmente FASE 1.3 dentro del Dashboard autenticado, sin modificar codigo.

## Restricciones aplicadas

- No se enviaron correos.
- No se respondio a compradores.
- No se llamo a SP-API.
- No se modifico Odoo.
- No se modifico Sendcloud.
- No se borraron datos.
- Las acciones de workflow mantuvieron `externalSend=false`.

## Metodo

- Se inicio sesion contra el Dashboard local con usuario admin de validacion.
- Se uso un proxy local temporal solo para inyectar la cookie de sesion en capturas headless.
- El proxy temporal fue detenido al finalizar.
- No se modifico codigo de la aplicacion.

## Validaciones UI

- Acceso autenticado a Amazon Messages: OK.
- Fuente visual `REAL API`: OK.
- Conversacion real importada visible: `403-9628163-5791508`: OK.
- Filtros visibles:
  - Todas: OK.
  - Nuevas: OK.
  - Pendientes: OK.
  - En revision: OK.
  - Listas: OK.
  - Cerradas: OK.
- Contadores visibles:
  - Antes del cambio: `Pendientes (1)`, `En revision (0)`.
  - Tras el cambio: `Pendientes (0)`, `En revision (1)`.
- Cambio de estado:
  - `PENDIENTE_REVISAR -> EN_REVISION`: OK.
- Asignacion:
  - `Soporte -> Rafa`: OK.
- Auditoria visible:
  - Workflow registrado en la conversacion: OK.
  - Asignacion registrada en la conversacion: OK.
- Supervisor:
  - Importados: OK.
  - Duplicados: OK.
  - Errores: OK.
  - Nuevas: OK.
  - Abiertas: OK.
  - Cerradas: OK.
  - Asignadas: OK.
  - Modo seguro: OK.

## Validacion backend complementaria

- Detalle de conversacion confirma:
  - `workflowStatus: EN_REVISION`
  - `assignedUser: Rafa`
  - `assignedAt` persistido.
  - `lastActivityAt` actualizado.
  - `workflowHistory` con `PENDIENTE_REVISAR -> EN_REVISION`.
  - Auditoria con `conversation_workflow_changed` y `conversation_assigned`.
- Intento de `externalSend=true` en workflow rechazado con:
  - `Envio externo deshabilitado para workflow interno`

## Capturas

- `/root/amazon-captures/amazon-phase-1-3-1-inbox.png`
- `/root/amazon-captures/amazon-phase-1-3-1-workflow-updated.png`
- `/root/amazon-captures/amazon-phase-1-3-1-supervisor.png`
- `/root/amazon-captures/amazon-phase-1-3-1-fullpage.png`

## Resultado

FASE 1.3.1 validada visualmente en Dashboard autenticado. El workflow operativo funciona, los filtros y contadores reflejan el cambio, la asignacion persiste, la auditoria queda visible y Supervisor muestra las metricas de Gmail readonly y workflow. No se ejecuto ningun envio externo.
