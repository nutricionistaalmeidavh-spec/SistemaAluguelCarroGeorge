import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exchangeSnapshots,
  normalizeSyncUrl,
  createSyncMeta,
  markSyncSuccess,
  markSyncFailure
} from '../src/domain/sync.mjs';

const snap=(updatedAt,value)=>({version:3,updatedAt,value});

test('P2 sync: primeiro dispositivo publica snapshot no servidor vazio',()=>{
  const result=exchangeSnapshots({serverRevision:0,serverSnapshot:null,baseRevision:0,clientSnapshot:snap('2026-09-14T10:00:00Z','pc')});
  assert.equal(result.action,'push');
  assert.equal(result.nextRevision,1);
  assert.equal(result.snapshot.value,'pc');
  assert.equal(result.conflict,false);
});

test('P2 sync: cliente atualizado sobre a mesma revisão publica nova revisão',()=>{
  const result=exchangeSnapshots({serverRevision:3,serverSnapshot:snap('2026-09-14T10:00:00Z','old'),baseRevision:3,clientSnapshot:snap('2026-09-14T10:05:00Z','new')});
  assert.equal(result.action,'push');
  assert.equal(result.nextRevision,4);
  assert.equal(result.snapshot.value,'new');
});

test('P2 sync: conflito escolhe o snapshot mais recente e sinaliza cópia de segurança',()=>{
  const pull=exchangeSnapshots({serverRevision:5,serverSnapshot:snap('2026-09-14T10:10:00Z','mobile'),baseRevision:4,clientSnapshot:snap('2026-09-14T10:05:00Z','pc')});
  assert.equal(pull.action,'pull');
  assert.equal(pull.conflict,true);
  assert.equal(pull.snapshot.value,'mobile');
  assert.equal(pull.nextRevision,5);

  const push=exchangeSnapshots({serverRevision:5,serverSnapshot:snap('2026-09-14T10:10:00Z','mobile'),baseRevision:4,clientSnapshot:snap('2026-09-14T10:15:00Z','pc')});
  assert.equal(push.action,'push');
  assert.equal(push.conflict,true);
  assert.equal(push.snapshot.value,'pc');
  assert.equal(push.nextRevision,6);
});

test('P2 sync: empate mantém estado do servidor para evitar oscilação',()=>{
  const result=exchangeSnapshots({serverRevision:2,serverSnapshot:snap('2026-09-14T10:00:00Z','server'),baseRevision:1,clientSnapshot:snap('2026-09-14T10:00:00Z','client')});
  assert.equal(result.action,'pull');
  assert.equal(result.snapshot.value,'server');
  assert.equal(result.nextRevision,2);
});

test('P2 sync: normaliza URL local e metadados registram sucesso/falha sem perder revisão',()=>{
  assert.equal(normalizeSyncUrl('http://192.168.0.10:4174/'),'http://192.168.0.10:4174');
  assert.throws(()=>normalizeSyncUrl('ftp://192.168.0.10'),/http/i);
  let meta=createSyncMeta({deviceId:'DEV-1',serverUrl:'http://pc:4174',token:'abc',enabled:true});
  meta=markSyncSuccess(meta,{revision:7,direction:'pull',at:'2026-09-14T10:00:00Z'});
  assert.equal(meta.revision,7);
  assert.equal(meta.lastDirection,'pull');
  assert.equal(meta.lastError,null);
  meta=markSyncFailure(meta,new Error('offline'),{at:'2026-09-14T10:01:00Z'});
  assert.equal(meta.revision,7);
  assert.equal(meta.lastError,'offline');
});

import { can, seedUsers } from '../src/domain/auth.mjs';
test('P2 RBAC: atendente e vistoriador podem sincronizar dispositivos',()=>{
  const users=seedUsers();
  assert.equal(can(users.find(u=>u.role==='atendente'),'sync.read'),true);
  assert.equal(can(users.find(u=>u.role==='atendente'),'sync.write'),true);
  assert.equal(can(users.find(u=>u.role==='vistoriador'),'sync.read'),true);
  assert.equal(can(users.find(u=>u.role==='vistoriador'),'sync.write'),true);
});
