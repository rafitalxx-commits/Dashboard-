---
name: "dashboard-frontend-ux-ui"
description: "Feedback visual y carga obligatorias en cada acción."
---

## Adenda obligatoria: retroalimentación de acciones

En cualquier interfaz del Dashboard, cada botón que inicie una acción debe proporcionar una señal visual inmediata de que la pulsación fue recibida. La señal debe ser perceptible sin depender solo del color y mantenerse hasta que se conozca el resultado.

- Para acciones inmediatas, mostrar el cambio de estado o la confirmación contextual correspondiente (por ejemplo, selección actualizada, mensaje de éxito o error).
- Para acciones asíncronas o potencialmente lentas, sustituir temporalmente el contenido del botón por un indicador de carga visible (ruleta/spinner) y texto de progreso comprensible, por ejemplo «Guardando…», «Validando…» o «Enviando a Odoo…».
- Mientras la operación está en curso, prevenir dobles envíos deshabilitando el control o usando un bloqueo equivalente cuando no comprometa la operación. No permitir que una segunda pulsación cree duplicados.
- Al terminar, retirar el estado de carga y mostrar éxito o error visible junto con el siguiente paso útil. No afirmar éxito antes de que la operación lo haya confirmado.
- Mantener el control accesible: estado `disabled` real cuando corresponda, etiqueta clara y aviso de estado para lectores de pantalla cuando sea necesario.
- No bloquear toda la pantalla si la acción puede mostrar progreso de forma local y el resto de la interfaz sigue siendo seguro de usar.

Añadir a la verificación obligatoria de finalización: cada botón modificado ha sido probado para retroalimentación inmediata, estado de carga durante operaciones lentas, prevención de doble envío y mensaje final de éxito/error.
