const crypto = require('crypto');

const SESSION_TTL_SECONDS = 8 * 60 * 60;

function configuredPassword() {
  const password = process.env.TEACHER_PASSWORD;
  if (!password) {
    const error = new Error('TEACHER_PASSWORD no está configurada');
    error.statusCode = 503;
    throw error;
  }
  return password;
}

function signingSecret() {
  // Un secreto separado es preferible. Si todavía no existe, la contraseña
  // docente firma los tokens; al rotarla, todas las sesiones quedan invalidadas.
  return process.env.TEACHER_SESSION_SECRET || configuredPassword();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

function issueTeacherToken(password) {
  if (!safeEqual(password, configuredPassword())) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    scope: 'teacher',
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: crypto.randomBytes(12).toString('base64url'),
  }), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyTeacherToken(token) {
  if (!token || !token.includes('.')) return false;
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return parsed.scope === 'teacher' && Number(parsed.exp) > now;
  } catch (_) {
    return false;
  }
}

function bearerToken(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : '';
}

function passwordFromBody(event) {
  if (!event.body) return '';
  try {
    const parsed = JSON.parse(event.body);
    return parsed && typeof parsed.pw === 'string' ? parsed.pw : '';
  } catch (_) {
    return '';
  }
}

function requireTeacher(event, options = {}) {
  try {
    if (verifyTeacherToken(bearerToken(event))) return { ok: true };

    // Compatibilidad temporal para páginas de notas ya generadas: esas páginas
    // aún envían la contraseña únicamente en el body de un POST. Nunca aceptar
    // la contraseña por query string.
    if (options.allowBodyPassword && safeEqual(passwordFromBody(event), configuredPassword())) {
      return { ok: true, legacyBodyPassword: true };
    }
    return { ok: false, statusCode: 401, error: 'Unauthorized' };
  } catch (error) {
    return { ok: false, statusCode: error.statusCode || 503, error: error.message };
  }
}

function authCorsHeaders(methods = 'GET, POST, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

module.exports = {
  SESSION_TTL_SECONDS,
  issueTeacherToken,
  requireTeacher,
  authCorsHeaders,
};
