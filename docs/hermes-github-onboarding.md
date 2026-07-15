# Guia para Hermes: trabajar en GitHub

## Repositorio

URL:

```text
https://github.com/rafitalxx-commits/Dashboard-
```

El trabajo debe hacerse en ramas y Pull Requests. No trabajar directamente sobre `main`.

## Primer acceso

Clonar:

```bash
git clone https://github.com/rafitalxx-commits/Dashboard-.git
cd Dashboard-
npm install
cp .env.example .env.local
npm run build
```

Si el repo es privado, Rafa debe dar acceso como colaborador o permitir una deploy key/token de lectura y escritura.

## Crear una rama de trabajo

Para la parte de tareas:

```bash
git checkout -b feature/hermes-tasks
```

Para una mejora pequena:

```bash
git checkout -b fix/nombre-del-arreglo
```

## Subir avances

Cada bloque de trabajo debe subirse con commits claros:

```bash
git status
git add .
git commit -m "feat(tasks): add task board draft"
git push -u origin feature/hermes-tasks
```

Despues abrir Pull Request en GitHub contra `main`.

## Como debe trabajar Hermes

- Leer primero `README.md`, `AGENTS.md`, `docs/github-workflow.md`, `docs/project-map.md` y `docs/tasks-hermes-plan.md`.
- Mantener el modulo de tareas en paralelo, sin sustituir la version actual de golpe.
- Preferir archivos nuevos:
  - `src/modules/tasks/`
  - `backend/tasks/`
- Mantener compatibilidad con endpoints actuales:
  - `GET /api/tasks`
  - `POST /api/tasks`
  - `PATCH /api/tasks/:taskId`
  - `DELETE /api/tasks/:taskId`
- No commitear `.env.local`, tokens, stores reales, backups, ZIPs, `dist` ni `node_modules`.
- No activar envios reales por Gmail, Telegram, Amazon, Sendcloud u Odoo sin aprobacion explicita de Rafa.
- No desplegar produccion.

## Que debe poner en cada Pull Request

- Que ha cambiado.
- Que archivos principales ha tocado.
- Como lo ha probado.
- Que falta por terminar.
- Capturas si cambia UI.
- Riesgos o dudas para Rafa/Juanito.

## Validacion minima antes de pedir revision

```bash
npm run build
```

Segun lo que toque:

```bash
npm run test:agent-api
npm run test:amazon-backend
npm run test:odoo-delivery-status
```

Si algun test no aplica o no puede ejecutarlo, debe explicarlo en el PR.

## Flujo recomendado para avances visibles

1. Hermes trabaja en `feature/hermes-tasks`.
2. Sube commits frecuentes.
3. Abre PR aunque este en borrador.
4. Rafa/Juanito revisan el PR y capturas.
5. Solo despues de aprobar, se integra en `main`.
6. Produccion se actualiza aparte y solo con aprobacion de Rafa.
