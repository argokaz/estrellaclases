/**
 * keep-alive.js
 * Scheduled function — corre lunes y jueves a las 8am UTC.
 * Propósito: mantener el proyecto Supabase (free tier) activo
 * haciendo una consulta simple. Sin esto, Supabase pausa el proyecto
 * tras 7 días de inactividad.
 *
 * Programación en netlify.toml:
 *   schedule = "0 8 * * 1,4"
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const start = Date.now();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Una lectura simple — cuenta alumnos registrados
  const { count, error } = await supabase
    .from('alumnos')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  const ms = Date.now() - start;

  if (error) {
    console.error('[keep-alive] ❌ Error al consultar Supabase:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message }),
    };
  }

  console.log(`[keep-alive] ✅ Supabase activo. Alumnos: ${count} · ${ms}ms`);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, alumnos: count, ms }),
  };
};
