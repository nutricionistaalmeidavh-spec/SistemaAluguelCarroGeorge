import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostics from '../electron/diagnostics.cjs';
const {buildOperationalDiagnostics}=diagnostics;

test('diagnóstico operacional expõe saúde sem segredos',()=>{
  const result=buildOperationalDiagnostics({appVersion:'0.7.0',schemaVersion:9,databasePath:'C:/data/locadora.sqlite',attachmentsPath:'C:/data/attachments',backup:{valid:true,path:'C:/data/backups/B1',createdAt:'2026-09-27T12:00:00Z'},replica:{running:true,cursor:501,restoreGeneration:4,lastSuccessAt:'2026-09-27T12:10:00Z'},cloudConfigured:true,cloudBackup:{status:'valid',createdAt:'2026-09-27T03:17:00Z'},outbox:{pending:2,conflict:1,failed:0},restorePending:false,token:'NUNCA-VAZA',cookie:'NUNCA-VAZA',password:'NUNCA-VAZA'});
  assert.equal(result.replica.cursor,501);assert.equal(result.replica.restoreGeneration,4);assert.equal(result.localBackup.valid,true);assert.equal(result.cloud.lastBackupStatus,'valid');
  const text=JSON.stringify(result).toLowerCase();
  for(const forbidden of ['token','cookie','password','passwordhash','sessionid','devicecredential'])assert.equal(text.includes(forbidden),false,`diagnóstico vazou campo sensível: ${forbidden}`);
});
