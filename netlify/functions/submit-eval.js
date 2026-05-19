const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore() {
  return getStore({
    name: "evaluaciones",
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

  const { nombre, grado, sesion, score, correctas, total, fecha } = data;
  if (!nombre || !grado || !sesion || typeof score !== "number") {
    return { statusCode: 400, headers: CORS, body: '{"error":"Missing required fields"}' };
  }

  try {
    const store = makeStore();
    const key = `s${String(sesion).padStart(2,"0")}/${grado}/${Date.now()}`;

    await store.setJSON(key, {
      nombre,
      grado,
      sesion: String(sesion).padStart(2, "0"),
      score,
      correctas: correctas ?? null,
      total: total ?? 10,
      fecha: fecha || new Date().toISOString(),
      ts: Date.now(),
    });

    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
  } catch (err) {
    console.error("submit-eval error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
