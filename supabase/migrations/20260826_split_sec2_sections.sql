-- Separa 2.° de secundaria en A y B sin duplicar alumnos ni perder historial.
-- Idempotente: puede volver a ejecutarse si la primera corrida se interrumpe.

BEGIN;

CREATE TEMP TABLE sec2_section_map (
  alumno_id uuid PRIMARY KEY,
  new_grade text NOT NULL CHECK (new_grade IN ('sec2a', 'sec2b'))
) ON COMMIT DROP;

INSERT INTO sec2_section_map (alumno_id, new_grade) VALUES
  ('4d2d92d2-9f44-429b-971c-df0ddef08fc7', 'sec2a'), -- Breixo Daichi Berrios Santos
  ('59bbe0d4-6393-404c-bab8-49e49da28217', 'sec2a'), -- Jordan Rodrigo Bujaico Garcia
  ('d835b61d-b2ec-4deb-a567-c90d13a2be41', 'sec2a'), -- Almudena Milagros Caycho Mendoza
  ('01bfa9da-30f0-4d84-8900-fdc01290820a', 'sec2a'), -- Maria Angela Quilla Curi Mayhuire
  ('45b8689a-8525-4e0a-9d9b-1110a8903f0a', 'sec2a'), -- Jesus Adrian Flores Mamani
  ('0ae4a4c3-3ab8-4f15-858d-89c44b001795', 'sec2a'), -- Zoe Akari Jorge Jorge
  ('50a5ef27-0cf6-4dc8-8c5f-02e27567a77b', 'sec2a'), -- Alejandra Katalella Loza Rojas
  ('88575894-a77c-43a0-b0af-c78b0d380f11', 'sec2a'), -- Miley Aileen Nahui Saavedra
  ('648df16f-47be-491f-91fe-cb8a56cbc3f5', 'sec2a'), -- Joshua Emanuel Panta de las Casas
  ('b5675143-499b-4609-a06c-9fbba8da88bd', 'sec2a'), -- Tatiana Gabriela Rivas Comitivo
  ('ab4fa74e-1075-4b1e-82ef-c706a1f59d9a', 'sec2a'), -- Sofia Alexandra Rojas Chuco
  ('a4c1cedc-0e39-4198-81dc-db937c20472b', 'sec2a'), -- Maximo Lionel Isaac Saavedra Napan
  ('c299dfb8-29d6-4431-97e3-c880306c2008', 'sec2a'), -- Joe Valentino Salcedo Palomino
  ('6603349d-7be6-4586-9fe8-ee06d75d1fd4', 'sec2a'), -- Naomi Ysamar Siesquen Castaneda
  ('33ef094d-bc98-4517-9c19-ed16e7f55824', 'sec2a'), -- Julio Angelo Torres Sanchez
  ('c2d7f2b6-384f-4162-96cb-1c11332ec021', 'sec2a'), -- Leysi Montaño Ramos
  ('8bfd81f2-4a93-41bc-895c-6eecd272fa3d', 'sec2b'), -- Fabianna Zoe Aliaga Llamccaya
  ('a3492ac2-1e92-4692-8ff3-08289ca72de1', 'sec2b'), -- Gonzalo Antonio Anco Malca
  ('217d3265-c568-46be-b25c-b2f13d6f9de4', 'sec2b'), -- Amy Anahi Alexia Barreto Rojas
  ('695f2e3b-59ce-4ecd-9c07-5465b08a8a58', 'sec2b'), -- Sayuri Dariana Bastidas Salinas
  ('103d37f6-7382-43ee-82b3-eab4a19df131', 'sec2b'), -- Dana Marycielo Chafloque Chuco
  ('afd5d32d-a264-442b-b443-6ada2f4a007d', 'sec2b'), -- Rodrigo Andree Cieza Zanabria
  ('a9089d74-0226-433e-80f8-1e926bb9acc9', 'sec2b'), -- Valentino Aldair Lopez Pajuelo
  ('e87c8431-4ca0-4c75-a73d-870a2a06d7d7', 'sec2b'), -- Astridth Minelly Montano Ramos
  ('cb2d241c-2ade-4187-a21c-ea886c7b2e8e', 'sec2b'), -- Verioska Valery Perez Calle
  ('65aaddb2-f520-4b8f-b79a-5aca456d3891', 'sec2b'), -- Gael Adriano Ramos Ore
  ('20d01224-ee79-4c53-876a-1026a618e89f', 'sec2b'), -- Victoria Guadalupe Rojas Ocanto
  ('589f88a9-fa6b-4931-9377-a9dca64fe46c', 'sec2b'), -- James Johann Santa Cruz Holguin
  ('18e389c1-e518-4bec-8173-362f3a3a6491', 'sec2b'), -- Camila Antuanet Soto Huamani
  ('3187dc32-e67b-44bd-904c-5edd7bca45cf', 'sec2b'), -- Luciana Mayte Soto Huamani
  ('f551add0-9b74-48c5-b65d-c8cca1a1f2ed', 'sec2b'); -- Jasmin Fatima Torrejon Sanchez

DO $$
DECLARE
  found_students integer;
  unexpected_students text;
