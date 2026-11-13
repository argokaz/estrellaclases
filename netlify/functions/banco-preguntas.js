/**
 * banco-preguntas.js — Banco de preguntas del test vocacional (5.°)
 *
 * GET  ?proyecto=app-vocacional-5to                    → {preguntas:[{id,pregunta,opciones,estado,nota,autor,creado}]}
 * GET  ?proyecto=…&export=1  + Authorization: Bearer   → {preguntas:[fila completa]}   (solo profesora)
 * POST {accion:'proponer', grado, alumno_id, pregunta, opciones:[{e,x,a}×4]} → {pregunta}
 * POST {accion:'revisar', id, estado, nota?}  + Bearer → {pregunta}                    (solo profesora)
 * POST {accion:'borrar', id}                  + Bearer → {ok}                          (solo profesora)
 *
 * Supabase tabla "banco_preguntas" (migración 20261113_banco_preguntas.sql).
 * Una fila por propuesta: nunca se sobrescribe la de otro alumno. El alumno
 * se elige del roster y el servidor comprueba que sea de ese salón.
 */

const { supabase } = require("./_supabase");
const { requireTeacher } = require("./_teacherAuth");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const PROYECTOS = { "app-vocacional-5to": ["sec5"] };
const AREAS = ["tec", "sal", "art", "neg", "soc", "cie"];
const ESTADOS = ["propuesta", "aprobada", "descartada"];
const MAX_POR_ALUMNO = 15;
const COLS_PUBLICAS = "id, pregunta, opciones, estado, nota_profesora, autor_raw, creado";

const res = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const texto = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Pedro Fidel Huamanciza Miranda" → "Pedro H." — en la página pública basta con eso. */
function autorCorto(nombre) {
  const p = String(nombre || "").trim().split(/\s+/);
  if (p.length < 2) return p[0] || "";
  return `${p[0]} ${p[p.length >= 3 ? p.length - 2 : 1][0]}.`;   // inicial del primer apellido
}
const publica = (f) => ({
  id: f.id, pregunta: f.pregunta, opciones: f.opciones, estado: f.estado,
  nota: f.nota_profesora, autor: autorCorto(f.autor_raw), creado: f.creado,
});

/** Devuelve las 4 opciones limpias o un mensaje de error para el alumno. */
function validarOpciones(lista) {
  if (!Array.isArray(lista) || lista.length !== 4) return { error: "La pregunta necesita 4 respuestas." };
  const opciones = lista.map((o) => ({
    e: texto(o && o.e, 4),
    x: texto(o && o.x, 60),
    a: String((o && o.a) || ""),
  }));
  if (opciones.some((o) => o.x.length < 2)) return { error: "Escribe las 4 respuestas." };
  if (opciones.some((o) => !AREAS.includes(o.a))) return { error: "Elige el área de cada respuesta." };
  if (new Set(opciones.map((o) => o.a)).size !== 4) {
    return { error: "Cada respuesta debe sumar a un área distinta." };
  }
  if (new Set(opciones.map((o) => o.x.toLowerCase())).size !== 4) return { error: "Hay dos respuestas iguales." };
  return { opciones };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const db = supabase();

  try {
    if (event.httpMethod === "GET") {
      const q = event.queryStringParameters || {};
      if (!PROYECTOS[q.proyecto]) return res(400, { error: "Proyecto no válido." });
      if (q.export) {
        const auth = requireTeacher(event);
        if (!auth.ok) return res(auth.statusCode, { error: auth.error });
        const { data, error } = await db.from("banco_preguntas").select("*")
          .eq("proyecto", q.proyecto).is("deleted_at", null).order("creado");
        if (error) throw error;
        return res(200, { preguntas: data });
      }
      const { data, error } = await db.from("banco_preguntas").select(COLS_PUBLICAS)
        .eq("proyecto", q.proyecto).is("deleted_at", null).order("creado");
      if (error) throw error;
      return res(200, { preguntas: data.map(publica) });
    }
    if (event.httpMethod !== "POST") return res(405, { error: "Método no permitido." });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return res(400, { error: "JSON inválido." }); }
    const proyecto = body.proyecto || "app-vocacional-5to";
    if (!PROYECTOS[proyecto]) return res(400, { error: "Proyecto no válido." });

    if (body.accion === "proponer") {
      const grado = body.grado;
      if (!PROYECTOS[proyecto].includes(grado)) return res(400, { error: "Salón no válido." });
      if (!UUID.test(String(body.alumno_id || ""))) return res(400, { error: "Elige tu nombre de la lista." });
      const { data: alumno, error: aErr } = await db.from("alumnos").select("id, nombre")
        .eq("id", body.alumno_id).eq("grado", grado).is("deleted_at", null).maybeSingle();
      if (aErr) throw aErr;
      if (!alumno) return res(400, { error: "Tu nombre no está en la lista de este salón." });

      const pregunta = texto(body.pregunta, 140);
      if (pregunta.length < 8) return res(400, { error: "Escribe la pregunta completa." });
      const v = validarOpciones(body.opciones);
      if (v.error) return res(400, { error: v.error });

      const { count, error: cErr } = await db.from("banco_preguntas").select("id", { count: "exact", head: true })
        .eq("proyecto", proyecto).eq("alumno_id", alumno.id).is("deleted_at", null);
      if (cErr) throw cErr;
      if (count >= MAX_POR_ALUMNO) return res(400, { error: `Ya propusiste ${MAX_POR_ALUMNO} preguntas. ¡Gracias!` });

      const { data, error } = await db.from("banco_preguntas").insert({
        proyecto, grado, alumno_id: alumno.id, autor_raw: alumno.nombre,
        pregunta, opciones: v.opciones, areas: v.opciones.map((o) => o.a),
      }).select(COLS_PUBLICAS).single();
      if (error) throw error;
      return res(200, { pregunta: publica(data) });
    }

    if (body.accion === "revisar" || body.accion === "borrar") {
      const auth = requireTeacher(event);
      if (!auth.ok) return res(auth.statusCode, { error: auth.error });
      if (!UUID.test(String(body.id || ""))) return res(400, { error: "Falta la pregunta." });
      if (body.accion === "borrar") {
        const { error } = await db.from("banco_preguntas").update({ deleted_at: new Date().toISOString() })
          .eq("id", body.id).eq("proyecto", proyecto);
        if (error) throw error;
        return res(200, { ok: true });
      }
      if (!ESTADOS.includes(body.estado)) return res(400, { error: "Estado no válido." });
      const { data, error } = await db.from("banco_preguntas").update({
        estado: body.estado, nota_profesora: texto(body.nota, 300), revisado: new Date().toISOString(),
      }).eq("id", body.id).eq("proyecto", proyecto).is("deleted_at", null).select(COLS_PUBLICAS).maybeSingle();
      if (error) throw error;
      if (!data) return res(404, { error: "Esa pregunta ya no existe." });
      return res(200, { pregunta: publica(data) });
    }

    return res(400, { error: "Acción no válida." });
  } catch (e) {
    console.error("banco-preguntas error:", e.message);
    const sinTabla = /banco_preguntas.*(schema cache|does not exist)/i.test(e.message || "");
    return res(sinTabla ? 503 : 500, {
      error: sinTabla ? "El banco de preguntas aún no está activado." : "No se pudo guardar. Inténtalo otra vez.",
    });
  }
};

exports.validarOpciones = validarOpciones;
exports.autorCorto = autorCorto;
