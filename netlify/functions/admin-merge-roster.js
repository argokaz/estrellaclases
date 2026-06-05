const { createClient } = require("@supabase/supabase-js");
const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
let _db = null;
function db() { if (!_db) _db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); return _db; }
function norm(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim(); }
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch {}
  if (body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  const { grado, nombre } = body;
  const d = db();
  const { data: alumnos } = await d.from("alumnos").select("id, nombre, evaluaciones(id)").eq("grado", grado);
  const target = (alumnos||[]).find(a => norm(a.nombre) === norm(nombre));
  if (!target) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: `No encontrado: "${nombre}" en ${grado}` }) };
  if ((target.evaluaciones||[]).length > 0) await d.from("evaluaciones").delete().eq("alumno_id", target.id);
  await d.from("bonuses").delete().eq("alumno_id", target.id);
  await d.from("alumnos").delete().eq("id", target.id);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, deleted: target.nombre }) };
};
