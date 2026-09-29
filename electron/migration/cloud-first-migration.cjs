'use strict';

const MIGRATION_TABLES=Object.freeze([
  'customers','vehicles','rentals','rental_payments','expenses','inspections','inspection_items','maintenance',
  'audit_log','alert_state','app_settings','ledger','contract_templates','issued_contracts','billing_plans',
  'billing_installments','billing_payments','billing_payment_conflicts','collection_actions'
]);
const BUSINESS_TABLES=Object.freeze([
  'customers','vehicles','rentals','rental_payments','expenses','inspections','inspection_items','maintenance',
  'ledger','contract_templates','issued_contracts','billing_plans','billing_installments','billing_payments',
  'billing_payment_conflicts','collection_actions','attachments'
]);

const rows=(dataset,table)=>Array.isArray(dataset?.[table])?dataset[table]:[];
function activeRows(dataset,table){return rows(dataset,table).filter(row=>!row?.deleted_at);}
function businessRowCount(dataset){return BUSINESS_TABLES.reduce((sum,table)=>sum+activeRows(dataset,table).length,0);}

function assessCloudFirstMigration({localDataset={},cloudSnapshot={},replicaState={}}={}){
  const localRows=businessRowCount(localDataset),cloudRows=businessRowCount(cloudSnapshot);
  if(replicaState?.initialized)return{mode:'ready',localRows,cloudRows};
  if(localRows===0)return{mode:'new-device',localRows,cloudRows};
  if(cloudRows===0)return{mode:'seed-cloud',localRows,cloudRows};
  return{mode:'blocked',localRows,cloudRows,reason:'both_datasets_populated'};
}

function normalizeRow(row,{installationId,actorId,table}){
  const next={...row,installation_id:String(installationId)};
  if(table==='rentals'&&next.attendant_id)next.attendant_id=String(actorId);
  if(table==='audit_log'&&next.actor_id)next.actor_id=String(actorId);
  if(table==='collection_actions'&&next.actor_id)next.actor_id=String(actorId);
  return next;
}

function prepareMigrationTables(localDataset,{installationId,actorId}={}){
  if(!installationId)throw new TypeError('installation_id_required');
  if(!actorId)throw new TypeError('actor_id_required');
  const result={};
  for(const table of MIGRATION_TABLES)result[table]=rows(localDataset,table).map(row=>normalizeRow(row,{installationId,actorId,table}));
  return result;
}

function localAttachmentIds(localDataset){return activeRows(localDataset,'attachments').map(row=>String(row.id)).filter(Boolean);}

module.exports={MIGRATION_TABLES,BUSINESS_TABLES,businessRowCount,assessCloudFirstMigration,prepareMigrationTables,localAttachmentIds};
