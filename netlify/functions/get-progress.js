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
  const nombre = params.nombre;
  const grado = params.grado;

  if (!nombre || !grado) {
    return { statusCode: 400, headers: CORS, body: '{"error":"nombre and grado are required"}' };
  }

  const normalizedName = nombre.toLowerCase().trim();
  const now = new Date();
  const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const evalStore = makeStore("evaluaciones");
    const bonusStore = makeStore("bonuses");

    const [evalList, bonusList] = await Promise.all([
      evalStore.list({}),
      bonusStore.list({ prefix: grado + "/" }),
    ]);

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

    // Filter for this student and grade
    const studentEvals = evalDatas
      .filter(
        (d) =>
          d &&
          d.grado === grado &&
          d.nombre &&
          d.nombre.toLowerCase().trim() === normalizedName
      )
      .sort((a, b) => (a.sesion || "").localeCompare(b.sesion || ""));

    const studentBonuses = bonusDatas
      .filter(
        (d) =>
          d &&
          d.nombre &&
          d.nombre.toLowerCase().trim() === normalizedName
      )
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    if (studentEvals.length === 0 && studentBonuses.length === 0) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ found: false }),
      };
    }

    // Calculate rank for current month
    // Build map of all students in this grade this month
    const allEvalsThisMonth = evalDatas.filter(
      (d) => d && d.grado === grado && d.fecha && d.fecha.slice(0, 7) === currentMes
    );
    const allBonusesThisMonth = bonusDatas.filter((d) => d && d.mes === currentMes);

    const studentMap = new Map();

    function getOrCreate(n) {
      const key = n.toLowerCase().trim();
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          evals: [],
          sesiones: new Set(),
          bonuses: [],
        });
      }
      return studentMap.get(key);
    }

    for (const ev of allEvalsThisMonth) {
      const s = getOrCreate(ev.nombre);
      s.evals.push(ev.score);
      if (ev.sesion) s.sesiones.add(ev.sesion);
    }

    for (const bonus of allBonusesThisMonth) {
      const s = getOrCreate(bonus.nombre);
      s.bonuses.push(bonus.puntos);
    }

    const rankingArr = [];
    for (const [key, s] of studentMap) {
      const avgEval =
        s.evals.length > 0
          ? Math.round(
              (s.evals.reduce((a, b) => a + b, 0) / s.evals.length) * 10
            ) / 10
          : 0;
      const sesiones = s.sesiones.size;
      const bonus = s.bonuses.reduce((a, b) => a + b, 0);
      const total = Math.round((avgEval * 10 + sesiones * 10 + bonus) * 10) / 10;
      rankingArr.push({ key, total, avgEval, sesiones });
    }

    rankingArr.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.avgEval !== a.avgEval) return b.avgEval - a.avgEval;
      return b.sesiones - a.sesiones;
    });

    const rankPos = rankingArr.findIndex((s) => s.key === normalizedName);
    const rank = rankPos >= 0 ? rankPos + 1 : null;
    const totalStudents = rankingArr.length;

    // Use the display name from the first eval record
    const displayName =
      studentEvals.length > 0
        ? studentEvals[0].nombre
        : studentBonuses.length > 0
        ? studentBonuses[0].nombre
        : nombre;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        found: true,
        nombre: displayName,
        grado,
        evals: studentEvals,
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
