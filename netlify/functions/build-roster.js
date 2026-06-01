/**
 * build-roster.js
 *
 * POST /.netlify/functions/build-roster
 * Body: { pw: "...", grado?: "sec2" }   // grado opcional; si se omite, reconstruye todos
 *
 * Escanea TODAS las evaluaciones, clusteriza nombres similares con fuzzy matching,
 * y guarda un roster canónico en Blobs "rosters" con clave = {grado}.
 *
 * El roster contiene la lista de alumnos únicos del salón (nombre canónico)
 * y se usa como fuente estable para el autocomplete el resto del año.
 */

const { getStore } = require("@netlify/blobs");
const {
  normalize,
  areSamePerson,
  bestDisplayName,
  clusterKeys,
} = require("./_nameUtils");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const GRADES = ["prim6", "sec2", "sec3", "sec4", "sec5"];

function makeStore(name) {
  return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  if (body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  const targetGrade = body.grado || null; // null = todos los grados
  const gradesToBuild = targetGrade ? [targetGrade] : GRADES;

  try {
    const evalStore   = makeStore("evaluaciones");
    const rosterStore = makeStore("rosters");

    // Traer todas las evaluaciones de una vez
    const { blobs } = await evalStore.list({});
    const evalDatas = await Promise.all(
      (blobs || []).map(({ key }) => evalStore.get(key, { type: "json" }).catch(() => null))
    );
    const allEvals = evalDatas.filter(Boolean);

    const results = {};

    for (const grado of gradesToBuild) {
      const gradeEvals = allEvals.filter(d => d.grado === grado);

      if (gradeEvals.length === 0) {
        results[grado] = { alumnos: 0, raw: 0 };
        continue;
      }

      // Recopilar todos los nombres presentados para este grado
      // nameMap: normKey → { displayNames[], sesiones Set, rawScores[] }
      const nameMap = new Map();

      for (const ev of gradeEvals) {
        const key = normalize(ev.nombre);
        if (!nameMap.has(key)) {
          nameMap.set(key, { displayNames: [], sesiones: new Set(), rawScores: [] });
        }
        const s = nameMap.get(key);
        const display = (ev.nombre || "").trim();
        if (!s.displayNames.includes(display)) s.displayNames.push(display);
        if (ev.sesion) s.sesiones.add(ev.sesion);
        s.rawScores.push(Number(ev.score) || 0);
      }

      // Clusterizar nombres similares
      const allKeys  = [...nameMap.keys()];
      const clusters = clusterKeys(allKeys);

      // Construir lista canónica
      const alumnos = [];
      for (const [, groupKeys] of clusters) {
        const allDisplayNames = [];
        const allSesiones     = new Set();
        const allScores       = [];

        for (const k of groupKeys) {
          const s = nameMap.get(k);
          allDisplayNames.push(...s.displayNames);
          s.sesiones.forEach(ses => allSesiones.add(ses));
          allScores.push(...s.rawScores);
        }

        const scoreSum = allScores.reduce((a, b) => a + b, 0);
        const sesiones = allSesiones.size;
        const avg = sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0;

        alumnos.push({
          nombre:    bestDisplayName(allDisplayNames),
          variantes: [...new Set(allDisplayNames)].filter(v => v !== bestDisplayName(allDisplayNames)),
          sesiones,
          avg,
          total: scoreSum,
        });
      }

      // Ordenar alfabéticamente
      alumnos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

      // Guardar en Blobs
      await rosterStore.setJSON(grado, {
        grado,
        alumnos,
        actualizadoEn: new Date().toISOString(),
        totalAlumnos:  alumnos.length,
      });

      results[grado] = { alumnos: alumnos.length, raw: allKeys.length };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, results }),
    };
  } catch (err) {
    console.error("build-roster error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
