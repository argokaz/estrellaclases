const { supabase } = require('./_supabase');
const { restoreDelete } = require('./_deletion');

const { requireTeacher } = require('./_teacherAuth');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const response = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const auth = requireTeacher(event, { allowBodyPassword: event.httpMethod === 'POST' });
  if (!auth.ok) return response(auth.statusCode, { error: auth.error });
  const db = supabase();

  try {
    if (event.httpMethod === 'GET') {
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

