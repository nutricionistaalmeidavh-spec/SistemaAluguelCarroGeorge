import { RESTORE_DELETE_ORDER,RESTORE_INSERT_ORDER } from './tables.mjs';
import { readVerifiedManifest } from './r2-backup.mjs';
import { sha256Text } from './logical-backup.mjs';

function insertStatement(db,table,row){
  const columns=Object.keys(row);
  if(!columns.length)return null;
  const names=columns.map(x=>`"${x.replaceAll('"','""')}"`).join(','),marks=columns.map(()=>'?').join(',');
  return db.prepare(`INSERT INTO ${table} (${names}) VALUES (${marks})`).bind(...columns.map(key=>row[key]));
}

export async function restoreCloudBackup(env,auth,backupId){
  if(!auth?.installationId||!auth?.userId)throw Object.assign(new Error('unauthorized'),{status:401});
  const {manifest}=await readVerifiedManifest(env,auth.installationId,backupId),rowsByTable=new Map();

  for(const entry of manifest.objects){
    const object=await env.ATTACHMENTS.get(entry.key);
    if(!object)throw new Error('backup_object_missing');
    const body=await object.text();
    if(await sha256Text(body)!==entry.sha256)throw new Error('backup_object_checksum');
    const chunk=JSON.parse(body);
    if(chunk.table!==entry.table||!Array.isArray(chunk.rows))throw new Error('backup_object_invalid');
    const list=rowsByTable.get(entry.table)||[];
    list.push(...chunk.rows);
    rowsByTable.set(entry.table,list);
  }

  const current=await env.DB.prepare('SELECT restore_generation FROM installations WHERE id=? AND deleted_at IS NULL LIMIT 1').bind(auth.installationId).first();
  const fromGeneration=Number(current?.restore_generation)||0,toGeneration=fromGeneration+1,restoreId=`RST-${crypto.randomUUID()}`,auditId=`AUD-${crypto.randomUUID()}`,now=new Date().toISOString(),statements=[];

  statements.push(env.DB.prepare('INSERT INTO restore_records (id,installation_id,backup_id,from_generation,to_generation,actor_id,status,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(restoreId,auth.installationId,backupId,fromGeneration,toGeneration,auth.userId,'running',now));

  // Sessões e credenciais nunca são restauradas. Elas referenciam usuários e precisam sair
  // antes da substituição do dataset para evitar FK e, principalmente, para impedir que um
  // dispositivo antigo continue autenticado depois de um restore.
  statements.push(env.DB.prepare('DELETE FROM device_credentials WHERE installation_id=?').bind(auth.installationId));
  statements.push(env.DB.prepare('DELETE FROM sessions WHERE installation_id=?').bind(auth.installationId));

  for(const table of RESTORE_DELETE_ORDER)statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE installation_id=?`).bind(auth.installationId));
  for(const table of RESTORE_INSERT_ORDER){
    for(const row of rowsByTable.get(table)||[]){
      const stmt=insertStatement(env.DB,table,row);
      if(stmt)statements.push(stmt);
    }
  }

  statements.push(env.DB.prepare('DELETE FROM sync_changes WHERE installation_id=?').bind(auth.installationId));
  statements.push(env.DB.prepare('DELETE FROM sync_cursors WHERE installation_id=?').bind(auth.installationId));
  statements.push(env.DB.prepare('UPDATE installations SET restore_generation=?,updated_at=?,version=version+1 WHERE id=?').bind(toGeneration,now,auth.installationId));
  statements.push(env.DB.prepare(`INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version,updated_by_device,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,NULL)`).bind(auditId,auth.installationId,auth.userId,'backup.restore','installation',auth.installationId,JSON.stringify({backupId,restoreId,fromGeneration,toGeneration}),now,now,now,auth.deviceId??null));
  statements.push(env.DB.prepare('UPDATE restore_records SET status=?,completed_at=? WHERE id=?').bind('complete',now,restoreId));

  await env.DB.batch(statements);
  return{restoreGeneration:toGeneration,restoreId,cursor:0};
}
