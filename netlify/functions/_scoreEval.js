/** Calcula la nota 0–20 sin depender de red ni base de datos. */
function calcularScore(data) {
  let score = data.score;
  const totalN = (typeof data.total === "number" && data.total > 0) ? data.total : 10;
  if (typeof data.correctas === "number" && data.correctas >= 0 && data.correctas <= totalN) {
    score = Math.round((data.correctas / totalN) * 20); // fuente de verdad: aciertos
  } else if (score > 20) {
    score = Math.round(score / 5); // 0–100 → 0–20
  }
  return Math.max(0, Math.min(20, score));
}

module.exports = { calcularScore };
