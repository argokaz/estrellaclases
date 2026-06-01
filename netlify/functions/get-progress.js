const { getStore } = require("@netlify/blobs");
const {
  normalize,
  areSamePerson,
  bestDisplayName,
  clusterKeys,
  normalizeScore,
  nameSimilarity,
  SAME_THRESHOLD,
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

    // ── Buscar evals y bonuses del alumno con fuzzy matching ────
    const studentEvals   = gradeEvals.filter(d   => areSamePerson(normSearch, normalize(d.nombre)));
    const studentBonuses = gradeBonuses.filter(d => areSamePerson(normSearch, normalize(d.nombre)));

    if (studentEvals.length === 0 && studentBonuses.length === 0) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
    }

    // Ordenar: evals por sesión asc, bonuses por fecha desc
    studentEvals.sort((a, b)   => (a.sesion || "").localeCompare(b.sesion || ""));
    studentBonuses.sort((a, b) => (b.fecha  || "").localeCompare(a.fecha  || ""));

    // ── Calcular rank del mes actual usando el mismo algoritmo que get-ranking ──
    const thisMonthEvals   = gradeEvals.filter(d   => d.fecha && d.fecha.slice(0, 7) === currentMes);
    const thisMonthBonuses = gradeBonuses.filter(d => d.mes === currentMes);

    // Construir rawMap solo desde evals del mes
    const rawMap = new Map();
    for (const ev of thisMonthEvals) {
      const key = normalize(ev.nombre);
      if (!rawMap.has(key)) rawMap.set(key, { displayNames: [], scores: [], sesiones: new Set(), bonusTotal: 0 });
      const s = rawMap.get(key);
      const display = (ev.nombre || "").trim();
      if (!s.displayNames.includes(display)) s.displayNames.push(display);
      s.scores.push(normalizeScore(ev));
      if (ev.sesion) s.sesiones.add(ev.sesion);
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

    const rankingArr = [];
    let   studentClusterRoot = null;

    for (const [root, groupKeys] of clusters) {
      const allScores   = [];
      const allSesiones = new Set();
      let   totalBonus  = 0;

      for (const k of groupKeys) {
        const s = rawMap.get(k);
        allScores.push(...s.scores);
        s.sesiones.forEach(ses => allSesiones.add(ses));
        totalBonus += s.bonusTotal;
        // Detectar si este cluster corresponde al alumno buscado
        if (areSamePerson(normSearch, k)) studentClusterRoot = root;
      }

      const avgPct  = allScores.length > 0
        ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
        : 0;
      const sesiones = allSesiones.size;
      const total    = Math.round((avgPct + sesiones * 5 + totalBonus) * 10) / 10;

      rankingArr.push({ root, avgPct, sesiones, total });
    }

    rankingArr.sort((a, b) => b.total - a.total || b.avgPct - a.avgPct || b.sesiones - a.sesiones);

    const rankPos = studentClusterRoot !== null
      ? rankingArr.findIndex(r => r.root === studentClusterRoot)
      : -1;
    const rank         = rankPos >= 0 ? rankPos + 1 : null;
    const totalStudents = rankingArr.length;

    // Nombre canónico: el más "bien escrito" de todas las variantes
    const allDisplayVariants = studentEvals.map(e => (e.nombre || "").trim()).filter(Boolean);
    const displayName = allDisplayVariants.length > 0 ? bestDisplayName(allDisplayVariants) : nombre;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        found: true,
        nombre: displayName,
        grado,
        evals:   studentEvals,
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
