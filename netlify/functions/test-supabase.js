/**
 * test-supabase.js  — TEMPORAL, borrar después de verificar
 *
 * GET /.netlify/functions/test-supabase
 *
 * Verifica que:
 *   1. Las variables SUPABASE_URL y SUPABASE_SERVICE_KEY están configuradas
 *   2. La conexión a Supabase funciona
 *   3. Las tres tablas (alumnos, evaluaciones, bonuses) existen
 */

const { createClient } = require("@supabase/supabase-js");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

exports.handler = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  // 1. Verificar variables de entorno
  if (!url || !key) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        ok: false,
        error: "Variables de entorno faltantes",
        SUPABASE_URL:         url  ? "✅ configurada" : "❌ FALTA",
        SUPABASE_SERVICE_KEY: key  ? "✅ configurada" : "❌ FALTA",
      }),
    };
  }

  const supabase = createClient(url, key);

  // 2. Verificar cada tabla
  const checks = {};
  for (const table of ["alumnos", "evaluaciones", "bonuses"]) {
    const { error, count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    checks[table] = error
      ? `❌ ${error.message}`
      : `✅ existe (${count} filas)`;
  }

  const allOk = Object.values(checks).every(v => v.startsWith("✅"));

  return {
    statusCode: allOk ? 200 : 500,
    headers: CORS,
    body: JSON.stringify({
      ok: allOk,
      supabase_url: url.replace(/^(https:\/\/\w{6}).*/, "$1…"),
      tablas: checks,
    }),
  };
};
