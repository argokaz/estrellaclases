async function softDelete(db, entityType, entityId) {
  const { data, error } = await db.rpc('soft_delete_school_record', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok !== true || !data.deletion_id) throw new Error('La papelera no confirmó el archivado');
  return data;
}

async function restoreDelete(db, deletionId) {
  const { data, error } = await db.rpc('restore_school_deletion', {
    p_deletion_id: deletionId,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok !== true) throw new Error('La papelera no confirmó la restauración');
  return data;
}

module.exports = { softDelete, restoreDelete };

