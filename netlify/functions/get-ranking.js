const { getStore } = require("@netlify/blobs");
const {
  normalize,
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
  return getStore({
    name,
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const params = event.queryStringParameters || {};
  const grado  = params.grado;
  if (!grado) return { statusCode: 400, headers: CORS, body: '{"error":"grado is required"}' };

  const now = new Date();
  const targetMes = params.mes || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

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

    const filteredEvals   = evalDatas.filter(d  => d && d.grado === grado && d.fecha && d.fecha.slice(0, 7) === targetMes);
    const filteredBonuses = bonusDatas.filter(d => d && d.mes === targetMes);

    // ── rawMap: construir SOLO desde evaluaciones ────────────────────────
    // Fórmula: total = suma de scores brutos (0-20 c/u) + bonus del profesor
    // avgScore = suma / sesiones (mostrado como X.X/20)
    const rawMap = new Map(); // normKey → { displayNames, rawScores[], sesiones Set, bonusTotal }

    for (const ev of filteredEvals) {
      const key = normalize(ev.nombre);
      if (!rawMap.has(key)) {
        rawMap.set(key, { displayNames: [], rawScores: [], sesiones: new Set(), bonusTotal: 0 });
      }
      const s = rawMap.get(key);
      const display = (ev.nombre || "").trim();
      if (!s.displayNames.includes(display)) s.displayNames.push(display);
      s.rawScores.push(Number(ev.score) || 0);   // score bruto 0-20
      if (ev.sesion) s.sesiones.add(ev.sesion);
    }

    // ── Aplicar bonus: exact match primero, luego fuzzy ──────────────────
    for (const bonus of filteredBonuses) {
      const key = normalize(bonus.nombre);
      const pts = Number(bonus.puntos) || 0;
      if (rawMap.has(key)) {
        rawMap.get(key).bonusTotal += pts;
      } else {
        let bestKey = null, bestSim = 0;
        for (const k of rawMap.keys()) {
          const sim = nameSimilarity(key, k);
          if (sim > bestSim) { bestSim = sim; bestKey = k; }
        }
        if (bestKey && bestSim >= SAME_THRESHOLD) rawMap.get(bestKey).bonusTotal += pts;
        // Si no hay match → alumno sin eval este mes → ignorar
      }
    }

    // ── Clusterizar nombres similares y fusionar ─────────────────────────
    const allKeys  = [...rawMap.keys()];
    const clusters = clusterKeys(allKeys);

    const ranking = [];
    for (const [, groupKeys] of clusters) {
      const allDisplayNames = [];
      const allRawScores    = [];
      const allSesiones     = new Set();
      let   totalBonus      = 0;

      for (const k of groupKeys) {
        const s = rawMap.get(k);
        allDisplayNames.push(...s.displayNames);
        allRawScores.push(...s.rawScores);
        s.sesiones.forEach(ses => allSesiones.add(ses));
        totalBonus += s.bonusTotal;
      }

      const nombre   = bestDisplayName(allDisplayNames);
      const sesiones = allSesiones.size;
      const scoreSum = allRawScores.reduce((a, b) => a + b, 0);
      // avgScore: promedio por sesión (0-20), mostrado en tabla como "X.X/20"
      const avgScore = sesiones > 0
        ? Math.round((scoreSum / sesiones) * 10) / 10
        : 0;
      // total = suma de scores brutos + bonus del profesor
      // Con 2 sesiones perfectas: 20+20 = 40. Con 3: 60. Transparente.
      const total = Math.round((scoreSum + totalBonus) * 10) / 10;

      ranking.push({ nombre, sesiones, avgScore, scoreSum, bonus: totalBonus, total });
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
