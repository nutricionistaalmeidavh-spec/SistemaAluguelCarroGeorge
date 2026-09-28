import { getResourceDefinition } from '../api/resource-map.mjs';

function definition(resource){const value=getResourceDefinition(resource);if(!value)throw new Error('Recurso não permitido.');return value;}
function installation(value){const id=String(value||'').trim();if(!id)throw new TypeError('installationId é obrigatório.');return id;}
function idValue(value){const id=String(value||'').trim();if(!id)throw new TypeError('id é obrigatório.');return id;}
function writableEntries(def,payload={}){
  const entries=[];
  for(const [publicName,column] of Object.entries(def.writable))if(Object.hasOwn(payload,publicName))entries.push([column,payload[publicName]]);
  return entries;
}
function now(){return new Date().toISOString();}

export function createD1Repository(db,installationId){
  if(!db?.prepare)throw new TypeError('Binding D1 inválido.');
  const tenant=installation(installationId);
  return Object.freeze({
    async list(resource){
      const def=definition(resource);
      const sql=`SELECT ${def.read.join(', ')} FROM ${def.table} WHERE installation_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id`;
      const result=await db.prepare(sql).bind(tenant).all();
      return result?.results??[];
    },
    async get(resource,id){
      const def=definition(resource),entityId=idValue(id);
      const sql=`SELECT ${def.read.join(', ')} FROM ${def.table} WHERE installation_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`;
      return await db.prepare(sql).bind(tenant,entityId).first();
    },
    async insert(resource,id,payload={},metadata={}){
      const def=definition(resource),entityId=idValue(id),entries=writableEntries(def,payload);
      for(const field of def.required)if(!Object.hasOwn(payload,field)||payload[field]==null||String(payload[field]).trim()==='')throw new Error(`Campo obrigatório: ${field}.`);
      if(!entries.length)throw new Error('Nenhum campo gravável informado.');
      const stamp=now(),columns=['id','installation_id',...entries.map(([column])=>column),'created_at','updated_at','version','updated_by_device'];
      const values=[entityId,tenant,...entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value),stamp,stamp,1,metadata.deviceId??null];
      const placeholders=columns.map(()=>'?').join(', ');
      await db.prepare(`INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
      return this.get(resource,entityId);
    },
    async update(resource,id,payload={},expectedVersion,metadata={}){
      const def=definition(resource),entityId=idValue(id),entries=writableEntries(def,payload),version=Number(expectedVersion);
      if(!Number.isInteger(version)||version<1)throw new Error('expectedVersion inválida.');
      if(!entries.length)throw new Error('Nenhum campo gravável informado.');
      const assignments=entries.map(([column])=>`${column} = ?`);
      assignments.push('updated_at = ?','version = version + 1','updated_by_device = ?');
      const params=[...entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value),now(),metadata.deviceId??null,tenant,entityId,version];
      const result=await db.prepare(`UPDATE ${def.table} SET ${assignments.join(', ')} WHERE installation_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`).bind(...params).run();
      if(Number(result?.meta?.changes??0)!==1)return null;
      return this.get(resource,entityId);
    },
    async softDelete(resource,id,expectedVersion,metadata={}){
      const def=definition(resource),entityId=idValue(id),version=Number(expectedVersion);
      if(!Number.isInteger(version)||version<1)throw new Error('expectedVersion inválida.');
      const stamp=now();
      const result=await db.prepare(`UPDATE ${def.table} SET deleted_at = ?, updated_at = ?, version = version + 1, updated_by_device = ? WHERE installation_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`).bind(stamp,stamp,metadata.deviceId??null,tenant,entityId,version).run();
      return Number(result?.meta?.changes??0)===1;
    },
    async batch(statements){
      if(!Array.isArray(statements)||!statements.length)throw new TypeError('batch exige statements.');
      if(typeof db.batch!=='function')throw new Error('Binding D1 sem suporte a batch.');
      return db.batch(statements);
    }
  });
}
