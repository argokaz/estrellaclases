/**
 * test-supabase.js — diagnóstico completo (temporal)
 *
 * GET /.netlify/functions/test-supabase
 */

const { createClient } = require("@supabase/supabase-js");
const { getStore }     = require("@netlify/blobs");

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

exports.handler = async (event) => {
  const report = {};

  // ── 1. Variables de entorno ───────────────────────────────────────────────
  const supaUrl  = process.env.SUPABASE_URL;
  const supaKey  = process.env.SUPABASE_SERVICE_KEY;
  const siteId   = process.env.SITE_ID;
  const netlTok  = process.env.NETLIFY_TOKEN;

  report.env = {
    SUPABASE_URL:         supaUrl  ? "✅" : "❌ FALTA",
    SUPABASE_SERVICE_KEY: supaKey  ? "✅" : "❌ FALTA",
    SITE_ID:              siteId   ? "✅" : "❌ FALTA (necesario para leer Blobs)",
    NETLIFY_TOKEN:        netlTok  ? "✅" : "❌ FALTA (necesario para leer Blobs)",
  };

  // ── 2. Supabase ───────────────────────────────────────────────────────────
  if (supaUrl && supaKey) {
    const db = createClient(supaUrl, supaKey);
    const checks = {};
    for (const table of ["alumnos", "evaluaciones", "bonuses"]) {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
      checks[table] = error ? `❌ ${error.message}` : `✅ ${count} filas`;
    }
    report.supabase = checks;
  } else {
    report.supabase = "❌ No se puede conectar (faltan variables)";
  }

  // ── 3. Netlify Blobs ──────────────────────────────────────────────────────
  if (siteId && netlTok) {
    try {
      const store = getStore({ name: "evaluaciones", siteID: siteId, token: netlTok });
      const { blobs } = await store.list({});
      report.blobs = {
        evaluaciones: `✅ ${(blobs || []).length} blobs encontrados`,
        muestra: (blobs || []).slice(0, 3).map(b => b.key),
      };

      // Intentar leer el primero para verificar formato
      if (blobs && blobs.length > 0) {
        const sample = await store.get(blobs[0].key, { type: "json" }).catch(e => ({ error: e.message }));
        report.blobs.ejemplo = sample;
      }
    } catch (e) {
      report.blobs = `❌ Error: ${e.message}`;
    }
  } else {
    report.blobs = "❌ SITE_ID o NETLIFY_TOKEN no configurados — los blobs no se pueden leer";
  }

  const allOk = !JSON.stringify(report).includes("❌");
  return {
    statusCode: allOk ? 200 : 500,
    headers: CORS,
    body: JSON.stringify(report, null, 2),
  };
};
