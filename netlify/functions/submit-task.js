/**
 * submit-task.js — Recibir entregas de tareas de alumnos
 *
 * POST /.netlify/functions/submit-task
 * Body: { nombre, grado, sesion, drive_link, comentario? }
 *
 * Busca el alumno canónico en Supabase (fuzzy match).
 * Si existe la entrega (alumno_id + sesion) → actualiza.
 * Si no existe → inserta.
 * Si el alumno no está en el roster → inserta igual (sin alumno_id).
 */

const { supabase }  = require('./_supabase');
const { normalize, areSamePerson, titleCase } = require('./_nameUtils');

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

  const { nombre, grado, sesion, drive_link, comentario } = body;

  if (!nombre || !grado || !sesion || !drive_link) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan campos: nombre, grado, sesion, drive_link' }) };
  }
  if (!drive_link.startsWith('http')) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'drive_link debe comenzar con http' }) };
  }

  const db          = supabase();
  const nombreClean = titleCase(nombre.trim());
  const sesionPad   = String(sesion).padStart(2, '0');

  const { data: alumnos } = await db.from('alumnos').select('id, nombre').eq('grado', grado);
  const normNombre = normalize(nombreClean);
  const matched    = (alumnos || []).find(a => areSamePerson(normNombre, normalize(a.nombre)));

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
    if (matched) {
      const { data: existing } = await db
        .from('tareas')
        .select('id')
        .eq('alumno_id', matched.id)
        .eq('sesion', sesionPad)
        .maybeSingle();

      if (existing) {
        await db.from('tareas').update({
          drive_link: payload.drive_link,
          comentario: payload.comentario,
          fecha:      payload.fecha,
          nombre_raw: payload.nombre_raw,
        }).eq('id', existing.id);
      } else {
        await db.from('tareas').insert(payload);
      }
    } else {
      await db.from('tareas').insert(payload);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, nombre: nombreClean, matched: !!matched }),
    };
  } catch (err) {
    console.error('submit-task error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
