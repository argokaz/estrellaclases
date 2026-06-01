/**
 * build-roster.js
 *
 * POST /.netlify/functions/build-roster
 * Body: { pw: "...", grado?: "sec2" }   // grado opcional; si se omite, reconstruye todos
 *
 * Escanea TODAS las evaluaciones, clusteriza nombres similares con fuzzy matching,
 * y guarda un roster canónico en Blobs "rosters" con clave = {grado}.
 *
 * El roster contiene la lista de alumnos únicos del salón, sus estadísticas
 * y el historial completo de notas por sesión.
 */

const { getStore } = require("@netlify/blobs");
const {
  normalize,
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

  const targetGrade  = body.grado || null; // null = todos los grados
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

      // nameMap: normKey → { displayNames[], sessionScores: Map<sesion, {score, fecha}> }
      // sessionScores deduplica: si un alumno envió la misma sesión desde dos dispositivos,
      // conservamos solo el score más alto.
      const nameMap = new Map();

      for (const ev of gradeEvals) {
        const key = normalize(ev.nombre);
        if (!nameMap.has(key)) {
          nameMap.set(key, { displayNames: [], sessionScores: new Map() });
        }
        const s = nameMap.get(key);
        const display = (ev.nombre || "").trim();
        if (!s.displayNames.includes(display)) s.displayNames.push(display);

        const sesId = String(ev.sesion || `noses_${ev.ts || Date.now()}`);
        const prev  = s.sessionScores.get(sesId);
        const score = Number(ev.score) || 0;
        if (!prev || score > prev.score) {
          s.sessionScores.set(sesId, { score, fecha: ev.fecha || "" });
        }
      }

      // Clusterizar nombres similares
      const allKeys  = [...nameMap.keys()];
      const clusters = clusterKeys(allKeys);

      // Construir lista canónica
      const alumnos = [];
      for (const [, groupKeys] of clusters) {
        const allDisplayNames  = [];
        const mergedSesScores  = new Map(); // sesion → {score, fecha}

        for (const k of groupKeys) {
          const s = nameMap.get(k);
          allDisplayNames.push(...s.displayNames);
          s.sessionScores.forEach((data, sesId) => {
            const prev = mergedSesScores.get(sesId);
            if (!prev || data.score > prev.score) {
              mergedSesScores.set(sesId, data);
            }
          });
        }

        const sesiones  = mergedSesScores.size;
        const scoreSum  = [...mergedSesScores.values()].reduce((a, b) => a + b.score, 0);
        const avg       = sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0;

        // Historial ordenado por sesión
        const historial = [...mergedSesScores.entries()]
          .map(([sesion, data]) => ({ sesion, score: data.score, fecha: data.fecha }))
          .sort((a, b) => a.sesion.localeCompare(b.sesion));

        const nombre = bestDisplayName(allDisplayNames);
        alumnos.push({
          nombre,
          variantes: [...new Set(allDisplayNames)].filter(v => v !== nombre),
          sesiones,
          avg,
          total: scoreSum,
          historial,
        });
      }

      // Ordenar alfabéticamente
      alumnos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

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
