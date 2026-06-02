/**
 * delete-result.js
 *
 * POST /.netlify/functions/delete-result
 * Body: { pw, key }   — key es el UUID del registro en evaluaciones
 */

const { supabase } = require("./_supabase");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

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

  if (body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  if (!body.key)              return { statusCode: 400, headers: CORS, body: '{"error":"key required"}' };

  try {
    const { error } = await supabase()
      .from("evaluaciones")
      .delete()
      .eq("id", body.key);

    if (error) throw error;
    return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
  } catch (err) {
    console.error("delete-result error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
