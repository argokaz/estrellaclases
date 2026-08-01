/**
 * admin-roster.js — herramientas de limpieza del roster.
 *
 * POST /.netlify/functions/admin-roster
 *   {pw, action:"inspeccionar", id}          → todo lo que cuelga de ese alumno
 *   {pw, action:"fusionar", desde, hacia}    → pasa evaluaciones, bonos y tareas
 *                                              del registro duplicado al real
 *
 * Nace de una limpieza real (jul 2026): alumnos que entraron al repaso del
 * salón equivocado quedaron como registros aparte, y algunos guardaban la
 * ÚNICA copia de una evaluación. Borrarlos de frente les habría costado esa
 * nota — y, con el descuento por práctica no rendida, 2 puntos más.
 *
 * Fusionar NO borra: mueve lo que se puede mover y devuelve el detalle. El
 * borrado sigue siendo un paso aparte y explícito (delete-alumno.js).
 */

const { supabase } = require("./_supabase");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const ok  = body => ({ statusCode: 200, headers: CORS, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) });

async function cargar(db, id) {
  const { data, error } = await db.from("alumnos").select("id, nombre, grado").eq("id", id).maybeSingle();
  if (error) throw new Error("alumno " + id + ": " + error.message);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return err(405, "Method not allowed");

  let b;
  try { b = JSON.parse(event.body); } catch { return err(400, "Bad JSON"); }
  if (b.pw !== TEACHER_PW) return err(401, "Unauthorized");

  const db = supabase();

  try {
    if (b.action === "inspeccionar") {
      const alumno = await cargar(db, b.id);
      if (!alumno) return err(404, "Alumno no encontrado");
      const [ev, bo, ta] = await Promise.all([
        db.from("evaluaciones").select("id, sesion, score, fecha, nombre_raw").eq("alumno_id", b.id),
        db.from("bonuses").select("id, puntos, razon, mes, fecha").eq("alumno_id", b.id),
        db.from("tareas").select("id, sesion, drive_link, fecha").eq("alumno_id", b.id),
      ]);
      return ok({
        alumno,
        evaluaciones: ev.data || [],
        bonuses:      bo.data || [],
        tareas:       ta.error ? [] : (ta.data || []),
      });
    }

    if (b.action === "fusionar") {
      const [desde, hacia] = await Promise.all([cargar(db, b.desde), cargar(db, b.hacia)]);
      if (!desde) return err(404, "Registro de origen no encontrado");
      if (!hacia) return err(404, "Alumno de destino no encontrado");
      if (desde.id === hacia.id) return err(400, "Origen y destino son el mismo alumno");

      const reporte = { desde, hacia, evaluaciones: [], bonuses: [], tareas: [] };

      // ── Evaluaciones: solo las sesiones que el destino todavía no tiene.
      //    Si ya la tiene, la del duplicado es redundante y se queda para que
      //    el borrado se la lleve; nunca se pisa una nota existente.
      const [{ data: evOrigen }, { data: evDestino }] = await Promise.all([
        db.from("evaluaciones").select("id, sesion, score").eq("alumno_id", desde.id),
        db.from("evaluaciones").select("sesion, score").eq("alumno_id", hacia.id),
      ]);
      const yaTiene = new Map((evDestino || []).map(e => [e.sesion, e.score]));

      for (const ev of evOrigen || []) {
        if (yaTiene.has(ev.sesion)) {
          reporte.evaluaciones.push({ sesion: ev.sesion, score: ev.score, resultado: "ya la tenía (" + yaTiene.get(ev.sesion) + ")" });
          continue;
        }
        const { error } = await db.from("evaluaciones")
          .update({ alumno_id: hacia.id, grado: hacia.grado })
          .eq("id", ev.id);
        reporte.evaluaciones.push({ sesion: ev.sesion, score: ev.score, resultado: error ? "ERROR: " + error.message : "movida" });
        if (error) throw new Error("mover evaluación S" + ev.sesion + ": " + error.message);
      }

      // ── Bonos: se mueven todos; el destino es la misma persona.
      const { data: boOrigen } = await db.from("bonuses").select("id, puntos, mes").eq("alumno_id", desde.id);
      for (const bo of boOrigen || []) {
        const { error } = await db.from("bonuses")
          .update({ alumno_id: hacia.id, grado: hacia.grado })
          .eq("id", bo.id);
        reporte.bonuses.push({ puntos: bo.puntos, mes: bo.mes, resultado: error ? "ERROR: " + error.message : "movido" });
      }

      // ── Tareas: una por sesión; si el destino ya entregó, se deja.
      const [taOrigen, taDestino] = await Promise.all([
        db.from("tareas").select("id, sesion").eq("alumno_id", desde.id),
        db.from("tareas").select("sesion").eq("alumno_id", hacia.id),
      ]);
      if (!taOrigen.error) {
        const entregadas = new Set((taDestino.data || []).map(t => t.sesion));
        for (const ta of taOrigen.data || []) {
          if (entregadas.has(ta.sesion)) {
            reporte.tareas.push({ sesion: ta.sesion, resultado: "ya la tenía" });
            continue;
          }
          const { error } = await db.from("tareas")
            .update({ alumno_id: hacia.id, grado: hacia.grado })
            .eq("id", ta.id);
          reporte.tareas.push({ sesion: ta.sesion, resultado: error ? "ERROR: " + error.message : "movida" });
        }
      }

      return ok({ ok: true, ...reporte });
    }

    // ── Asignar una evaluación sin dueño al alumno que le corresponde ────────
    // Contraparte de submit-eval: cuando un alumno escribe mal su nombre, la
    // nota se guarda sin alumno_id. Esto la pone donde va, conservando el mejor
    // intento si el alumno ya tenía nota en esa sesión.
    if (b.action === "asignar") {
      const alumno = await cargar(db, b.alumno);
      if (!alumno) return err(404, "Alumno no encontrado");

      const { data: ev, error: evErr } = await db
        .from("evaluaciones")
        .select("id, sesion, score, alumno_id")
        .eq("id", b.evaluacion)
        .maybeSingle();
      if (evErr) throw new Error("lookup evaluación: " + evErr.message);
      if (!ev)   return err(404, "Evaluación no encontrada");

      const { data: yaTiene, error: ytErr } = await db
        .from("evaluaciones")
        .select("id, score")
        .eq("alumno_id", alumno.id)
        .eq("sesion", ev.sesion)
        .limit(1);
      if (ytErr) throw new Error("lookup nota existente: " + ytErr.message);
      const suya = yaTiene && yaTiene[0];

      if (suya) {
        // Ya tenía nota en esa sesión: se queda la mejor y la suelta se borra
        if (ev.score > suya.score) {
          const { error } = await db.from("evaluaciones")
            .update({ score: ev.score }).eq("id", suya.id);
          if (error) throw new Error("actualizar nota: " + error.message);
        }
        const { error: delErr } = await db.from("evaluaciones").delete().eq("id", ev.id);
        if (delErr) throw new Error("borrar duplicada: " + delErr.message);
        return ok({ ok: true, alumno: alumno.nombre, sesion: ev.sesion,
          resultado: ev.score > suya.score ? "se quedó la mejor (" + ev.score + ")" : "ya tenía una mejor (" + suya.score + ")" });
      }

      const { error } = await db.from("evaluaciones")
        .update({ alumno_id: alumno.id, grado: alumno.grado })
        .eq("id", ev.id);
      if (error) throw new Error("asignar evaluación: " + error.message);
      return ok({ ok: true, alumno: alumno.nombre, sesion: ev.sesion, resultado: "asignada (" + ev.score + ")" });
    }

    return err(400, 'action debe ser "inspeccionar", "fusionar" o "asignar"');
  } catch (e) {
    console.error("admin-roster error:", e.message);
    return err(500, e.message);
  }
};
