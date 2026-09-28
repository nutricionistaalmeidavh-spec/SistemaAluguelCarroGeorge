'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('perda de celular: revogação encerra sessão e credencial; novo device recupera dados cloud',async()=>{
  const {FakeD1,seedOperationFixture}=await import('../../tests/helpers/fake-d1.mjs');
  const {issueDeviceCredential,resolveDeviceCredential}=await import('../../cloudflare/auth/device-credentials.mjs');
  const {createSessionRecord,buildSessionCookie,resolveSession}=await import('../../cloudflare/auth/session.mjs');
  const {revokeDevice}=await import('../../cloudflare/auth/devices.mjs');
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),auth={installationId:ids.installationId,userId:ids.userId,role:'admin',active:true};
    const oldCredential=await issueDeviceCredential(db,auth,{deviceId:'PHONE-LOST',name:'Celular perdido',kind:'mobile'});
    const oldSession=await createSessionRecord(db,{installationId:ids.installationId,userId:ids.userId,deviceId:'PHONE-LOST',userAgent:'dr-lost-phone'});
    const oldCredentialRequest=new Request('https://george.example/api/v1/replica/bootstrap',{headers:{'x-locadora-device-token':oldCredential.token}});
    const oldSessionRequest=new Request('https://george.example/api/v1/auth/me',{headers:{cookie:buildSessionCookie(oldSession.token)}});
    assert.equal((await resolveDeviceCredential(oldCredentialRequest,{DB:db}))?.deviceId,'PHONE-LOST');
    assert.equal((await resolveSession(oldSessionRequest,{DB:db}))?.deviceId,'PHONE-LOST');

    await revokeDevice(db,ids.installationId,'PHONE-LOST');

    assert.equal(await resolveDeviceCredential(oldCredentialRequest,{DB:db}),null);
    assert.equal(await resolveSession(oldSessionRequest,{DB:db}),null);
    assert.equal(db.scalar("SELECT COUNT(*) FROM sessions WHERE device_id='PHONE-LOST' AND revoked_at IS NULL"),0);
    assert.equal(db.scalar("SELECT COUNT(*) FROM device_credentials WHERE device_id='PHONE-LOST' AND revoked_at IS NULL"),0);

    const fresh=await issueDeviceCredential(db,auth,{deviceId:'PHONE-NEW',name:'Celular novo',kind:'mobile'});
    const freshRequest=new Request('https://george.example/api/v1/replica/bootstrap',{headers:{'x-locadora-device-token':fresh.token}});
    assert.equal((await resolveDeviceCredential(freshRequest,{DB:db}))?.deviceId,'PHONE-NEW');
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=?',ids.installationId),1,'revogar aparelho não apaga dados do negócio');
    assert.equal(db.scalar("SELECT active FROM devices WHERE id='PHONE-LOST'"),0);
  }finally{db.close();}
});
