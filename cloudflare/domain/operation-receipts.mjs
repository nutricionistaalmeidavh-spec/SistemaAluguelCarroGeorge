function valid(value,label){const text=String(value??'').trim();if(!text||text.length>160)throw Object.assign(new Error(`${label}_invalid`),{code:`${label}_invalid`});return text;}
export function operationIdentity(operationId){return valid(operationId,'operation_id');}
export async function findOperationReceipt(db,installationId,operationId){
  const row=await db.prepare('SELECT kind, execution_id, result_json, completed_at FROM operation_receipts WHERE installation_id = ? AND operation_id = ? LIMIT 1').bind(installationId,operationId).first();
  if(!row?.result_json)return row??null;
  try{return{...row,result:JSON.parse(row.result_json)}}catch{return row;}
}
export function beginOperationStatement(db,{installationId,operationId,kind,executionId,createdAt}){
  return db.prepare(`INSERT OR IGNORE INTO operation_receipts
    (installation_id, operation_id, kind, execution_id, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(installationId,operationId,kind,executionId,createdAt);
}
export function completeOperationStatement(db,{installationId,operationId,executionId,result,completedAt,guardSql='1=1',guardParams=[]}){
  return db.prepare(`UPDATE operation_receipts SET result_json = ?, completed_at = ?
    WHERE installation_id = ? AND operation_id = ? AND execution_id = ? AND result_json IS NULL AND (${guardSql})`)
    .bind(JSON.stringify(result),completedAt,installationId,operationId,executionId,...guardParams);
}
export async function abandonOperation(db,{installationId,operationId,executionId}){
  await db.prepare('DELETE FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ? AND result_json IS NULL').bind(installationId,operationId,executionId).run();
}
