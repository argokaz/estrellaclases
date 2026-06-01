/**
 * submit-eval.js
 *
 * POST /.netlify/functions/submit-eval
 * Body: { nombre, grado, sesion, score, correctas, total, fecha, respuestas }
 *
 * 1. Guarda el blob raw de la evaluación (fuente de verdad histórica).
 * 2. Actualiza (upsert) el registro canónico del alumno en el roster del grado.
 *    El roster es el registro único por alumno con toda su historia.
 */

const { getStore } = require("@netlify/blobs");
const { normalize, titleCase, areSamePerson } = require("./_nameUtils");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore(name) {
  return getStore({
    name,
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' }; }

  const { nombre, grado, sesion, score, correctas, total, fecha, respuestas } = data;
  if (!nombre || !grado || !sesion || typeof score !== "number") {
    return { statusCode: 400, headers: CORS, body: '{"error":"Missing required fields"}' };
  }

  const nombreNorm = titleCase(nombre); // nombre normalizado para guardar
  const fechaStr   = fecha || new Date().toISOString();
  const sesId      = String(sesion).padStart(2, "0");

  try {
    // ── 1. Guardar blob raw (historial de auditoría) ──────────────────────────
    const evalStore = makeStore("evaluaciones");
    const key = `s${sesId}/${grado}/${Date.now()}`;
    await evalStore.setJSON(key, {
      nombre:    nombreNorm,
      grado,
      sesion:    sesId,
      score,
      correctas: correctas ?? null,
      total:     total ?? 10,
      fecha:     fechaStr,
      ts:        Date.now(),
      respuestas: respuestas || null,
    });

    // ── 2. Upsert en el roster del grado ─────────────────────────────────────
    // El roster es el registro único por alumno con historial completo.
    // Si falla, el eval ya está guardado — no bloquear al alumno.
    try {
      const rosterStore = makeStore("rosters");
      const roster = await rosterStore.get(grado, { type: "json" }).catch(() => null);

      const newHistEntry = { sesion: sesId, score, fecha: fechaStr };

      if (roster && Array.isArray(roster.alumnos)) {
        // ── Buscar alumno existente (fuzzy) ──
        const normBuscado = normalize(nombreNorm);
        const idx = roster.alumnos.findIndex(a =>
          areSamePerson(normBuscado, normalize(a.nombre))
        );

        if (idx >= 0) {
          // Actualizar historial del alumno existente
          const student = roster.alumnos[idx];
          const hist    = Array.isArray(student.historial) ? [...student.historial] : [];
          const hIdx    = hist.findIndex(h => h.sesion === sesId);

          if (hIdx < 0) {
            // Sesión nueva para este alumno
            hist.push(newHistEntry);
          } else if (score > hist[hIdx].score) {
            // Mejor intento para una sesión ya registrada
            hist[hIdx] = newHistEntry;
          } else {
            // Score igual o peor — nada que actualizar
            return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
          }

          hist.sort((a, b) => a.sesion.localeCompare(b.sesion));
          const scoreSum = hist.reduce((a, h) => a + h.score, 0);

          roster.alumnos[idx] = {
            ...student,
            nombre:   titleCase(student.nombre), // asegurar normalización
            historial: hist,
            sesiones:  hist.length,
            total:     scoreSum,
            avg:       Math.round((scoreSum / hist.length) * 10) / 10,
          };
        } else {
          // Alumno nuevo — agregar al roster
          roster.alumnos.push({
            nombre:    nombreNorm,
            variantes: [],
            sesiones:  1,
            avg:       score,
            total:     score,
            historial: [newHistEntry],
          });
          roster.alumnos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
          roster.totalAlumnos = roster.alumnos.length;
        }

        roster.actualizadoEn = new Date().toISOString();
        await rosterStore.setJSON(grado, roster);

      } else {
        // No hay roster aún — crear uno con este alumno
        await rosterStore.setJSON(grado, {
          grado,
          alumnos: [{
            nombre:    nombreNorm,
            variantes: [],
            sesiones:  1,
            avg:       score,
            total:     score,
            historial: [newHistEntry],
          }],
          actualizadoEn: new Date().toISOString(),
          totalAlumnos:  1,
        });
      }
    } catch (rosterErr) {
      // No crítico: el eval raw ya está guardado
      console.warn("Roster upsert failed (non-critical):", rosterErr.message);
    }

    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };

  } catch (err) {
    console.error("submit-eval error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
