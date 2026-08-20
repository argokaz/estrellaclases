/**
 * delete-result.js
 *
 * POST /.netlify/functions/delete-result
 * Body: { pw, key }   — key es el UUID del registro en evaluaciones
 */

const { supabase } = require("./_supabase");
const { softDelete } = require("./_deletion");

const TEACHER_PW = process.env.TEACHER_PASSWORD;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: '{"error":"Bad JSON"}' }; }

  if (!TEACHER_PW || body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  if (!body.key)              return { statusCode: 400, headers: CORS, body: '{"error":"key required"}' };

  try {
    const deletion = await softDelete(supabase(), "evaluacion", body.key);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, deletion }) };
  } catch (err) {
    console.error("delete-result error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
