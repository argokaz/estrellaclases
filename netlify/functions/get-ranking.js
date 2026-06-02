/**
 * get-ranking.js
 *
 * GET /.netlify/functions/get-ranking?grado=sec2&mes=2026-05
 */

const { supabase } = require("./_supabase");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function nextMonthStr(mes) {
  const [y, m] = mes.split("-").map(Number);
  // Date.UTC(y, m, 1) → primer día del mes siguiente (m en JS es 0-indexed,
  // pero aquí m ya viene como número del mes 1-12, así que funciona directo)
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const params = event.queryStringParameters || {};
  const grado  = params.grado;
  if (!grado) return { statusCode: 400, headers: CORS, body: '{"error":"grado is required"}' };

  const now       = new Date();
  const targetMes = params.mes || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const nextMes   = nextMonthStr(targetMes);

  try {
    const db = supabase();

    // Alumnos del grado
    const { data: alumnos, error: aErr } = await db
      .from("alumnos")
      .select("id, nombre")
      .eq("grado", grado);
    if (aErr) throw aErr;
    if (!alumnos || alumnos.length === 0) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ mes: targetMes, grado, ranking: [] }) };
    }

    const ids = alumnos.map(a => a.id);

    // Evaluaciones del mes
    const { data: evals, error: eErr } = await db
      .from("evaluaciones")
      .select("alumno_id, sesion, score")
      .in("alumno_id", ids)
      .gte("fecha", `${targetMes}-01`)
      .lt("fecha", nextMes);
    if (eErr) throw eErr;

    // Bonuses del mes
    const { data: bonuses, error: bErr } = await db
      .from("bonuses")
      .select("alumno_id, puntos")
      .in("alumno_id", ids)
      .eq("mes", targetMes);
    if (bErr) throw bErr;

    // Agregar por alumno en JS
    const alumnoMap = new Map(alumnos.map(a => [a.id, { nombre: a.nombre, evals: [], bonus: 0 }]));

    for (const ev of evals  || []) alumnoMap.get(ev.alumno_id)?.evals?.push(ev.score);
    for (const b  of bonuses || []) {
      const entry = alumnoMap.get(b.alumno_id);
      if (entry) entry.bonus += Number(b.puntos) || 0;
    }

    const ranking = [];
    for (const [, a] of alumnoMap) {
      if (a.evals.length === 0 && a.bonus === 0) continue;
      const scoreSum = a.evals.reduce((s, sc) => s + sc, 0);
      const sesiones = a.evals.length;
      const avgScore = sesiones > 0 ? Math.round(scoreSum / sesiones * 10) / 10 : 0;
      ranking.push({
        nombre:   a.nombre,
        sesiones,
        avgScore,
        scoreSum,
        bonus:    a.bonus,
        total:    Math.round((scoreSum + a.bonus) * 10) / 10,
      });
    }

    ranking.sort((a, b) => b.total - a.total || b.avgScore - a.avgScore || b.sesiones - a.sesiones);

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
