import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1 } from './helpers/fake-d1.mjs';
import { hashPassword, verifyPassword } from '../cloudflare/auth/password.mjs';
import { ensureGeorgeAdmin } from '../cloudflare/auth/george-provision.mjs';
import { handleAuthRoute } from '../cloudflare/api/auth-routes.mjs';

const INSTALLATION_ID='LOCADORA-GEORGE';
const GEORGE_EMAIL='georgedaut.adm@gmail.com';
const LEGACY_INITIAL_HASH='pbkdf2-sha256$310000$fb088d29d93054f9534c620d5957891e$327213206bd0c0e8eacd737cc8f903f2035a0874d2a4f34d6df19f382a785496';
const TEMP_PASSWORD='a%Vm6X13b$ZUOwRtyb';

test('hashPassword usa por padrão 100000 iterações compatíveis com Cloudflare Workers',async()=>{
  const encoded=await hashPassword('fixture-password-value');
  assert.match(encoded,/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i);
});

test('verifyPassword identifica hash PBKDF2 acima do limite sem mascarar como credencial inválida',async()=>{
  await assert.rejects(
    ()=>verifyPassword(TEMP_PASSWORD,LEGACY_INITIAL_HASH),
    error=>{
      assert.equal(error?.message,'password_hash_unsupported');
      assert.equal(error?.status,503);
      return true;
    }
  );
});

test('login propaga hash incompatível como erro de serviço em vez de invalid_credentials',async()=>{
  const service={
    async findUser(){return{id:'USR-1',installation_id:INSTALLATION_ID,username:GEORGE_EMAIL,name:'George',role:'admin',active:1,must_change_password:1,password_hash:LEGACY_INITIAL_HASH};},
    async createSession(){throw new Error('session_should_not_be_created');}
  };
  const request=new Request('https://example.test/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installationId:INSTALLATION_ID,username:GEORGE_EMAIL,password:TEMP_PASSWORD})});
  const response=await handleAuthRoute(request,{}, {},{service});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{ok:false,error:'password_hash_unsupported'});
});

test('provisionamento migra somente o hash inicial legado enquanto o primeiro acesso continua pendente',async()=>{
  const db=new FakeD1();
  try{
    await ensureGeorgeAdmin(db,{now:'2026-09-28T01:40:00.000Z'});
    db.sqlite.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE installation_id=? AND username=?')
      .run(LEGACY_INITIAL_HASH,INSTALLATION_ID,GEORGE_EMAIL);

    await ensureGeorgeAdmin(db,{now:'2026-09-30T13:30:00.000Z'});

    const user=db.sqlite.prepare('SELECT password_hash,must_change_password FROM users WHERE installation_id=? AND username=?').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.notEqual(user.password_hash,LEGACY_INITIAL_HASH);
    assert.match(user.password_hash,/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i);
    assert.equal(Number(user.must_change_password),1);
    assert.deepEqual(await verifyPassword(TEMP_PASSWORD,user.password_hash),{ok:true,needsUpgrade:false});
  }finally{db.close();}
});

test('provisionamento não sobrescreve senha definida depois do primeiro acesso mesmo se ela usar formato legado',async()=>{
  const db=new FakeD1();
  try{
    await ensureGeorgeAdmin(db,{now:'2026-09-28T01:40:00.000Z'});
    const chosenHash='pbkdf2-sha256$310000$00112233445566778899aabbccddeeff$00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    db.sqlite.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE installation_id=? AND username=?')
      .run(chosenHash,INSTALLATION_ID,GEORGE_EMAIL);

    await ensureGeorgeAdmin(db,{now:'2026-09-30T13:31:00.000Z'});

    const user=db.sqlite.prepare('SELECT password_hash,must_change_password FROM users WHERE installation_id=? AND username=?').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.equal(user.password_hash,chosenHash);
    assert.equal(Number(user.must_change_password),0);
  }finally{db.close();}
});
