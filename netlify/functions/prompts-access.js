/**
 * prompts-access.js — Acceso a la biblioteca completa de prompts
 *
 * Los 36 prompts de pago viven AQUÍ, no en el HTML público: si estuvieran en
 * la página cualquiera los leería con "ver código fuente" y el aporte no
 * tendría sentido.
 *
 * POST {code}                        → {ok, CATS, PROMPTS}   valida el link mágico
 * POST {pw, action:'list'}           → {codes:[...]}          la profesora ve los emitidos
 * POST {pw, action:'create', nombre} → {code}                 emite uno nuevo
 * POST {pw, action:'revoke', code}   → {ok}                   lo anula
 */

const { getStore } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const KEY = "codes";
const PREMIUM = {
 "CATS": [
  {
   "id": "crear",
   "nom": "Crear materiales",
   "em": "📚"
  },
  {
   "id": "adaptar",
   "nom": "Adaptar contenidos",
   "em": "🔀"
  },
  {
   "id": "evaluar",
   "nom": "Evaluar y retroalimentar",
   "em": "✏️"
  },
  {
   "id": "revisar",
   "nom": "Revisar y verificar",
   "em": "🔍"
  },
  {
   "id": "tiempo",
   "nom": "Ahorrar tiempo",
   "em": "⏱️"
  },
  {
   "id": "trucos",
   "nom": "Trucos que sirven siempre",
   "em": "✨"
  }
 ],
 "PROMPTS": [
  {
   "c": "crear",
   "t": "Convertir un documento en diapositivas",
   "p": "Cuándo: ya tienes la separata y quieres proyectarla.",
   "x": "Convierte el documento adjunto en una presentación para alumnos de [GRADO].\nCrea [CANTIDAD] diapositivas.\nCada diapositiva debe tener un título, una idea principal y una sugerencia de imagen.\nUsa poco texto y conserva los datos importantes.\nNo agregues información que no aparezca en el documento."
  },
  {
   "c": "crear",
   "t": "Analogías para explicar",
   "p": "Cuándo: necesitas otra entrada al mismo concepto.",
   "x": "Crea [3] analogías sencillas para explicar [CONCEPTO] a alumnos de [GRADO].\nPara cada analogía indica:\n- Qué representa cada elemento.\n- En qué ayuda la comparación.\n- En qué punto deja de ser exacta.\nEvita analogías que puedan generar una idea equivocada."
  },
  {
   "c": "crear",
   "t": "Un caso para resolver",
   "p": "Cuándo: quieres que apliquen, no que repitan.",
   "x": "Crea un caso práctico sobre [TEMA] para alumnos de [GRADO].\nEl caso debe incluir una situación creíble del Perú de hoy, información suficiente para analizarla y [3] preguntas.\nMáximo 12 líneas. No des la respuesta dentro del caso.\nAl final, agrega una guía de respuestas solo para el profesor."
  },
  {
   "c": "crear",
   "t": "Comparar dos conceptos",
   "p": "Cuándo: los confunden entre sí una y otra vez.",
   "x": "Compara [CONCEPTO A] y [CONCEPTO B] para alumnos de [GRADO].\nPreséntalo en una tabla con: definición, características, similitudes, diferencias y un ejemplo de cada uno.\nUsa lenguaje claro y evita simplificaciones incorrectas."
  },
  {
   "c": "crear",
   "t": "Línea de tiempo",
   "p": "Cuándo: hay que ordenar hechos y fechas.",
   "x": "Usa las fuentes adjuntas para crear una línea de tiempo sobre [TEMA].\nIncluye [8] acontecimientos importantes.\nPara cada uno indica: fecha, qué ocurrió y por qué fue importante.\nOrdénalos cronológicamente y señala cualquier fecha que yo deba verificar."
  },
  {
   "c": "crear",
   "t": "Glosario de palabras nuevas",
   "p": "Cuándo: el tema trae vocabulario que no manejan.",
   "x": "Crea un glosario de [10] términos importantes sobre [TEMA] para alumnos de [GRADO].\nPara cada término: una definición sencilla, un ejemplo y una palabra relacionada.\nUsa únicamente los términos que aparecen en el material adjunto."
  },
  {
   "c": "crear",
   "t": "Actividades para el aula",
   "p": "Cuándo: te sobra media clase o quieres cortar la explicación.",
   "x": "Soy profesor de [CURSO] y trabajo el tema [TEMA] con alumnos de [GRADO].\nPropón [3] actividades que puedan hacerse en [15] minutos.\nPara cada una incluye: objetivo, materiales, instrucciones tal como se las digo, tiempo aproximado y resultado esperado.\nUsa recursos fáciles de conseguir: cuaderno, pizarra y nada más."
  },
  {
   "c": "crear",
   "t": "Ficha de trabajo",
   "p": "Cuándo: necesitas algo para imprimir o copiar a Docs.",
   "x": "Convierte este contenido en una ficha de trabajo para alumnos de [GRADO]:\n[PEGA AQUÍ EL CONTENIDO]\nIncluye: una introducción breve, instrucciones claras, [6] ejercicios y un espacio de reflexión final.\nUsa un formato que pueda copiarse fácilmente a Word o Google Docs."
  },
  {
   "c": "crear",
   "t": "La pregunta con la que abrir",
   "p": "Cuándo: quieres enganchar en el primer minuto.",
   "x": "Crea [5] preguntas breves para introducir el tema [TEMA] a alumnos de [GRADO].\nLas preguntas deben conectar el tema con cosas que ellos ya saben o han vivido.\nEvita preguntas que exijan conocer la explicación completa de antemano.\nQue den ganas de opinar, no de quedarse callados."
  },
  {
   "c": "crear",
   "t": "Plan de una clase de 45 minutos",
   "p": "Cuándo: tienes el tema pero no el orden de la hora.",
   "x": "Arma el plan de una clase de [45] minutos sobre [TEMA] para [GRADO].\nDivídela en inicio, desarrollo, práctica y cierre.\nDime cuántos minutos va cada parte, qué hago yo y qué hacen los alumnos.\nDeja tiempo para preguntas."
  },
  {
   "c": "crear",
   "t": "Debate con roles",
   "p": "Cuándo: el tema tiene más de un lado.",
   "x": "Arma un debate de aula sobre [TEMA] para [GRADO], de [20] minutos.\nDame [4] roles con su postura y 3 argumentos cada uno.\nIncluye las reglas del debate y 3 preguntas mías para cuando se traben."
  },
  {
   "c": "crear",
   "t": "Juego de repaso",
   "p": "Cuándo: última clase antes del examen.",
   "x": "Diseña un juego de repaso de [TEMA] para [GRADO], para jugar en el aula en [20] minutos.\nExplícame las reglas en 5 pasos, qué necesito y cómo se gana.\nIncluye 12 preguntas del juego con sus respuestas."
  },
  {
   "c": "adaptar",
   "t": "Tres niveles de dificultad",
   "p": "Cuándo: el aula va a ritmos distintos.",
   "x": "Crea tres versiones de esta actividad sobre [TEMA]:\n1. Una versión básica.\n2. Una versión intermedia.\n3. Una versión avanzada.\nMantén el mismo objetivo en las tres.\nIndica claramente qué cambia entre cada nivel."
  },
  {
   "c": "adaptar",
   "t": "Adaptar sin tocar el contenido",
   "p": "Cuándo: el material es correcto pero está mal calibrado.",
   "x": "Adapta este material para alumnos de [GRADO].\nNo cambies los conceptos, datos ni objetivos.\nModifica únicamente: complejidad del vocabulario, longitud de las oraciones, cantidad de ejemplos y claridad de las instrucciones.\nIndica cualquier parte que no pueda simplificarse sin perder precisión."
  },
  {
   "c": "adaptar",
   "t": "El mismo tema para otro grado",
   "p": "Cuándo: dictas lo mismo en dos salones distintos.",
   "x": "Tengo este material preparado para [GRADO A]:\n[PEGA AQUÍ TU MATERIAL]\nAdáptalo para [GRADO B]. Ajusta el vocabulario, los ejemplos y la dificultad.\nDime en una lista qué cambiaste y por qué."
  },
  {
   "c": "adaptar",
   "t": "De lectura larga a guía de estudio",
   "p": "Cuándo: tienes un PDF de 20 páginas y 45 minutos de clase.",
   "x": "Convierte este texto en una guía de estudio para [GRADO]:\n[PEGA AQUÍ EL TEXTO O SÚBELO]\nLa guía debe tener: 5 ideas principales, las palabras nuevas con su significado en una línea y 5 preguntas de repaso.\nUsa solo lo que dice el texto. No agregues información de afuera."
  },
  {
   "c": "adaptar",
   "t": "Resumen de repaso",
   "p": "Cuándo: la semana antes del examen.",
   "x": "Crea un resumen de repaso sobre [TEMA] para alumnos de [GRADO].\nDebe poder leerse en [5] minutos.\nIncluye los conceptos principales, ejemplos breves y cinco preguntas de autoevaluación.\nNo introduzcas contenido que no esté en las fuentes."
  },
  {
   "c": "adaptar",
   "t": "Reciclar una clase del año pasado",
   "p": "Cuándo: ya lo dictaste y no quieres rehacerlo.",
   "x": "Usa este material de una clase anterior y crea:\n- Una presentación breve.\n- Una ficha de repaso.\n- Cinco preguntas.\n- Una actividad de aplicación.\nMantén los mismos conceptos y objetivos.\nNo agregues información que no aparezca en el material original."
  },
  {
   "c": "evaluar",
   "t": "Preguntas a partir de una lectura",
   "p": "Cuándo: quieres evaluar exactamente lo que leyeron.",
   "x": "Usa únicamente la lectura adjunta.\nCrea [8] preguntas para alumnos de [GRADO].\nIncluye preguntas de respuesta directa, de comprensión y de análisis.\nAñade una respuesta sugerida para cada una.\nNo preguntes por información que no aparezca en el texto."
  },
  {
   "c": "evaluar",
   "t": "Alternativas falsas que sí engañan",
   "p": "El que más mejora una prueba de alternativas.",
   "x": "Para cada una de estas preguntas, crea tres alternativas incorrectas pero creíbles:\n[PEGA AQUÍ TUS PREGUNTAS]\nDeben representar errores comunes que de verdad comete un alumno de [GRADO].\nNo hagas que la respuesta correcta sea evidente por su longitud o su redacción.\nExplica brevemente por qué cada alternativa es incorrecta."
  },
  {
   "c": "evaluar",
   "t": "Examen con tres niveles",
   "p": "Cuándo: quieres que apruebe el que estudió y se exija el que va adelante.",
   "x": "Prepara una evaluación de [TEMA] para [GRADO] con 12 preguntas, en tres bloques:\n- 4 fáciles (que apruebe quien estudió lo básico)\n- 5 intermedias\n- 3 difíciles\nIndica el puntaje de cada bloque sobre 20."
  },
  {
   "c": "evaluar",
   "t": "Rúbrica para calificar",
   "p": "Cuándo: quieres calificar parejo y poder explicar la nota.",
   "x": "Crea una rúbrica para evaluar [TRABAJO, EXPOSICIÓN O PROYECTO] de alumnos de [GRADO].\nUsa [4] criterios y [4] niveles de desempeño.\nDescribe cada nivel con comportamientos observables y concretos.\nEvita criterios vagos como \"bueno\", \"regular\" o \"malo\".\nEl total debe sumar 20 puntos."
  },
  {
   "c": "evaluar",
   "t": "Preguntas de cierre",
   "p": "Cuándo: quieres saber en dos minutos si entendieron.",
   "x": "Crea [3] preguntas breves para comprobar la comprensión del tema [TEMA] en [GRADO].\nDeben poder responderse en menos de [2] minutos.\nIncluye una pregunta de concepto, una de aplicación y una de reflexión.\nAñade respuestas sugeridas."
  },
  {
   "c": "evaluar",
   "t": "Más ejercicios como este",
   "p": "Cuándo: tienes un ejercicio bueno y necesitas diez iguales.",
   "x": "Este es un ejercicio que uso con [GRADO]:\n[PEGA AQUÍ TU EJERCICIO]\nHazme [8] ejercicios parecidos, del mismo nivel, cambiando los números y las situaciones.\nPon las respuestas al final, separadas."
  },
  {
   "c": "evaluar",
   "t": "Corregir sin borrarle la voz",
   "p": "Cuándo: corriges redacción y no quieres que suene a otra persona.",
   "x": "Corrige únicamente ortografía, puntuación y errores gramaticales de este texto:\n[PEGA AQUÍ EL TEXTO DEL ALUMNO]\nMantén las ideas, el vocabulario y la manera de expresarse del alumno.\nNo mejores el contenido ni agregues información.\nDespués, enumera los principales tipos de errores que encontraste."
  },
  {
   "c": "evaluar",
   "t": "Comparar dos trabajos",
   "p": "Cuándo: dos respuestas parecidas y hay que sustentar la nota.",
   "x": "Compara estas dos respuestas usando los siguientes criterios: [CRITERIOS].\n[PEGA AQUÍ LAS DOS RESPUESTAS]\nIndica qué hace bien cada una, qué le falta a cada una, y cuál responde mejor a la consigna y por qué.\nNo evalúes aspectos que no estén en los criterios."
  },
  {
   "c": "evaluar",
   "t": "Explicarle por qué está mal",
   "p": "Cuándo: repite el error porque no entiende el porqué.",
   "x": "Un alumno de [GRADO] respondió esto en [TEMA]:\n[PEGA AQUÍ LA RESPUESTA]\nExplícale en 3 líneas por qué no es correcto, de forma que entienda el razonamiento y no solo la respuesta buena.\nSin regañarlo."
  },
  {
   "c": "evaluar",
   "t": "Dónde se equivoca todo el salón",
   "p": "Cuándo: corregiste 30 pruebas y quieres ver el patrón.",
   "x": "Estas son las respuestas equivocadas más comunes de mi salón en [TEMA]:\n[PEGA AQUÍ LOS ERRORES]\nDime qué idea están entendiendo mal por debajo de cada error.\nSugiéreme cómo volver a explicarlo para corregir eso."
  },
  {
   "c": "revisar",
   "t": "Revisar una evaluación antes de aplicarla",
   "p": "Cuándo: la prueba ya está lista y quieres una segunda opinión.",
   "x": "Revisa esta evaluación para alumnos de [GRADO]:\n[PEGA AQUÍ LA EVALUACIÓN]\nNo cambies todavía el contenido. Primero identifica:\n- Preguntas confusas.\n- Respuestas ambiguas.\n- Errores de redacción.\n- Contenido repetido.\n- Preguntas demasiado fáciles o difíciles.\n- Preguntas que no podrían responderse con el material entregado.\nPresenta primero la lista de observaciones y después una versión corregida."
  },
  {
   "c": "revisar",
   "t": "¿Se entiende mi consigna?",
   "p": "Cuándo: siempre te preguntan lo mismo al dar una tarea.",
   "x": "Analiza esta consigna desde la perspectiva de un alumno de [GRADO]:\n[PEGA AQUÍ LA CONSIGNA]\nIdentifica qué partes podrían resultar ambiguas o incompletas.\nIndica qué preguntas podría hacerse el alumno al leerla.\nDespués, dame una versión más clara sin cambiar el objetivo original."
  },
  {
   "c": "revisar",
   "t": "Instrucciones que sí se siguen",
   "p": "Cuándo: la actividad es buena pero se pierden en el camino.",
   "x": "Reescribe estas instrucciones para alumnos de [GRADO]:\n[PEGA AQUÍ LAS INSTRUCCIONES]\nOrganízalas en pasos numerados. Usa verbos de acción y oraciones breves.\nConserva todos los requisitos importantes.\nSeñala cualquier parte que todavía pueda prestarse a confusión."
  },
  {
   "c": "revisar",
   "t": "Trabaja solo con mi material",
   "p": "Para que no te mezcle cosas de internet.",
   "x": "Responde usando únicamente el documento que te adjunté.\nSi la respuesta no está ahí, dime \"no está en el documento\" en vez de completarlo por tu cuenta."
  },
  {
   "c": "tiempo",
   "t": "Mensaje para los padres",
   "p": "Cuándo: hay que avisar algo y no sabes cómo redactarlo.",
   "x": "Escribe un mensaje breve para los padres de [GRADO] sobre [ASUNTO].\nTono respetuoso y claro, sin sonar a circular de oficina.\nMáximo 6 líneas. Que quede claro qué tienen que hacer ellos y para cuándo."
  },
  {
   "c": "tiempo",
   "t": "Resumir un documento largo",
   "p": "Cuándo: te llegó algo extenso y necesitas lo que te toca.",
   "x": "Resume esto en media página:\n[PEGA AQUÍ EL TEXTO]\nDime: los 3 puntos principales, qué me toca hacer a mí y para cuándo.\nSi algo no queda claro en el texto, dímelo en vez de suponerlo."
  },
  {
   "c": "tiempo",
   "t": "Programación de la unidad",
   "p": "Cuándo: hay que entregar la planificación del bimestre.",
   "x": "Ayúdame a armar la programación de una unidad de [CURSO] para [GRADO] sobre [TEMA GENERAL].\nSon [8] sesiones de [45] minutos.\nPara cada sesión: el tema del día, qué deben lograr y una actividad.\nDime también qué evalúo y en qué sesión."
  },
  {
   "c": "trucos",
   "t": "Que marque lo que hay que revisar",
   "p": "Para no llevarte un dato inventado al aula.",
   "x": "Al final de tu respuesta, agrega una lista de los datos, fechas o cifras que yo debería verificar antes de usarlos con mis alumnos.\nSi no estás seguro de algo, dilo en vez de inventarlo."
  }
 ]
};

