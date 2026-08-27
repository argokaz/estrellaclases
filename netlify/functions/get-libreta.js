/**
 * get-libreta.js
 *
 * GET /.netlify/functions/get-libreta (Authorization: Bearer …)
 *
 * La libreta completa del año en una sola llamada: todos los alumnos de las
 * seis aulas, con su nota de cada sesión, su promedio, sus puntos de
 * participación y cuántas tareas entregó. De aquí sale el Excel que la
 * profesora descarga desde la consola.
 *
 * Agrega en el servidor a propósito: el dashboard solo dibuja las hojas, así
 * que el criterio de "qué cuenta como nota" vive en un solo sitio.
 */

const { supabase } = require("./_supabase");

const { requireTeacher } = require("./_teacherAuth");
const EXCLUDED_NAMES = new Set(["estrella vizcarra"]);   // la profesora como test user
const PENALIZACION   = 2;   // puntos que se descuentan del promedio por práctica no rendida

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

/**
 * Supabase corta en 1000 filas por defecto. Las evaluaciones ya rondan ese
 * número y seguirán creciendo toda la segunda mitad del año, así que se pide
 * por páginas: si algún día se corta, la libreta quedaría incompleta sin avisar.
 */
async function traerTodo(db, tabla, columnas) {
  const PAGINA = 1000;
  let desde = 0, filas = [];
  for (;;) {
    const { data, error } = await db.from(tabla).select(columnas)
      .is("deleted_at", null)
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(tabla + ": " + error.message);
    filas = filas.concat(data || []);
    if (!data || data.length < PAGINA) return filas;
    desde += PAGINA;
  }
}

const redondea = n => Math.round(n * 10) / 10;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  const auth = requireTeacher(event);
  if (!auth.ok) return { statusCode: auth.statusCode, headers: CORS, body: JSON.stringify({ error: auth.error }) };

  try {
    const db = supabase();

    // Si falla tareas, la libreta debe fallar completa: una libreta parcial es
    // más peligrosa que un error visible porque puede registrar faltantes falsos.
    const [alumnos, evals, bonuses, tareas] = await Promise.all([
      traerTodo(db, "alumnos",      "id, nombre, grado"),
      traerTodo(db, "evaluaciones", "alumno_id, grado, sesion, score, correctas, total, fecha, nombre_raw"),
      traerTodo(db, "bonuses",      "alumno_id, puntos, mes"),
      traerTodo(db, "tareas",       "alumno_id, sesion, grado, fecha"),
    ]);

    const porAlumno = new Map();
    const excluidos = new Set();   // la profesora puede existir como usuaria de prueba
    for (const a of alumnos) {
      if (EXCLUDED_NAMES.has((a.nombre || "").toLowerCase())) { excluidos.add(a.id); continue; }
      porAlumno.set(a.id, {
        nombre: a.nombre, grado: a.grado,
        notas: {}, puntos: 0, tareas: 0,
      });
    }

    const sinAsignar = [];   // evaluaciones que nunca se ligaron a un alumno del roster
    const tareasSinAsignar = (tareas || [])
      .filter(t => !t.alumno_id)
      .map(t => ({
        nombre: t.nombre_raw || "—",
        grado: t.grado || "—",
        sesion: t.sesion,
        fecha: t.fecha,
      }));
    const detalle    = [];

    for (const ev of evals) {
      if (ev.alumno_id && excluidos.has(ev.alumno_id)) continue;   // pruebas de la profesora
      const a = ev.alumno_id ? porAlumno.get(ev.alumno_id) : null;
      if (!a) {
        // Sin alumno_id (o de un alumno borrado): no se pierde, se reporta aparte
        if (!EXCLUDED_NAMES.has((ev.nombre_raw || "").trim().toLowerCase())) {
          sinAsignar.push({
            nombre: ev.nombre_raw || "—", grado: ev.grado || "—",
            sesion: ev.sesion, score: ev.score, fecha: ev.fecha,
          });
        }
        continue;
      }
      // Un alumno puede tener un solo registro por sesión, pero si hubiera dos
      // se queda el mejor: es la misma regla que aplica submit-eval al guardar.
      const previa = a.notas[ev.sesion];
      if (previa == null || ev.score > previa.score) {
        a.notas[ev.sesion] = {
          score:     ev.score,
          correctas: ev.correctas,
          total:     ev.total ?? 10,
          fecha:     ev.fecha,
        };
      }
      detalle.push({
        nombre: a.nombre, grado: a.grado, sesion: ev.sesion,
        score: ev.score, correctas: ev.correctas, total: ev.total ?? 10, fecha: ev.fecha,
      });
    }

    for (const b of bonuses) {
      const a = porAlumno.get(b.alumno_id);
      if (a) a.puntos += Number(b.puntos) || 0;
    }
    for (const t of tareas) {
      const a = porAlumno.get(t.alumno_id);
      if (a) a.tareas += 1;
    }

    // Agrupar por aula, con los alumnos que nunca rindieron incluidos:
    // la libreta también sirve para ver quién falta.
    const aulas = {};
    for (const [, a] of porAlumno) {
      const sesiones = Object.keys(a.notas).sort();
      const suma     = sesiones.reduce((s, k) => s + a.notas[k].score, 0);
      (aulas[a.grado] = aulas[a.grado] || []).push({
        nombre:    a.nombre,
        notas:     a.notas,
        rendidas:  sesiones.length,
        promedio:  sesiones.length ? redondea(suma / sesiones.length) : null,
        puntos:    redondea(a.puntos),
        tareas:    a.tareas,
      });
    }
    /**
     * Castigo por práctica no rendida: −2 puntos del promedio por cada una.
     * "Práctica del salón" = sesión en la que ALGÚN compañero rindió; así una
     * clase que nunca tuvo evaluación no penaliza a nadie, y el que faltó a la
     * evaluación de una clase que sí se tomó carga con su descuento.
     */
    for (const g of Object.keys(aulas)) {
      aulas[g].sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));

      const practicas = [...new Set(aulas[g].flatMap(a => Object.keys(a.notas)))].sort();
      for (const a of aulas[g]) {
        a.practicas  = practicas.length;
        a.faltantes  = practicas.filter(s => !a.notas[s]).length;
        a.descuento  = a.faltantes * PENALIZACION;
        // Sin ninguna práctica rendida no hay promedio del que descontar: la
        // nota es 0, no un vacío — faltar a todas no puede quedar mejor que
        // rendir mal. Si el salón todavía no tuvo evaluaciones, no hay nota.
        a.promedioFinal = a.rendidas
          ? Math.max(0, redondea(a.promedio - a.descuento))
          : (practicas.length ? 0 : null);
      }
    }

    const sesiones = [...new Set(evals.map(e => e.sesion))].sort();
    detalle.sort((a, b) => a.grado.localeCompare(b.grado) || a.sesion.localeCompare(b.sesion) || a.nombre.localeCompare(b.nombre, "es"));

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        ok: true,
        generado: new Date().toISOString(),
        penalizacion: PENALIZACION,
        sesiones,
        aulas,
        detalle,
        sinAsignar,
        tareasSinAsignar,
        totales: {
          alumnos:      porAlumno.size,
          evaluaciones: detalle.length,
          tareasSinAsignar: tareasSinAsignar.length,
        },
      }),
    };
  } catch (err) {
    console.error("get-libreta error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
