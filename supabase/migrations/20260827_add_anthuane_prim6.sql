-- Incorpora a Anthuane Tejada Franco a 6.° de primaria y registra 16/20
-- únicamente en las prácticas históricas que realmente rindió el salón.
-- Idempotente: volver a ejecutarla no duplica al alumno ni sus evaluaciones.

BEGIN;

DO $$
DECLARE
  v_alumno_id uuid;
BEGIN
  SELECT id
    INTO v_alumno_id
    FROM public.alumnos
   WHERE lower(regexp_replace(trim(nombre), '\s+', ' ', 'g')) =
         lower('Anthuane Tejada Franco')
   ORDER BY (deleted_at IS NULL) DESC, created_at
   LIMIT 1;

  IF v_alumno_id IS NULL THEN
    INSERT INTO public.alumnos (nombre, grado, variantes)
    VALUES ('Anthuane Tejada Franco', 'prim6', ARRAY[]::text[])
    RETURNING id INTO v_alumno_id;
  ELSE
    UPDATE public.alumnos
       SET nombre = 'Anthuane Tejada Franco',
           grado = 'prim6',
           deleted_at = NULL,
           deletion_id = NULL,
           updated_at = now()
     WHERE id = v_alumno_id;
  END IF;

  INSERT INTO public.evaluaciones (
    alumno_id, grado, sesion, score, correctas, total, fecha, nombre_raw
  )
  SELECT
    v_alumno_id,
    'prim6',
    historial.sesion,
    16,
    8,
    10,
    historial.fecha::timestamptz,
    'Anthuane Tejada Franco'
  FROM (VALUES
    ('02', '2026-05-22T12:00:00-05:00'),
    ('03', '2026-05-29T12:00:00-05:00'),
    ('05', '2026-06-12T12:00:00-05:00'),
    ('06', '2026-06-19T12:00:00-05:00'),
    ('07', '2026-06-26T12:00:00-05:00'),
    ('09', '2026-07-10T12:00:00-05:00'),
    ('11', '2026-08-07T12:00:00-05:00'),
    ('12', '2026-08-14T12:00:00-05:00'),
    ('13', '2026-08-21T12:00:00-05:00')
  ) AS historial(sesion, fecha)
  ON CONFLICT (alumno_id, sesion)
    WHERE alumno_id IS NOT NULL AND deleted_at IS NULL
  DO UPDATE SET
    grado = EXCLUDED.grado,
    score = EXCLUDED.score,
    correctas = EXCLUDED.correctas,
    total = EXCLUDED.total,
    fecha = EXCLUDED.fecha,
    nombre_raw = EXCLUDED.nombre_raw;
END $$;

COMMIT;

-- Control esperado: una fila, 9 evaluaciones, promedio 16 y sesiones
-- 02,03,05,06,07,09,11,12,13.
SELECT
  a.id,
  a.nombre,
  a.grado,
  count(e.id) AS evaluaciones,
  round(avg(e.score), 2) AS promedio,
  string_agg(e.sesion, ',' ORDER BY e.sesion) AS sesiones
FROM public.alumnos a
LEFT JOIN public.evaluaciones e
  ON e.alumno_id = a.id AND e.deleted_at IS NULL
WHERE a.nombre = 'Anthuane Tejada Franco'
  AND a.deleted_at IS NULL
GROUP BY a.id, a.nombre, a.grado;
