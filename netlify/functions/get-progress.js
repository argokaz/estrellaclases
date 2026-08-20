/**
 * get-progress.js
 *
 * GET /.netlify/functions/get-progress?nombre=Ana+Garcia&grado=sec2
 *
 * Busca el alumno en Supabase (fuzzy sobre la tabla alumnos del grado),
 * retorna su historial completo y posición en el ranking del mes actual.
 */

const { supabase }    = require("./_supabase");
const { normalize, findBestPerson } = require("./_nameUtils");

// Excluir del ranking: profesora actuando como test user
const EXCLUDED_NAMES = new Set(["estrella vizcarra"]);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function nextMonthStr(mes) {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const params = event.queryStringParameters || {};
  const nombre = (params.nombre || "").trim();
  const grado  = params.grado;
  if (!nombre || !grado) return { statusCode: 400, headers: CORS, body: '{"error":"nombre and grado are required"}' };

  const now        = new Date();
  const currentMes = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const nextMes    = nextMonthStr(currentMes);

  try {
    const db = supabase();

    // ── 1. Buscar alumno en la tabla (fuzzy sobre lista pequeña) ─────────────
    const { data: alumnos } = await db
      .from("alumnos")
      .select("id, nombre")
      .eq("grado", grado)
      .is("deleted_at", null);

    const normSearch = normalize(nombre);
    const alumno = findBestPerson(normSearch, alumnos, a => a.nombre); // exacto > subset > ancla

    if (!alumno) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
    }

    // ── 2. Historial completo del alumno + todas las sesiones del grado ────────
    const [{ data: evals }, { data: allSesiones }] = await Promise.all([
      db.from("evaluaciones")
        .select("sesion, score, correctas, total, fecha")
        .eq("alumno_id", alumno.id)
        .is("deleted_at", null)
        .order("sesion"),
      // Todas las sesiones que EXISTEN para este grado (cualquier alumno)
      db.from("evaluaciones")
        .select("sesion")
        .eq("grado", grado)
        .is("deleted_at", null),
    ]);

    const historial = (evals || []).map(e => ({
      sesion: e.sesion,
      score:  e.score,
      fecha:  e.fecha,
    }));

    // Lista ordenada de sesiones únicas disponibles para el grado
    const sesionesGrado = [...new Set((allSesiones || []).map(e => e.sesion))].sort();
    const sesiones   = historial.length;
    const scoreSum   = historial.reduce((s, h) => s + h.score, 0);
    const avg        = sesiones > 0 ? Math.round(scoreSum / sesiones * 10) / 10 : 0;

    // ── 3. Bonuses del alumno (todos) ─────────────────────────────────────────
    const { data: bonuses } = await db
      .from("bonuses")
      .select("puntos, razon, mes, fecha")
      .eq("alumno_id", alumno.id)
      .is("deleted_at", null)
      .order("fecha", { ascending: false });

    const bonusTotal = (bonuses || []).reduce((s, b) => s + (Number(b.puntos) || 0), 0);

    // ── 4. Rank en el mes actual (excluye profesora) ─────────────────────────
    // ⚠️ rankIds debe declararse ANTES de usarse en las queries (TDZ) — este
    //    error tenía roto get-progress para todo alumno encontrado.
    const rankAlumnos = (alumnos || []).filter(a => !EXCLUDED_NAMES.has(a.nombre.toLowerCase()));
    const rankIds = rankAlumnos.map(a => a.id);

    const [{ data: monthEvals }, { data: monthBonuses }] = await Promise.all([
      db.from("evaluaciones")
        .select("alumno_id, score")
        .in("alumno_id", rankIds)
        .is("deleted_at", null)
        .gte("fecha", `${currentMes}-01`)
        .lt("fecha", nextMes),
      db.from("bonuses")
        .select("alumno_id, puntos")
        .in("alumno_id", rankIds)
        .is("deleted_at", null)
        .eq("mes", currentMes),
    ]);

    // Sumar scores del mes por alumno (excluir profesora)
    const mesScores = new Map(rankIds.map(id => [id, 0]));
    for (const ev of monthEvals  || []) mesScores.set(ev.alumno_id, (mesScores.get(ev.alumno_id) || 0) + ev.score);
    for (const b  of monthBonuses || []) mesScores.set(b.alumno_id,  (mesScores.get(b.alumno_id)  || 0) + (Number(b.puntos) || 0));

    const sorted        = [...mesScores.values()].filter(v => v > 0).sort((a, b) => b - a);
    const myMesScore    = mesScores.get(alumno.id) || 0;
    const rank          = myMesScore > 0 ? sorted.indexOf(myMesScore) + 1 : null;
    const totalStudents = sorted.length;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        found: true,
        nombre:        alumno.nombre,
        grado,
        historial,
        sesionesGrado, // todas las sesiones con eval en el grado
        sesiones,
        avg,
        scoreSum,
        bonusTotal,
        total:         scoreSum + bonusTotal,
        bonuses:       bonuses || [],
        rank,
        totalStudents,
        mes:           currentMes,
      }),
    };
  } catch (err) {
    console.error("get-progress error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
