/**
 * get-ranking.js
 *
 * GET /.netlify/functions/get-ranking?grado=sec2&mes=2026-05
 *
 * Lee el roster (registro único por alumno) y filtra las sesiones del mes
 * para construir el ranking. Agrega bonuses del profesor.
 *
 * Fallback: si no hay roster, escanea raw evals (comportamiento anterior).
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
  const grado  = params.grado;
  if (!grado) return { statusCode: 400, headers: CORS, body: '{"error":"grado is required"}' };

  const now       = new Date();
  const targetMes = params.mes || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const rosterStore = makeStore("rosters");
    const bonusStore  = makeStore("bonuses");

    const [roster, bonusList] = await Promise.all([
      rosterStore.get(grado, { type: "json" }).catch(() => null),
      bonusStore.list({ prefix: grado + "/" }).catch(() => ({ blobs: [] })),
    ]);

    const bonusDatas = await Promise.all(
      (bonusList.blobs || []).map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))
    );
    const monthBonuses = bonusDatas.filter(d => d && d.mes === targetMes);

    // ── Construir ranking desde roster ────────────────────────────────────────
    if (roster && Array.isArray(roster.alumnos) && roster.alumnos.length > 0) {
      const ranking = [];

      for (const student of roster.alumnos) {
        // Sesiones de este alumno en el mes pedido
        const monthHist = (student.historial || []).filter(
          h => h.fecha && h.fecha.slice(0, 7) === targetMes
        );

        // Bonus del mes para este alumno
        const normNombre = normalize(student.nombre);
        let bonus = 0;
        for (const b of monthBonuses) {
          if (areSamePerson(normNombre, normalize(b.nombre || ""))) {
            bonus += Number(b.puntos) || 0;
          }
        }

        // Incluir si tiene evaluaciones O bonus en el mes
        if (monthHist.length === 0 && bonus === 0) continue;

        const scoreSum = monthHist.reduce((a, h) => a + (h.score || 0), 0);
        const sesiones = monthHist.length;
        const avgScore = sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0;

        ranking.push({
          nombre:   student.nombre,
          sesiones,
          avgScore,
          scoreSum,
          bonus,
          total: Math.round((scoreSum + bonus) * 10) / 10,
        });
      }

      ranking.sort((a, b) =>
        b.total - a.total || b.avgScore - a.avgScore || b.sesiones - a.sesiones
      );

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ mes: targetMes, grado, ranking }),
      };
    }

    // ── Fallback: no hay roster → escanear raw evals ──────────────────────────
    console.warn(`get-ranking: no roster for ${grado}, falling back to raw evals`);

    const evalStore = makeStore("evaluaciones");
    const { blobs } = await evalStore.list({});
    const evalDatas = await Promise.all(
      (blobs || []).map(({ key }) => evalStore.get(key, { type: "json" }).catch(() => null))
    );
    const filteredEvals = evalDatas.filter(
      d => d && d.grado === grado && d.fecha && d.fecha.slice(0, 7) === targetMes
    );

    // rawMap con deduplicación por sesión
    const rawMap = new Map();
    for (const ev of filteredEvals) {
      const key = normalize(ev.nombre);
      if (!rawMap.has(key)) rawMap.set(key, { displayNames: [], sessionScores: new Map(), bonusTotal: 0 });
      const s       = rawMap.get(key);
      const display = (ev.nombre || "").trim();
      if (!s.displayNames.includes(display)) s.displayNames.push(display);
      const sesId   = String(ev.sesion || `noses_${ev.ts || Date.now()}`);
      const prev    = s.sessionScores.get(sesId) || 0;
      s.sessionScores.set(sesId, Math.max(prev, Number(ev.score) || 0));
    }

    // Aplicar bonus
    for (const bonus of monthBonuses) {
      const key = normalize(bonus.nombre);
      const pts = Number(bonus.puntos) || 0;
      if (rawMap.has(key)) { rawMap.get(key).bonusTotal += pts; continue; }
      let bestKey = null, bestSim = 0;
      for (const k of rawMap.keys()) {
        const sim = nameSimilarity(key, k);
        if (sim > bestSim) { bestSim = sim; bestKey = k; }
      }
      if (bestKey && bestSim >= SAME_THRESHOLD) rawMap.get(bestKey).bonusTotal += pts;
    }

    // Clusterizar y construir ranking
    const allKeys  = [...rawMap.keys()];
    const clusters = clusterKeys(allKeys);
    const ranking  = [];

    for (const [, groupKeys] of clusters) {
      const allDisplayNames = [];
      const mergedScores    = new Map();
      let   totalBonus      = 0;

      for (const k of groupKeys) {
        const s = rawMap.get(k);
        allDisplayNames.push(...s.displayNames);
        s.sessionScores.forEach((score, sesId) => {
          mergedScores.set(sesId, Math.max(mergedScores.get(sesId) || 0, score));
        });
        totalBonus += s.bonusTotal;
      }

      const sesiones  = mergedScores.size;
      const scoreSum  = [...mergedScores.values()].reduce((a, b) => a + b, 0);
      const avgScore  = sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0;

      ranking.push({
        nombre:   titleCase(bestDisplayName(allDisplayNames)),
        sesiones,
        avgScore,
        scoreSum,
        bonus:    totalBonus,
        total:    Math.round((scoreSum + totalBonus) * 10) / 10,
      });
    }

    ranking.sort((a, b) =>
      b.total - a.total || b.avgScore - a.avgScore || b.sesiones - a.sesiones
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ mes: targetMes, grado, ranking }),
    };

  } catch (err) {
    console.error("get-ranking error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
