/**
 * build-roster.js  — Sincronizar evaluaciones de Blobs → Supabase
 *
 * POST /.netlify/functions/build-roster
 * Body: { pw, grado? }
 *
 * Nuevo comportamiento (roster canónico ya existe en Supabase):
 *   1. Leer alumnos EXISTENTES en Supabase para el grado
 *   2. Leer evaluaciones de Netlify Blobs
 *   3. Para cada eval del blob, buscar el alumno canónico por fuzzy match
 *   4. Si matchea → upsert eval (conserva el score más alto si ya existe)
 *   5. Si NO matchea → ignorar (NO crea alumnos nuevos)
 *
 * Esto preserva la lista canónica. Solo importa datos de evaluaciones.
 */

const { getStore }  = require("@netlify/blobs");
const { supabase }  = require("./_supabase");
const { normalize, areSamePerson } = require("./_nameUtils");

const TEACHER_PW = process.env.TEACHER_PASSWORD;
const GRADES     = ["prim6", "sec2a", "sec2b", "sec3", "sec4", "sec5"];

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore(name) {
  return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  if (!TEACHER_PW || body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  const targetGrade   = body.grado || null;
  const gradesToBuild = targetGrade ? [targetGrade] : GRADES;

  try {
    const evalStore = makeStore("evaluaciones");
    const db        = supabase();

    // ── 1. Leer blobs en paralelo ─────────────────────────────────────────────
    const { blobs: evalBlobs } = await evalStore.list({});
    const allEvals = (await Promise.all(
      (evalBlobs || []).map(({ key }) => evalStore.get(key, { type: "json" }).catch(() => null))
    )).filter(Boolean);

    const results = {};

    for (const grado of gradesToBuild) {
      // ── 2. Obtener roster canónico desde Supabase ──────────────────────────
      const { data: alumnosDB, error: fetchErr } = await db
        .from("alumnos")
        .select("id, nombre")
        .eq("grado", grado)
        .is("deleted_at", null);

      if (fetchErr) throw fetchErr;

      const alumnos = alumnosDB || [];
      if (alumnos.length === 0) {
        results[grado] = { sinced: 0, skipped: 0, msg: "Sin alumnos en roster — agrega alumnos primero" };
        continue;
      }

      // ── 3. Evaluar blobs del grado ─────────────────────────────────────────
      const gradeEvals = allEvals.filter(d => d.grado === grado);
      let synced = 0, skipped = 0;

      // Agrupar por (nombreNorm, sesion) → quedarse con el score más alto
      const bestByKey = new Map(); // "normNombre|sesion" → {nombre, sesion, score, fecha}
      for (const ev of gradeEvals) {
        const normN = normalize(ev.nombre || "");
        const sesId = String(ev.sesion || "??").padStart(2, "0");
        const key   = `${normN}|${sesId}`;
        const score = Number(ev.score) || 0;
        const prev  = bestByKey.get(key);
        if (!prev || score > prev.score) {
          bestByKey.set(key, { nombre: ev.nombre, sesion: sesId, score, fecha: ev.fecha });
        }
      }

      // ── 4. Para cada eval, buscar alumno canónico y upsert ─────────────────
      const evalsPayload = [];

      for (const [, ev] of bestByKey) {
        const normEv  = normalize(ev.nombre || "");
        const matched = alumnos.find(a => areSamePerson(normEv, normalize(a.nombre)));

        if (!matched) {
          skipped++;
          continue;
        }

        evalsPayload.push({
          alumno_id:  matched.id,
          grado,
          sesion:     ev.sesion,
          score:      ev.score,
          fecha:      ev.fecha || new Date().toISOString(),
          nombre_raw: ev.nombre,
          total:      10,
        });
      }

      // Upsert en batch: si ya existe (alumno_id, sesion), conservar el score más alto
      for (const payload of evalsPayload) {
        const { data: existing } = await db
          .from("evaluaciones")
          .select("id, score")
          .eq("alumno_id", payload.alumno_id)
          .eq("sesion",    payload.sesion)
          .is("deleted_at", null)
          .maybeSingle();

        if (!existing) {
          const { error } = await db.from("evaluaciones").insert(payload);
          if (!error) synced++;
        } else if (payload.score > existing.score) {
          const { error } = await db.from("evaluaciones")
            .update({ score: payload.score, fecha: payload.fecha, nombre_raw: payload.nombre_raw })
            .eq("id", existing.id)
            .is("deleted_at", null);
          if (!error) synced++;
        }
        // Si score <= existing.score: ya tiene un mejor intento, no tocar
      }

      results[grado] = { alumnos: alumnos.length, synced, skipped };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, results }),
    };
  } catch (err) {
    console.error("build-roster error:", err.message, err.stack);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
