const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {applyMigrations}=require('./migration-runner.cjs');

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function toBuffer(value){
  if(Buffer.isBuffer(value))return value;
  if(value instanceof Uint8Array)return Buffer.from(value);
  if(value instanceof ArrayBuffer)return Buffer.from(new Uint8Array(value));
  if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
  throw new TypeError('bytes deve ser Buffer, Uint8Array ou ArrayBuffer.');
}
function safeHash(id){return sha256(Buffer.from(String(id),'utf8'));}
function rowToMetadata(row){
  if(!row)return null;
  return {
    id:row.id,
    installationId:row.installation_id,
    entityType:row.entity_type,
    entityId:row.entity_id,
    localPath:row.local_path,
    mimeType:row.mime_type,
    sizeBytes:Number(row.size_bytes||0),
    sha256:row.sha256,
    createdAt:row.created_at,
    createdBy:row.created_by??null,
    status:row.status,
    updatedAt:row.updated_at,
    version:Number(row.version||1),
    updatedByDevice:row.updated_by_device??null,
    deletedAt:row.deleted_at??null
  };
}

class AttachmentStore{
  static open(options={}){return new AttachmentStore(options);}
  constructor({databasePath,rootDir,migrationsDir,installationId,deviceId='GEORGE-PC'}={}){
    if(!databasePath)throw new TypeError('databasePath é obrigatório.');
    if(!rootDir)throw new TypeError('rootDir é obrigatório.');
    if(!migrationsDir)throw new TypeError('migrationsDir é obrigatório.');
    if(!installationId)throw new TypeError('installationId é obrigatório.');
    this.databasePath=databasePath;this.rootDir=rootDir;this.installationId=String(installationId);this.deviceId=String(deviceId||'');
    fs.mkdirSync(path.dirname(databasePath),{recursive:true});fs.mkdirSync(rootDir,{recursive:true});
    this.db=new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    applyMigrations(this.db,migrationsDir);
    this.getStmt=this.db.prepare('SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL');
    this.listStmt=this.db.prepare('SELECT * FROM attachments WHERE installation_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL ORDER BY created_at,id');
    this.upsertStmt=this.db.prepare(`INSERT INTO attachments(
      id,installation_id,entity_type,entity_id,local_path,mime_type,size_bytes,sha256,created_at,created_by,status,updated_at,version,updated_by_device,deleted_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      installation_id=excluded.installation_id,entity_type=excluded.entity_type,entity_id=excluded.entity_id,
      local_path=excluded.local_path,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,sha256=excluded.sha256,
      created_by=excluded.created_by,status=excluded.status,updated_at=excluded.updated_at,
      version=attachments.version+1,updated_by_device=excluded.updated_by_device,deleted_at=NULL`);
    this.deleteStmt=this.db.prepare('DELETE FROM attachments WHERE id=?');
  }
  relativePath(id){
    const hash=safeHash(id);return path.join(hash.slice(0,2),hash);
  }
  absolutePath(localPath){
    const absolute=path.resolve(this.rootDir,String(localPath));
    const root=path.resolve(this.rootDir)+path.sep;
    if(!absolute.startsWith(root))throw new Error('Caminho de attachment inválido.');
    return absolute;
  }
  metadata(id){return rowToMetadata(this.getStmt.get(String(id)));}
  listByEntity(entityType,entityId){return this.listStmt.all(this.installationId,String(entityType),String(entityId)).map(rowToMetadata);}
  put({id,entityType,entityId,mimeType,bytes,createdBy=null}={}){
    if(!id||!entityType||!entityId||!mimeType)throw new TypeError('id, entityType, entityId e mimeType são obrigatórios.');
    const buffer=toBuffer(bytes);if(!buffer.length)throw new Error('Attachment vazio não é permitido.');
    const now=new Date().toISOString(),localPath=this.relativePath(id),absolute=this.absolutePath(localPath);
    fs.mkdirSync(path.dirname(absolute),{recursive:true});
    const token=crypto.randomUUID();const temp=`${absolute}.tmp-${token}`;const backup=`${absolute}.bak-${token}`;
    fs.writeFileSync(temp,buffer,{flag:'wx'});
    const hadExisting=fs.existsSync(absolute);
    let movedOld=false,movedNew=false;
    this.db.exec('BEGIN IMMEDIATE;');
    try{
      if(hadExisting){fs.renameSync(absolute,backup);movedOld=true;}
      const existing=this.getStmt.get(String(id));
      this.upsertStmt.run(
        String(id),this.installationId,String(entityType),String(entityId),localPath,String(mimeType),buffer.length,sha256(buffer),
        existing?.created_at??now,createdBy==null?null:String(createdBy),'ready',now,existing?.version??1,this.deviceId||null,null
      );
      fs.renameSync(temp,absolute);movedNew=true;
      this.db.exec('COMMIT;');
      if(movedOld&&fs.existsSync(backup))fs.unlinkSync(backup);
      return this.metadata(id);
    }catch(error){
      try{this.db.exec('ROLLBACK;');}catch{}
      try{if(movedNew&&fs.existsSync(absolute))fs.unlinkSync(absolute);}catch{}
      try{if(movedOld&&fs.existsSync(backup))fs.renameSync(backup,absolute);}catch{}
      try{if(fs.existsSync(temp))fs.unlinkSync(temp);}catch{}
      throw error;
    }
  }
  get(id){
    const metadata=this.metadata(id);if(!metadata)return null;
    const absolute=this.absolutePath(metadata.localPath);if(!fs.existsSync(absolute))return null;
    return fs.readFileSync(absolute);
  }
  verify(id){
    const metadata=this.metadata(id);if(!metadata)return{ok:false,expectedSha256:null,actualSha256:null};
    const bytes=this.get(id);const actualSha256=bytes?sha256(bytes):null;
    return{ok:Boolean(actualSha256&&actualSha256===metadata.sha256),expectedSha256:metadata.sha256,actualSha256};
  }
  remove(id){
    const metadata=this.metadata(id);if(!metadata)return false;
    const absolute=this.absolutePath(metadata.localPath),trash=`${absolute}.delete-${crypto.randomUUID()}`;
    let moved=false;
    this.db.exec('BEGIN IMMEDIATE;');
    try{
      if(fs.existsSync(absolute)){fs.renameSync(absolute,trash);moved=true;}
      this.deleteStmt.run(String(id));
      this.db.exec('COMMIT;');
      if(moved&&fs.existsSync(trash))fs.unlinkSync(trash);
      return true;
    }catch(error){
      try{this.db.exec('ROLLBACK;');}catch{}
      try{if(moved&&fs.existsSync(trash))fs.renameSync(trash,absolute);}catch{}
      throw error;
    }
  }
  close(){try{this.db.close();}catch{}}
}

module.exports={AttachmentStore,sha256};
