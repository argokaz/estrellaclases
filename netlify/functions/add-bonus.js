/**
 * add-bonus.js
 *
 * POST /.netlify/functions/add-bonus
 * Body: { pw, nombre, grado, puntos, razon, mes }
 */

const { supabase }    = require("./_supabase");
const { normalize, areSamePerson } = require("./_nameUtils");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' }; }

  const { pw, nombre, grado, puntos, razon, mes: mesParam } = data;

  if (pw !== TEACHER_PW)  return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  if (!nombre || !grado || puntos === undefined)
    return { statusCode: 400, headers: CORS, body: '{"error":"Missing fields"}' };

  const puntosNum = Number(puntos);
  if (isNaN(puntosNum) || puntosNum === 0)
    return { statusCode: 400, headers: CORS, body: '{"error":"puntos must be non-zero"}' };

  const now = new Date();
  const mes = mesParam || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  try {
    const db = supabase();

    // Buscar alumno_id con fuzzy match
    const { data: alumnos } = await db
      .from("alumnos")
      .select("id, nombre")
      .eq("grado", grado);

    const normSearch = normalize(nombre);
    const alumno = (alumnos || []).find(a =>
      areSamePerson(normSearch, normalize(a.nombre))
    );

    if (!alumno) {
      return { statusCode: 404, headers: CORS, body: '{"error":"Alumno no encontrado en el roster"}' };
    }

    const { error } = await db.from("bonuses").insert({
      alumno_id: alumno.id,
      grado,
      puntos:    puntosNum,
      razon:     (razon || "").trim(),
      mes,
      fecha:     now.toISOString(),
    });

    if (error) throw error;

    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
  } catch (err) {
    console.error("add-bonus error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