function res(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/** Códigos legibles al dictado: sin 0/O ni 1/I, que se confunden por WhatsApp. */
function nuevoCodigo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return "AULA-" + s;
}

async function leer(store) {
  try {
    const raw = await store.get(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return res(405, { error: "method not allowed" });

  let body;
  try { body = JSON.parse(event.body); } catch { return res(400, { error: "bad json" }); }

  const store = getStore({
    name: "prompt-codes",
    consistency: "strong",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  const esperado = process.env.TEACHER_PASSWORD || "yoshipotosucio";

  // ── Panel de la profesora ────────────────────────────────────────────────
  if (body.action) {
    if (String(body.pw || "") !== esperado) return res(401, { error: "no autorizado" });
    const codes = await leer(store);

    if (body.action === "list") return res(200, { codes });

    if (body.action === "create") {
      const nombre = String(body.nombre || "").slice(0, 60).trim();
      let code = nuevoCodigo();
      while (codes.some((c) => c.code === code)) code = nuevoCodigo();
      codes.push({ code, nombre, ts: Date.now(), usos: 0 });
      try {
        await store.set(KEY, JSON.stringify(codes.slice(-500)));
      } catch (e) {
        // Si no se guardó, decirlo: un código que la profesora manda y no existe
        // es peor que no generarlo.
        console.error("create error:", e.message);
        return res(500, { error: "no se pudo guardar el código" });
      }
      return res(200, { code, codes });
    }

    if (body.action === "revoke") {
      const restantes = codes.filter((c) => c.code !== String(body.code || ""));
      try {
        await store.set(KEY, JSON.stringify(restantes));
      } catch (e) {
        console.error("revoke error:", e.message);
        return res(500, { error: "no se pudo anular" });
      }
      return res(200, { ok: true, codes: restantes });
    }

    return res(400, { error: "acción desconocida" });
  }

  // ── Canje del link mágico ────────────────────────────────────────────────
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) return res(400, { error: "falta el código" });

  const codes = await leer(store);
  const hit = codes.find((c) => c.code === code);
  if (!hit) return res(403, { error: "Ese código no es válido o fue anulado." });

  // Contador de usos: informativo para la profesora, no bloquea.
  hit.usos = (hit.usos || 0) + 1;
  hit.ultimo = Date.now();
  try { await store.set(KEY, JSON.stringify(codes)); } catch (_) {}

  return res(200, { ok: true, nombre: hit.nombre || "", CATS: PREMIUM.CATS, PROMPTS: PREMIUM.PROMPTS });
};
