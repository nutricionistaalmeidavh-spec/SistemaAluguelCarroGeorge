import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

async function load(relative){try{return await import(new URL(relative,import.meta.url));}catch(error){assert.fail(`Plano 03 ausente: ${relative}: ${error.message}`);}}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

test('PC zerado faz bootstrap e replica anexo somente após SHA-256 conferir',async()=>{
  const {runReplicaCycle}=await load('../electron/plan03/cloud-replica-agent.cjs');
  const bytes=Buffer.from('documento-george');const writes=[];let replaced=null;
  const api={
    async bootstrap(){return{restoreGeneration:3,cursor:9,snapshot:{customers:[{id:'CUS-1'}]},attachments:[{id:'ATT-1',sha256:sha(bytes)}]};},
    async attachment(){return bytes;},async changes(){throw new Error('não deveria buscar delta no bootstrap');}
  };
  const local={async replaceAll(value){replaced=value;},async putAttachment(meta,data){writes.push([meta.id,Buffer.from(data).toString()]);},async applyChanges(){}};
  const next=await runReplicaCycle({state:{initialized:false,cursor:0,restoreGeneration:0},api,local});
  assert.deepEqual(replaced,{customers:[{id:'CUS-1'}]});assert.deepEqual(writes,[['ATT-1','documento-george']]);assert.equal(next.cursor,9);assert.equal(next.restoreGeneration,3);assert.equal(next.initialized,true);
});

test('agente alcança todos os deltas mesmo após vários dias offline',async()=>{
  const {runReplicaCycle}=await load('../electron/plan03/cloud-replica-agent.cjs');let page=0;const applied=[];
  const api={async changes(cursor){page++;return page===1?{restoreGeneration:7,changes:[{sequence:11},{sequence:12}],cursor:12,hasMore:true}:{restoreGeneration:7,changes:[{sequence:13}],cursor:13,hasMore:false};}};
  const local={async applyChanges(changes){applied.push(...changes.map(x=>x.sequence));}};
  const next=await runReplicaCycle({state:{initialized:true,cursor:10,restoreGeneration:7,lastSyncAt:'2026-09-22T00:00:00.000Z'},api,local});
  assert.deepEqual(applied,[11,12,13]);assert.equal(next.cursor,13);assert.equal(page,2);
});

test('anexo R2 corrompido nunca é aceito no PC',async()=>{
  const {runReplicaCycle}=await load('../electron/plan03/cloud-replica-agent.cjs');let wrote=false;
  const api={async bootstrap(){return{restoreGeneration:1,cursor:1,snapshot:{},attachments:[{id:'A',sha256:sha('esperado')}]};},async attachment(){return Buffer.from('corrompido');}};
  const local={async replaceAll(){},async putAttachment(){wrote=true;}};
  await assert.rejects(runReplicaCycle({state:{initialized:false,cursor:0,restoreGeneration:0},api,local}),error=>error?.code==='attachment_checksum_mismatch');assert.equal(wrote,false);
});
