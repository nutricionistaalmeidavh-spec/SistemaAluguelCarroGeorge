import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { SqliteStore }=require('../electron/sqlite-store.cjs');

test('SQLite desktop: dados, token e estado de sync permanecem no mesmo arquivo locadora.sqlite',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'locadora-db-'));
  const file=join(dir,'locadora.sqlite');
  let store=new SqliteStore(file);
  t.after(async()=>{store?.close();await rm(dir,{recursive:true,force:true});});
  store.set('app:snapshot:v3',JSON.stringify({version:3,customers:[{id:'C1'}]}));
  store.set('sync:token','TOKEN');
  store.setJson('sync:server-state',{revision:7,snapshot:{version:3}});
  store.close();
  assert.ok((await stat(file)).size>0);
  store=new SqliteStore(file);
  assert.equal(JSON.parse(store.get('app:snapshot:v3')).customers[0].id,'C1');
  assert.equal(store.get('sync:token'),'TOKEN');
  assert.equal(store.getJson('sync:server-state').revision,7);
});
