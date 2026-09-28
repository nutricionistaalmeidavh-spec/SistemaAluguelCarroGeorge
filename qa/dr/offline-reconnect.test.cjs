'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runReplicaCycle}=require('../../electron/replica/cycle.cjs');

test('PC volta após cinco dias offline e alcança todos os deltas sem pular cursor',async()=>{
  const pages=[
    {restoreGeneration:2,changes:[{sequence:101},{sequence:102}],cursor:102,hasMore:true,tableSnapshots:{customers:[{id:'C-102'}]}},
    {restoreGeneration:2,changes:[{sequence:103}],cursor:103,hasMore:true,tableSnapshots:{vehicles:[{id:'V-103'}]}},
    {restoreGeneration:2,changes:[{sequence:104},{sequence:105}],cursor:105,hasMore:false,tableSnapshots:{rentals:[{id:'R-105'}]}}
  ];
  const cursors=[],applied=[],snapshots=[];
  const api={async changes(cursor){cursors.push(cursor);return pages.shift();}};
  const local={async applyChanges(changes){applied.push(...changes.map(x=>x.sequence));},async applyTableSnapshots(value){snapshots.push(Object.keys(value)[0]);}};
  const state=await runReplicaCycle({state:{initialized:true,cursor:100,restoreGeneration:2,lastSyncAt:'2026-09-22T10:00:00.000Z'},api,local});
  assert.deepEqual(cursors,[100,102,103]);
  assert.deepEqual(applied,[101,102,103,104,105]);
  assert.deepEqual(snapshots,['customers','vehicles','rentals']);
  assert.equal(state.cursor,105);
  assert.equal(state.restoreGeneration,2);
  assert.equal(state.lastError,null);
});
