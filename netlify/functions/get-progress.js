/**
 * get-progress.js
 *
 * GET /.netlify/functions/get-progress?nombre=Ana+Garcia&grado=sec2
 *
 * Busca todas las evaluaciones y bonuses de un alumno usando fuzzy matching,
 * y calcula su posición en el ranking del mes actual con la misma fórmula
 * que get-ranking.js: total = scoreSum + bonus.
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
  const nombre = params.nombre;
  const grado  = params.grado;
  if (!nombre || !grado) return { statusCode: 400, headers: CORS, body: '{"error":"nombre and grado are required"}' };

  const normSearch = normalize(nombre);
  const now        = new Date();
  const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const evalStore  = makeStore("evaluaciones");
    const bonusStore = makeStore("bonuses");

    const [evalList, bonusList] = await Promise.all([
      evalStore.list({}),
      bonusStore.list({ prefix: grado + "/" }).catch(() => ({ blobs: [] })),
    ]);

    const [evalDatas, bonusDatas] = await Promise.all([
      Promise.all((evalList.blobs  || []).map(({ key }) => evalStore.get(key,  { type: "json" }).catch(() => null))),
      Promise.all((bonusList.blobs || []).map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))),
    ]);

    const gradeEvals   = evalDatas.filter(d  => d && d.grado === grado);
    const gradeBonuses = bonusDatas.filter(d => d);

    // ── Buscar evals y bonuses del alumno con fuzzy matching ────────────────
    const studentEvals   = gradeEvals.filter(d   => areSamePerson(normSearch, normalize(d.nombre)));
    const studentBonuses = gradeBonuses.filter(d => areSamePerson(normSearch, normalize(d.nombre)));

    if (studentEvals.length === 0 && studentBonuses.length === 0) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
    }

    // Ordenar: evals por sesión asc
    studentEvals.sort((a, b)   => (a.sesion || "").localeCompare(b.sesion || ""));
    studentBonuses.sort((a, b) => (b.fecha  || "").localeCompare(a.fecha  || ""));

    // ── Calcular rank del mes actual con la misma lógica que get-ranking.js ──
    const thisMonthEvals   = gradeEvals.filter(d   => d.fecha && d.fecha.slice(0, 7) === currentMes);
    const thisMonthBonuses = gradeBonuses.filter(d => d.mes === currentMes);

    // rawMap: normKey → { displayNames[], sessionScores: Map<sesion, maxScore>, bonusTotal }
    const rawMap = new Map();
    for (const ev of thisMonthEvals) {
      const key = normalize(ev.nombre);
      if (!rawMap.has(key)) rawMap.set(key, { displayNames: [], sessionScores: new Map(), bonusTotal: 0 });
      const s = rawMap.get(key);
      const display = (ev.nombre || "").trim();
      if (!s.displayNames.includes(display)) s.displayNames.push(display);
      const sesId = String(ev.sesion || `noses_${ev.ts || Date.now()}`);
      const prev  = s.sessionScores.get(sesId) || 0;
      s.sessionScores.set(sesId, Math.max(prev, Number(ev.score) || 0));
    }

    // Aplicar bonus del mes
    for (const bonus of thisMonthBonuses) {
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

    // Clusterizar y calcular ranking completo
    const allKeys  = [...rawMap.keys()];
    const clusters = clusterKeys(allKeys);

    const rankingArr      = [];
    let   studentClusterRoot = null;

    for (const [root, groupKeys] of clusters) {
      const mergedSesScores = new Map();
      let   totalBonus      = 0;

      for (const k of groupKeys) {
        const s = rawMap.get(k);
        s.sessionScores.forEach((score, sesId) => {
          const prev = mergedSesScores.get(sesId) || 0;
          mergedSesScores.set(sesId, Math.max(prev, score));
        });
        totalBonus += s.bonusTotal;
        if (areSamePerson(normSearch, k)) studentClusterRoot = root;
      }

      const sesiones = mergedSesScores.size;
      const scoreSum = [...mergedSesScores.values()].reduce((a, b) => a + b, 0);
      const avgScore = sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0;
      const total    = Math.round((scoreSum + totalBonus) * 10) / 10;

      rankingArr.push({ root, sesiones, avgScore, scoreSum, total });
    }

    rankingArr.sort((a, b) => b.total - a.total || b.avgScore - a.avgScore || b.sesiones - a.sesiones);

    const rankPos       = studentClusterRoot !== null
      ? rankingArr.findIndex(r => r.root === studentClusterRoot)
      : -1;
    const rank          = rankPos >= 0 ? rankPos + 1 : null;
    const totalStudents = rankingArr.length;

    // Nombre canónico: el más "bien escrito" de todas las variantes
    const allDisplayVariants = studentEvals.map(e => (e.nombre || "").trim()).filter(Boolean);
    const displayName = titleCase(allDisplayVariants.length > 0 ? bestDisplayName(allDisplayVariants) : nombre);

    // Historial completo del alumno (deduplicado por sesión, score más alto)
    const sesionScoreMap = new Map();
    for (const ev of studentEvals) {
      const sesId = String(ev.sesion || `noses_${ev.ts || Date.now()}`);
      const prev  = sesionScoreMap.get(sesId);
      if (!prev || Number(ev.score) > prev.score) {
        sesionScoreMap.set(sesId, { score: Number(ev.score) || 0, fecha: ev.fecha || "", sesion: ev.sesion });
      }
    }
    const historial = [...sesionScoreMap.values()]
      .sort((a, b) => (a.sesion || "").localeCompare(b.sesion || ""));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        found: true,
        nombre: displayName,
        grado,
        evals:   studentEvals,
        historial,
        bonuses: studentBonuses,
        rank,
        totalStudents,
        mes: currentMes,
      }),
    };
  } catch (err) {
    console.error("get-progress error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
