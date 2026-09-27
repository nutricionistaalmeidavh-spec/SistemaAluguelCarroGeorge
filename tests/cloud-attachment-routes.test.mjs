import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { FakeR2 } from './helpers/fake-r2.mjs';
import { handleAttachmentRoute } from '../cloudflare/api/attachment-routes.mjs';

const fileBytes=new TextEncoder().encode('inspection-photo');
function setup(){const db=new FakeD1(),ids=seedOperationFixture(db),bucket=new FakeR2();return{db,bucket,env:{DB:db,ATTACHMENTS:bucket},auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-ATT-HTTP',role:'admin',active:true},...ids};}
function putRequest(id,{entityType='inspection',entityId='INSP-HTTP',mime='image/jpeg',bytes=fileBytes}={}){return new Request(`https://example.test/api/v1/attachments/${id}?entityType=${entityType}&entityId=${entityId}`,{method:'PUT',headers:{'content-type':mime,'x-file-name':'../../unsafe.exe'},body:bytes});}

test('PUT/GET de attachment passa somente pelo Worker e preserva bytes/metadados',async()=>{
  const ctx=setup();try{
    const uploaded=await handleAttachmentRoute(putRequest('ATT-HTTP-1'),ctx.env,{}, {auth:ctx.auth});
    assert.equal(uploaded.status,201);const meta=await uploaded.json();assert.equal(meta.item.id,'ATT-HTTP-1');assert.equal(meta.item.objectKey,`installations/${ctx.installationId}/inspection/INSP-HTTP/ATT-HTTP-1.jpg`);
    const downloaded=await handleAttachmentRoute(new Request('https://example.test/api/v1/attachments/ATT-HTTP-1'),ctx.env,{}, {auth:ctx.auth});
    assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'image/jpeg');assert.match(downloaded.headers.get('x-content-sha256')??'',/^[0-9a-f]{64}$/);
    assert.equal(new TextDecoder().decode(await downloaded.arrayBuffer()),'inspection-photo');
  }finally{ctx.db.close();}
});

test('vistoriador pode anexar evidência de vistoria, mas não contrato',async()=>{
  const ctx=setup();try{
    const inspector={...ctx.auth,role:'vistoriador'};
    const inspection=await handleAttachmentRoute(putRequest('ATT-INSP'),ctx.env,{}, {auth:inspector});assert.equal(inspection.status,201);
    const contract=await handleAttachmentRoute(putRequest('ATT-CONTRACT',{entityType:'contract',entityId:'CTR-1',mime:'application/pdf'}),ctx.env,{}, {auth:inspector});assert.equal(contract.status,403);
    assert.equal(ctx.bucket.putCalls.length,1);
  }finally{ctx.db.close();}
});

test('DELETE remove objeto privado e metadata fica tombstoned',async()=>{
  const ctx=setup();try{
    await handleAttachmentRoute(putRequest('ATT-HTTP-DEL',{mime:'image/png'}),ctx.env,{}, {auth:ctx.auth});
    const response=await handleAttachmentRoute(new Request('https://example.test/api/v1/attachments/ATT-HTTP-DEL',{method:'DELETE'}),ctx.env,{}, {auth:ctx.auth});
    assert.equal(response.status,200);assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM attachments WHERE id='ATT-HTTP-DEL' AND deleted_at IS NOT NULL"),1);
  }finally{ctx.db.close();}
});

test('request sem sessão não toca D1 nem R2',async()=>{
  const ctx=setup();try{
    const response=await handleAttachmentRoute(putRequest('ATT-NOAUTH'),ctx.env,{}, {auth:null});assert.equal(response.status,401);assert.equal(ctx.bucket.putCalls.length,0);assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM attachments'),0);
  }finally{ctx.db.close();}
});
