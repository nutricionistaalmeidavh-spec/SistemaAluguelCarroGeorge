'use strict';
function clean(value){if(value==null)return null;if(value instanceof Date)return value.toISOString();return value;}
function buildOperationalDiagnostics({appVersion='unknown',schemaVersion=null,databasePath=null,attachmentsPath=null,backup={},replica={},cloudConfigured=false,cloudBackup=null,restorePending=false,outbox=null,api=null}={}){
  const safeReplica={running:Boolean(replica.running),cursor:Number(replica.cursor)||0,restoreGeneration:Number(replica.restoreGeneration)||0,lastSuccessAt:replica.lastSuccessAt??replica.lastSyncAt??null,lastError:replica.lastError??null,cloudReachable:replica.cloudReachable??api?.reachable??null};
  const localBackup={valid:Boolean(backup.valid),path:backup.path??null,createdAt:backup.createdAt??null,reason:backup.valid?null:(backup.reason??null)};
  const result={
    ok:Boolean(databasePath&&localBackup.valid),appVersion:String(appVersion),schemaVersion:schemaVersion==null?null:Number(schemaVersion),
    storage:{databasePath:clean(databasePath),attachmentsPath:clean(attachmentsPath)},localBackup,
    cloud:{configured:Boolean(cloudConfigured),apiReachable:api?.reachable??safeReplica.cloudReachable,lastBackupAt:cloudBackup?.createdAt??null,lastBackupStatus:cloudBackup?.status??null},
    replica:safeReplica,outbox:outbox?{pending:Number(outbox.pending)||0,conflict:Number(outbox.conflict)||0,failed:Number(outbox.failed)||0}:null,restorePending:Boolean(restorePending),
    databasePath:clean(databasePath),attachmentsPath:clean(attachmentsPath),latestBackup:localBackup.path,backupValid:localBackup.valid,backupReason:localBackup.reason,cloudConfigured:Boolean(cloudConfigured)
  };
  return Object.freeze(result);
}
exports.buildOperationalDiagnostics=buildOperationalDiagnostics;
