const path=require('node:path');
const fs=require('node:fs');
const { DatabaseSync }=require('node:sqlite');

class SqliteStore {
  constructor(filePath){
    if(!filePath)throw new TypeError('filePath is required');
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    this.filePath=filePath;
    this.db=new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.getStmt=this.db.prepare('SELECT value FROM kv WHERE key=?');
    this.setStmt=this.db.prepare(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
    this.deleteStmt=this.db.prepare('DELETE FROM kv WHERE key=?');
  }
  get(key){return this.getStmt.get(String(key))?.value??null;}
  set(key,value){this.setStmt.run(String(key),String(value),new Date().toISOString());return true;}
  remove(key){this.deleteStmt.run(String(key));return true;}
  getJson(key,fallback=null){const raw=this.get(key);if(raw==null)return fallback;try{return JSON.parse(raw);}catch{return fallback;}}
  setJson(key,value){return this.set(key,JSON.stringify(value));}
  close(){try{this.db.close();}catch{}}
}

module.exports={SqliteStore};
