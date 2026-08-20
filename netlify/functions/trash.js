const { supabase } = require('./_supabase');
const { restoreDelete } = require('./_deletion');

const TEACHER_PW = process.env.TEACHER_PASSWORD || 'yoshipotosucio';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const response = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const db = supabase();

  try {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      if (params.pw !== TEACHER_PW) return response(401, { error: 'Unauthorized' });
      const { data, error } = await db.from('deletion_events')
        .select('id, entity_type, entity_id, label, details, deleted_at')
        .is('restored_at', null)
        .order('deleted_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return response(200, { ok: true, items: data || [] });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Bad JSON' }); }
      if (body.pw !== TEACHER_PW) return response(401, { error: 'Unauthorized' });
      if (body.action !== 'restore' || !body.deletion_id) return response(400, { error: 'restore y deletion_id son requeridos' });
      const restored = await restoreDelete(db, body.deletion_id);
      return response(200, restored);
    }

    return response(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('trash error:', error.message);
    return response(500, { error: error.message });
  }
};

