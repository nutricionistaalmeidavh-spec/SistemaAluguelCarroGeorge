import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository, STORE_KEY} from '../src/storage/repository.mjs';

test('storage recovers after a rejected write and reports the failure', async()=>{
 const map=new Map();let fail=false;const errors=[];const previous=globalThis.window;
 globalThis.window={locadoraDesktop:{dbGet:async k=>map.get(k)??null,dbSet:async(k,v)=>{if(fail)throw new Error('disk unavailable');map.set(k,v);},dbRemove:async k=>map.delete(k)}};
 try{
  const repo=await createRepository({onPersistenceError:e=>errors.push(e.message)});
  fail=true;repo.save({...repo.load(),settings:{companyName:'Not persisted'}});
  await assert.rejects(repo.flush(),/disk unavailable/);
  fail=false;await repo.kv.set('unrelated','ok');
  await assert.rejects(repo.flush(),/disk unavailable/);
  repo.save({...repo.load(),settings:{companyName:'Recovered'}});await repo.flush();
  assert.equal(JSON.parse(map.get(STORE_KEY)).settings.companyName,'Recovered');
  assert.deepEqual(errors,['disk unavailable']);
  assert.equal((await createRepository()).load().settings.companyName,'Recovered');
 }finally{globalThis.window=previous;}
});
