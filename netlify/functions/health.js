const { supabase } = require('./_supabase');

const TEACHER_PW = process.env.TEACHER_PASSWORD || 'yoshipotosucio';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };
  const params = event.queryStringParameters || {};
  if (params.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  const db = supabase();
  const started = Date.now();
  try {
    const [students, looseEvals, looseTasks, trash] = await Promise.all([
      db.from('alumnos').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      db.from('evaluaciones').select('id', { count: 'exact', head: true }).is('deleted_at', null).is('alumno_id', null),
      db.from('tareas').select('id', { count: 'exact', head: true }).is('deleted_at', null).is('alumno_id', null),
      db.from('deletion_events').select('id', { count: 'exact', head: true }).is('restored_at', null),
    ]);
    const failed = [students, looseEvals, looseTasks, trash].find(result => result.error);
    if (failed) throw failed.error;
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        checked_at: new Date().toISOString(),
        latency_ms: Date.now() - started,
        students: students.count || 0,
        unassigned_evaluations: looseEvals.count || 0,
        unassigned_tasks: looseTasks.count || 0,
        trash: trash.count || 0,
      }),
    };
  } catch (error) {
    console.error('health error:', error.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, checked_at: new Date().toISOString(), latency_ms: Date.now() - started, error: error.message }),
    };
  }
};
