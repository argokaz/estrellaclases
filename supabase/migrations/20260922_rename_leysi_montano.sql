-- Corrige el nombre canónico sin crear otra alumna ni mover su historial.
-- Las variantes anteriores se conservan para reconocer entregas pendientes.
UPDATE public.alumnos
SET nombre = 'Leysi Montano',
    variantes = ARRAY(
      SELECT DISTINCT variante
      FROM unnest(
        coalesce(variantes, ARRAY[]::text[])
        || ARRAY[
          'Leysi Montaño Ramos',
          'Leysi Montaño',
          'Leisy Mabel Montano Ramos'
        ]::text[]
      ) AS variante
      WHERE variante <> 'Leysi Montano'
    )
WHERE id = 'c2d7f2b6-384f-4162-96cb-1c11332ec021'
  AND deleted_at IS NULL;
