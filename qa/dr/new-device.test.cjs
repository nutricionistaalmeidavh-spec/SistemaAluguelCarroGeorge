'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('perda de celular: device antigo é revogado e novo device recupera dados cloud',async()=>{
  const {FakeD1,seedOperationFixture}=await import('../../tests/helpers/fake-d1.mjs');
  const {issueDeviceCredential,resolveDeviceCredential}=await import('../../cloudflare/auth/device-credentials.mjs');
  const {revokeDevice}=await import('../../cloudflare/auth/devices.mjs');
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),auth={installationId:ids.installationId,userId:ids.userId,role:'admin',active:true};
    const oldCredential=await issueDeviceCredential(db,auth,{deviceId:'PHONE-LOST',name:'Celular perdido',kind:'mobile'});
    const oldRequest=new Request('https://george.example/api/v1/replica/bootstrap',{headers:{'x-locadora-device-token':oldCredential.token}});
    assert.equal((await resolveDeviceCredential(oldRequest,{DB:db}))?.deviceId,'PHONE-LOST');
    await revokeDevice(db,ids.installationId,'PHONE-LOST');
    assert.equal(await resolveDeviceCredential(oldRequest,{DB:db}),null);
    const fresh=await issueDeviceCredential(db,auth,{deviceId:'PHONE-NEW',name:'Celular novo',kind:'mobile'});
    const freshRequest=new Request('https://george.example/api/v1/replica/bootstrap',{headers:{'x-locadora-device-token':fresh.token}});
    assert.equal((await resolveDeviceCredential(freshRequest,{DB:db}))?.deviceId,'PHONE-NEW');
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=?',ids.installationId),1,'revogar aparelho não apaga dados do negócio');
    assert.equal(db.scalar("SELECT active FROM devices WHERE id='PHONE-LOST'"),0);
  }finally{db.close();}
});
