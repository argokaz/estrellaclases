const { getStore } = require("@netlify/blobs");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };
  }

  const params = event.queryStringParameters || {};
  if (params.pw !== TEACHER_PW) {
    return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  }

  try {
    const sesion = params.session || "";
    const store = makeStore();
    const prefix = sesion ? `s${String(sesion).padStart(2,"0")}/` : "";

    const { blobs } = await store.list({ prefix });

    if (!blobs || blobs.length === 0) {
      return { statusCode: 200, headers: CORS, body: "[]" };
    }

    const results = await Promise.all(
      blobs.map(async ({ key }) => {
        const data = await store.get(key, { type: "json" }).catch(() => null);
        if (data) data._key = key;
        return data;
      })
    );

    const sorted = results
      .filter(Boolean)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(sorted),
    };
  } catch (err) {
    console.error("get-results error:", err.message);
    return { statusCode: 200, headers: CORS, body: "[]" };
  }
};
