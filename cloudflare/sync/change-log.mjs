function positiveLimit(value,defaultValue=100,max=200){const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1)return defaultValue;return Math.min(parsed,max);}
function nonNegative(value){const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=0?parsed:0;}
function parsePayload(value){if(value==null||value==='')return null;try{return JSON.parse(String(value));}catch{return null;}}
function publicChange(row){return row?{
  sequence:Number(row.sequence)||0,
  operationId:row.operation_id,
  installationId:row.installation_id,
  deviceId:row.device_id??null,
  entityType:row.entity_type,
  entityId:row.entity_id,
  operation:row.operation,
  baseVersion:row.base_version==null?null:Number(row.base_version),
  entityVersion:row.entity_version==null?null:Number(row.entity_version),
  payload:parsePayload(row.payload_json),
  createdAt:row.created_at
}:null;}

export function appendChangeStatement(db,{operationId,installationId,deviceId=null,entityType,entityId,operation,baseVersion=null,entityVersion=null,payload=null,createdAt=new Date().toISOString()}={}){
  if(!db?.prepare)throw new TypeError('database_unavailable');
  return db.prepare(`INSERT INTO sync_changes
    (operation_id, installation_id, device_id, entity_type, entity_id, operation, base_version, entity_version, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(String(operationId),String(installationId),deviceId==null?null:String(deviceId),String(entityType),String(entityId),String(operation),baseVersion==null?null:Number(baseVersion),entityVersion==null?null:Number(entityVersion),payload==null?null:JSON.stringify(payload),String(createdAt));
}

export async function findChangeByOperationId(db,installationId,operationId){
  if(!db?.prepare)throw new TypeError('database_unavailable');
  const row=await db.prepare(`SELECT sequence, operation_id, installation_id, device_id, entity_type, entity_id, operation, base_version, entity_version, payload_json, created_at
    FROM sync_changes WHERE installation_id = ? AND operation_id = ? LIMIT 1`).bind(String(installationId),String(operationId)).first();
  return publicChange(row);
}

export async function listChangesAfter(db,installationId,cursor=0,limit=100){
  if(!db?.prepare)throw new TypeError('database_unavailable');
  const after=nonNegative(cursor),take=positiveLimit(limit);
  const result=await db.prepare(`SELECT sequence, operation_id, installation_id, device_id, entity_type, entity_id, operation, base_version, entity_version, payload_json, created_at
    FROM sync_changes WHERE installation_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`).bind(String(installationId),after,take).all();
  return (result?.results??[]).map(publicChange);
}
