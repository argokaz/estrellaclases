/**
 * sync.js — Remote sync entre proyector (sesion-NN) y notas del profesor (notas-NN)
 *
 * GET  /.netlify/functions/sync?room=CODE   → {slide, grade, session, bonus?, ts}
 * POST /.netlify/functions/sync             ← {room, slide?, grade?, session?, bonus?}
 *
 * Usa Netlify Blobs ("sync-rooms") para persistencia entre instancias Lambda.
 * Credenciales explícitas: SITE_ID + NETLIFY_TOKEN (ya configurados en Netlify).
 */

const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function res(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // consistency:"strong" es OBLIGATORIO: el default (eventual) sirve lecturas
  // cacheadas viejas → el proyector no ve la posición nueva de las notas y el
  // Conectar del dashboard no encuentra salas recién creadas.
  const store = getStore({ name: "sync-rooms", consistency: "strong", siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });

  // ── GET: el proyector poll + el dashboard de redirect ─────────────────────
  if (event.httpMethod === "GET") {
    const room = (event.queryStringParameters || {}).room || "";
    if (!room || room.length > 8) return res(400, { error: "bad room" });

    try {
      const raw = await store.get(room);
      if (!raw) return res(200, { slide: -1 }); // sala no inicializada aún
      return res(200, JSON.parse(raw));
    } catch (e) {
      console.error("sync GET error:", e.message);
      return res(200, { slide: -1 });
    }
  }

  // ── POST: proyector registra slide / grade / session; notas registra slide ─
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch { return res(400, { error: "bad json" }); }

    const { room, slide, bonus, grade, session, ruleta } = body;
    if (!room || room.length > 8) return res(400, { error: "bad params" });
    if (typeof slide !== "number" && !bonus && !grade && !ruleta) return res(400, { error: "bad params" });

    // Leer estado actual y mergear — todos los campos son independientes
    let current = { slide: -1 };
    try {
      const raw = await store.get(room);
      if (raw) current = JSON.parse(raw);
    } catch (_) {}

    if (typeof slide === "number") current.slide = slide;
    if (bonus && bonus.nombre) current.bonus = { nombre: bonus.nombre, ts: bonus.ts || Date.now() };
    // La profesora gira la ruleta desde sus notas; el proyector la ve girar en
    // el siguiente poll. El ts hace que cada giro dispare una sola vez.
    if (ruleta && ruleta.nombre) current.ruleta = { nombre: ruleta.nombre, ts: ruleta.ts || Date.now() };
    if (grade)   current.grade   = grade;
    if (session) current.session = session;
    current.ts = Date.now();

    try {
      await store.set(room, JSON.stringify(current));
    } catch (e) {
      console.error("sync POST error:", e.message);
      return res(500, { error: "store write failed" });
    }

    return res(200, { ok: true });
  }

  return res(405, { error: "method not allowed" });
};
