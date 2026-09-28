'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const migrationRunner=require('../../electron/migration-runner.cjs');
const {createSqliteReplicaStore}=require('../../electron/replica/sqlite-replica-store.cjs');
const {runReplicaCycle}=require('../../electron/replica/cycle.cjs');

function relational(db){return{db,transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}};}

test('PC vazio é reconstruído integralmente a partir do snapshot cloud',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'george-dr-rebuild-')),file=path.join(root,'locadora-george.sqlite'),db=new DatabaseSync(file),migrations=path.resolve(__dirname,'../../db/migrations');
  try{
    db.exec('PRAGMA foreign_keys=ON');migrationRunner.applyMigrations(db,migrations);
    const store=createSqliteReplicaStore({relationalStore:relational(db),installationId:'LOCADORA-GEORGE',deviceId:'PC-REBUILD'});
    const created='2026-09-27T12:00:00.000Z',snapshot={installations:[{id:'LOCADORA-GEORGE',name:'George',created_at:created,updated_at:created,version:1,restore_generation:6}],customers:[{id:'CUS-DR',installation_id:'LOCADORA-GEORGE',name:'Cliente reconstruído',active:1,created_at:created,updated_at:created,version:4,updated_by_device:'PHONE-1',deleted_at:null}]};
    const api={async bootstrap(){return{restoreGeneration:6,cursor:311,snapshot,attachments:[]};}};
    const state=await runReplicaCycle({state:{initialized:false,cursor:0,restoreGeneration:0},api,local:store});
    assert.equal(state.cursor,311);assert.equal(state.restoreGeneration,6);
    assert.equal(db.prepare("SELECT name FROM customers WHERE id='CUS-DR'").get().name,'Cliente reconstruído');
    assert.equal(db.prepare("SELECT kind FROM devices WHERE id='PC-REBUILD'").get().kind,'desktop');
  }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});
