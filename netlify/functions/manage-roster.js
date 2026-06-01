/**
 * manage-roster.js
 *
 * POST /.netlify/functions/manage-roster
 * Body: { pw, grado, alumnos: [{nombre, sesiones, avg, total}] }
 *
 * Reemplaza el roster de un grado con la lista proporcionada.
 * Aplica normalización Title Case a todos los nombres antes de guardar.
 */

const { getStore } = require("@netlify/blobs");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore(name) {
  return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
}

// Partículas que van en minúscula salvo que sean la primera palabra
const MINORS = new Set(["de", "del", "de la", "de las", "de los", "y", "e", "o", "el", "la", "los", "las"]);

function titleCase(str) {
  return (str || "").trim()
    .split(/\s+/)
    .map((word, i) => {
      const low = word.toLowerCase();
      if (i > 0 && MINORS.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(" ");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  if (body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  if (!body.grado)            return { statusCode: 400, headers: CORS, body: '{"error":"grado required"}' };
  if (!Array.isArray(body.alumnos)) return { statusCode: 400, headers: CORS, body: '{"error":"alumnos array required"}' };

  try {
    const store = makeStore("rosters");

    // Normalizar nombres a Title Case y eliminar duplicados
    const seen = new Set();
    const alumnos = body.alumnos
      .map(a => ({
        ...a,
        nombre: titleCase(typeof a === "string" ? a : a.nombre || ""),
      }))
      .filter(a => {
        if (!a.nombre || a.nombre.length < 2) return false;
        const key = a.nombre.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    await store.setJSON(body.grado, {
      grado: body.grado,
      alumnos,
      actualizadoEn:  new Date().toISOString(),
      totalAlumnos:   alumnos.length,
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, totalAlumnos: alumnos.length }),
    };
  } catch (err) {
    console.error("manage-roster error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
