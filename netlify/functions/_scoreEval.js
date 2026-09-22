/** Calcula la nota 0–20 sin depender de red ni base de datos. */
function calcularScore(data) {
  let score = data.score;
  const totalN = (typeof data.total === "number" && data.total > 0) ? data.total : 10;
  if (typeof data.correctas === "number" && data.correctas >= 0 && data.correctas <= totalN) {
    score = Math.round((data.correctas / totalN) * 20); // fuente de verdad: aciertos
    // En diversa v2.1 cada descuento corresponde a una pregunta acertada que
    // usó lenguaje inapropiado. Nunca se descuenta por debajo de cero.
    if (data.version === "diversa-v2.1") {
      const descuento = Number.isInteger(data.descuentoConducta)
        ? Math.max(0, Math.min(data.descuentoConducta, data.correctas, totalN))
        : 0;
      score = Math.max(0, score - descuento);
    }
  } else if (score > 20) {
    score = Math.round(score / 5); // 0–100 → 0–20
  }
  return Math.max(0, Math.min(20, score));
}

module.exports = { calcularScore };
