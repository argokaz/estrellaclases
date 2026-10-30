/**
 * diseno.js — Documento de diseño de los proyectos finales (por grupo)
 *
 * GET  /.netlify/functions/diseno?aula=sec4           → {proyectos:[{slug,nombre,miembros,tipo,progreso,t,por}]}
 * POST /.netlify/functions/diseno  ← {accion, aula, ...}
 *   crear    {nombre, miembros:[], por}        → {proyecto}      (409 + {proyecto} si el nombre ya existe)
 *   leer     {p, latido?, conocidos?:{id:etag}} → {meta, latido, campos:{id:{v,por,t,etag}}} (solo lo que cambió)
 *   guardar  {p, campos:{id:valor}, por, progreso} → {ok, t}
 *   grupo    {p, nombre?, miembros?, por}       → {meta}          (renombrar / cambiar integrantes)
 *   borrar   {p}  + Authorization: Bearer       → {ok}            (solo profesora)
 *
 * Netlify Blobs ("disenos", consistency:"strong"), una entrada POR CAMPO:
 *   {aula}/{slug}/meta        {nombre, slug, aula, miembros, creado, creadoPor}
 *   {aula}/{slug}/latido      {t, por, progreso}   ← cambia en cada guardado
 *   {aula}/{slug}/c/{campo}   {v, por, t}
 * La versión 8 de Blobs no tiene escrituras condicionales: con el documento en
 * una sola entrada, dos integrantes guardando a la vez se borrarían el trabajo.
 * Por campo, solo chocan si escriben EL MISMO campo, y gana el último.
 * `leer` compara la versión del latido: si nadie guardó, cuesta una sola lectura.
 */

const { getStore } = require("@netlify/blobs");
const { requireTeacher } = require("./_teacherAuth");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const AULAS = ["prim6", "sec2a", "sec2b", "sec3", "sec4", "sec5"];
const CAMPO_RE = /^[a-z0-9-]{1,40}$/;
const MAX_VALOR = 4000;
const MAX_CAMPOS = 80;

