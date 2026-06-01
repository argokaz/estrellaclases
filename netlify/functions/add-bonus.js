const { getStore } = require("@netlify/blobs");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore(name) {
  return getStore({
    name,
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' };
  }

  const { pw, nombre, grado, puntos, razon, mes: mesParam } = data;

  if (pw !== TEACHER_PW) {
    return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  }

  if (!nombre || !grado || puntos === undefined || puntos === null) {
    return { statusCode: 400, headers: CORS, body: '{"error":"Missing required fields: nombre, grado, puntos"}' };
  }

  const puntosNum = Number(puntos);
  if (isNaN(puntosNum) || puntosNum === 0) {
    return { statusCode: 400, headers: CORS, body: '{"error":"puntos must be a non-zero number"}' };
  }

  try {
    const store = makeStore("bonuses");
    const ts  = Date.now();
    const now = new Date();
    // Usar el mes enviado por el frontend (el que el profesor está viendo en el ranking)
    // Fallback: mes actual del calendario
    const mes = mesParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const key = `${grado}/${ts}`;

    await store.setJSON(key, {
      nombre: nombre.trim(),
      grado,
      puntos: puntosNum,
      razon: razon ? razon.trim() : "",
      fecha: now.toISOString(),
      mes,
      ts,
    });

    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
  } catch (err) {
    console.error("add-bonus error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
