/**
 * app-vocacional.js — Tablero de la app vocacional de 5.° (marca, carreras, sedes, ética, medición)
 *
 * GET  ?proyecto=app-vocacional-5to                  → {campos:{campo:{v, por, t}}, version}
 * GET  ?proyecto=…&export=1  + Authorization: Bearer → {aportes:[fila completa, historial]}  (solo profesora)
 * POST {accion:'guardar', grado, alumno_id, campos:{campo: valor}}  → {ok, guardados, t}
 *
 * Supabase: tabla app_vocacional_aportes (registro, una fila por cambio) y vista
 * app_vocacional_actual (última fila de cada campo). Migración
 * 20261113_app_vocacional_aportes.sql. Sin alumno del roster no se guarda nada.
 * Las preguntas del test van por banco-preguntas.js.
 */

const { supabase } = require("./_supabase");
const { requireTeacher } = require("./_teacherAuth");
const { autorCorto } = require("./banco-preguntas");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const PROYECTOS = { "app-vocacional-5to": ["sec5"] };
const CAMPO_OK = /^(marca-(nombre|eslogan|color|emoji)|car-(tec|sal|art|neg|soc|cie)|sede[1-6]|etica-(datos|aviso|no)|med-(indicador|meta|prueba|mejora))$/;
const MAX_VALOR = 4000;
const MAX_CAMPOS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const res = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

async function actuales(db, proyecto, campos) {
  let q = db.from("app_vocacional_actual").select("campo, valor, alumno_id, autor_raw, creado").eq("proyecto", proyecto);
  if (campos) q = q.in("campo", campos);
  const { data, error } = await q;
  if (error) throw error;
  return data;
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
        const { data, error } = await db.from("app_vocacional_aportes").select("*")
          .eq("proyecto", q.proyecto).is("deleted_at", null).order("creado");
        if (error) throw error;
        return res(200, { aportes: data });
      }
      const filas = await actuales(db, q.proyecto);
      const campos = {};
      let version = "";
      for (const f of filas) {
        campos[f.campo] = { v: f.valor, por: f.alumno_id ? autorCorto(f.autor_raw) : f.autor_raw, t: Date.parse(f.creado) };
        if (f.creado > version) version = f.creado;
      }
      return res(200, { campos, version });
    }
    if (event.httpMethod !== "POST") return res(405, { error: "Método no permitido." });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return res(400, { error: "JSON inválido." }); }
    const proyecto = body.proyecto || "app-vocacional-5to";
    if (!PROYECTOS[proyecto]) return res(400, { error: "Proyecto no válido." });
    if (body.accion !== "guardar") return res(400, { error: "Acción no válida." });

    const grado = body.grado;
    if (!PROYECTOS[proyecto].includes(grado)) return res(400, { error: "Salón no válido." });
    if (!UUID.test(String(body.alumno_id || ""))) return res(400, { error: "Elige tu nombre de la lista para guardar." });
    const { data: alumno, error: aErr } = await db.from("alumnos").select("id, nombre")
      .eq("id", body.alumno_id).eq("grado", grado).is("deleted_at", null).maybeSingle();
    if (aErr) throw aErr;
    if (!alumno) return res(400, { error: "Tu nombre no está en la lista de este salón." });

    const entrada = body.campos && typeof body.campos === "object" ? Object.entries(body.campos) : [];
    if (!entrada.length || entrada.length > MAX_CAMPOS) return res(400, { error: "Nada que guardar." });
    if (entrada.some(([id]) => !CAMPO_OK.test(id))) return res(400, { error: "Campo no válido." });

    // Solo se registra lo que cambió: el autoguardado no llena el historial de copias.
    const previos = Object.fromEntries((await actuales(db, proyecto, entrada.map(([id]) => id))).map((f) => [f.campo, f.valor]));
    const filas = entrada
      .map(([campo, v]) => ({ campo, valor: String(v == null ? "" : v).slice(0, MAX_VALOR) }))
      .filter((f) => previos[f.campo] !== f.valor && !(previos[f.campo] === undefined && f.valor === ""))
      .map((f) => ({ ...f, proyecto, grado, alumno_id: alumno.id, autor_raw: alumno.nombre }));
    if (filas.length) {
      const { error } = await db.from("app_vocacional_aportes").insert(filas);
      if (error) throw error;
    }
    return res(200, { ok: true, guardados: filas.length, por: autorCorto(alumno.nombre), t: Date.now() });
  } catch (e) {
    console.error("app-vocacional error:", e.message);
    const sinTabla = /app_vocacional_(aportes|actual).*(schema cache|does not exist)/i.test(e.message || "");
    return res(sinTabla ? 503 : 500, {
      error: sinTabla ? "El guardado del tablero aún no está activado." : "No se pudo guardar. Inténtalo otra vez.",
    });
  }
};

exports.CAMPO_OK = CAMPO_OK;
