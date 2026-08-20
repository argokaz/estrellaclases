/**
 * submit-task.js — Recibir entregas de tareas de alumnos
 *
 * POST /.netlify/functions/submit-task
 * Body: { nombre, grado, sesion, drive_link, comentario? }
 *
 * Exige un alumno canónico elegido desde el roster y vuelve a verificar el ID.
 * Si existe la entrega (alumno_id + sesion) → actualiza.
 * Si no existe → inserta.
 * Si el alumno no está en el roster, rechaza la identidad para que el cliente
 * obligue a elegir de nuevo. Nunca crea una entrega anónima nueva.
 */

const { supabase }  = require('./_supabase');
const { normalize, titleCase } = require('./_nameUtils');

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
  if (!alumno_id) {
    return {
      statusCode: 409,
      headers: CORS,
      body: JSON.stringify({ ok: false, identidadInvalida: true, error: 'Elige tu nombre de la lista del salón.' }),
    };
  }

  const db          = supabase();
  const nombreClean = titleCase(nombre.trim());
  const sesionPad   = String(sesion).padStart(2, '0');

  let alumnos;
  try {
    const roster = await db.from('alumnos').select('id, nombre').eq('grado', grado).is('deleted_at', null);
    if (roster.error) throw new Error('leer roster: ' + roster.error.message);
    alumnos = roster.data;
    if (!alumnos || !alumnos.length) throw new Error('Roster vacío para ' + grado);
  } catch (err) {
    console.error('submit-task roster error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }

  const normNombre = normalize(nombreClean);
  const byId = alumnos.find(a => String(a.id) === String(alumno_id));
  if (!byId) {
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, identidadInvalida: true, error: 'Actualiza la lista de alumnos e inténtalo de nuevo.' }) };
  }
  if (byId && normalize(byId.nombre) !== normNombre) {
    return { statusCode: 409, headers: CORS, body: JSON.stringify({ ok: false, identidadInvalida: true, error: 'El nombre no coincide con la identidad seleccionada.' }) };
  }
  const matched = byId;

  const payload = {
    grado,
    sesion:     sesionPad,
    drive_link: drive_link.trim(),
    comentario: (comentario || '').trim(),
    nombre_raw: nombreClean,
    fecha:      new Date().toISOString(),
    alumno_id: matched.id,
  };

  try {
    // Idempotente: buscar la entrega activa por alumno_id + sesión. Reintentar
    // el mismo envío NUNCA duplica filas. Verificar el error de CADA insert/update: un fallo
    // silencioso respondía ok:true y la entrega se perdía (mismo bug que evals).
    const lookup = await db.from('tareas').select('id')
      .eq('alumno_id', matched.id).eq('sesion', sesionPad).is('deleted_at', null).maybeSingle();
    if (lookup.error) throw new Error('lookup tarea: ' + lookup.error.message);
    const existing = lookup.data;

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
        nombre: matched.nombre,
        matched: true,
        requiereRevision: false,
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
