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

    // List all evals (no prefix to get all) and bonuses for this grade
    const [evalList, bonusList] = await Promise.all([
      evalStore.list({}),
      bonusStore.list({ prefix: grado + "/" }),
    ]);

    // Fetch all eval blobs in parallel
    const evalBlobs = evalList.blobs || [];
    const bonusBlobs = bonusList.blobs || [];

    const [evalDatas, bonusDatas] = await Promise.all([
      Promise.all(
        evalBlobs.map(({ key }) =>
          evalStore.get(key, { type: "json" }).catch(() => null)
        )
      ),
      Promise.all(
        bonusBlobs.map(({ key }) =>
          bonusStore.get(key, { type: "json" }).catch(() => null)
        )
      ),
    ]);

    // Filter evals: correct grade and target month
    const filteredEvals = evalDatas.filter(
      (d) => d && d.grado === grado && d.fecha && d.fecha.slice(0, 7) === targetMes
    );

    // Filter bonuses: target month
    const filteredBonuses = bonusDatas.filter(
      (d) => d && d.mes === targetMes
    );

    // Group by normalized name
    const studentMap = new Map();

    function getOrCreate(nombre) {
      const key = nombre.toLowerCase().trim();
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          displayName: nombre.trim(),
          evals: [],
          sesiones: new Set(),
          bonuses: [],
        });
      }
      return studentMap.get(key);
    }

    for (const ev of filteredEvals) {
      const student = getOrCreate(ev.nombre);
      student.evals.push(ev.score);
      if (ev.sesion) student.sesiones.add(ev.sesion);
    }

    for (const bonus of filteredBonuses) {
      const student = getOrCreate(bonus.nombre);
      student.bonuses.push(bonus.puntos);
    }

    // Build ranking array
    const ranking = [];
    for (const [, student] of studentMap) {
      const avgEval =
        student.evals.length > 0
          ? Math.round(
              (student.evals.reduce((a, b) => a + b, 0) / student.evals.length) * 10
            ) / 10
          : 0;
      const sesiones = student.sesiones.size;
      const bonus = student.bonuses.reduce((a, b) => a + b, 0);
      const total = Math.round((avgEval * 10 + sesiones * 10 + bonus) * 10) / 10;

      ranking.push({
        nombre: student.displayName,
        sesiones,
        avgEval,
        bonus,
        total,
      });
    }

    // Sort: total desc, then avgEval desc, then sesiones desc
    ranking.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.avgEval !== a.avgEval) return b.avgEval - a.avgEval;
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
