# Handoff de seguridad — autenticación docente

Fecha: 2026-08-19

Rama de trabajo: `security/harden-teacher-auth`

## Objetivo

Resolver los dos problemas detectados en la consola docente:

1. Eliminar la contraseña docente hardcodeada del repositorio y todos sus fallbacks.
2. Dejar de enviar la contraseña en query strings (`?pw=...`), donde puede terminar en historial, logs o analítica.

`main` no debe tocarse hasta validar esta rama.

## Estado actual

### Ya creado en la rama

- `netlify/functions/_teacherAuth.js`
  - Lee `TEACHER_PASSWORD` exclusivamente desde variables de entorno.
  - No contiene contraseña fallback.
  - Emite/verifica tokens docentes firmados con HMAC SHA-256.
  - TTL actual: 8 horas.
  - Usa `TEACHER_SESSION_SECRET` si existe; si no, firma con `TEACHER_PASSWORD`, de modo que rotar la contraseña invalida sesiones anteriores.
  - Nunca acepta contraseña por query string.
  - Permite de forma temporal contraseña en body solo cuando un endpoint lo solicita explícitamente, para no romper páginas de notas ya generadas.

- `netlify/functions/teacher-login.js`
  - `POST {password}`.
  - Si la contraseña coincide con `TEACHER_PASSWORD`, devuelve un token temporal.
  - Si `TEACHER_PASSWORD` no está configurada, falla cerrado.

- `scripts/harden-teacher-auth.py`
  - Migración reproducible e idempotente.
  - Parchea `index.html` sin reescribir manualmente sus 260 KB.
  - Elimina el literal histórico de contraseña.
  - Cambia estado docente de `localStorage` a `sessionStorage`.
  - Agrega `teacherFetch()` con `Authorization: Bearer <token>`.
  - Quita `pw` de URLs de resultados, tareas, libreta, papelera y health.
  - Migra `get-results.js`, `get-tasks.js`, `get-libreta.js`, `health.js` y `trash.js` a Bearer auth para lecturas protegidas.
  - Elimina el fallback hardcodeado del resto de funciones legacy y hace que fallen cerrado si falta la variable de entorno.
  - Falla explícitamente si encuentra todavía el literal histórico o `?pw=` en `index.html`.

- `.github/workflows/harden-teacher-auth.yml`
  - Intenta ejecutar el script automáticamente en esta rama.
  - Valida sintaxis de todas las Netlify Functions con `node --check`.
  - Ejecuta `git diff --check`.
  - Si hay cambios generados, los commitea en la misma rama.

## IMPORTANTE: estado pendiente antes de mergear

Al momento de escribir este handoff, el workflow todavía no había aplicado el parche generado a `index.html`.

Por lo tanto, **NO MERGEAR todavía** esta rama a `main`.

Codex puede continuar así:

```bash
git checkout security/harden-teacher-auth
python3 scripts/harden-teacher-auth.py

# Validaciones mínimas
for file in netlify/functions/*.js; do node --check "$file"; done
git diff --check

grep -R "yoshipotosucio" index.html netlify/functions || true
grep -nE '[?&]pw=' index.html || true
```

Los dos últimos comandos deben devolver cero coincidencias.

Después revisar el diff, especialmente:

```bash
git diff -- index.html
git diff -- netlify/functions/get-results.js
git diff -- netlify/functions/get-tasks.js
git diff -- netlify/functions/get-libreta.js
git diff -- netlify/functions/health.js
git diff -- netlify/functions/trash.js
```

## Validación funcional requerida

En un deploy preview de esta rama:

1. `/` sigue funcionando para alumnos sin autenticación.
2. `/profe` muestra muro de contraseña.
3. Password incorrecto devuelve rechazo y no abre consola.
4. Password correcto abre consola y crea una sesión temporal.
5. DevTools > Network: resultados, tareas, libreta, health y papelera NO contienen `pw=` en Request URL.
6. Esas llamadas llevan `Authorization: Bearer ...`.
7. Cerrar sesión elimina token y contraseña temporal de `sessionStorage`.
8. Recargar `/profe` después de cerrar sesión vuelve al muro.
9. Resultados, tareas y libreta siguen cargando normalmente.
10. Papelera lista y restaura registros.
11. Health carga correctamente.
12. Abrir notas desde la consola y dar bonus sigue funcionando. Durante esta transición, `nota_pw` se conserva únicamente en `sessionStorage` para compatibilidad con las páginas de notas ya generadas.

## Acción manual obligatoria de infraestructura

La contraseña histórica ya estuvo publicada dentro de `index.html` y funciones del repositorio. Borrarla del HEAD no la vuelve secreta porque sigue existiendo en el historial de Git.

Antes de llevar este cambio a producción:

1. Cambiar `TEACHER_PASSWORD` en las variables de entorno de Netlify por una contraseña nueva y aleatoria.
2. Recomendado: crear también `TEACHER_SESSION_SECRET` con un valor aleatorio largo e independiente.
3. Redeploy después de cambiar variables.
4. No reutilizar la contraseña histórica.

No es necesario reescribir todo el historial de Git para recuperar seguridad si la contraseña expuesta se rota y queda invalidada. Reescribir historial sería una operación separada y disruptiva.

## Decisión de compatibilidad tomada

El objetivo de esta rama es resolver los puntos 1 y 2 sin romper las páginas de clase generadas.

Por eso:

- La consola nueva usa token Bearer para recursos protegidos de lectura.
- La contraseña ingresada por la profesora se guarda solo durante la pestaña/sesión del navegador, en `sessionStorage`, para POSTs legacy y para `nota_pw`.
- Ya no existe en el código fuente ni viaja en URLs.

Siguiente mejora recomendada, fuera del alcance de esta rama: migrar también todas las páginas `notas-*` y endpoints POST legacy a Bearer token y eliminar por completo el almacenamiento temporal de la contraseña en el navegador.

## Archivos añadidos deliberadamente

- `SECURITY-HANDOFF.md`
- `scripts/harden-teacher-auth.py`
- `.github/workflows/harden-teacher-auth.yml`
- `netlify/functions/_teacherAuth.js`
- `netlify/functions/teacher-login.js`

No editar manualmente los decks/slides generados como parte de esta migración.
