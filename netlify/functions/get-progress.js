/**
 * get-progress.js
 *
 * GET /.netlify/functions/get-progress?nombre=Ana+Garcia&grado=sec2
 *
 * Lee el registro canónico del alumno desde el roster (registro único por alumno).
 * Fallback: si el roster no existe o no encuentra al alumno, escanea raw evals.
 *
 * Devuelve historial completo de todas las sesiones + posición en ranking del mes.
 */

const { getStore } = require("@netlify/blobs");
const {
  normalize,
  titleCase,
  areSamePerson,
  bestDisplayName,
  clusterKeys,
  nameSimilarity,
} = require("./_nameUtils");

const SAME_THRESHOLD = 0.6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore(name) {
  return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const params = event.queryStringParameters || {};
  const nombre = (params.nombre || "").trim();
  const grado  = params.grado;
  if (!nombre || !grado) return { statusCode: 400, headers: CORS, body: '{"error":"nombre and grado are required"}' };

  const normSearch = normalize(nombre);
  const now        = new Date();
  const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const rosterStore = makeStore("rosters");
    const bonusStore  = makeStore("bonuses");

    // ── 1. Buscar en el roster (registro único por alumno) ────────────────────
    const roster  = await rosterStore.get(grado, { type: "json" }).catch(() => null);
    let   student = null;

    if (roster && Array.isArray(roster.alumnos)) {
      student = roster.alumnos.find(a =>
        areSamePerson(normSearch, normalize(a.nombre))
      ) || null;
    }

    // ── 2. Fallback: escanear raw evals si no hay roster o no encontró ────────
    if (!student) {
      const evalStore = makeStore("evaluaciones");
      const { blobs }  = await evalStore.list({});
      const evalDatas  = await Promise.all(
        (blobs || []).map(({ key }) => evalStore.get(key, { type: "json" }).catch(() => null))
      );
      const gradeEvals = evalDatas.filter(d => d && d.grado === grado);
      const matching   = gradeEvals.filter(d => areSamePerson(normSearch, normalize(d.nombre)));

      if (matching.length === 0) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
      }

      // Construir registro sintético desde raw evals
      const sesMap = new Map();
      for (const ev of matching) {
        const sesId = String(ev.sesion || "??").padStart(2, "0");
        const prev  = sesMap.get(sesId);
        if (!prev || ev.score > prev.score) {
          sesMap.set(sesId, { sesion: sesId, score: Number(ev.score) || 0, fecha: ev.fecha || "" });
        }
      }
      const historial  = [...sesMap.values()].sort((a, b) => a.sesion.localeCompare(b.sesion));
      const scoreSum   = historial.reduce((a, h) => a + h.score, 0);
      const sesiones   = historial.length;
      const allNames   = matching.map(e => (e.nombre || "").trim()).filter(Boolean);
      student = {
        nombre:   titleCase(bestDisplayName(allNames)),
        historial,
        sesiones,
        total:    scoreSum,
        avg:      sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0,
      };
    }

    // ── 3. Bonuses del alumno ─────────────────────────────────────────────────
    const bonusList = await bonusStore.list({ prefix: grado + "/" }).catch(() => ({ blobs: [] }));
    const bonusDatas = await Promise.all(
      (bonusList.blobs || []).map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))
    );
    const bonuses = bonusDatas.filter(d => d && areSamePerson(normSearch, normalize(d.nombre || "")));
    bonuses.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const bonusTotal = bonuses.reduce((a, b) => a + (Number(b.puntos) || 0), 0);

    // ── 4. Ranking del mes actual (desde roster completo del grado) ───────────
    let rank = null, totalStudents = 0;
    if (roster && Array.isArray(roster.alumnos)) {
      const rankingArr = roster.alumnos.map(a => {
        const monthHist = (a.historial || []).filter(h => h.fecha && h.fecha.slice(0, 7) === currentMes);
        if (monthHist.length === 0) return null;
        const sc = monthHist.reduce((s, h) => s + h.score, 0);
        return { nombre: a.nombre, scoreSum: sc, sesiones: monthHist.length };
      }).filter(Boolean);

      // Agregar bonus del mes a cada entrada
      const bonusListAll = await bonusStore.list({ prefix: grado + "/" }).catch(() => ({ blobs: [] }));
      const bonusAllData = await Promise.all(
        (bonusListAll.blobs || []).map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))
      );
      const monthBonuses = bonusAllData.filter(d => d && d.mes === currentMes);

      for (const b of monthBonuses) {
        const normB = normalize(b.nombre || "");
        const entry = rankingArr.find(r => areSamePerson(normB, normalize(r.nombre)));
        if (entry) entry.scoreSum += Number(b.puntos) || 0;
      }

      rankingArr.sort((a, b) => b.scoreSum - a.scoreSum || b.sesiones - a.sesiones);
      totalStudents = rankingArr.length;
      const pos = rankingArr.findIndex(r => areSamePerson(normSearch, normalize(r.nombre)));
      rank = pos >= 0 ? pos + 1 : null;
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        found:         true,
        nombre:        student.nombre,
        grado,
        historial:     student.historial || [],
        sesiones:      student.sesiones  || 0,
        avg:           student.avg       || 0,
        total:         (student.total || 0) + bonusTotal,
        scoreSum:      student.total    || 0,
        bonusTotal,
        bonuses,
        rank,
        totalStudents,
        mes:           currentMes,
      }),
    };
  } catch (err) {
    console.error("get-progress error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
