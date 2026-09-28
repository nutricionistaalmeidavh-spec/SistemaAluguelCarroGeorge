import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './helpers/fake-d1.mjs';
import { ensureGeorgeAdmin } from '../cloudflare/auth/george-provision.mjs';
import { handleAuthRoute } from '../cloudflare/api/auth-routes.mjs';

const INSTALLATION_ID='LOCADORA-GEORGE';
const GEORGE_EMAIL='georgedaut.adm@gmail.com';

function read(relative){return readFileSync(fileURLToPath(new URL(`../${relative}`,import.meta.url)),'utf8');}

test('login cloud fixa a instalação do George e mostra apenas e-mail e senha',()=>{
  const source=read('src/cloud-app.mjs'),bootstrap=read('src/bootstrap.mjs'),index=read('index.html');
  assert.match(source,/CLOUD_INSTALLATION_ID\s*=\s*['"]LOCADORA-GEORGE['"]/);
  assert.match(source,/GEORGE_LOGIN_EMAIL\s*=\s*['"]georgedaut\.adm@gmail\.com['"]/);
  assert.doesNotMatch(source,/name=["']installationId["']/);
  assert.match(source,/<label>E-mail<input name=["']username["']/);
  assert.doesNotMatch(source,/>Usuário<input name=["']username["']/);
  assert.match(bootstrap,/\/api\/v1\/auth\/bootstrap/);
  assert.match(index,/src\/bootstrap\.mjs/);
});

test('provisionamento cloud cria George como admin e desativa login admin legado',async()=>{
  const db=new FakeD1(),now='2026-09-28T01:40:00.000Z';
  try{
    db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(INSTALLATION_ID,'George legado',now,now);
    db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('USR-LEGACY',INSTALLATION_ID,'admin','Administrador legado','admin',1,'legacy-hash',0,now,now);

    await ensureGeorgeAdmin(db,{now});

    const user=db.sqlite.prepare('SELECT username,name,role,active,password_hash,must_change_password,deleted_at FROM users WHERE installation_id=? AND lower(username)=lower(?)').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.equal(user?.username,GEORGE_EMAIL);
    assert.equal(user?.role,'admin');
    assert.equal(Number(user?.active),1);
    assert.equal(Number(user?.must_change_password),1);
    assert.equal(user?.deleted_at,null);
    assert.match(String(user?.password_hash??''),/^pbkdf2-sha256\$310000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i);

    const legacy=db.sqlite.prepare("SELECT active FROM users WHERE installation_id=? AND lower(username)='admin' AND deleted_at IS NULL").get(INSTALLATION_ID);
    assert.equal(Number(legacy?.active),0);
  }finally{db.close();}
});

test('provisionamento não redefine a senha depois do primeiro acesso',async()=>{
  const db=new FakeD1();
  try{
    await ensureGeorgeAdmin(db,{now:'2026-09-28T01:40:00.000Z'});
    const changedHash='pbkdf2-sha256$310000$00112233445566778899aabbccddeeff$00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    db.sqlite.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE installation_id=? AND username=?').run(changedHash,INSTALLATION_ID,GEORGE_EMAIL);

    await ensureGeorgeAdmin(db,{now:'2026-09-29T01:40:00.000Z'});
    const user=db.sqlite.prepare('SELECT password_hash,must_change_password FROM users WHERE installation_id=? AND username=?').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.equal(user.password_hash,changedHash);
    assert.equal(Number(user.must_change_password),0);
    assert.equal(Number(db.sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE installation_id=? AND username=?').get(INSTALLATION_ID,GEORGE_EMAIL).n),1);
  }finally{db.close();}
});

test('provisionamento não reativa nem restaura conta do George revogada',async()=>{
  const db=new FakeD1();
  try{
    await ensureGeorgeAdmin(db,{now:'2026-09-28T01:40:00.000Z'});
    const revokedAt='2026-09-29T02:00:00.000Z',revokedHash='pbkdf2-sha256$310000$ffeeddccbbaa99887766554433221100$ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
    db.sqlite.prepare('UPDATE users SET active=0,deleted_at=?,password_hash=?,must_change_password=0 WHERE installation_id=? AND username=?')
      .run(revokedAt,revokedHash,INSTALLATION_ID,GEORGE_EMAIL);

    await ensureGeorgeAdmin(db,{now:'2026-09-30T03:00:00.000Z'});
    const user=db.sqlite.prepare('SELECT active,deleted_at,password_hash,must_change_password FROM users WHERE installation_id=? AND username=?').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.equal(Number(user.active),0);
    assert.equal(user.deleted_at,revokedAt);
    assert.equal(user.password_hash,revokedHash);
    assert.equal(Number(user.must_change_password),0);
  }finally{db.close();}
});

test('bootstrap de autenticação provisiona a conta sem exigir senha ou instalação do cliente',async()=>{
  const db=new FakeD1();
  try{
    const request=new Request('https://example.test/api/v1/auth/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const response=await handleAuthRoute(request,{DB:db},{},{auth:null});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true});
    const user=db.sqlite.prepare('SELECT username,role,active,must_change_password FROM users WHERE installation_id=? AND username=?').get(INSTALLATION_ID,GEORGE_EMAIL);
    assert.equal(user?.username,GEORGE_EMAIL);
    assert.equal(user?.role,'admin');
    assert.equal(Number(user?.active),1);
    assert.equal(Number(user?.must_change_password),1);
  }finally{db.close();}
});
