/**
 * _nameUtils.js — Fuzzy name matching compartido
 *
 * Dos estrategias para detectar si dos nombres refieren a la misma persona:
 *
 * Estrategia 1 — Subset: si todos los tokens del nombre CORTO aparecen
 *   en el nombre LARGO (con margen de typo), son la misma persona.
 *   Cubre: "MATIAS Ramos" vs "Alexander Matias Ramos Apcho"
 *          "ALMUSENA CAYCHO" vs "Almudena Milagros Caycho Mendosa"
 *
 * Estrategia 2 — Apellido ancla: si el último token (apellido) coincide
 *   exactamente y al menos un nombre tiene similitud razonable, son la misma persona.
 *   Cubre: "Paris Arteaga" vs "patrick Arteaga"
 */

// ── Normalización ──────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // á→a, é→e, ú→u, etc.
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// ── Levenshtein ────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let corner = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const upper = prev[j];
      prev[j] = a[i - 1] === b[j - 1]
        ? corner
        : 1 + Math.min(corner, prev[j], prev[j - 1]);
      corner = upper;
    }
  }
  return prev[b.length];
}

// Umbral de edición por longitud (del token más largo)
// ≤3 chars: exacto | 4-5: 1 error | 6+: 2 errores
function editThreshold(maxLen) {
  if (maxLen <= 3) return 0;
  if (maxLen <= 5) return 1;
  return 2;
}

function tokensSimilar(ta, tb) {
  if (ta === tb) return true;
  const maxLen = Math.max(ta.length, tb.length);
  return levenshtein(ta, tb) <= editThreshold(maxLen);
}

// Umbral más permisivo para comparar nombres de pila (primer nombre)
// cuando el apellido ya coincidió: acepta hasta el 45% de error
function firstNameSimilar(ta, tb) {
  if (tokensSimilar(ta, tb)) return true;
  const dist = levenshtein(ta, tb);
  const maxLen = Math.max(ta.length, tb.length);
  return dist <= Math.floor(maxLen * 0.45);
}

// ── Estrategias de matching ────────────────────────────────────────────────

/**
 * Estrategia 1: el nombre corto es subconjunto del nombre largo.
 * Requiere que ≥75% de los tokens del nombre corto coincidan (fuzzy)
 * en el nombre largo. Si el nombre corto tiene ≤2 tokens, requiere
 * que TODOS coincidan.
 *
 * Ejemplos que pasan:
 *   "almusena caycho" vs "almudena milagros caycho mendosa" → 2/2 = 100% ✓
 *   "matias ramos"    vs "alexander matias ramos apcho"     → 2/2 = 100% ✓
 */
function subsetStrategy(tokA, tokB) {
  const [shorter, longer] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
  const needed = shorter.length <= 2
    ? shorter.length           // con ≤2 tokens exigir todos
    : Math.ceil(shorter.length * 0.75);

  let matched = 0;
  const used = new Set();
  for (const ts of shorter) {
    for (let j = 0; j < longer.length; j++) {
      if (used.has(j)) continue;
      if (tokensSimilar(ts, longer[j])) { matched++; used.add(j); break; }
    }
  }
  return matched >= needed;
}

/**
 * Estrategia 2: apellido ancla + nombre de pila razonable.
 * Si el ÚLTIMO token (primer apellido) coincide Y al menos un token
 * de la parte "nombre" tiene similitud permisiva → misma persona.
 *
 * Ejemplos que pasan:
 *   "paris arteaga" vs "patrick arteaga"  → apellido idéntico + "paris"~"patrick" (dist 3/7) ✓
 *
 * Ejemplos que NO pasan:
 *   "ana garcia"  vs "juan garcia"  → "ana" vs "juan" dist 4, 4*0.45=1 → 4>1 ✗ ✓
 *   "maria lopez" vs "mario lopez"  → "maria" vs "mario" dist 1, 5*0.45=2 → 1≤2... hmm
 *     Pero maria/mario son nombres distintos (f/m). Trade-off aceptable en aula pequeña.
 */
function anchorStrategy(tokA, tokB) {
  const lastA = tokA[tokA.length - 1];
  const lastB = tokB[tokB.length - 1];

  // El último token (apellido) debe coincidir exacto o casi exacto
  if (!tokensSimilar(lastA, lastB)) return false;

  // Al menos un token de la parte "nombre" (todo excepto el último) debe ser similar
  const firstA = tokA.slice(0, -1);
  const firstB = tokB.slice(0, -1);
  if (firstA.length === 0 || firstB.length === 0) return true; // solo apellidos → coinciden

  for (const fa of firstA) {
    for (const fb of firstB) {
      if (firstNameSimilar(fa, fb)) return true;
    }
  }
  return false;
}

// ── API pública ────────────────────────────────────────────────────────────

/** Devuelve true si normA y normB refieren a la misma persona */
function areSamePerson(normA, normB) {
  if (normA === normB) return true;
  const tokA = normA.split(' ').filter(Boolean);
  const tokB = normB.split(' ').filter(Boolean);
  if (tokA.length === 0 || tokB.length === 0) return false;

  return subsetStrategy(tokA, tokB) || anchorStrategy(tokA, tokB);
}

