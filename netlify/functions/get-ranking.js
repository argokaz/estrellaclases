const { getStore } = require("@netlify/blobs");
const {
  normalize,
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

    // ── rawMap: un entry por nombre normalizado ──────────────────────────────
    // sessionScores: Map<sesion, maxScore>  — deduplica intentos múltiples de la misma sesión
    const rawMap = new Map();

    for (const ev of filteredEvals) {
      const key = normalize(ev.nombre);
      if (!rawMap.has(key)) {
        rawMap.set(key, { displayNames: [], sessionScores: new Map(), bonusTotal: 0 });
      }
      const s = rawMap.get(key);
      const display = (ev.nombre || "").trim();
      if (!s.displayNames.includes(display)) s.displayNames.push(display);

      // Guardar el score más alto por sesión (protección contra doble envío)
      const sesId = String(ev.sesion || `noses_${ev.ts || Date.now()}`);
      const prev  = s.sessionScores.get(sesId) || 0;
      s.sessionScores.set(sesId, Math.max(prev, Number(ev.score) || 0));
    }

    // ── Aplicar bonus ────────────────────────────────────────────────────────
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
      }
    }

    // ── Clusterizar nombres similares y fusionar ─────────────────────────────
    const allKeys  = [...rawMap.keys()];
    const clusters = clusterKeys(allKeys);

    const ranking = [];
    for (const [, groupKeys] of clusters) {
      const allDisplayNames  = [];
      const mergedSesScores  = new Map(); // sesion → maxScore  (fusión sin duplicar sesiones)
      let   totalBonus       = 0;

      for (const k of groupKeys) {
        const s = rawMap.get(k);
        allDisplayNames.push(...s.displayNames);
        s.sessionScores.forEach((score, sesId) => {
          const prev = mergedSesScores.get(sesId) || 0;
          mergedSesScores.set(sesId, Math.max(prev, score));
        });
        totalBonus += s.bonusTotal;
      }

      const nombre    = bestDisplayName(allDisplayNames);
      const sesiones  = mergedSesScores.size;
      const scoreSum  = [...mergedSesScores.values()].reduce((a, b) => a + b, 0);

      // avgScore: promedio por sesión (0–20) — con 2 sesiones perfectas → 20.0
      const avgScore  = sesiones > 0 ? Math.round((scoreSum / sesiones) * 10) / 10 : 0;

      // total: suma bruta + bonus; con 2 sesiones perfectas → 40 + bonus
      const total     = Math.round((scoreSum + totalBonus) * 10) / 10;

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
