-- Aportes al tablero de la app vocacional de 5.° (nov 2026): marca, carreras,
-- sedes, ética y medición. Es un registro: cada cambio es una fila nueva con su
-- autor, nada se sobrescribe. El valor vigente de un campo es su fila más
-- reciente (vista app_vocacional_actual). Los valores estructurados (car-*,
-- sede*) son JSON en texto: en SQL se leen con valor::jsonb.
-- Las preguntas del test van aparte, en banco_preguntas.

CREATE TABLE IF NOT EXISTS public.app_vocacional_aportes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto text NOT NULL DEFAULT 'app-vocacional-5to',
  grado text NOT NULL,
  alumno_id uuid REFERENCES public.alumnos(id) ON DELETE SET NULL,
  autor_raw text NOT NULL,
  campo text NOT NULL CHECK (campo ~ '^[a-z0-9-]{1,40}$'),
  valor text NOT NULL CHECK (char_length(valor) <= 4000),
  creado timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS app_vocacional_aportes_campo_idx
  ON public.app_vocacional_aportes (proyecto, campo, creado DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.app_vocacional_aportes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_vocacional_aportes FROM anon, authenticated;
GRANT ALL ON TABLE public.app_vocacional_aportes TO service_role;

CREATE OR REPLACE VIEW public.app_vocacional_actual WITH (security_invoker = true) AS
  SELECT DISTINCT ON (proyecto, campo)
    proyecto, campo, valor, alumno_id, autor_raw, creado
  FROM public.app_vocacional_aportes
  WHERE deleted_at IS NULL
  ORDER BY proyecto, campo, creado DESC;
REVOKE ALL ON public.app_vocacional_actual FROM anon, authenticated;
GRANT SELECT ON public.app_vocacional_actual TO service_role;

-- Lo que el salón ya había escrito en el tablero el 13/11 entre 8:35 y 8:38,
-- antes de que se pidiera el nombre (no se sabe quién lo escribió).
INSERT INTO public.app_vocacional_aportes (grado, autor_raw, campo, valor, creado)
SELECT 'sec5', 'Salón (antes de pedir nombre)', v.campo, v.valor, v.creado
FROM (VALUES
  ('marca-nombre',  'VocaTest',               timestamptz '2026-11-13 08:35:32-05'),
  ('marca-eslogan', 'Tu camino, tu decisión', timestamptz '2026-11-13 08:37:42-05'),
  ('marca-color',   '#ff3d7f',                timestamptz '2026-11-13 08:37:56-05'),
  ('marca-emoji',   '🎓',                     timestamptz '2026-11-13 08:38:04-05')
) AS v(campo, valor, creado)
WHERE NOT EXISTS (SELECT 1 FROM public.app_vocacional_aportes WHERE autor_raw = 'Salón (antes de pedir nombre)');
