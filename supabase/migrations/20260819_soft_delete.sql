-- Papelera recuperable para Escuela Estrella.
-- Aplicar antes de desplegar las funciones que dependen de deleted_at.

CREATE TABLE IF NOT EXISTS public.deletion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('alumno', 'evaluacion', 'tarea', 'bonus')),
  entity_id uuid NOT NULL,
  label text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);
ALTER TABLE public.deletion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deletion_events FROM anon, authenticated;
GRANT ALL ON TABLE public.deletion_events TO service_role;

ALTER TABLE public.alumnos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_id uuid REFERENCES public.deletion_events(id) ON DELETE SET NULL;
ALTER TABLE public.evaluaciones
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_id uuid REFERENCES public.deletion_events(id) ON DELETE SET NULL;
ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_id uuid REFERENCES public.deletion_events(id) ON DELETE SET NULL;
ALTER TABLE public.bonuses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_id uuid REFERENCES public.deletion_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS alumnos_activos_grado_idx
  ON public.alumnos (grado, nombre) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS evaluaciones_activas_alumno_idx
  ON public.evaluaciones (alumno_id, sesion) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tareas_activas_alumno_idx
  ON public.tareas (alumno_id, sesion) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deletion_events_pendientes_idx
  ON public.deletion_events (deleted_at DESC) WHERE restored_at IS NULL;

DROP INDEX IF EXISTS public.evaluaciones_alumno_sesion_uidx;
CREATE UNIQUE INDEX evaluaciones_alumno_sesion_uidx
  ON public.evaluaciones (alumno_id, sesion)
  WHERE alumno_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_alumno_id_sesion_key;
