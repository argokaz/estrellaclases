/**
 * get-tasks.js — Ver entregas de tareas (solo profesora)
 *
 * GET /.netlify/functions/get-tasks?pw=...&session=05&grado=prim6
 *
 * Devuelve:
 *   { submitted: [{alumno_id, nombre_raw, grado, drive_link, comentario, fecha}],
 *     unassigned: [{...}],                 ← guardadas, pero sin alumno confirmado
 *     pending:   [nombre, ...],          ← del roster que NO entregó
 *     total_roster: N }
 *
 * grado es opcional; sin él devuelve todos los grados.
 */

const { supabase } = require('./_supabase');

const TEACHER_PW = process.env.TEACHER_PASSWORD || 'yoshipotosucio';

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const { pw, session, grado } = event.queryStringParameters || {};
  if (pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  if (!session)          return { statusCode: 400, headers: CORS, body: '{"error":"session requerida"}' };

  const sesionPad = String(session).padStart(2, '0');
  const db        = supabase();

  let rosterQ = db.from('alumnos').select('id, nombre, grado').is('deleted_at', null).order('nombre');
  if (grado) rosterQ = rosterQ.eq('grado', grado);

  let tasksQ = db.from('tareas')
    .select('id, alumno_id, nombre_raw, grado, drive_link, comentario, fecha')
    .eq('sesion', sesionPad)
    .is('deleted_at', null)
    .order('fecha', { ascending: false });
  if (grado) tasksQ = tasksQ.eq('grado', grado);

  const [{ data: roster, error: rErr }, { data: tasks, error: tErr }] = await Promise.all([rosterQ, tasksQ]);
  if (rErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: rErr.message }) };
  if (tErr) {
    const missingTable = /tareas.*schema cache|relation .* does not exist/i.test(tErr.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: missingTable
          ? "Falta crear la tabla 'tareas' en Supabase — ejecutar el SQL de tareas.md (sección Backend) en el SQL Editor."
          : tErr.message,
      }),
    };
  }

  const submittedIds = new Set((tasks || []).filter(t => t.alumno_id).map(t => t.alumno_id));
  const unassigned = (tasks || []).filter(t => !t.alumno_id).map(t => ({
    ...t,
    requiereRevision: true,
  }));
  const pending = (roster || [])
    .filter(a => !submittedIds.has(a.id))
    .map(a => ({ nombre: a.nombre, grado: a.grado }));

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok:           true,
      grado:        grado || 'all',
      sesion:       sesionPad,
      submitted:    tasks || [],
      unassigned,
      pending,
      total_roster: (roster || []).length,
    }),
  };
};
