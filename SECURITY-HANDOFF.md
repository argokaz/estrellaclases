# Handoff de seguridad — autenticación docente

Fecha: 2026-08-19

Rama de trabajo: `security/harden-teacher-auth-run`

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
  - Parchea `index.html` sin reescribir manualmente sus ~260 KB.
  - Elimina el literal histórico de contraseña.
  - Cambia estado docente de `localStorage` a `sessionStorage`.
  - Agrega `teacherFetch()` con `Authorization: Bearer <token>`.
  - Quita `pw` de URLs de resultados, tareas, libreta, papelera y health.
  - Migra `get-results.js`, `get-tasks.js`, `get-libreta.js`, `health.js` y `trash.js` a Bearer auth para lecturas protegidas.
  - Elimina el fallback hardcodeado del resto de funciones legacy y hace que fallen cerrado si falta la variable de entorno.
  - Falla explícitamente si encuentra todavía el secreto histórico o `?pw=` en `index.html`.

- `scripts/normalize-auth-block.py`
  - Normaliza el bloque legacy de acceso antes de aplicar la migración.
  - Solo cambia formato, no comportamiento.

- `scripts/add-build-history.py`
  - Agrega el build visible en la esquina inferior izquierda.
  - El build abre un popup compacto con historial de versiones y cambios.
  - Primer build formal: `Build 20260819.1`.

- `.github/workflows/harden-teacher-auth.yml`
  - Ejecuta la migración y las validaciones en esta rama.
  - Valida sintaxis de las Netlify Functions con `node --check`.
  - Ejecuta `git diff --check`.
  - Persiste diagnóstico en `.ci/migration-status.txt` incluso si falla.
  - Si todo pasa, commitea los archivos generados en la misma rama.

## Estado pendiente antes de mergear

**NO MERGEAR todavía** hasta que el workflow termine en verde y se revise el deploy preview.

El workflow ya superó la normalización del bloque de acceso y llegó a aplicar la migración sobre `index.html` y las funciones. Un run posterior detectó correctamente que el secreto histórico seguía escrito en este mismo documento de handoff; esa referencia ya fue eliminada.

### Validaciones mínimas locales / Codex

```bash
git checkout security/harden-teacher-auth-run
python3 scripts/normalize-auth-block.py
python3 scripts/harden-teacher-auth.py
python3 scripts/add-build-history.py

for file in netlify/functions/*.js; do node --check "$file"; done
git diff --check

# No debe existir ningún fallback de password hardcodeado.
grep -R -nE "TEACHER_PASSWORD.*\|\|" netlify/functions || true

# La contraseña no debe viajar en query strings desde el frontend.
grep -nE '[?&]pw=' index.html || true
```

Los dos últimos comandos deben devolver cero coincidencias relevantes.

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
13. Abajo a la izquierda aparece `Build 20260819.1`.
14. Al pulsar el build se abre el popup de historial y se puede cerrar con `✕`, clic fuera o `Escape`.

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
- Ya no debe existir en el código fuente ni viajar en URLs.

Siguiente mejora recomendada, fuera del alcance de esta rama: migrar también todas las páginas `notas-*` y endpoints POST legacy a Bearer token y eliminar por completo el almacenamiento temporal de la contraseña en el navegador.

## Archivos añadidos deliberadamente

- `SECURITY-HANDOFF.md`
- `scripts/harden-teacher-auth.py`
- `scripts/normalize-auth-block.py`
- `scripts/add-build-history.py`
- `.github/workflows/harden-teacher-auth.yml`
- `netlify/functions/_teacherAuth.js`
- `netlify/functions/teacher-login.js`

No editar manualmente los decks/slides generados como parte de esta migración.
