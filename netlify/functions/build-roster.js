/**
 * build-roster.js  — Migración Blobs → Supabase
 *
 * POST /.netlify/functions/build-roster
 * Body: { pw, grado? }
 *
 * Lee todos los blobs de evaluaciones (Netlify Blobs), clusteriza nombres
 * con fuzzy matching, e inserta en Supabase en batch para ser rápido.
 *
 * Estrategia sin upsert de expresión:
 *   1. Leer blobs en paralelo
 *   2. Clusterizar en memoria
 *   3. Insertar alumnos en batch (ignorar duplicados via ON CONFLICT DO NOTHING)
 *   4. Re-leer alumnos para obtener IDs
 *   5. Insertar evaluaciones en batch
 *   6. Migrar bonuses
 */

const { getStore }    = require("@netlify/blobs");
const { supabase }    = require("./_supabase");
const {
  normalize, titleCase, areSamePerson, bestDisplayName, clusterKeys,
} = require("./_nameUtils");

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

    // ── 1. Leer TODOS los blobs en paralelo ───────────────────────────────────
    const [{ blobs: evalBlobs }, { blobs: bonusBlobs }] = await Promise.all([
      evalStore.list({}),
      bonusStore.list({}).catch(() => ({ blobs: [] })),
    ]);

    const [allEvals, allBonuses] = await Promise.all([
      Promise.all((evalBlobs  || []).map(({ key }) => evalStore.get(key,  { type: "json" }).catch(() => null))),
      Promise.all((bonusBlobs || []).map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))),
    ]);

    const evals   = allEvals.filter(Boolean);
    const bonuses = allBonuses.filter(Boolean);

    const results = {};

    for (const grado of gradesToBuild) {
      const gradeEvals = evals.filter(d => d.grado === grado);
      if (gradeEvals.length === 0) {
        results[grado] = { alumnos: 0, evals: 0, msg: "Sin evaluaciones en blobs para este grado" };
        continue;
      }

      // ── 2. Clusterizar nombres ──────────────────────────────────────────────
      const nameMap = new Map();
      for (const ev of gradeEvals) {
        const key = normalize(ev.nombre);
        if (!nameMap.has(key)) nameMap.set(key, { displayNames: [], sessionScores: new Map() });
        const s     = nameMap.get(key);
        const disp  = (ev.nombre || "").trim();
        if (!s.displayNames.includes(disp)) s.displayNames.push(disp);
        const sesId = String(ev.sesion || "??").padStart(2, "0");
        const score = Number(ev.score) || 0;
        const prev  = s.sessionScores.get(sesId);
        if (!prev || score > prev.score) {
          s.sessionScores.set(sesId, { score, fecha: ev.fecha || new Date().toISOString() });
        }
      }

      const clusters = clusterKeys([...nameMap.keys()]);

      // ── 3. Preparar arrays para insert en batch ─────────────────────────────
      // clusterData: [{nombre, evals: [{sesion, score, fecha}]}]
      const clusterData = [];
      for (const [, groupKeys] of clusters) {
        const allNames = [];
        const merged   = new Map();
        for (const k of groupKeys) {
          const s = nameMap.get(k);
          allNames.push(...s.displayNames);
          s.sessionScores.forEach((data, sesId) => {
            const prev = merged.get(sesId);
            if (!prev || data.score > prev.score) merged.set(sesId, data);
          });
        }
        clusterData.push({
          nombre: titleCase(bestDisplayName(allNames)),
          evals:  [...merged.entries()].map(([sesion, d]) => ({ sesion, score: d.score, fecha: d.fecha })),
        });
      }

      // ── 4. Insertar alumnos en batch (ignorar si ya existen) ───────────────
      const alumnosPayload = clusterData.map(c => ({ nombre: c.nombre, grado }));
      await db.from("alumnos").insert(alumnosPayload).then(() => null).catch(() => null);
      // Nota: algunos pueden fallar por duplicado — no pasa nada, el siguiente SELECT los recoge

      // Insertar uno a uno los que fallaron por conflicto
      for (const c of clusterData) {
        const { count } = await db
          .from("alumnos")
          .select("id", { count: "exact", head: true })
          .eq("grado", grado)
          .ilike("nombre", c.nombre);
        if (!count) {
          await db.from("alumnos").insert({ nombre: c.nombre, grado }).catch(() => null);
        }
      }

      // ── 5. Leer alumnos creados para obtener IDs ───────────────────────────
      const { data: alumnosDB } = await db
        .from("alumnos")
        .select("id, nombre")
        .eq("grado", grado);

      // Mapear nombre → id (fuzzy para cubrir diferencias menores de mayúsculas)
      const idMap = new Map(); // nombre (lower) → id
      for (const a of (alumnosDB || [])) idMap.set(a.nombre.toLowerCase(), a.id);

      // ── 6. Insertar evaluaciones en batch ──────────────────────────────────
      const evalsPayload = [];
      for (const c of clusterData) {
        const alumnoId = idMap.get(c.nombre.toLowerCase());
        if (!alumnoId) continue;
        for (const ev of c.evals) {
          evalsPayload.push({
            alumno_id:  alumnoId,
            grado,
            sesion:     ev.sesion,
            score:      ev.score,
            fecha:      ev.fecha,
            nombre_raw: c.nombre,
            total:      10,
          });
        }
      }

      // Batch insert evaluaciones. UNIQUE(alumno_id, sesion) → ignorar duplicados
      // (en migración limpia no hay duplicados; si se re-ejecuta, conserva el dato existente)
      if (evalsPayload.length > 0) {
        await db.from("evaluaciones")
          .upsert(evalsPayload, { onConflict: "alumno_id,sesion", ignoreDuplicates: true })
          .catch(err => console.warn("evals upsert warning:", err.message));
      }

      // ── 7. Migrar bonuses ──────────────────────────────────────────────────
      const gradeBonuses = bonuses.filter(b => b.grado === grado);
      for (const b of gradeBonuses) {
        const normB  = normalize(b.nombre || "");
        const alumno = (alumnosDB || []).find(a => areSamePerson(normB, normalize(a.nombre)));
        if (!alumno) continue;
        await db.from("bonuses").insert({
          alumno_id: alumno.id,
          grado,
          puntos:    Number(b.puntos) || 0,
          razon:     b.razon || "",
          mes:       b.mes   || "",
          fecha:     b.fecha || new Date().toISOString(),
        }).catch(() => null);
      }

      results[grado] = {
        alumnos: clusterData.length,
        evals:   evalsPayload.length,
        bonuses: gradeBonuses.length,
      };
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
