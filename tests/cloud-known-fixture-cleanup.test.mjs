import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1 } from './helpers/fake-d1.mjs';
import { FakeR2 } from './helpers/fake-r2.mjs';
import { cleanupKnownFixtureData,knownFixtureCleanupAction } from '../cloudflare/maintenance/known-fixture-cleanup.mjs';

const INSTALL='LOCADORA-GEORGE',NOW='2026-10-02T15:00:00.000Z';

function seed(db){
  db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(INSTALL,'George',NOW,NOW);
  db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('USR-VICTOR-DEMO',INSTALL,'demo@example.test','Victor Demo','admin',0,NOW,NOW);
  db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('USR-REAL',INSTALL,'real@example.com','George','admin',1,NOW,NOW);

  db.sqlite.prepare('INSERT INTO customers (id,installation_id,name,email,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('CUS-FAKE',INSTALL,'Cliente Base','base@example.test',1,NOW,NOW);
  db.sqlite.prepare('INSERT INTO customers (id,installation_id,name,email,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('CUS-REAL',INSTALL,'Cliente Real','cliente@real.com',1,NOW,NOW);

  db.sqlite.prepare('INSERT INTO vehicles (id,installation_id,model,plate,daily_rate,availability,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('VEI-FAKE',INSTALL,'Argo Base','OFF1A23',100,'disponivel',NOW,NOW);
  db.sqlite.prepare('INSERT INTO vehicles (id,installation_id,model,plate,daily_rate,availability,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('VEI-REAL',INSTALL,'Onix','ABC1D23',150,'disponivel',NOW,NOW);

  db.sqlite.prepare('INSERT INTO rentals (id,installation_id,vehicle_id,customer_id,attendant_id,pickup_at,return_at,status,daily_rate,total,billing_mode,payment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('LOC-FAKE',INSTALL,'VEI-FAKE','CUS-FAKE','USR-VICTOR-DEMO','2026-10-01T10:00:00.000Z','2026-10-02T10:00:00.000Z','reserva',100,100,'total','aberto',NOW,NOW);
  db.sqlite.prepare('INSERT INTO rentals (id,installation_id,vehicle_id,customer_id,attendant_id,pickup_at,return_at,status,daily_rate,total,billing_mode,payment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('LOC-REAL',INSTALL,'VEI-REAL','CUS-REAL','USR-REAL','2026-10-01T10:00:00.000Z','2026-10-02T10:00:00.000Z','reserva',150,150,'total','aberto',NOW,NOW);

  db.sqlite.prepare('INSERT INTO inspections (id,installation_id,rental_id,vehicle_id,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('INSP-FAKE',INSTALL,'LOC-FAKE','VEI-FAKE','pickup','completed',NOW,NOW);
  db.sqlite.prepare('INSERT INTO attachments (id,installation_id,entity_type,entity_id,local_path,mime_type,size_bytes,sha256,created_at,created_by,status,updated_at,object_key,storage_backend) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('FOTO-LEGACY-001',INSTALL,'inspection','INSP-FAKE','baseline.jpg','image/jpeg',4,'a'.repeat(64),NOW,'USR-VICTOR-DEMO','ready',NOW,'installations/LOCADORA-GEORGE/inspection/INSP-FAKE/FOTO-LEGACY-001.jpg','r2');

  db.sqlite.prepare('INSERT INTO expenses (id,installation_id,vehicle_id,description,category,amount,paid,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('EXP-FAKE',INSTALL,'VEI-FAKE','Lavagem baseline','Operacional',60,1,NOW,NOW);
  db.sqlite.prepare('INSERT INTO maintenance (id,installation_id,vehicle_id,type,notes,cost_estimate,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('MNT-WEB-1',INSTALL,'VEI-FAKE','Troca de óleo','Manutenção da fixture',250,'scheduled',NOW,NOW);
  db.sqlite.prepare('INSERT INTO contract_templates (id,installation_id,name,body,active,is_default,template_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('TPL-WEB-1',INSTALL,'Contrato baseline','Contrato',1,1,1,NOW,NOW);

  db.sqlite.prepare('INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('AUD-FAKE',INSTALL,'USR-VICTOR-DEMO','customer.created','customer','CUS-FAKE',NOW,NOW,NOW);
}

test('limpeza remove somente fixtures conhecidas do tenant George, preserva reais e cria backup',async()=>{
  const db=new FakeD1(),bucket=new FakeR2();seed(db);
  await bucket.put('installations/LOCADORA-GEORGE/inspection/INSP-FAKE/FOTO-LEGACY-001.jpg','fake');
  try{
    const result=await cleanupKnownFixtureData({DB:db,ATTACHMENTS:bucket},{actorId:'USR-REAL'});
    assert.equal(result.ok,true);
    assert.equal(result.alreadyRan,false);
    assert.ok(result.backupId,'deve criar backup antes da exclusão');
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=? AND id=?',INSTALL,'CUS-FAKE'),0);
    assert.equal(db.scalar('SELECT COUNT(*) FROM vehicles WHERE installation_id=? AND id=?',INSTALL,'VEI-FAKE'),0);
    assert.equal(db.scalar('SELECT COUNT(*) FROM rentals WHERE installation_id=? AND id=?',INSTALL,'LOC-FAKE'),0);
    assert.equal(db.scalar('SELECT COUNT(*) FROM inspections WHERE installation_id=? AND id=?',INSTALL,'INSP-FAKE'),0);
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=? AND id=?',INSTALL,'CUS-REAL'),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM vehicles WHERE installation_id=? AND id=?',INSTALL,'VEI-REAL'),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM rentals WHERE installation_id=? AND id=?',INSTALL,'LOC-REAL'),1);
    assert.equal(await bucket.head('installations/LOCADORA-GEORGE/inspection/INSP-FAKE/FOTO-LEGACY-001.jpg'),null);
    assert.equal(db.scalar('SELECT COUNT(*) FROM audit_log WHERE installation_id=? AND action=?',INSTALL,knownFixtureCleanupAction),1);

    const replay=await cleanupKnownFixtureData({DB:db,ATTACHMENTS:bucket},{actorId:'USR-REAL'});
    assert.equal(replay.alreadyRan,true,'segunda execução deve ser no-op');
  }finally{db.close();}
});