function res(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/** "Talleres Asunción 2.0" → "talleres-asuncion-2-0": la clave del proyecto. */
function slugDe(nombre) {
  return String(nombre || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 50).replace(/-+$/, "");
}

const texto = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const limpiarMiembros = (lista) =>
  [...new Set((Array.isArray(lista) ? lista : []).map((m) => texto(m, 80)).filter(Boolean))].slice(0, 8);

function store() {
  return getStore({ name: "disenos", consistency: "strong", siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
}

/** Lee una entrada JSON; una entrada ilegible cuenta como vacía en vez de tumbar el documento. */
async function leerJSON(s, key) {
  const raw = await s.get(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function listarProyectos(s, aula) {
  const { directories } = await s.list({ prefix: `${aula}/`, directories: true });
  const slugs = directories.map((d) => d.slice(aula.length + 1).replace(/\/$/, ""));
  const filas = await Promise.all(slugs.map(async (slug) => {
    const [meta, latido, tipo] = await Promise.all([
      leerJSON(s, `${aula}/${slug}/meta`),
      leerJSON(s, `${aula}/${slug}/latido`),
      leerJSON(s, `${aula}/${slug}/c/tipo`),
    ]);
    if (!meta) return null;
    return {
      slug, nombre: meta.nombre, miembros: meta.miembros || [], tipo: tipo ? tipo.v : "",
      progreso: latido ? latido.progreso || 0 : 0,
      t: latido ? latido.t : meta.creado, por: latido ? latido.por : meta.creadoPor,
    };
  }));
  return filas.filter(Boolean).sort((a, b) => b.t - a.t);
}

/** Devuelve solo lo que el cliente no tiene: si nadie guardó desde su última
    lectura, una sola consulta. La versión del latido es su propia marca de
    tiempo; los campos se comparan con el etag del listado, nunca mezclado con
    el de una lectura suelta (pueden venir en formatos distintos). */
async function leer(s, aula, slug, body) {
  const base = `${aula}/${slug}`;
  const latido = await leerJSON(s, `${base}/latido`);
  const version = latido ? `${latido.t}:${latido.por || ""}` : "";
  if (body.latido && body.latido === version) return res(200, { sinCambios: true, latido: version });

  const meta = await leerJSON(s, `${base}/meta`);
  if (!meta) return res(404, { error: "Ese proyecto no existe o fue eliminado." });

  const conocidos = body.conocidos && typeof body.conocidos === "object" ? body.conocidos : {};
  const { blobs } = await s.list({ prefix: `${base}/c/` });
  const nuevos = blobs.filter((b) => conocidos[b.key.slice(base.length + 3)] !== b.etag);
  const campos = {};
  await Promise.all(nuevos.map(async (b) => {
    const data = await leerJSON(s, b.key);
    if (data) campos[b.key.slice(base.length + 3)] = { ...data, etag: b.etag };
  }));
  const ultimo = latido ? { t: latido.t, por: latido.por } : null;
  return res(200, { meta, latido: version, ultimo, campos });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const s = store();

  try {
    if (event.httpMethod === "GET") {
      const aula = (event.queryStringParameters || {}).aula;
      if (!AULAS.includes(aula)) return res(400, { error: "Salón no válido." });
      return res(200, { proyectos: await listarProyectos(s, aula) });
    }
    if (event.httpMethod !== "POST") return res(405, { error: "Método no permitido." });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return res(400, { error: "JSON inválido." }); }
    const aula = body.aula;
    if (!AULAS.includes(aula)) return res(400, { error: "Salón no válido." });

    if (body.accion === "crear") {
      const nombre = texto(body.nombre, 60);
      const slug = slugDe(nombre);
      if (slug.length < 2) return res(400, { error: "Escribe un nombre de proyecto de al menos 2 letras." });
      const existente = await leerJSON(s, `${aula}/${slug}/meta`);
      if (existente) return res(409, { error: "Ya existe un proyecto con ese nombre en tu salón.", proyecto: existente });
      const por = texto(body.por, 80);
      const meta = { nombre, slug, aula, miembros: limpiarMiembros(body.miembros), creado: Date.now(), creadoPor: por };
      await s.setJSON(`${aula}/${slug}/meta`, meta);
      await s.setJSON(`${aula}/${slug}/latido`, { t: meta.creado, por, progreso: 0 });
      return res(200, { proyecto: meta });
    }

    const slug = slugDe(body.p);
    if (!slug) return res(400, { error: "Falta el proyecto." });

    if (body.accion === "leer") return await leer(s, aula, slug, body);

    if (body.accion === "guardar") {
      const entrada = body.campos && typeof body.campos === "object" ? Object.entries(body.campos) : [];
      if (!entrada.length || entrada.length > MAX_CAMPOS) return res(400, { error: "Nada que guardar." });
      if (entrada.some(([id]) => !CAMPO_RE.test(id))) return res(400, { error: "Campo no válido." });
      if (!(await leerJSON(s, `${aula}/${slug}/meta`))) {
        return res(404, { error: "Ese proyecto no existe o fue eliminado." });
      }
      const t = Date.now();
      const por = texto(body.por, 80);
      await Promise.all(entrada.map(([id, v]) =>
        s.setJSON(`${aula}/${slug}/c/${id}`, { v: String(v == null ? "" : v).slice(0, MAX_VALOR), por, t })));
      // El latido va DESPUÉS de los campos: quien lo vea cambiado ya encuentra los datos
      const progreso = Math.max(0, Math.min(100, Math.round(Number(body.progreso) || 0)));
      await s.setJSON(`${aula}/${slug}/latido`, { t, por, progreso });
      return res(200, { ok: true, t });
    }

    if (body.accion === "grupo") {
      const meta = await leerJSON(s, `${aula}/${slug}/meta`);
      if (!meta) return res(404, { error: "Ese proyecto no existe o fue eliminado." });
      if (body.nombre != null) {
        const nombre = texto(body.nombre, 60);
        if (slugDe(nombre).length < 2) return res(400, { error: "Escribe un nombre de al menos 2 letras." });
        meta.nombre = nombre;   // la clave conserva el nombre con que se creó
      }
      if (body.miembros != null) meta.miembros = limpiarMiembros(body.miembros);
      await s.setJSON(`${aula}/${slug}/meta`, meta);
      const latido = (await leerJSON(s, `${aula}/${slug}/latido`)) || {};
      await s.setJSON(`${aula}/${slug}/latido`, { ...latido, t: Date.now(), por: texto(body.por, 80) });
      return res(200, { meta });
    }

    if (body.accion === "borrar") {
      const auth = requireTeacher(event);
      if (!auth.ok) return res(auth.statusCode, { error: auth.error });
      const { blobs } = await s.list({ prefix: `${aula}/${slug}/` });
      await Promise.all(blobs.map((b) => s.delete(b.key)));
      return res(200, { ok: true, borrados: blobs.length });
    }

    return res(400, { error: "Acción no válida." });
  } catch (e) {
    console.error("diseno error:", e.message);
    return res(500, { error: "No se pudo conectar con el guardado. Lo volveremos a intentar." });
  }
};

exports.slugDe = slugDe;
