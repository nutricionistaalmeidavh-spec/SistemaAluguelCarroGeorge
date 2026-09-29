import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { writeCloudBackup } from '../backup/r2-backup.mjs';

const PATH=`${API_PREFIX}/migration/import`;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const MAX_JSON_BYTES=8_000_000,MAX_ROWS=10_000;
const MIGRATION_TABLES=Object.freeze([
  'customers','vehicles','rentals','rental_payments','expenses','inspections','inspection_items','maintenance',
  'audit_log','alert_state','app_settings','ledger','contract_templates','issued_contracts','billing_plans',
  'billing_installments','billing_payments','billing_payment_conflicts','collection_actions'
]);
const BUSINESS_TABLES=Object.freeze([
  'customers','vehicles','rentals','rental_payments','expenses','inspections','inspection_items','maintenance','ledger',
  'contract_templates','issued_contracts','billing_plans','billing_installments','billing_payments','billing_payment_conflicts','collection_actions','attachments'
]);
const COLUMN=/^[a-z_][a-z0-9_]*$/i;

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:HEADERS});}
function fail(code,status=400){const error=new Error(code);error.code=code;error.status=status;throw error;}
async function readJson(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))fail('content_type',415);
  const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_JSON_BYTES)fail('payload_too_large',413);
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES)fail('payload_too_large',413);
  try{return JSON.parse(text||'{}');}catch{fail('invalid_json');}
}
async function businessRows(db,installationId){
  let total=0;
  for(const table of BUSINESS_TABLES){const row=await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE installation_id=? AND deleted_at IS NULL`).bind(installationId).first();total+=Number(row?.total)||0;}
  return total;
}
function normalizeRow(table,row,auth){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('migration_row_invalid');
  const next={...row,installation_id:auth.installationId};
  for(const key of Object.keys(next))if(!COLUMN.test(key))fail('migration_column_invalid');
  if(table==='rentals'&&next.attendant_id)next.attendant_id=auth.userId;
  if(table==='audit_log'&&next.actor_id)next.actor_id=auth.userId;
  if(table==='collection_actions'&&next.actor_id)next.actor_id=auth.userId;
  return next;
}
function insertStatement(db,table,row){
  const columns=Object.keys(row);if(!columns.length)fail('migration_row_invalid');
  const names=columns.map(name=>`"${name}"`).join(','),marks=columns.map(()=>'?').join(','),values=columns.map(name=>row[name]);
  if(table==='app_settings')return db.prepare(`INSERT INTO app_settings (${names}) VALUES (${marks}) ON CONFLICT(installation_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at,version=excluded.version,updated_by_device=excluded.updated_by_device`).bind(...values);
  return db.prepare(`INSERT OR IGNORE INTO ${table} (${names}) VALUES (${marks})`).bind(...values);
}

export function isMigrationRoute(request){return new URL(request.url).pathname===PATH;}
export async function handleMigrationRoute(request,env,_ctx,{auth=null}={}){
  if(!auth)return json({ok:false,error:'unauthorized'},401);
  if(!canCloud(auth,'*'))return json({ok:false,error:'forbidden'},403);
  if(request.method.toUpperCase()!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  if(!env?.DB?.prepare||typeof env.DB.batch!=='function'||!env?.ATTACHMENTS?.put)return json({ok:false,error:'migration_bindings_unavailable'},503);
  try{
    const input=await readJson(request),tables=input?.tables&&typeof input.tables==='object'&&!Array.isArray(input.tables)?input.tables:{};
    for(const name of Object.keys(tables))if(!MIGRATION_TABLES.includes(name))fail('migration_table_not_allowed');
    let rowCount=0;for(const name of MIGRATION_TABLES){if(tables[name]!=null&&!Array.isArray(tables[name]))fail('migration_rows_invalid');rowCount+=(tables[name]?.length??0);}if(rowCount>MAX_ROWS)fail('migration_too_many_rows',413);
    if(await businessRows(env.DB,auth.installationId)>0)fail('migration_cloud_not_empty',409);

    const backup=await writeCloudBackup(env,auth.installationId),now=new Date().toISOString(),current=await env.DB.prepare('SELECT restore_generation FROM installations WHERE id=? AND deleted_at IS NULL LIMIT 1').bind(auth.installationId).first();
    if(!current)fail('installation_not_found',404);
    const nextGeneration=(Number(current.restore_generation)||0)+1,statements=[];
    for(const table of MIGRATION_TABLES)for(const raw of tables[table]??[])statements.push(insertStatement(env.DB,table,normalizeRow(table,raw,auth)));
    statements.push(env.DB.prepare('DELETE FROM sync_changes WHERE installation_id=?').bind(auth.installationId));
    statements.push(env.DB.prepare('DELETE FROM sync_cursors WHERE installation_id=?').bind(auth.installationId));
    statements.push(env.DB.prepare('UPDATE installations SET restore_generation=?,updated_at=?,version=version+1,updated_by_device=? WHERE id=? AND deleted_at IS NULL').bind(nextGeneration,now,auth.deviceId??null,auth.installationId));
    statements.push(env.DB.prepare(`INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version,updated_by_device,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,NULL)`).bind(`AUD-${crypto.randomUUID()}`,auth.installationId,auth.userId,'migration.cloud.seed','installation',auth.installationId,JSON.stringify({backupId:backup.id,importedRows:rowCount,restoreGeneration:nextGeneration}),now,now,now,auth.deviceId??null));
    await env.DB.batch(statements);
    return json({ok:true,backupId:backup.id,restoreGeneration:nextGeneration,cursor:0,importedRows:rowCount},201);
  }catch(error){return json({ok:false,error:error?.code??error?.message??'migration_failed'},Number(error?.status)||500);}
}

export const migrationTables=MIGRATION_TABLES;
