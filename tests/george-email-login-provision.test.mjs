import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './helpers/fake-d1.mjs';

const INSTALLATION_ID='LOCADORA-GEORGE';
const GEORGE_EMAIL='georgedaut.adm@gmail.com';

function read(relative){return readFileSync(fileURLToPath(new URL(`../${relative}`,import.meta.url)),'utf8');}

test('login cloud fixa a instalação do George e mostra apenas e-mail e senha',()=>{
  const source=read('src/cloud-app.mjs');
  assert.match(source,/CLOUD_INSTALLATION_ID\s*=\s*['"]LOCADORA-GEORGE['"]/);
  assert.match(source,/GEORGE_LOGIN_EMAIL\s*=\s*['"]georgedaut\.adm@gmail\.com['"]/);
  assert.doesNotMatch(source,/name=["']installationId["']/);
  assert.match(source,/<label>E-mail<input name=["']username["']/);
  assert.doesNotMatch(source,/>Usuário<input name=["']username["']/);
});

test('migrations provisionam George como admin ativo com troca obrigatória de senha',()=>{
  const db=new FakeD1();
  try{
    const installation=db.sqlite.prepare('SELECT id,name,deleted_at FROM installations WHERE id=?').get(INSTALLATION_ID);
    assert.equal(installation?.id,INSTALLATION_ID);
    assert.equal(installation?.deleted_at,null);

    const user=db.sqlite.prepare('SELECT username,name,role,active,password_hash,must_change_password,deleted_at FROM users WHERE installation_id=? AND lower(username)=lower(?)').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.equal(user?.username,GEORGE_EMAIL);
    assert.equal(user?.role,'admin');
    assert.equal(Number(user?.active),1);
    assert.equal(Number(user?.must_change_password),1);
    assert.equal(user?.deleted_at,null);
    assert.match(String(user?.password_hash??''),/^pbkdf2-sha256\$310000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i);

    const legacyAdmin=db.sqlite.prepare("SELECT active FROM users WHERE installation_id=? AND lower(username)='admin' AND deleted_at IS NULL").get(INSTALLATION_ID);
    if(legacyAdmin)assert.equal(Number(legacyAdmin.active),0);
  }finally{db.close();}
});
