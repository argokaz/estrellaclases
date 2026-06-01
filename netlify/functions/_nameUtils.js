/**
 * _nameUtils.js — Fuzzy name matching compartido
 *
 * Maneja: mayúsculas, tildes, y typos como "gabrielaa" vs "gabriela".
 * Se importa con require('./_nameUtils') en get-ranking y get-progress.
 */

// Normaliza a minúsculas sin tildes ni caracteres especiales
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos: á→a, é→e, etc.
    .replace(/[^a-z\s]/g, '')        // solo letras y espacios
    .trim()
    .replace(/\s+/g, ' ');
}

// Distancia de Levenshtein entre dos strings
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

// Umbral de edición por longitud del token más largo
// len 1-3: exacto | len 4-5: 1 error | len 6+: 2 errores
function editThreshold(maxLen) {
  if (maxLen <= 3) return 0;
  if (maxLen <= 5) return 1;
  return 2;
}

// Dos tokens son el "mismo" con margen de typo
function tokensSimilar(ta, tb) {
  if (ta === tb) return true;
  const maxLen = Math.max(ta.length, tb.length);
  return levenshtein(ta, tb) <= editThreshold(maxLen);
}

/**
 * Similitud (0–1) entre dos nombres YA normalizados.
 * Compara token a token con fuzzy matching.
 */
function nameSimilarity(normA, normB) {
  if (normA === normB) return 1;
  const tokA = normA.split(' ').filter(Boolean);
  const tokB = normB.split(' ').filter(Boolean);
  let matched = 0;
  const usedB = new Set();
  for (const ta of tokA) {
    for (let j = 0; j < tokB.length; j++) {
      if (usedB.has(j)) continue;
      if (tokensSimilar(ta, tokB[j])) { matched++; usedB.add(j); break; }
    }
  }
  // Exigir al menos 2 tokens coincidentes (evita false positives en nombres cortos)
  if (matched < Math.min(2, Math.min(tokA.length, tokB.length))) return 0;
  return matched / Math.max(tokA.length, tokB.length);
}

const SAME_THRESHOLD = 0.6; // ≥60% de tokens coincidentes → misma persona

function areSamePerson(normA, normB) {
  return normA === normB || nameSimilarity(normA, normB) >= SAME_THRESHOLD;
}

/**
 * Del listado de variantes de un nombre, elige el mejor para mostrar.
 * Prefiere: más palabras en Title Case → más largo → el primero.
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
 * Union-Find sobre un array de claves normalizadas.
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

/**
 * Normaliza el score a escala 0–100.
 * Los repasos guardan: score (pts brutos, máx = total*2), correctas, total.
 */
function normalizeScore(ev) {
  if (ev.correctas != null && ev.total) return (ev.correctas / ev.total) * 100;
  if (ev.score     != null && ev.total) return (ev.score / (ev.total * 2)) * 100;
  return (ev.score || 0) * 10;
}

module.exports = {
  normalize,
  nameSimilarity,
  areSamePerson,
  bestDisplayName,
  clusterKeys,
  normalizeScore,
  SAME_THRESHOLD,
};
