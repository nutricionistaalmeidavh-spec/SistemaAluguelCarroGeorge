import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSnapshotRestore,createBackupEnvelope,restoreBackupEnvelope} from '../src/domain/backup.mjs';
import {exchangeSnapshots,mergeSnapshots} from '../src/domain/sync.mjs';
const old={version:4,updatedAt:'2020-01-01T00:00:00Z',customers:[{id:'C1',name:'Backup',updatedAt:'2020-01-01T00:00:00Z'}]};
const current={version:4,updatedAt:'2026-09-27T00:00:00Z',customers:[{id:'C1',name:'Atual'},{id:'C2',name:'Remover na restauração'}]};
test('restored backup survives sync with same or stale revision and stale peers cannot resurrect removed data',async()=>{
 const decoded=await restoreBackupEnvelope(await createBackupEnvelope(old));
 const restored=prepareSnapshotRestore(decoded,current,{id:'restore-a'});
 for(const baseRevision of [4,5]){
  const result=exchangeSnapshots({serverRevision:5,baseRevision,serverSnapshot:current,clientSnapshot:restored});
  assert.equal(result.action,'push');assert.deepEqual(result.snapshot.customers,old.customers);
  const stale=exchangeSnapshots({serverRevision:6,baseRevision:5,serverSnapshot:result.snapshot,clientSnapshot:{...current,updatedAt:'2099-01-01T00:00:00Z'}});
  assert.equal(stale.action,'pull');assert.deepEqual(stale.snapshot.customers,old.customers);
 }
 assert.deepEqual(mergeSnapshots(current,restored).customers,old.customers);
 assert.deepEqual(mergeSnapshots(restored,current).customers,old.customers);
 assert.equal(old.restorePoint,undefined);
 const again=prepareSnapshotRestore(old,restored,{id:'restore-b'});
 assert.equal(again.restorePoint.generation,2);
});
test('normal edits within the same restore generation still merge',()=>{
 const restored=prepareSnapshotRestore(old,current,{id:'shared'});
 const edited={...restored,customers:[{id:'C1',name:'Editado',updatedAt:'2030-01-01T00:00:00Z'}]};
 assert.equal(mergeSnapshots(restored,edited).customers[0].name,'Editado');
});