BEGIN
  SELECT count(*) INTO found_students
  FROM sec2_section_map m
  JOIN public.alumnos a ON a.id = m.alumno_id;
  IF found_students <> 31 THEN
    RAISE EXCEPTION 'Migración cancelada: se esperaban 31 alumnos y se encontraron %', found_students;
  END IF;

  IF EXISTS (
    SELECT 1 FROM sec2_section_map m
    JOIN public.alumnos a ON a.id = m.alumno_id
    WHERE a.grado NOT IN ('sec2', 'sec2a', 'sec2b')
  ) THEN
    RAISE EXCEPTION 'Migración cancelada: un alumno del mapa pertenece a otro salón';
  END IF;

  SELECT string_agg(a.nombre, ', ' ORDER BY a.nombre) INTO unexpected_students
  FROM public.alumnos a
  WHERE a.grado = 'sec2'
    AND a.deleted_at IS NULL
    AND a.id NOT IN (SELECT alumno_id FROM sec2_section_map)
    AND a.id NOT IN (
      'eef07b5a-2ddb-4869-b76e-d48d4d2a8661', -- Estrella Vizcarra (prueba)
      '7cc134fb-30ff-4bca-82a6-bbb10d408003'  -- Sebastian Otori Valderrama
    );
  IF unexpected_students IS NOT NULL THEN
    RAISE EXCEPTION 'Migración cancelada: alumnos de sec2 sin sección: %', unexpected_students;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.evaluaciones
    WHERE grado = 'sec2' AND alumno_id IS NULL AND deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.tareas
    WHERE grado = 'sec2' AND alumno_id IS NULL AND deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.bonuses
    WHERE grado = 'sec2' AND alumno_id IS NULL AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Migración cancelada: hay registros activos de sec2 sin alumno confirmado';
  END IF;
END;
$$;

-- Los registros dependientes se actualizan por alumno_id; no se recalcula ni
-- se reemplaza ninguna nota, enlace, fecha o puntaje.
UPDATE public.evaluaciones e
SET grado = m.new_grade
FROM sec2_section_map m
WHERE e.alumno_id = m.alumno_id
  AND e.grado IS DISTINCT FROM m.new_grade;

UPDATE public.tareas t
SET grado = m.new_grade
FROM sec2_section_map m
WHERE t.alumno_id = m.alumno_id
  AND t.grado IS DISTINCT FROM m.new_grade;

UPDATE public.bonuses b
SET grado = m.new_grade
FROM sec2_section_map m
WHERE b.alumno_id = m.alumno_id
  AND b.grado IS DISTINCT FROM m.new_grade;

UPDATE public.alumnos a
SET grado = m.new_grade
FROM sec2_section_map m
WHERE a.id = m.alumno_id
  AND a.grado IS DISTINCT FROM m.new_grade;

-- Reutiliza el registro existente para no perder su evaluación previa.
UPDATE public.alumnos
SET nombre = 'Leysi Montaño Ramos',
    variantes = ARRAY(
      SELECT DISTINCT variante
      FROM unnest(
        coalesce(variantes, ARRAY[]::text[])
        || ARRAY['Leisy Mabel Montano Ramos', 'Leysi Montaño']::text[]
      ) AS variante
    )
WHERE id = 'c2d7f2b6-384f-4162-96cb-1c11332ec021';

-- Sebastián no pertenece al aula. Queda en la papelera recuperable, junto con
-- cualquier registro ligado. La cuenta de prueba de la profesora se conserva.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.alumnos
    WHERE id = '7cc134fb-30ff-4bca-82a6-bbb10d408003' AND deleted_at IS NULL
  ) THEN
    PERFORM public.soft_delete_school_record('alumno', '7cc134fb-30ff-4bca-82a6-bbb10d408003');
  END IF;

END;
$$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.alumnos WHERE grado = 'sec2a' AND deleted_at IS NULL) <> 16 THEN
    RAISE EXCEPTION 'Verificación final falló: 2.° A no tiene 16 alumnos activos';
  END IF;
  IF (SELECT count(*) FROM public.alumnos WHERE grado = 'sec2b' AND deleted_at IS NULL) <> 15 THEN
    RAISE EXCEPTION 'Verificación final falló: 2.° B no tiene 15 alumnos activos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.alumnos
    WHERE grado = 'sec2' AND deleted_at IS NULL
      AND id <> 'eef07b5a-2ddb-4869-b76e-d48d4d2a8661'
  ) THEN
    RAISE EXCEPTION 'Verificación final falló: aún quedan alumnos reales activos en sec2';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sec2_section_map m
    JOIN public.evaluaciones e ON e.alumno_id = m.alumno_id
    WHERE e.grado IS DISTINCT FROM m.new_grade
  ) OR EXISTS (
    SELECT 1 FROM sec2_section_map m
    JOIN public.tareas t ON t.alumno_id = m.alumno_id
    WHERE t.grado IS DISTINCT FROM m.new_grade
  ) OR EXISTS (
    SELECT 1 FROM sec2_section_map m
    JOIN public.bonuses b ON b.alumno_id = m.alumno_id
    WHERE b.grado IS DISTINCT FROM m.new_grade
  ) THEN
    RAISE EXCEPTION 'Verificación final falló: un registro dependiente conserva el salón antiguo';
  END IF;
END;
$$;

COMMIT;
