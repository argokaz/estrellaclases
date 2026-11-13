-- Banco de preguntas del test vocacional (proyecto final de 5.°, nov 2026).
-- Cada propuesta de un alumno es una fila: nada se sobrescribe, queda el autor
-- y la profesora la marca como aprobada o descartada. Las aprobadas son las que
-- usa la app. Aplicar una sola vez, antes de publicar banco-preguntas.js.

CREATE TABLE IF NOT EXISTS public.banco_preguntas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto text NOT NULL DEFAULT 'app-vocacional-5to',
  grado text NOT NULL,
  alumno_id uuid REFERENCES public.alumnos(id) ON DELETE SET NULL,
  autor_raw text NOT NULL,
  pregunta text NOT NULL CHECK (char_length(pregunta) BETWEEN 8 AND 140),
  -- [{e: emoji, x: texto de la respuesta, a: área}] × 4, áreas distintas
  opciones jsonb NOT NULL CHECK (jsonb_typeof(opciones) = 'array' AND jsonb_array_length(opciones) = 4),
  areas text[] NOT NULL,
  estado text NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta', 'aprobada', 'descartada')),
  nota_profesora text NOT NULL DEFAULT '',
  creado timestamptz NOT NULL DEFAULT now(),
  revisado timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS banco_preguntas_proyecto_idx
  ON public.banco_preguntas (proyecto, estado, creado)
  WHERE deleted_at IS NULL;

ALTER TABLE public.banco_preguntas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banco_preguntas FROM anon, authenticated;
GRANT ALL ON TABLE public.banco_preguntas TO service_role;
