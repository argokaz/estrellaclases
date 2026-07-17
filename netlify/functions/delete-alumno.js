/**
 * delete-alumno.js — Borra un alumno y todos sus registros dependientes.
 *
 * POST /.netlify/functions/delete-alumno
 * Body: { pw, id }                — por id de alumno (preferido)
 *   o   { pw, nombre, grado }     — por nombre exacto + grado
 *
 * Borra en orden: evaluaciones → bonuses → tareas → alumno (evita violar FKs).
 * Protegido con contraseña de profesora. Útil para limpiar duplicados o
 * registros de prueba.
 */

const { supabase } = require("./_supabase");
const { titleCase } = require("./_nameUtils");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let b;
  try { b = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' }; }
  if (b.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  try {
    const db = supabase();
    let id = b.id;

    if (!id) {
      if (!b.nombre || !b.grado) return { statusCode: 400, headers: CORS, body: '{"error":"id, o nombre+grado, requeridos"}' };
      const { data } = await db.from("alumnos").select("id, nombre")
        .eq("grado", b.grado).eq("nombre", titleCase(b.nombre.trim())).maybeSingle();
      if (!data) return { statusCode: 404, headers: CORS, body: '{"error":"Alumno no encontrado"}' };
      id = data.id;
    }

    // Borrar dependientes antes del alumno (respeta las FKs)
    const deleted = {};
    for (const tabla of ["evaluaciones", "bonuses", "tareas"]) {
      const { error, count } = await db.from(tabla).delete({ count: "exact" }).eq("alumno_id", id);
      if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`${tabla}: ${error.message}`);
      deleted[tabla] = count || 0;
    }
    const { error: aErr } = await db.from("alumnos").delete().eq("id", id);
    if (aErr) throw new Error("alumnos: " + aErr.message);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id, deleted }) };
  } catch (err) {
    console.error("delete-alumno error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
