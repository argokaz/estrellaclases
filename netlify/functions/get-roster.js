/**
 * get-roster.js
 *
 * GET /.netlify/functions/get-roster?grado=sec2a
 *
 * Devuelve la lista canónica de alumnos del grado con su historial
 * completo calculado desde la tabla evaluaciones de Supabase.
 */

const { supabase } = require("./_supabase");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const grado = (event.queryStringParameters || {}).grado;
  if (!grado) return { statusCode: 400, headers: CORS, body: '{"error":"grado required"}' };

  try {
    const { data, error } = await supabase()
      .from("alumnos")
      .select("id, nombre, variantes, evaluaciones(sesion, score, fecha)")
      .eq("grado", grado)
      .is("deleted_at", null)
      .is("evaluaciones.deleted_at", null)
      .order("nombre");

    if (error) throw error;
    if (!data || data.length === 0) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
    }

    const alumnos = data.map(a => {
      const historial = (a.evaluaciones || []).sort((x, y) => x.sesion.localeCompare(y.sesion));
      const sesiones  = historial.length;
      const total     = historial.reduce((s, h) => s + h.score, 0);
      const avg       = sesiones > 0 ? Math.round(total / sesiones * 10) / 10 : 0;
      return { id: a.id, nombre: a.nombre, variantes: a.variantes || [], sesiones, avg, total, historial };
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ found: true, grado, alumnos, totalAlumnos: alumnos.length }),
    };
  } catch (err) {
    console.error("get-roster error:", err.message);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
  }
};
