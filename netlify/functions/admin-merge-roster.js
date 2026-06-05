/**
 * admin-merge-roster.js  — TEMPORAL, borrar después del merge
 *
 * POST /.netlify/functions/admin-merge-roster
 * Body: { pw, grado }
 *
 * Para el grado dado:
 *   1. Lee todos los alumnos con conteo de evaluaciones
 *   2. Por cada nombre canónico, encuentra TODOS los registros que
 *      hacen fuzzy-match (incluyendo el recién insertado exacto)
 *   3. Elige el "ganador" = el que tiene más evaluaciones (o cualquiera si empatan)
 *   4. Transfiere evals/bonuses de duplicados al ganador (evitando conflictos UNIQUE)
 *   5. Renombra el ganador al nombre canónico
 *   6. Elimina los registros vaciados
 */

const { createClient } = require("@supabase/supabase-js");

const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ── Roster canónico completo ──────────────────────────────────────────────────
const CANONICAL = {
  prim6: [
    "Bastian Adriano Aliaga Llamccaya",
    "Joaquin Leonardo Arquiñego Arango",
    "Samira Ayelen Calle Sierra",
    "Matias Jesus Carbonell Pacheco",
    "Ian Sebastian Imer Chavez Rojas",
    "Wollff Alejandro Concha Quiroz",
    "Mateo Valentino Cordova Calle",
    "Camila Crousillat Raffo",
    "Aldahir Antonio Huerta Quispe",
    "Evhan Sthefano Lopez Ortiz",
    "Gianluca Frank Paulino Inga",
    "Luana Gabriela Ramos Ore",
    "Liam Valentino Ramos Santos",
    "Liam Aaron Reyes Carranza",
    "Darenka Alessia Rios Palomino",
    "Taiz Alejandra Spigno Basurto",
  ],
  sec2: [
    "Breixo Daichi Berrios Santos",
    "Jordan Rodrigo Bujaico Garcia",
    "Almudena Milagros Caycho Mendoza",
    "Maria Angela Quilla Curi Mayhuire",
    "Jesus Adrian Flores Mamani",
    "Zoe Akari Jorge Jorge",
    "Alejandra Katalella Loza Rojas",
    "Miley Aileen Nahui Saavedra",
    "Sebastian Otori Valderrama",
    "Joshua Emanuel Panta De Las Casas",
    "Tatiana Gabriela Rivas Comitivo",
    "Sofia Alexandra Rojas Chuco",
    "Maximo Lionel Isaac Saavedra Napan",
    "Joe Valentino Salcedo Palomino",
    "Naomi Ysamar Siesquen Castaneda",
    "Julio Angelo Torres Sanchez",
    "Fabianna Zoe Aliaga Llamccaya",
    "Gonzalo Antonio Anco Malca",
    "Amy Anahi Alexia Barreto Rojas",
    "Sayuri Dariana Bastidas Salinas",
    "Dana Marycielo Chafloque Chuco",
    "Rodrigo Andree Cieza Zanabria",
    "Valentino Aldair Lopez Pajuelo",
    "Astridth Minelly Montano Ramos",
    "Verioska Valery Perez Calle",
    "Gael Adriano Ramos Ore",
    "Victoria Guadalupe Rojas Ocanto",
    "James Johann Santa Cruz Holguin",
    "Camila Antuanet Soto Huamani",
    "Luciana Mayte Soto Huamani",
    "Jasmin Fatima Torrejon Sanchez",
  ],
  sec3: [
    "Paris Eneas Arteaga Montoya",
    "Valery Aileen Calderon Sanchez",
    "Veronica Carbonell Pacheco",
    "Valery Adriana Corra Cecinario",
    "Jhariel Cuadros Suasnabar",
    "Fabricio Davalos Mancilla",
    "Drake Andy Durand Valera",
    "Charlene Flores Matorel",
    "Fernanda Katigza Infanzon Acevedo",
    "Angel Javier Llontop Patnoll",
    "Brayan Alexander Machaca Chico",
    "Keila Angeli Mallqui Mamani",
    "Jade Marrie Meza Cayetano",
    "Luciana Valentina Quinto Rojas",
    "Ayllin Mikella Rios Palomino",
    "Sebastian Omar Rojas Caceres",
    "Amy Cristina Santaria Llamocca",
    "Haziel Jeremy Spigno Basurto",
    "Genesis Belen Sulca Chancan",
    "Lian Yamir Tiza Centeno",
  ],
  sec4: [
    "Leonardo Fabian Hildegarde Abanto Chumpitaz",
    "Richard Elmo Chavez Solis",
    "Joaquin Eduardo Chumpitaz Alvarez",
    "Luis Adrian Horna Bujaico",
    "Sebastian Ederson Jara Quispe",
    "Aixa Thayss Jorge Jorge",
    "Angel Adriel Leon Carranza",
    "Yusumy Del Rocio Llican Flores",
    "Esteban Enrique Martinez Salazar",
    "Fatima Isabella Mostajo Raffo",
    "Ariana Olortegui Bellido",
    "Nathaniel Darlen Poma Flores",
    "Alexander Matias Ramos Apcho",
    "Fabrisio Nicolas Romani Ramos",
    "Favianny Isabel Silva Hernandez",
    "Valentina Suyai Tiza Centeno",
    "Jana Samara Torrejon Sanchez",
    "Darry William Velasquez Congona",
  ],
  sec5: [
    "Maria Fernanda Aldonate Rivas",
    "Victor Andres Arquinego Arango",
    "Madison Nicol Ccoicca Mayta",
    "Elias Abraham Chafloque Chuco",
    "Pedro Fidel Huamanciza Miranda",
    "Aaron Ernesto Lenche Perez",
    "Carlos Lerma Casapaico",
    "Gabriel Estefano Mostajo Raffo",
    "Fabrizio Mijail Serna Herencia",
    "Enid Abril Vasquez Donaires",
    "Daniel Aaron Vicencio Chino",
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const { createClient: _cc } = require("@supabase/supabase-js");
let _db = null;
function db() {
  if (!_db) _db = _cc(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _db;
}

function norm(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Devuelve true si los tokens del nombre corto son subset del nombre largo
function isFuzzyMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const tokensA = na.split(" ");
  const tokensB = nb.split(" ");
  // Todos los tokens del más corto deben estar en el más largo
  const shorter = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const longer  = tokensA.length <= tokensB.length ? tokensB : tokensA;
  const matchCount = shorter.filter(t => longer.includes(t)).length;
  // Necesita al menos 60% de coincidencia Y al menos 2 tokens (apellidos)
  return matchCount >= 2 && matchCount / shorter.length >= 0.6;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: '{"error":"Method not allowed"}' };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  if (body.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };

  const grado = body.grado;
  if (!grado || !CANONICAL[grado]) {
    return { statusCode: 400, headers: CORS, body: '{"error":"grado inválido"}' };
  }

  const canonical = CANONICAL[grado];
  const d = db();
  const log = [];
  let merged = 0, renamed = 0, deleted = 0, unchanged = 0;

  try {
    // 1. Obtener todos los alumnos del grado con sus evaluaciones
    const { data: alumnos, error: fetchErr } = await d
      .from("alumnos")
      .select("id, nombre, evaluaciones(id, sesion, score), bonuses(id)")
      .eq("grado", grado)
      .order("nombre");

    if (fetchErr) throw fetchErr;

    const alumnosMap = new Map(); // id → alumno obj
    for (const a of (alumnos || [])) {
      a.evalCount  = (a.evaluaciones || []).length;
      a.bonusCount = (a.bonuses || []).length;
      alumnosMap.set(a.id, a);
    }

    // IDs ya procesados (para no reusar el mismo en dos canónicos)
    const usedIds = new Set();

    // 2. Para cada nombre canónico, encontrar todos los registros que hacen match
    for (const canonicalName of canonical) {
      const matches = [...alumnosMap.values()].filter(a =>
        !usedIds.has(a.id) && isFuzzyMatch(canonicalName, a.nombre)
      );

      if (matches.length === 0) {
        log.push(`⚠ Sin match: "${canonicalName}"`);
        continue;
      }

      if (matches.length === 1) {
        const m = matches[0];
        usedIds.add(m.id);
        if (norm(m.nombre) === norm(canonicalName)) {
          log.push(`✓ OK: "${m.nombre}"`);
          unchanged++;
        } else {
          // Solo renombrar
          await d.from("alumnos").update({ nombre: canonicalName }).eq("id", m.id);
          log.push(`✏ Renombrado: "${m.nombre}" → "${canonicalName}"`);
          renamed++;
        }
        continue;
      }

      // Múltiples matches → elegir ganador (más evals), transferir y eliminar resto
      matches.sort((a, b) => b.evalCount - a.evalCount);
      const winner = matches[0];
      usedIds.add(winner.id);

      for (const dup of matches.slice(1)) {
        usedIds.add(dup.id);
        // Transferir evaluaciones (evitar conflictos UNIQUE alumno_id+sesion)
        const dupSesiones  = new Set((dup.evaluaciones || []).map(e => e.sesion));
        const winSesiones  = new Set((winner.evaluaciones || []).map(e => e.sesion));

        for (const sesion of dupSesiones) {
          if (winSesiones.has(sesion)) {
            // Ganador ya tiene esta sesión → borrar la del duplicado
            await d.from("evaluaciones").delete()
              .eq("alumno_id", dup.id).eq("sesion", sesion);
          } else {
            // Mover al ganador
            await d.from("evaluaciones").update({ alumno_id: winner.id })
              .eq("alumno_id", dup.id).eq("sesion", sesion);
            winner.evalCount++;
            winSesiones.add(sesion);
          }
        }

        // Transferir bonuses
        if (dup.bonusCount > 0) {
          await d.from("bonuses").update({ alumno_id: winner.id }).eq("alumno_id", dup.id);
        }

        // Eliminar duplicado
        await d.from("alumnos").delete().eq("id", dup.id);
        log.push(`🗑 Eliminado duplicado: "${dup.nombre}" (${dup.evalCount} evals transferidas al ganador)`);
        deleted++;
        merged += dup.evalCount;
      }

      // Renombrar ganador al nombre canónico
      if (norm(winner.nombre) !== norm(canonicalName)) {
        await d.from("alumnos").update({ nombre: canonicalName }).eq("id", winner.id);
        log.push(`✏ Renombrado: "${winner.nombre}" → "${canonicalName}" (${winner.evalCount} evals)`);
        renamed++;
      } else {
        log.push(`✓ OK: "${winner.nombre}" (${winner.evalCount} evals, ${matches.length - 1} duplicados eliminados)`);
        unchanged++;
      }
    }

    // 3. Reportar registros huérfanos (no matchearon ningún canónico)
    const orphans = [...alumnosMap.values()].filter(a => !usedIds.has(a.id));
    for (const o of orphans) {
      log.push(`👻 Huérfano (no está en lista canónica): "${o.nombre}" (${o.evalCount} evals) — NO eliminado`);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true, grado,
        stats: { renamed, deleted, merged, unchanged, orphans: orphans.length },
        log,
      }),
    };
  } catch (err) {
    console.error("admin-merge error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message, log }) };
  }
};