DROP INDEX IF EXISTS public.tareas_alumno_id_sesion_key;
CREATE UNIQUE INDEX tareas_alumno_id_sesion_uidx
  ON public.tareas (alumno_id, sesion)
  WHERE alumno_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.soft_delete_school_record(
  p_entity_type text,
  p_entity_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
  v_label text;
  v_grade text;
  v_session text;
  v_eval_count integer := 0;
  v_task_count integer := 0;
  v_bonus_count integer := 0;
BEGIN
  IF p_entity_type = 'evaluacion' THEN
    SELECT COALESCE(a.nombre, e.nombre_raw, 'Evaluación'), e.grado, e.sesion
      INTO v_label, v_grade, v_session
      FROM public.evaluaciones e
      LEFT JOIN public.alumnos a ON a.id = e.alumno_id
      WHERE e.id = p_entity_id AND e.deleted_at IS NULL
      FOR UPDATE OF e;
    IF NOT FOUND THEN RAISE EXCEPTION 'Evaluación no encontrada o ya archivada'; END IF;

    INSERT INTO public.deletion_events(id, entity_type, entity_id, label, details)
      VALUES (v_event_id, p_entity_type, p_entity_id, v_label,
        jsonb_build_object('grado', v_grade, 'sesion', v_session));
    UPDATE public.evaluaciones SET deleted_at = now(), deletion_id = v_event_id
      WHERE id = p_entity_id AND deleted_at IS NULL;

  ELSIF p_entity_type = 'tarea' THEN
    SELECT COALESCE(a.nombre, t.nombre_raw, 'Tarea'), t.grado, t.sesion
      INTO v_label, v_grade, v_session
      FROM public.tareas t
      LEFT JOIN public.alumnos a ON a.id = t.alumno_id
      WHERE t.id = p_entity_id AND t.deleted_at IS NULL
      FOR UPDATE OF t;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarea no encontrada o ya archivada'; END IF;

    INSERT INTO public.deletion_events(id, entity_type, entity_id, label, details)
      VALUES (v_event_id, p_entity_type, p_entity_id, v_label,
        jsonb_build_object('grado', v_grade, 'sesion', v_session));
    UPDATE public.tareas SET deleted_at = now(), deletion_id = v_event_id
      WHERE id = p_entity_id AND deleted_at IS NULL;

  ELSIF p_entity_type = 'bonus' THEN
    SELECT COALESCE(a.nombre, 'Participación'), b.grado
      INTO v_label, v_grade
      FROM public.bonuses b
      LEFT JOIN public.alumnos a ON a.id = b.alumno_id
      WHERE b.id = p_entity_id AND b.deleted_at IS NULL
      FOR UPDATE OF b;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bonus no encontrado o ya archivado'; END IF;

    INSERT INTO public.deletion_events(id, entity_type, entity_id, label, details)
      VALUES (v_event_id, p_entity_type, p_entity_id, v_label,
        jsonb_build_object('grado', v_grade));
    UPDATE public.bonuses SET deleted_at = now(), deletion_id = v_event_id
      WHERE id = p_entity_id AND deleted_at IS NULL;

  ELSIF p_entity_type = 'alumno' THEN
    SELECT nombre, grado INTO v_label, v_grade
      FROM public.alumnos
      WHERE id = p_entity_id AND deleted_at IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Alumno no encontrado o ya archivado'; END IF;

    SELECT count(*) INTO v_eval_count FROM public.evaluaciones
      WHERE alumno_id = p_entity_id AND deleted_at IS NULL;
    SELECT count(*) INTO v_task_count FROM public.tareas
      WHERE alumno_id = p_entity_id AND deleted_at IS NULL;
    SELECT count(*) INTO v_bonus_count FROM public.bonuses
      WHERE alumno_id = p_entity_id AND deleted_at IS NULL;

    INSERT INTO public.deletion_events(id, entity_type, entity_id, label, details)
      VALUES (v_event_id, p_entity_type, p_entity_id, v_label,
        jsonb_build_object('grado', v_grade, 'evaluaciones', v_eval_count,
          'tareas', v_task_count, 'bonuses', v_bonus_count));

    UPDATE public.evaluaciones SET deleted_at = now(), deletion_id = v_event_id
      WHERE alumno_id = p_entity_id AND deleted_at IS NULL;
    UPDATE public.tareas SET deleted_at = now(), deletion_id = v_event_id
      WHERE alumno_id = p_entity_id AND deleted_at IS NULL;
    UPDATE public.bonuses SET deleted_at = now(), deletion_id = v_event_id
      WHERE alumno_id = p_entity_id AND deleted_at IS NULL;
    UPDATE public.alumnos SET deleted_at = now(), deletion_id = v_event_id
      WHERE id = p_entity_id AND deleted_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Tipo de registro no permitido';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deletion_id', v_event_id,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'label', v_label,
    'details', jsonb_build_object('grado', v_grade, 'sesion', v_session,
      'evaluaciones', v_eval_count, 'tareas', v_task_count, 'bonuses', v_bonus_count)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_school_deletion(
  p_deletion_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.deletion_events%ROWTYPE;
  v_alumnos integer := 0;
  v_evaluaciones integer := 0;
  v_tareas integer := 0;
  v_bonuses integer := 0;
BEGIN
  SELECT * INTO v_event FROM public.deletion_events
    WHERE id = p_deletion_id AND restored_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elemento no encontrado en la papelera o ya restaurado'; END IF;

  UPDATE public.alumnos SET deleted_at = NULL, deletion_id = NULL
    WHERE deletion_id = p_deletion_id;
  GET DIAGNOSTICS v_alumnos = ROW_COUNT;
  UPDATE public.evaluaciones SET deleted_at = NULL, deletion_id = NULL
    WHERE deletion_id = p_deletion_id;
  GET DIAGNOSTICS v_evaluaciones = ROW_COUNT;
  UPDATE public.tareas SET deleted_at = NULL, deletion_id = NULL
    WHERE deletion_id = p_deletion_id;
  GET DIAGNOSTICS v_tareas = ROW_COUNT;
  UPDATE public.bonuses SET deleted_at = NULL, deletion_id = NULL
    WHERE deletion_id = p_deletion_id;
  GET DIAGNOSTICS v_bonuses = ROW_COUNT;

  UPDATE public.deletion_events SET restored_at = now() WHERE id = p_deletion_id;
  RETURN jsonb_build_object('ok', true, 'deletion_id', p_deletion_id,
    'label', v_event.label, 'alumnos', v_alumnos,
    'evaluaciones', v_evaluaciones, 'tareas', v_tareas, 'bonuses', v_bonuses);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'No se puede restaurar porque ya existe un registro activo para esa sesión';
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_school_record(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_school_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_school_record(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_school_deletion(uuid) TO service_role;
