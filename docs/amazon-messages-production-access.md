# Amazon Messages: acceso en producción

## Objetivo

Mostrar Amazon Messages en la navegación de producción sin reutilizar el permiso general de Pedidos.

## Regla de acceso

- `amazonMessages`: permite ver el enlace y abrir el módulo.
- `amazonMessagesSendFinal`: permiso separado para el envío final.
- El acceso al módulo no activa envíos ni cambia `draft_only`.
- Los administradores reciben `amazonMessages` al crear la cuenta o al migrar permisos antiguos.
- Los roles `printer` y `viewer` no reciben este permiso automáticamente.

## Validación esperada

- Administrador: ve `Amazon Messages` y puede abrir `#/amazon-messages`.
- Usuario sin `amazonMessages`: no ve el enlace y la ruta redirige a Inicio.

## Validación

```bash
npm run test:amazon-production-access
```
- El borrador del agente sigue siendo interno y requiere revisión humana.
