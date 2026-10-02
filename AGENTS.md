# AGENTS.md — repo del sitio (clases.estrellavizcarra.com)

Esta carpeta es **solo el sitio desplegado** (Netlify la sirve tal cual — este archivo incluido, así que aquí no van secretos). El proyecto completo está en el repositorio privado `argokaz/estrellaclases-source`. Si estás en ese clone, lee las guías de la raíz y sigue `../CLOUD.md`: Git está en la raíz, las sesiones sí se pueden generar con las herramientas disponibles allí y el push privado no despliega. Si estás en el repo público aislado, las guías/herramientas no están incluidas:

- `../AGENTS.md` ← guía completa para agentes (léela antes de tocar nada)
- `../CLAUDE.md`, `../armarclase.md`, `../BITACORA.md`, `../cronograma.md`, etc.
- `../tools/gen-sesion/` ← el generador con el que se crean las sesiones

**Si estás corriendo en un entorno que solo ve este repo** (p. ej. Codex Cloud con el clone de GitHub), no tienes el contexto completo. En ese caso limítate a cambios pequeños y respeta estas reglas mínimas:

1. `slides/` se genera con `../tools/gen-sesion/` — **no edites sesiones a mano**; si las herramientas no están disponibles, no regeneres. En el repo privado completo sí se genera desde la raíz con el flujo de `../CLOUD.md`.
2. `netlify/functions/sync.js`: nunca reemplazar `getStore("sync-rooms")` por memoria ni quitar `consistency:"strong"`.
3. `netlify/functions/submit-eval.js`: los rechazos de roster responden **200** con `sinAsignar:true`, nunca 4xx.
4. `index.html` se edita con parches puntuales, jamás se reescribe entero. `TOTAL = 30` sesiones (S31/S32 no existen).
5. Todo push a `main` **despliega a producción en ~1-2 min**: no dejes trabajo a medias.
6. Contenido siempre en español; «la profesora», nunca «la profa»; las respuestas de los quizzes nunca van visibles en los decks.
