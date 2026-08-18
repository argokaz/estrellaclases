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
const { normalize, titleCase, findBestPerson } = require("./_nameUtils");

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

  const { nombre, grado, sesion, correctas, total, fecha, alumno_id } = data;
  let { score } = data;
  if (!nombre || !grado || !sesion || typeof score !== "number") {
    return { statusCode: 400, headers: CORS, body: '{"error":"Missing required fields"}' };
  }

  // ── Saneamiento de score a la escala 0–20 (constraint de la BD) ──
  // Algunos repasos (S10 oscuros) enviaban el score como porcentaje 0–100, que
  // la BD rechaza → la nota se perdía en silencio. Recalculamos desde `correctas`
  // cuando el score viene fuera de rango, para que hasta los envíos ya
  // encolados (con score=100) se guarden bien al reintentar.
  const totalN = (typeof total === "number" && total > 0) ? total : 10;
  if (typeof correctas === "number" && correctas >= 0 && correctas <= totalN) {
    score = Math.round((correctas / totalN) * 20);   // fuente de verdad: aciertos
  } else if (score > 20) {
    score = Math.round(score / 5);                    // 0–100 → 0–20
  }
  if (score < 0) score = 0;
  if (score > 20) score = 20;

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
    // ⚠️ El error de esta consulta NO se puede ignorar: si falla la red o la
    //    RLS, `alumnos` viene vacío, nadie calza y rechazaríamos a un alumno
    //    real. Con throw → 500 → la red de seguridad del cliente reintenta.
    const { data: alumnos, error: rosterErr } = await db
      .from("alumnos")
      .select("id, nombre")
      .eq("grado", grado);
    if (rosterErr) throw new Error("leer roster: " + rosterErr.message);

    const normBuscado = normalize(nombreNorm);
    // Las páginas nuevas envían el id canónico que obtuvieron del roster.
    // Se verifica contra el mismo roster antes de usarlo. Los envíos antiguos
    // siguen funcionando con fuzzy match para no perder colas ya existentes.
    const alumnoPorId = alumno_id
      ? alumnos.find(a => String(a.id) === String(alumno_id))
      : null;
    if (alumno_id && !alumnoPorId) {
      const err = new Error("Identidad de alumno no válida para " + grado);
      err.statusCode = 409;
      err.identidadInvalida = true;
      throw err;
    }
    if (alumnoPorId && normalize(alumnoPorId.nombre) !== normBuscado) {
      const err = new Error("El nombre no coincide con la identidad seleccionada");
      err.statusCode = 409;
      err.identidadInvalida = true;
      throw err;
    }
    // findBestPerson: exacto > subset > ancla — NUNCA "primer match gana"
    const alumno = alumnoPorId || findBestPerson(normBuscado, alumnos, a => a.nombre);

    // ── 2. Sin coincidencia: se guarda la nota, NO se crea el alumno ──────────
    // Antes se creaba un alumno con cualquier texto, y por ahí entraron "Shadow
    // Haunter", "Ewen" y otros 15 registros falsos (limpieza 31 jul 2026).
    //
    // Pero tirar el envío tampoco: un alumno real que escribe mal su nombre
    // perdería la nota que acaba de sacar. La evaluación se guarda SIN DUEÑO,
    // con el nombre tal cual lo escribió, y la profesora la asigna desde
    // 📊 Resultados. Se pierde la asignación automática, nunca la nota.
    if (!alumno) {
      if (!alumnos || !alumnos.length) throw new Error("Roster vacío para " + grado);

      // limit(1) y no maybeSingle: si por lo que sea hay dos sin asignar con el
      // mismo nombre, maybeSingle lanzaría error y el cliente reintentaría sin fin
      const { data: previas, error: hErr } = await db
        .from("evaluaciones")
        .select("id, score")
        .is("alumno_id", null)
        .eq("grado", grado)
        .eq("sesion", sesId)
        .eq("nombre_raw", nombre)
        .order("score", { ascending: false })
        .limit(1);
      if (hErr) throw new Error("lookup evaluación sin asignar: " + hErr.message);
      const previa = previas && previas[0];

      if (!previa) {
        const { error } = await db.from("evaluaciones").insert({
          alumno_id:  null,
          grado,
          sesion:     sesId,
          score,
          correctas:  correctas ?? null,
          total:      total ?? 10,
          fecha:      fechaStr,
          nombre_raw: nombre,
        });
        if (error) throw new Error("insert evaluación sin asignar: " + error.message);
      } else if (score > previa.score) {
        const { error } = await db.from("evaluaciones")
          .update({ score, correctas: correctas ?? null, fecha: fechaStr })
          .eq("id", previa.id);
        if (error) throw new Error("update evaluación sin asignar: " + error.message);
      }

      // ok:true a propósito: el resultado YA está guardado, así que el outbox
      // del repaso debe soltarlo. El aviso es para que el alumno avise, no para
      // que reintente.
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          sinAsignar: true,
          mensaje: "Guardamos tu resultado, pero «" + nombreNorm + "» no figura en la lista de tu salón. " +
                   "Avísale a la profesora para que lo ponga a tu nombre.",
        }),
      };
    }

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
    return {
      statusCode: err.statusCode || 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message, identidadInvalida: !!err.identidadInvalida }),
    };
  }
};
