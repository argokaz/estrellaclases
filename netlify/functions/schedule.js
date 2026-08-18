/**
 * schedule.js — Reprogramación de clases (aplazamientos)
 *
 * GET  /.netlify/functions/schedule            → {shifts:[...]}   (público: los alumnos
 *                                                 también deben ver las fechas corridas)
 * POST /.netlify/functions/schedule            ← {pw, shifts:[...]}  (solo profesora)
 *
 * Un "shift" aplaza una sesión y todas las siguientes:
 *   {id, from: 13, weeks: 1, until: 27, grade: 'all'|'prim6'|…, reason: '', ts}
 *
 * Se guarda la LISTA COMPLETA en cada POST (el cliente manda el estado final),
 * así quitar un aplazamiento es simplemente mandar la lista sin él.
 *
 * Netlify Blobs con consistency:"strong" — igual que sync.js: el default es
 * consistencia eventual y la profesora vería su propio cambio revertido al recargar.
 */

const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const KEY = "shifts";
const GRADES = ["all", "prim6", "sec2", "sec3", "sec4", "sec5"];

function res(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/** Descarta cualquier cosa que no sea un aplazamiento bien formado. */
function limpiar(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      id: String(s.id || "").slice(0, 40) || String(Date.now()) + Math.random().toString(36).slice(2, 7),
      from: parseInt(s.from, 10),
      weeks: parseInt(s.weeks, 10),
      until: s.until == null || s.until === "" ? null : parseInt(s.until, 10),
      grade: GRADES.includes(s.grade) ? s.grade : "all",
      reason: String(s.reason || "").slice(0, 120),
      ts: Number(s.ts) || Date.now(),
    }))
    .filter((s) => s.from >= 1 && s.from <= 32 && s.weeks >= 1 && s.weeks <= 12
      && (s.until == null || (s.until >= s.from && s.until <= 32)))
    .slice(0, 40);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const store = getStore({
    name: "schedule",
    consistency: "strong",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  if (event.httpMethod === "GET") {
    try {
      const raw = await store.get(KEY);
      return res(200, { shifts: raw ? limpiar(JSON.parse(raw)) : [] });
    } catch (e) {
      console.error("schedule GET error:", e.message);
      return res(200, { shifts: [] });
    }
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch { return res(400, { error: "bad json" }); }

    const pw = String(body.pw || "");
    const esperado = process.env.TEACHER_PASSWORD || "yoshipotosucio";
    if (pw !== esperado) return res(401, { error: "no autorizado" });

    const shifts = limpiar(body.shifts);

    try {
      await store.set(KEY, JSON.stringify(shifts));
    } catch (e) {
      // Si falla la escritura hay que decirlo: si devolviéramos ok:true la
      // profesora creería que reprogramó y el cambio no existiría.
      console.error("schedule POST error:", e.message);
      return res(500, { error: "no se pudo guardar" });
    }

    return res(200, { ok: true, shifts });
  }

  return res(405, { error: "method not allowed" });
};
