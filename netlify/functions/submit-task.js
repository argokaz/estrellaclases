/**
 * submit-task.js — Recibir entregas de tareas de alumnos
 *
 * POST /.netlify/functions/submit-task
 * Body: { nombre, grado, sesion, drive_link, comentario? }
 *
 * Busca el alumno canónico en Supabase (ID canónico cuando está disponible;
 * fuzzy match solo como compatibilidad con envíos antiguos).
 * Si existe la entrega (alumno_id + sesion) → actualiza.
 * Si no existe → inserta.
 * Si el alumno no está en el roster → conserva la entrega sin alumno_id y la
 * marca para revisión; nunca se presenta como entrega identificada.
 */

const { supabase }  = require('./_supabase');
const { normalize, findBestPerson, titleCase } = require('./_nameUtils');

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const { nombre, grado, sesion, drive_link, comentario, alumno_id } = body;

  if (!nombre || !grado || !sesion || !drive_link) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan campos: nombre, grado, sesion, drive_link' }) };
  }
  if (!drive_link.startsWith('http')) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'drive_link debe comenzar con http' }) };
  }

  const db          = supabase();
  const nombreClean = titleCase(nombre.trim());
  const sesionPad   = String(sesion).padStart(2, '0');

  let alumnos;
  try {
    const roster = await db.from('alumnos').select('id, nombre').eq('grado', grado);
    if (roster.error) throw new Error('leer roster: ' + roster.error.message);
    alumnos = roster.data;
    if (!alumnos || !alumnos.length) throw new Error('Roster vacío para ' + grado);
  } catch (err) {
    console.error('submit-task roster error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }

  const normNombre = normalize(nombreClean);
  const byId = alumno_id ? alumnos.find(a => String(a.id) === String(alumno_id)) : null;
  if (alumno_id && !byId) {
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, identidadInvalida: true, error: 'Actualiza la lista de alumnos e inténtalo de nuevo.' }) };
  }
  if (byId && normalize(byId.nombre) !== normNombre) {
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, identidadInvalida: true, error: 'El nombre no coincide con la identidad seleccionada.' }) };
  }
  const matched = byId || findBestPerson(normNombre, alumnos, a => a.nombre); // exacto > subset > ancla

  const payload = {
    grado,
    sesion:     sesionPad,
    drive_link: drive_link.trim(),
    comentario: (comentario || '').trim(),
    nombre_raw: nombreClean,
    fecha:      new Date().toISOString(),
    ...(matched ? { alumno_id: matched.id } : {}),
  };

  try {
    // Idempotente: buscar entrega existente por alumno_id (si matchea) o, si no,
    // por (grado, sesion, nombre_raw) — así reintentar el mismo envío NUNCA
    // duplica filas. ⚠️ Verificar el error de CADA insert/update: un fallo
    // silencioso respondía ok:true y la entrega se perdía (mismo bug que evals).
    let existing = null;
    if (matched) {
      const r = await db.from('tareas').select('id')
        .eq('alumno_id', matched.id).eq('sesion', sesionPad).maybeSingle();
      if (r.error) throw new Error('lookup tarea: ' + r.error.message);
      existing = r.data;
    } else {
      const r = await db.from('tareas').select('id')
        .eq('grado', grado).eq('sesion', sesionPad).eq('nombre_raw', nombreClean).maybeSingle();
      if (r.error) throw new Error('lookup tarea sin asignar: ' + r.error.message);
      existing = r.data;
    }

    if (existing) {
      const { error: uErr } = await db.from('tareas').update({
        drive_link: payload.drive_link,
        comentario: payload.comentario,
        fecha:      payload.fecha,
        nombre_raw: payload.nombre_raw,
      }).eq('id', existing.id);
      if (uErr) throw new Error('update tarea: ' + uErr.message);
    } else {
      const { error: iErr } = await db.from('tareas').insert(payload);
      if (iErr) throw new Error('insert tarea: ' + iErr.message);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        nombre: matched ? matched.nombre : nombreClean,
        matched: !!matched,
        requiereRevision: !matched,
        mensaje: matched ? undefined : 'La entrega quedó guardada, pero falta vincularla a un alumno del roster.',
      }),
    };
  } catch (err) {
    console.error('submit-task error:', err.message);
    const missingTable = /tareas.*schema cache|relation .* does not exist/i.test(err.message || '');
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: missingTable
          ? 'El sistema de tareas aún no está activado. Avisa a la profesora.'
          : err.message,
      }),
    };
  }
};