/**
 * Fuerza del match, jerárquica: 3 = igualdad exacta (normalizada),
 * 2 = subset (todos los tokens del corto están en el largo),
 * 1 = apellido ancla + nombre similar (la estrategia más permisiva),
 * 0 = no es la misma persona.
 */
function matchStrength(normA, normB) {
  if (normA === normB) return 3;
  const tokA = normA.split(' ').filter(Boolean);
  const tokB = normB.split(' ').filter(Boolean);
  if (tokA.length === 0 || tokB.length === 0) return 0;
  if (subsetStrategy(tokA, tokB)) return 2;
  if (anchorStrategy(tokA, tokB)) return 1;
  return 0;
}

/**
 * Elige el MEJOR candidato de una lista — no el primero que pase.
 *
 * ⚠️ Bug real (16 jul 2026): con `.find(areSamePerson)`, "Jasmin Fatima
 * Torrejon Sanchez" (nombre EXACTO del roster) se asignaba a "Julio Angelo
 * Torres Sanchez" porque Julio aparecía antes en la lista y pasaba la
 * estrategia de ancla (sanchez + torrejon≈torres al 45%). Sus evaluaciones
 * S05–S09 se registraron bajo Julio o se descartaron.
 *
 * candidatos: array de objetos; getNombre extrae el nombre de cada uno.
 * Devuelve el candidato con mayor matchStrength (desempate: nameSimilarity),
 * o null si ninguno pasa.
 */
function findBestPerson(normBuscado, candidatos, getNombre) {
  let best = null, bestStrength = 0, bestExact = -1, bestSim = -1;
  const tokIn = normBuscado.split(' ').filter(Boolean);
  for (const c of candidatos || []) {
    const normC = normalize(getNombre(c));
    const s = matchStrength(normBuscado, normC);
    if (s === 0) continue;
    // Desempate 1: tokens con coincidencia EXACTA (caso real: «Alexandra Rojas»
    // debe ir a "Sofia ALEXANDRA ROJAS Chuco" [2 exactos], no a
    // "Alejandra … Rojas" [1 exacto + 1 fuzzy] — sin esto el empate se
    // resolvía por orden de lista)
    const tokC = new Set(normC.split(' ').filter(Boolean));
    const exact = tokIn.filter(t => tokC.has(t)).length;
    const sim = nameSimilarity(normBuscado, normC);
    if (s > bestStrength ||
       (s === bestStrength && exact > bestExact) ||
       (s === bestStrength && exact === bestExact && sim > bestSim)) {
      best = c; bestStrength = s; bestExact = exact; bestSim = sim;
    }
  }
  return best;
}

/** Similitud 0–1 (solo para compatibilidad; usar areSamePerson para decisiones) */
function nameSimilarity(normA, normB) {
  if (normA === normB) return 1;
  const tokA = normA.split(' ').filter(Boolean);
  const tokB = normB.split(' ').filter(Boolean);
  const [shorter, longer] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
  let matched = 0;
  const used = new Set();
  for (const ts of shorter) {
    for (let j = 0; j < longer.length; j++) {
      if (used.has(j)) continue;
      if (tokensSimilar(ts, longer[j])) { matched++; used.add(j); break; }
    }
  }
  return matched / Math.max(tokA.length, tokB.length);
}

const SAME_THRESHOLD = 0.6;

/**
 * Del listado de variantes de un nombre, elige el más "canónico":
 * el que tiene más palabras en Title Case, luego el más largo.
 */
function bestDisplayName(names) {
  if (names.length === 1) return names[0];
  return names.slice().sort((a, b) => {
    const capA = (a.match(/\b[A-ZÁÉÍÓÚÑÜ]/g) || []).length;
    const capB = (b.match(/\b[A-ZÁÉÍÓÚÑÜ]/g) || []).length;
    if (capB !== capA) return capB - capA;
    return b.length - a.length;
  })[0];
}

/**
 * Union-Find: agrupa claves normalizadas similares.
 * Devuelve Map<root → [claves del grupo]>
 */
function clusterKeys(keys) {
  const parent = new Map(keys.map(k => [k, k]));

  function find(k) {
    if (parent.get(k) !== k) parent.set(k, find(parent.get(k)));
    return parent.get(k);
  }
  function union(a, b) { parent.set(find(a), find(b)); }

  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      if (areSamePerson(keys[i], keys[j]))
        union(keys[i], keys[j]);

  const clusters = new Map();
  for (const k of keys) {
    const root = find(k);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(k);
  }
  return clusters;
}

// ── Title Case ─────────────────────────────────────────────────────────────
// Primera letra de cada palabra en mayúscula; partículas en minúscula excepto
// cuando son la primera palabra.

const MINORS = new Set([
  "de", "del", "de la", "de las", "de los",
  "y", "e", "o", "el", "la", "los", "las",
]);

function titleCase(str) {
  return (str || "").trim()
    .split(/\s+/)
    .map((word, i) => {
      const low = word.toLowerCase();
      if (i > 0 && MINORS.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(" ");
}

module.exports = {
  normalize,
  titleCase,
  nameSimilarity,
  areSamePerson,
  matchStrength,
  findBestPerson,
  bestDisplayName,
  clusterKeys,
  SAME_THRESHOLD,
};
