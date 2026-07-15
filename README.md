# Todoelectrico Dashboard

Dashboard operativo de Todoelectrico para Odoo, pedidos, entregas, Amazon Messages, tareas y calendario.

Este repositorio esta pensado como punto central de trabajo para Rafa, Juanito, Hermes y cualquier otro colaborador o agente. El objetivo es que todos puedan proponer cambios en GitHub sin tocar produccion directamente ni mezclar secretos, stores locales o pruebas incompletas.

## Estado del proyecto

- Produccion actual: `https://dashboard.todoelectrico.net`
- Stack: React + Vite + TypeScript.
- Backend ligero: middleware Vite en `vite.config.ts` y modulos bajo `backend/`.
- Frontend principal: `src/App.tsx`.
- Cliente API: `src/services/odooClient.ts`.
- Datos sensibles y stores locales: fuera de Git.

## Modulos principales

- `src/`: interfaz del Dashboard.
- `src/modules/amazonMessages/`: modulo Amazon Messages.
- `src/services/`: cliente API y tipos compartidos.
- `backend/`: rutas y repositorios backend internos.
- `backend/agentApi/`: API segura para agentes externos como Hermes.
- `docs/`: documentacion tecnica y decisiones.
- `deploy/`: servicio de produccion.
- `scripts/`: validaciones y pruebas manuales/automatizadas.

## Arranque local

```bash
npm install
cp .env.example .env.local
npm run dev
```

La app queda disponible en el puerto que indique Vite. Para trabajar sin Odoo real, mantener `ODOO_WRITE_ENABLED=false` y usar datos demo/fallback cuando aplique.

## Comandos utiles

```bash
npm run build
npm run test:agent-api
npm run test:amazon-backend
npm run test:odoo-delivery-status
```

No todos los tests aplican a todos los cambios. Como minimo, cualquier PR debe ejecutar `npm run build` y los tests del modulo tocado.

## Reglas de oro

- No commitear `.env`, tokens, stores reales, backups, `node_modules`, `dist` ni archivos generados pesados.
- No cambiar comportamiento de produccion directamente. Primero lab/paralelo, despues validacion funcional, despues aprobacion explicita de Rafa.
- No activar escrituras reales en Odoo, Gmail, Sendcloud o Amazon sin aprobacion explicita.
- No crear endpoints de envio externo para Agent API.
- Todo cambio de tareas, calendario, Odoo o pedidos debe conservar compatibilidad con los datos existentes.
- Documentar decisiones importantes en `docs/`.

## Flujo recomendado

1. Crear una rama desde `main`.
2. Hacer cambios pequenos y revisables.
3. Ejecutar build/tests relevantes.
4. Abrir Pull Request con resumen, pruebas y riesgos.
5. Validar en entorno lab o demo.
6. Pedir aprobacion de Rafa antes de desplegar produccion.

Ver detalles en [docs/github-workflow.md](docs/github-workflow.md).

## Trabajo de Hermes: tareas

Hermes debe trabajar en la evolucion del modulo de tareas en paralelo, sin sustituir la version de produccion hasta validar. La guia esta en [docs/tasks-hermes-plan.md](docs/tasks-hermes-plan.md).

Para darle acceso y revisar avances por GitHub, ver [docs/hermes-github-onboarding.md](docs/hermes-github-onboarding.md).

## Agent API

La API para agentes externos esta documentada en [docs/agent-api-hermes-access.md](docs/agent-api-hermes-access.md). Usa Bearer token con scopes y no permite acciones finales peligrosas como envio de emails.

## Crear el repositorio en GitHub

Este directorio ya queda preparado para GitHub. Falta que Rafa confirme si el repositorio sera publico o privado y el nombre exacto. Despues:

```bash
git remote add origin git@github.com:ORG_OR_USER/NOMBRE_REPO.git
git branch -M main
git push -u origin main
```

Antes del primer push revisar `git status` y confirmar que no hay secretos ni archivos locales.
