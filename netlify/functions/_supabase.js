/**
 * _supabase.js — cliente singleton compartido entre todas las funciones
 */
const { createClient } = require("@supabase/supabase-js");

let _client = null;

function supabase() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _client;
}

module.exports = { supabase };
