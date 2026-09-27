'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runReplicaCycle}=require('../../electron/replica/cycle.cjs');

test('catch-up grande percorre todas as páginas antes de persistir cursor final',async()=>{
  const total=725,pageSize=80,seen=[];let next=1;
  const api={async changes(cursor){assert.equal(cursor,next-1);const end=Math.min(total,next+pageSize-1),changes=[];for(let sequence=next;sequence<=end;sequence++)changes.push({sequence});next=end+1;return{restoreGeneration:9,changes,cursor:end,hasMore:end<total};}};
  const local={async applyChanges(changes){seen.push(...changes.map(x=>x.sequence));}};
  const state=await runReplicaCycle({state:{initialized:true,cursor:0,restoreGeneration:9},api,local});
  assert.equal(seen.length,total);
  assert.equal(seen[0],1);
  assert.equal(seen.at(-1),total);
  assert.equal(new Set(seen).size,total);
  assert.equal(state.cursor,total);
});
