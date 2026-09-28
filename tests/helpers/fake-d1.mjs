import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import migrationRunner from '../../electron/migration-runner.cjs';

const migrationsDir=fileURLToPath(new URL('../../db/migrations/',import.meta.url));

class Statement{
  constructor(owner,sql){this.owner=owner;this.sql=sql;this.params=[];}
  bind(...params){const next=new Statement(this.owner,this.sql);next.params=params;return next;}
  async run(){return this.owner._run(this);}
  async first(){return this.owner._first(this);}
  async all(){return this.owner._all(this);}
}

export class FakeD1{
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');migrationRunner.applyMigrations(this.sqlite,migrationsDir);}
  prepare(sql){return new Statement(this,sql);}
  async batch(statements){
    this.sqlite.exec('BEGIN IMMEDIATE');
    try{const results=[];for(const stmt of statements)results.push(await this._run(stmt));this.sqlite.exec('COMMIT');return results;}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
  _prepared(stmt){return this.sqlite.prepare(stmt.sql);}
  async _run(stmt){const result=this._prepared(stmt).run(...stmt.params);return{success:true,meta:{changes:Number(result.changes??0)},results:[]};}
  async _first(stmt){return this._prepared(stmt).get(...stmt.params)??null;}
  async _all(stmt){return{success:true,results:this._prepared(stmt).all(...stmt.params)};}
  scalar(sql,...params){const row=this.sqlite.prepare(sql).get(...params);return row?Object.values(row)[0]:null;}
  close(){this.sqlite.close();}
}

export function seedOperationFixture(db,{installationId='INST-OPS',userId='USR-OPS',customerId='CUS-OPS',vehicleId='VEI-OPS'}={}){
  const now='2026-09-27T12:00:00.000Z';
  db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(installationId,'George',now,now);
  db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(userId,installationId,'operador','Operador','admin',1,now,now);
  db.sqlite.prepare('INSERT INTO customers (id,installation_id,name,active,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(customerId,installationId,'Cliente Teste',1,now,now);
  db.sqlite.prepare('INSERT INTO vehicles (id,installation_id,model,plate,daily_rate,availability,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(vehicleId,installationId,'Modelo Teste','TST0A00',100,'disponivel',now,now);
  return{installationId,userId,customerId,vehicleId};
}
