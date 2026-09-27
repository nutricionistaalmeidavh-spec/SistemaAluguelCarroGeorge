export function auditStatement(db,{installationId,actorId,action,entityType,entityId=null,details={},deviceId=null,at=new Date().toISOString(),id=`AUD-${crypto.randomUUID()}`,guardSql=null,guardParams=[]}){
  const columns='id, installation_id, actor_id, action, entity_type, entity_id, details_json, at, created_at, updated_at, version, updated_by_device';
  const params=[id,installationId,actorId??null,action,entityType,entityId??null,JSON.stringify(details??{}),at,at,at,deviceId??null];
  if(!guardSql){
    return db.prepare(`INSERT INTO audit_log (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).bind(...params);
  }
  return db.prepare(`INSERT INTO audit_log (${columns}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE ${guardSql}`).bind(...params,...guardParams);
}
