const { issueTeacherToken, SESSION_TTL_SECONDS, authCorsHeaders } = require('./_teacherAuth');

const CORS = authCorsHeaders('POST, OPTIONS');
const response = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return response(400, { error: 'Bad JSON' });
  }

  try {
    const token = issueTeacherToken(body.password || '');
    if (!token) return response(401, { error: 'Unauthorized' });
    return response(200, { ok: true, token, expires_in: SESSION_TTL_SECONDS });
  } catch (error) {
    console.error('teacher-login error:', error.message);
    return response(error.statusCode || 503, { error: error.message });
  }
};
