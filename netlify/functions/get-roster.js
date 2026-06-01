/**
 * get-roster.js
 *
 * GET /.netlify/functions/get-roster?grado=sec2
 *
 * Devuelve el roster canónico del salón construido por build-roster.
 * Si el roster no existe, devuelve { found: false } para que el cliente
 * haga fallback a get-ranking.
 */

const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function makeStore(name) {
  return getStore({ name, siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const grado = (event.queryStringParameters || {}).grado;
  if (!grado) return { statusCode: 400, headers: CORS, body: '{"error":"grado required"}' };

  try {
    const store  = makeStore("rosters");
    const roster = await store.get(grado, { type: "json" }).catch(() => null);

    if (!roster || !roster.alumnos || roster.alumnos.length === 0) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ found: false }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ found: true, ...roster }),
    };
  } catch (err) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
  }
};
