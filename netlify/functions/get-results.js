/**
 * get-results.js
 *
 * GET /.netlify/functions/get-results?pw=...&session=02&grado=sec2
 *
 * Vista del profesor: todas las evaluaciones de una sesión (y grado opcional).
 * Retorna array compatible con el panel de resultados del dashboard.
 */

const { supabase } = require("./_supabase");

const TEACHER_PW    = process.env.TEACHER_PASSWORD || "yoshipotosucio";
// Excluir de resultados: profesora actuando como test user
const EXCLUDED_NAMES = new Set(["estrella vizcarra"]);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const params = event.queryStringParameters || {};
  if (params.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  const session = params.session ? String(params.session).padStart(2, "0") : null;
  const grado   = params.grado || null;

  try {
    const db = supabase();

    // Join evaluaciones → alumnos para obtener nombre y grado
    let query = db
      .from("evaluaciones")
      // `grado` de la propia evaluación: sin él, una nota sin dueño se queda
      // sin salón ("—") y el botón de asignar no sabe qué lista pedir.
      .select("id, sesion, score, correctas, total, fecha, nombre_raw, alumno_id, grado, alumnos(nombre, grado)")
      .is("deleted_at", null)
      .order("fecha", { ascending: false });

    if (session) query = query.eq("sesion", session);
    if (grado)   query = query.eq("grado", grado);

    const { data, error } = await query;
    if (error) throw error;

    // Formatear para que sea compatible con el panel de resultados existente
    const results = (data || [])
      .filter(ev => !EXCLUDED_NAMES.has((ev.alumnos?.nombre || ev.nombre_raw || "").toLowerCase()))
      .map(ev => ({
      _key:      ev.id,           // UUID para borrar
      nombre:    ev.alumnos?.nombre || ev.nombre_raw || "—",
      nombre_raw: ev.nombre_raw || null,   // lo que tipeó el alumno — permite auditar asignaciones
      // Sin alumno_id: la nota se guardó pero no calzó con nadie del roster.
      // La profesora la ve marcada y la asigna; así ninguna evaluación se pierde.
      sinAsignar: !ev.alumno_id,
      grado:     ev.alumnos?.grado  || ev.grado || "—",
      sesion:    ev.sesion,
      score:     ev.score,
      correctas: ev.correctas,
      total:     ev.total ?? 10,
      fecha:     ev.fecha,
      ts:        new Date(ev.fecha).getTime(),
    }));

    return { statusCode: 200, headers: CORS, body: JSON.stringify(results) };
  } catch (err) {
    console.error("get-results error:", err.message);
    // Un error de base de datos NO equivale a "no hay resultados". Devolver
    // [] ocultaba caídas y podía hacer que la profesora creyera que se habían
    // perdido las notas.
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "No se pudieron leer las evaluaciones: " + err.message }) };
  }
};
