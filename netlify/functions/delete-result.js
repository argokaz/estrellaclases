const { getStore } = require("@netlify/blobs");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

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

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' };
  }

  const { pw, key } = body;
  if (pw !== TEACHER_PW) {
    return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  }
  if (!key) {
    return { statusCode: 400, headers: CORS, body: '{"error":"key required"}' };
  }

  try {
    const store = makeStore();
    await store.delete(key);
    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
  } catch (err) {
    console.error("delete-result error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
