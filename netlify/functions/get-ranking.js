const { getStore } = require("@netlify/blobs");

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

// Normaliza el score a 0-100.
// El repaso guarda: score (pts brutos, ej 18 de 20), correctas (nro correcto, ej 9),
// total (nro de preguntas, ej 10). Cada pregunta vale 2 pts → score_max = total * 2.
// Usamos correctas/total cuando están disponibles; fallback a score/(total*2).
function normalizeScore(ev) {
  if (ev.correctas != null && ev.total) {
    return (ev.correctas / ev.total) * 100;
  }
  if (ev.score != null && ev.total) {
    return (ev.score / (ev.total * 2)) * 100;
  }
  // último recurso: asumir score es 0-10
  return (ev.score || 0) * 10;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };
  }

  const params = event.queryStringParameters || {};
  const grado = params.grado;
  if (!grado) {
    return { statusCode: 400, headers: CORS, body: '{"error":"grado is required"}' };
  }

  const now = new Date();
  const targetMes = params.mes || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const evalStore = makeStore("evaluaciones");
    const bonusStore = makeStore("bonuses");

    const [evalList, bonusList] = await Promise.all([
      evalStore.list({}),
      bonusStore.list({ prefix: grado + "/" }).catch(() => ({ blobs: [] })),
    ]);

    const evalBlobs = evalList.blobs || [];
    const bonusBlobs = bonusList.blobs || [];

    const [evalDatas, bonusDatas] = await Promise.all([
      Promise.all(evalBlobs.map(({ key }) => evalStore.get(key, { type: "json" }).catch(() => null))),
      Promise.all(bonusBlobs.map(({ key }) => bonusStore.get(key, { type: "json" }).catch(() => null))),
    ]);

    // Solo evaluaciones del grado y mes correcto
    const filteredEvals = evalDatas.filter(
      (d) => d && d.grado === grado && d.fecha && d.fecha.slice(0, 7) === targetMes
    );

    // Solo bonus del mes correcto
    const filteredBonuses = bonusDatas.filter((d) => d && d.mes === targetMes);

    // Construir mapa de estudiantes — SOLO se crean entradas a partir de evals.
    // Los bonus se añaden encima, pero no crean entradas nuevas.
    const studentMap = new Map();

    for (const ev of filteredEvals) {
      const key = ev.nombre.toLowerCase().trim();
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          displayName: ev.nombre.trim(),
          scores: [],    // scores normalizados 0-100
          sesiones: new Set(),
          bonusTotal: 0,
        });
      }
      const s = studentMap.get(key);
      s.scores.push(normalizeScore(ev));
      if (ev.sesion) s.sesiones.add(ev.sesion);
    }

    // Aplicar bonus solo a estudiantes que ya tienen evals
    for (const bonus of filteredBonuses) {
      const key = bonus.nombre.toLowerCase().trim();
      if (studentMap.has(key)) {
        studentMap.get(key).bonusTotal += Number(bonus.puntos) || 0;
      }
    }

    // Calcular ranking
    // Fórmula: promedio (0-100) + sesiones × 5 + bonus
    // Máximo realista con 2 sesiones: 100 + 10 + bonus
    const ranking = [];
    for (const [, s] of studentMap) {
      const avgPct =
        s.scores.length > 0
          ? Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 10) / 10
          : 0;
      const sesiones = s.sesiones.size;
      const bonus = s.bonusTotal;
      const total = Math.round((avgPct + sesiones * 5 + bonus) * 10) / 10;

      ranking.push({
        nombre: s.displayName,
        sesiones,
        avgPct,   // 0-100, porcentaje de aciertos
        bonus,
        total,
      });
    }

    // Orden: total desc → avgPct desc → sesiones desc
    ranking.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.avgPct !== a.avgPct) return b.avgPct - a.avgPct;
      return b.sesiones - a.sesiones;
    });

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
