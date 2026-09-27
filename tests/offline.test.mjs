import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOfflineState,
  markOfflineDirty,
  markOfflineSynced,
  queueSnapshot,
  dequeueSnapshot,
  pendingCount
} from '../src/domain/offline.mjs';

test('offline-first: inicia limpo e marca alteração pendente', () => {
  const base=createOfflineState();
  const dirty=markOfflineDirty(base,{at:'2026-09-14T12:00:00.000Z'});
  assert.equal(base.dirty,false);
  assert.equal(dirty.dirty,true);
  assert.equal(dirty.dirtySince,'2026-09-14T12:00:00.000Z');
});

test('offline-first: fila guarda apenas o snapshot mais recente', () => {
  let state=createOfflineState();
  state=queueSnapshot(state,{version:3,updatedAt:'2026-09-14T12:00:00.000Z'});
  state=queueSnapshot(state,{version:3,updatedAt:'2026-09-14T12:05:00.000Z'});
  assert.equal(pendingCount(state),1);
  assert.equal(state.pending[0].snapshot.updatedAt,'2026-09-14T12:05:00.000Z');
});

test('offline-first: sincronização bem sucedida limpa pendência', () => {
  let state=markOfflineDirty(createOfflineState());
  state=queueSnapshot(state,{version:3,updatedAt:'2026-09-14T12:05:00.000Z'});
  state=markOfflineSynced(state,{at:'2026-09-14T12:06:00.000Z',revision:7});
  assert.equal(state.dirty,false);
  assert.equal(state.pending.length,0);
  assert.equal(state.lastSyncedRevision,7);
  assert.equal(state.lastSyncedAt,'2026-09-14T12:06:00.000Z');
});

test('offline-first: dequeue não apaga item diferente', () => {
  let state=queueSnapshot(createOfflineState(),{version:3,updatedAt:'2026-09-14T12:05:00.000Z'});
  const id=state.pending[0].id;
  assert.equal(dequeueSnapshot(state,'outro').pending.length,1);
  assert.equal(dequeueSnapshot(state,id).pending.length,0);
});
