/**
 * build-roster.js  →  ahora es la función de MIGRACIÓN Blobs → Supabase
 *
 * POST /.netlify/functions/build-roster
 * Body: { pw, grado? }
 *
 * Lee todos los blobs de evaluaciones y bonuses (Netlify Blobs),
 * clusteriza nombres con fuzzy matching, e inserta en Supabase:
 *   - alumnos (uno por persona por grado)
 *   - evaluaciones (mejor score por alumno por sesión)
 *   - bonuses
 *
 * Seguro para ejecutar varias veces: usa INSERT … ON CONFLICT DO NOTHING
 * para alumnos, y UPDATE si el score nuevo es mayor.
 */

const { getStore }    = require("@netlify/blobs");
const { supabase }    = require("./_supabase");
const { normalize, titleCase, areSamePerson, bestDisplayName, clusterKeys } = require("./_nameUtils");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";
const GRADES     = ["prim6", "sec2", "sec3", "sec4", "sec5"];

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
  if (body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  const targetGrade   = body.grado || null;
  const gradesToBuild = targetGrade ? [targetGrade] : GRADES;

  try {
    const evalStore  = makeStore("evaluaciones");
    const bonusStore = makeStore("bonuses");
    const db         = supabase();

    // ── Leer todos los blobs ──────────────────────────────────────────────────
    const { blobs: evalBlobs }  = await evalStore.list({});
    const { blobs: bonusBlobs } = await bonusStore.list({}).catch(() => ({ blobs: [] }));

    const allEvals = (await Promise.all(
      (evalBlobs || []).map(({ key }) => evalStore.get(key, { type: "json" }).catch(() => null))
    )).filter(Boolean);

    const allBonuses = (await Promise.all(
      (bonusBlobs || []).map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))
    )).filter(Boolean);

    const results = {};

    for (const grado of gradesToBuild) {
      const gradeEvals = allEvals.filter(d => d.grado === grado);
      if (gradeEvals.length === 0) { results[grado] = { alumnos: 0, evals: 0 }; continue; }

      // Clusterizar nombres (un cluster = un alumno real)
      const nameMap = new Map();
      for (const ev of gradeEvals) {
        const key = normalize(ev.nombre);
        if (!nameMap.has(key)) nameMap.set(key, { displayNames: [], sessionScores: new Map() });
        const s = nameMap.get(key);
        const display = (ev.nombre || "").trim();
        if (!s.displayNames.includes(display)) s.displayNames.push(display);
        const sesId = String(ev.sesion || "??").padStart(2, "0");
        const prev  = s.sessionScores.get(sesId);
        const score = Number(ev.score) || 0;
        if (!prev || score > prev.score) {
          s.sessionScores.set(sesId, { score, fecha: ev.fecha || new Date().toISOString() });
        }
      }

      const allKeys  = [...nameMap.keys()];
      const clusters = clusterKeys(allKeys);

      let alumnosCount = 0, evalsCount = 0;

      for (const [, groupKeys] of clusters) {
        const allDisplayNames = [];
        const mergedScores    = new Map();

        for (const k of groupKeys) {
          const s = nameMap.get(k);
          allDisplayNames.push(...s.displayNames);
          s.sessionScores.forEach((data, sesId) => {
            const prev = mergedScores.get(sesId);
            if (!prev || data.score > prev.score) mergedScores.set(sesId, data);
          });
        }

        const nombre = titleCase(bestDisplayName(allDisplayNames));

        // Insertar alumno (ignorar si ya existe por unicidad nombre+grado)
        const { data: alumnoRow, error: aErr } = await db
          .from("alumnos")
          .upsert(
            { nombre, grado },
            { onConflict: "lower(nombre),grado", ignoreDuplicates: false }
          )
          .select("id")
          .single();

        // Si upsert falla (conflicto de índice funcional), buscar el existente
        let alumnoId = alumnoRow?.id;
        if (!alumnoId) {
          const { data: found } = await db
            .from("alumnos")
            .select("id")
            .eq("grado", grado)
            .ilike("nombre", nombre)
            .single();
          alumnoId = found?.id;
        }
        if (!alumnoId) continue;
        alumnosCount++;

        // Insertar/actualizar evaluaciones
        for (const [sesion, { score, fecha }] of mergedScores) {
          const { data: existing } = await db
            .from("evaluaciones")
            .select("id, score")
            .eq("alumno_id", alumnoId)
            .eq("sesion", sesion)
            .single();

          if (!existing) {
            await db.from("evaluaciones").insert({
              alumno_id: alumnoId, grado, sesion, score, fecha, nombre_raw: nombre,
            });
            evalsCount++;
          } else if (score > existing.score) {
            await db.from("evaluaciones")
              .update({ score, fecha })
              .eq("id", existing.id);
            evalsCount++;
          }
        }
      }

      // ── Migrar bonuses del grado ──────────────────────────────────────────
      const gradeBonuses = allBonuses.filter(b => b.grado === grado);
      for (const b of gradeBonuses) {
        const normB   = normalize(b.nombre || "");
        const { data: gradeAlumnos } = await db
          .from("alumnos").select("id, nombre").eq("grado", grado);
        const alumno = (gradeAlumnos || []).find(a =>
          areSamePerson(normB, normalize(a.nombre))
        );
        if (!alumno) continue;
        await db.from("bonuses").insert({
          alumno_id: alumno.id,
          grado,
          puntos:    Number(b.puntos) || 0,
          razon:     b.razon || "",
          mes:       b.mes   || "",
          fecha:     b.fecha || new Date().toISOString(),
        }).catch(() => {}); // ignorar duplicados
      }

      results[grado] = { alumnos: alumnosCount, evals: evalsCount };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, results }) };
  } catch (err) {
    console.error("build-roster (migrate) error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
