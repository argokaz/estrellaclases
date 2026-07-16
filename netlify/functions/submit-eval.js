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
        // Podría ser conflicto de unicidad (race condition) — refetch con fuzzy,
        // NO con ilike exacto (acentos/typos harían fallar el recheck)
        const { data: refetch } = await db
          .from("alumnos")
          .select("id, nombre")
          .eq("grado", grado);
        alumno = (refetch || []).find(a =>
          areSamePerson(normBuscado, normalize(a.nombre))
        );
      } else {
        alumno = nuevo;
      }
    }

    if (!alumno) throw new Error("No se pudo crear o encontrar el alumno");

    // ── 3. Upsert evaluación (conservar el score más alto) ────────────────────
    // maybeSingle: 0 filas → null sin error; error real (red/RLS) → throw
    const { data: existing, error: exErr } = await db
      .from("evaluaciones")
      .select("id, score")
      .eq("alumno_id", alumno.id)
      .eq("sesion", sesId)
      .maybeSingle();
    if (exErr) throw new Error("lookup evaluación: " + exErr.message);

    // ⚠️ SIEMPRE verificar el error del insert/update — un fallo silencioso aquí
    //    respondía {ok:true} y el alumno perdía su evaluación (bug real: Jasmin
    //    Fatima sec2, S05–S09 sin registrar). Con 500, la red de seguridad del
    //    cliente reintenta hasta confirmar.
    if (!existing) {
      const { error: insErr } = await db.from("evaluaciones").insert({
        alumno_id:  alumno.id,
        grado,
        sesion:     sesId,
        score,
        correctas:  correctas ?? null,
        total:      total ?? 10,
        fecha:      fechaStr,
        nombre_raw: nombre,
      });
      if (insErr) throw new Error("insert evaluación: " + insErr.message);
    } else if (score > existing.score) {
      const { error: updErr } = await db.from("evaluaciones")
        .update({ score, correctas: correctas ?? null, fecha: fechaStr, nombre_raw: nombre })
        .eq("id", existing.id);
      if (updErr) throw new Error("update evaluación: " + updErr.message);
    }
    // Si score <= existing.score: ignorar (ya tiene un mejor intento)

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, alumno: alumno.nombre }) };

  } catch (err) {
    console.error("submit-eval error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
