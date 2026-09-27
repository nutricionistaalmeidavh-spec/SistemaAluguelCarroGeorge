'use strict';
function clean(value){if(value==null)return null;if(value instanceof Date)return value.toISOString();return value;}
function buildOperationalDiagnostics({appVersion='unknown',schemaVersion=null,databasePath=null,attachmentsPath=null,backup={},replica={},cloudConfigured=false,cloudBackup=null,restorePending=false,outbox=null,api=null}={}){
  return Object.freeze({
    appVersion:String(appVersion),schemaVersion:schemaVersion==null?null:Number(schemaVersion),
    storage:{databasePath:clean(databasePath),attachmentsPath:clean(attachmentsPath)},
    localBackup:{valid:Boolean(backup.valid),path:backup.path??null,createdAt:backup.createdAt??null,reason:backup.valid?null:(backup.reason??null)},
    cloud:{configured:Boolean(cloudConfigured),apiReachable:api?.reachable??null,lastBackupAt:cloudBackup?.createdAt??null,lastBackupStatus:cloudBackup?.status??null},
    replica:{running:Boolean(replica.running),cursor:Number(replica.cursor)||0,restoreGeneration:Number(replica.restoreGeneration)||0,lastSuccessAt:replica.lastSuccessAt??replica.lastSyncAt??null,lastError:replica.lastError??null},
    outbox:outbox?{pending:Number(outbox.pending)||0,conflict:Number(outbox.conflict)||0,failed:Number(outbox.failed)||0}:null,
    restorePending:Boolean(restorePending)
  });
}
exports.buildOperationalDiagnostics=buildOperationalDiagnostics;
