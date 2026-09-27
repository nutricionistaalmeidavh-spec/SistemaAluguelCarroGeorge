export function auditStatement(db,{installationId,actorId,action,entityType,entityId=null,details={},deviceId=null,at=new Date().toISOString(),id=`AUD-${crypto.randomUUID()}`}){
  return db.prepare(`INSERT INTO audit_log
    (id, installation_id, actor_id, action, entity_type, entity_id, details_json, at, created_at, updated_at, version, updated_by_device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(id,installationId,actorId??null,action,entityType,entityId??null,JSON.stringify(details??{}),at,at,at,deviceId??null);
}
