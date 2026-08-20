#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.QA_PORT || 8819);
const students = [
  { id: '11111111-1111-4111-8111-111111111111', nombre: 'Ana Prueba' },
  { id: '22222222-2222-4222-8222-222222222222', nombre: 'Bruno Prueba' },
  { id: '33333333-3333-4333-8333-333333333333', nombre: 'Carla Prueba' },
];
const state = { mode: 'ok', requests: [], saved: [] };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (error) { reject(error); } });
  });
}

function serveFile(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = decodeURIComponent(requestUrl.pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(file);
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (ext === '.html' && /^tarea-\d+-/.test(path.basename(file)) && requestUrl.searchParams.get('quota') === '1') {
    const html = fs.readFileSync(file, 'utf8').replace('<head>', `<head><script>
      Storage.prototype.setItem = function () { throw new DOMException('QA quota', 'QuotaExceededError'); };
    </script>`);
    res.end(html);
    return;
  }
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/.netlify/functions/get-roster') {
    return json(res, 200, { found: true, grado: url.searchParams.get('grado'), alumnos: students });
  }
  if (url.pathname === '/.netlify/functions/submit-task' && req.method === 'POST') {
    const payload = await body(req).catch(() => null);
    if (!payload) return json(res, 400, { error: 'Bad JSON' });
    state.requests.push(payload);
    if (state.mode === 'offline') return json(res, 503, { error: 'QA offline' });
    if (state.mode === 'stale') return json(res, 409, { identidadInvalida: true, error: 'QA identidad desactualizada' });
    const student = students.find(item => item.id === payload.alumno_id && item.nombre === payload.nombre);
    if (!student) return json(res, 409, { identidadInvalida: true, error: 'Elige tu nombre de la lista' });
    const key = `${payload.alumno_id}|${payload.sesion}`;
    const previous = state.saved.findIndex(item => item.key === key);
    const record = { key, payload };
    if (previous >= 0) state.saved[previous] = record; else state.saved.push(record);
    return json(res, 200, { ok: true, matched: true, nombre: student.nombre });
  }
  if (url.pathname === '/__qa/state') return json(res, 200, state);
  if (url.pathname === '/__qa/mode') {
    state.mode = url.searchParams.get('value') || 'ok';
    if (url.searchParams.get('reset') === '1') { state.requests = []; state.saved = []; }
    return json(res, 200, state);
  }
  serveFile(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`QA data safety server: http://127.0.0.1:${PORT}`);
});
