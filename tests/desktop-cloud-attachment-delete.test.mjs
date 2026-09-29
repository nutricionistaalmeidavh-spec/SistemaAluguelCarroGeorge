import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {runReplicaCycle}=require('../electron/replica/cycle.cjs');

test('fase 6: delta de exclusão remove o blob local antes de aplicar metadata canônica',async()=>{
  const events=[];
  const api={async changes(after){assert.equal(after,10);return{
    restoreGeneration:2,cursor:11,hasMore:false,
    changes:[{sequence:11,entityType:'attachment',entityId:'ATT-CLOUD-DEL',operation:'delete',payload:{id:'ATT-CLOUD-DEL',deleted:true}}],
    tableSnapshots:{attachments:[{id:'ATT-CLOUD-DEL',installation_id:'INST-1',deleted_at:'2026-09-29T15:00:00.000Z'}]}
  };}};
  const local={
    async applyChanges(){events.push('changes');},
    async removeAttachment(id){events.push(`remove:${id}`);return true;},
    async applyTableSnapshots(){events.push('snapshots');}
  };
  const next=await runReplicaCycle({state:{initialized:true,cursor:10,restoreGeneration:2},api,local});
  assert.equal(next.cursor,11);
  assert.deepEqual(events,['changes','remove:ATT-CLOUD-DEL','snapshots']);
});
