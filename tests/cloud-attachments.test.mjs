import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { FakeR2 } from './helpers/fake-r2.mjs';
import { putAttachment, getAttachment, deleteAttachment } from '../cloudflare/storage/r2-attachments.mjs';
import { findOrphanObjects } from '../cloudflare/jobs/orphan-attachments.mjs';

function setup(){
  const db=new FakeD1(),ids=seedOperationFixture(db),bucket=new FakeR2();
  const auth={installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-R2',role:'admin',active:true};
  return{db,bucket,env:{DB:db,ATTACHMENTS:bucket},auth,...ids};
}
const bytes=new TextEncoder().encode('fake-image-binary');

test('upload gera chave R2 isolada por instalação e registra delta para as réplicas',async()=>{
  const ctx=setup();try{
    const meta=await putAttachment(ctx.env,ctx.auth,{id:'ATT-1',entityType:'inspection',entityId:'INSP-1',mimeType:'image/jpeg',originalName:'../../segredo.exe'},bytes);
    assert.equal(meta.objectKey,`installations/${ctx.installationId}/inspection/INSP-1/ATT-1.jpg`);
    assert.equal(ctx.bucket.putCalls.length,1);
    assert.equal(ctx.bucket.putCalls[0].key,meta.objectKey);
    assert.match(meta.sha256,/^[0-9a-f]{64}$/);
    const row=ctx.db.sqlite.prepare('SELECT object_key, storage_backend, sha256, mime_type, size_bytes, local_path FROM attachments WHERE installation_id=? AND id=?').get(ctx.installationId,'ATT-1');
    assert.equal(row.object_key,meta.objectKey);assert.equal(row.storage_backend,'r2');assert.equal(row.sha256,meta.sha256);assert.equal(row.mime_type,'image/jpeg');assert.equal(row.size_bytes,bytes.byteLength);assert.equal(row.local_path,'');
    const change=ctx.db.sqlite.prepare('SELECT entity_type, entity_id, operation, payload_json FROM sync_changes WHERE installation_id=? AND entity_id=? ORDER BY sequence DESC LIMIT 1').get(ctx.installationId,'ATT-1');
    assert.equal(change.entity_type,'attachment');assert.equal(change.entity_id,'ATT-1');assert.equal(change.operation,'create');
    const payload=JSON.parse(change.payload_json);assert.equal(payload.id,'ATT-1');assert.equal(payload.sha256,meta.sha256);assert.equal(payload.entityType,'inspection');
  }finally{ctx.db.close();}
});

test('mime e tamanho inválidos falham antes de tocar no R2',async()=>{
  const ctx=setup();try{
    await assert.rejects(()=>putAttachment(ctx.env,ctx.auth,{id:'ATT-X',entityType:'inspection',entityId:'INSP-1',mimeType:'application/x-msdownload'},bytes),error=>error?.code==='attachment_mime_not_allowed');
    await assert.rejects(()=>putAttachment(ctx.env,ctx.auth,{id:'ATT-Y',entityType:'inspection',entityId:'INSP-1',mimeType:'image/png',sizeBytes:9_000_000},bytes),error=>error?.code==='attachment_too_large');
    assert.equal(ctx.bucket.putCalls.length,0);
  }finally{ctx.db.close();}
});

test('download é privado e uma instalação nunca lê objeto da outra',async()=>{
  const ctx=setup();try{
    await putAttachment(ctx.env,ctx.auth,{id:'ATT-PRIVATE',entityType:'inspection',entityId:'INSP-2',mimeType:'image/webp'},bytes);
    const own=await getAttachment(ctx.env,ctx.auth,'ATT-PRIVATE');assert.equal(own.metadata.id,'ATT-PRIVATE');assert.equal((await own.object.arrayBuffer()).byteLength,bytes.byteLength);
    await assert.rejects(()=>getAttachment(ctx.env,{...ctx.auth,installationId:'INST-OTHER'},'ATT-PRIVATE'),error=>error?.code==='attachment_not_found');
  }finally{ctx.db.close();}
});

test('falha ao gravar metadata compensa removendo o objeto R2',async()=>{
  const ctx=setup();try{
    const original=ctx.db.prepare.bind(ctx.db);ctx.db.prepare=(sql)=>{if(/INSERT INTO attachments/i.test(sql))throw new Error('fake_d1_metadata_failure');return original(sql);};
    await assert.rejects(()=>putAttachment(ctx.env,ctx.auth,{id:'ATT-ROLLBACK',entityType:'inspection',entityId:'INSP-3',mimeType:'image/jpeg'},bytes),/fake_d1_metadata_failure/);
    const key=`installations/${ctx.installationId}/inspection/INSP-3/ATT-ROLLBACK.jpg`;
    assert.equal(await ctx.bucket.head(key),null);assert.deepEqual(ctx.bucket.deleteCalls,[key]);
  }finally{ctx.db.close();}
});

test('cleanup identifica objetos órfãos por prefixo da instalação',async()=>{
  const ctx=setup();try{
    const orphan=`installations/${ctx.installationId}/inspection/INSP-9/ATT-ORPHAN.jpg`;
    await ctx.bucket.put(orphan,bytes,{httpMetadata:{contentType:'image/jpeg'}});
    await putAttachment(ctx.env,ctx.auth,{id:'ATT-OK',entityType:'inspection',entityId:'INSP-9',mimeType:'image/jpeg'},bytes);
    const found=await findOrphanObjects(ctx.env,ctx.installationId,{limit:50});
    assert.deepEqual(found.map(item=>item.key),[orphan]);
  }finally{ctx.db.close();}
});

test('delete registra delta, é idempotente e remove D1 + R2 sem bucket público',async()=>{
  const ctx=setup();try{
    await putAttachment(ctx.env,ctx.auth,{id:'ATT-DEL',entityType:'inspection',entityId:'INSP-4',mimeType:'image/png'},bytes);
    const key=`installations/${ctx.installationId}/inspection/INSP-4/ATT-DEL.png`;
    const first=await deleteAttachment(ctx.env,ctx.auth,'ATT-DEL');
    assert.equal(first.ok,true);assert.equal(await ctx.bucket.head(key),null);
    const row=ctx.db.sqlite.prepare('SELECT status, deleted_at FROM attachments WHERE installation_id=? AND id=?').get(ctx.installationId,'ATT-DEL');
    assert.equal(row.status,'deleted');assert.ok(row.deleted_at);
    const changes=ctx.db.sqlite.prepare('SELECT operation,payload_json FROM sync_changes WHERE installation_id=? AND entity_id=? ORDER BY sequence').all(ctx.installationId,'ATT-DEL');
    assert.equal(changes.length,2);assert.equal(changes[1].operation,'delete');assert.equal(JSON.parse(changes[1].payload_json).deleted,true);
    const second=await deleteAttachment(ctx.env,ctx.auth,'ATT-DEL');
    assert.equal(second.ok,true);assert.equal(second.alreadyDeleted,true);
    assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_changes WHERE installation_id=? AND entity_id=?').get(ctx.installationId,'ATT-DEL').n,2);
  }finally{ctx.db.close();}
});
