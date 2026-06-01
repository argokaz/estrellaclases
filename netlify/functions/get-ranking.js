const { getStore } = require("@netlify/blobs");
const {
  normalize,
  areSamePerson,
  bestDisplayName,
  clusterKeys,
  normalizeScore,
} = require("./_nameUtils");

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

    // ── 1. Construir rawMap desde evaluaciones ──────────────────
    // Clave: nombre normalizado. Valor: datos acumulados.
    // Los bonuses NO crean entradas nuevas — solo suman a quienes ya tienen eval.
    const rawMap = new Map();

    for (const ev of filteredEvals) {
      const key = normalize(ev.nombre);
      if (!rawMap.has(key)) {
        rawMap.set(key, { displayNames: [], scores: [], sesiones: new Set(), bonusTotal: 0 });
      }
      const s = rawMap.get(key);
      const display = (ev.nombre || "").trim();
      if (!s.displayNames.includes(display)) s.displayNames.push(display);
      s.scores.push(normalizeScore(ev));
      if (ev.sesion) s.sesiones.add(ev.sesion);
    }

    // ── 2. Aplicar bonus ────────────────────────────────────────
    for (const bonus of filteredBonuses) {
      const key = normalize(bonus.nombre);
      const pts = Number(bonus.puntos) || 0;

      if (rawMap.has(key)) {
        rawMap.get(key).bonusTotal += pts;
        continue;
      }
      // Fallback fuzzy: buscar la clave más parecida
      let bestKey = null, bestSim = 0;
      for (const k of rawMap.keys()) {
        const sim = require("./_nameUtils").nameSimilarity(key, k);
        if (sim > bestSim) { bestSim = sim; bestKey = k; }
      }
      if (bestKey && bestSim >= require("./_nameUtils").SAME_THRESHOLD) {
        rawMap.get(bestKey).bonusTotal += pts;
      }
      // Si no hay match → bonus de alguien sin eval en este mes → ignorar
    }

    // ── 3. Clusterizar claves similares (fuzzy dedup) ───────────
    const allKeys = [...rawMap.keys()];
    const clusters = clusterKeys(allKeys);

    // ── 4. Fusionar clusters y construir ranking ────────────────
    const ranking = [];
    for (const [, groupKeys] of clusters) {
      const allDisplayNames = [];
      const allScores       = [];
      const allSesiones     = new Set();
      let   totalBonus      = 0;

      for (const k of groupKeys) {
        const s = rawMap.get(k);
        allDisplayNames.push(...s.displayNames);
        allScores.push(...s.scores);
        s.sesiones.forEach(ses => allSesiones.add(ses));
        totalBonus += s.bonusTotal;
      }

      const nombre  = bestDisplayName(allDisplayNames);
      const avgPct  = allScores.length > 0
        ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
        : 0;
      const sesiones = allSesiones.size;
      const total    = Math.round((avgPct + sesiones * 5 + totalBonus) * 10) / 10;

      ranking.push({ nombre, sesiones, avgPct, bonus: totalBonus, total });
    }

    // Orden: total desc → avgPct desc → sesiones desc
    ranking.sort((a, b) =>
      b.total - a.total || b.avgPct - a.avgPct || b.sesiones - a.sesiones
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
