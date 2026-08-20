/**
 * manage-roster.js
 *
 * POST /.netlify/functions/manage-roster
 * Body: { pw, grado, alumnos: [{id?, nombre, variantes?}] }
 *
 * - Alumnos CON id → actualiza nombre en Supabase
 * - Alumnos SIN id → inserta como nuevo alumno
 * No borra alumnos (para no perder historial de evaluaciones).
 */

const { supabase }  = require("./_supabase");
const { titleCase } = require("./_nameUtils");

const TEACHER_PW = process.env.TEACHER_PASSWORD;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  if (!TEACHER_PW || body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  if (!body.grado)            return { statusCode: 400, headers: CORS, body: '{"error":"grado required"}' };
  if (!Array.isArray(body.alumnos)) return { statusCode: 400, headers: CORS, body: '{"error":"alumnos required"}' };

  const db = supabase();
  let updated = 0, inserted = 0;

  try {
    for (const a of body.alumnos) {
      const nombre = titleCase((a.nombre || "").trim());
      if (nombre.length < 2) continue;

      if (a.id) {
        const { error } = await db
          .from("alumnos")
          .update({ nombre, variantes: a.variantes || [] })
          .eq("id", a.id)
          .is("deleted_at", null);
        if (!error) updated++;
      } else {
        const { error } = await db
          .from("alumnos")
          .insert({ nombre, grado: body.grado, variantes: a.variantes || [] });
        if (!error) inserted++;
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, updated, inserted, totalAlumnos: updated + inserted }),
    };
  } catch (err) {
    console.error("manage-roster error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
