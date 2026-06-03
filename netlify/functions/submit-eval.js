/**
 * submit-eval.js
 *
 * POST /.netlify/functions/submit-eval
 * Body: { nombre, grado, sesion, score, correctas, total, fecha, respuestas }
 *
 * 1. Busca o crea el registro canónico del alumno en `alumnos`.
 * 2. Inserta la evaluación en `evaluaciones` (UPSERT: actualiza si el nuevo
 *    score es mayor que el registrado para esa sesión).
 */

const { supabase }    = require("./_supabase");
const { normalize, titleCase, areSamePerson } = require("./_nameUtils");

// Nombres excluidos: no se guardan en BD (profesora actuando como test user)
const EXCLUDED_NAMES = new Set(["estrella vizcarra"]);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' }; }

  const { nombre, grado, sesion, score, correctas, total, fecha } = data;
  if (!nombre || !grado || !sesion || typeof score !== "number") {
    return { statusCode: 400, headers: CORS, body: '{"error":"Missing required fields"}' };
  }

  // Ignorar entregas de la profesora (test user) — responder OK sin guardar
  if (EXCLUDED_NAMES.has(normalize(nombre).toLowerCase())) {
    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
  }

  const nombreNorm = titleCase(nombre);
  const sesId      = String(sesion).padStart(2, "0");
  const fechaStr   = fecha || new Date().toISOString();

  try {
    const db = supabase();

    // ── 1. Buscar alumno existente (fuzzy sobre lista pequeña del grado) ──────
    const { data: alumnos } = await db
      .from("alumnos")
      .select("id, nombre")
      .eq("grado", grado);

    const normBuscado = normalize(nombreNorm);
    let alumno = (alumnos || []).find(a =>
      areSamePerson(normBuscado, normalize(a.nombre))
    );

    // ── 2. Crear alumno si no existe ──────────────────────────────────────────
    if (!alumno) {
      const { data: nuevo, error } = await db
        .from("alumnos")
        .insert({ nombre: nombreNorm, grado })
        .select("id, nombre")
        .single();

      if (error) {
        // Podría ser conflicto de unicidad (race condition) — reintentar fetch
        const { data: recheck } = await db
          .from("alumnos")
          .select("id, nombre")
          .eq("grado", grado)
          .ilike("nombre", nombreNorm)
          .single();
        alumno = recheck;
      } else {
        alumno = nuevo;
      }
    }

    if (!alumno) throw new Error("No se pudo crear o encontrar el alumno");

    // ── 3. Upsert evaluación (conservar el score más alto) ────────────────────
    // Primero verificar si ya existe un score mayor para esta sesión
    const { data: existing } = await db
      .from("evaluaciones")
      .select("id, score")
      .eq("alumno_id", alumno.id)
      .eq("sesion", sesId)
      .single();

    if (!existing) {
      await db.from("evaluaciones").insert({
        alumno_id:  alumno.id,
        grado,
        sesion:     sesId,
        score,
        correctas:  correctas ?? null,
        total:      total ?? 10,
        fecha:      fechaStr,
        nombre_raw: nombre,
      });
    } else if (score > existing.score) {
      await db.from("evaluaciones")
        .update({ score, correctas: correctas ?? null, fecha: fechaStr, nombre_raw: nombre })
        .eq("id", existing.id);
    }
    // Si score <= existing.score: ignorar (ya tiene un mejor intento)

    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };

  } catch (err) {
    console.error("submit-eval error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
