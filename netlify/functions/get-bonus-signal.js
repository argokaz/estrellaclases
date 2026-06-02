/**
 * get-bonus-signal.js
 *
 * GET /.netlify/functions/get-bonus-signal?grado=prim6
 *
 * Devuelve el último bonus registrado para el grado en los últimos 60 segundos.
 * El proyector lo consulta cada 2 s para disparar el splash de celebración.
 * No requiere autenticación — solo retorna nombre y timestamp, sin datos sensibles.
 */

const { supabase } = require("./_supabase");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function res(code, body) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return res(405, { error: "Method not allowed" });

  const { grado } = event.queryStringParameters || {};
  if (!grado) return res(400, { error: "grado required" });

  // Solo bonuses de los últimos 60 segundos
  const since = new Date(Date.now() - 60_000).toISOString();

  try {
    const { data, error } = await supabase()
      .from("bonuses")
      .select("id, fecha, alumnos(nombre)")
      .eq("grado", grado)
      .gte("fecha", since)
      .order("fecha", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || !data.length) return res(200, { bonus: null });

    const b = data[0];
    return res(200, {
      bonus: {
        id:     b.id,
        nombre: b.alumnos?.nombre || "—",
        ts:     new Date(b.fecha).getTime(),
      },
    });
  } catch (err) {
    console.error("get-bonus-signal error:", err.message);
    return res(200, { bonus: null }); // falla silenciosa — no rompe el proyector
  }
};
