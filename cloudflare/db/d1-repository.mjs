import { getResourceDefinition } from '../api/resource-map.mjs';

function definition(resource){const value=getResourceDefinition(resource);if(!value)throw new Error('Recurso não permitido.');return value;}
function installation(value){const id=String(value||'').trim();if(!id)throw new TypeError('installationId é obrigatório.');return id;}
function idValue(value){const id=String(value||'').trim();if(!id)throw new TypeError('id é obrigatório.');return id;}
function writableEntries(def,payload={}){const entries=[];for(const [publicName,column] of Object.entries(def.writable))if(Object.hasOwn(payload,publicName))entries.push([column,payload[publicName]]);return entries;}
function now(){return new Date().toISOString();}
function aliveClause(def){return def.softDelete===false?'':' AND deleted_at IS NULL';}
function orderClause(def){return String(def.orderBy||'updated_at DESC, id');}
function idColumn(def){return String(def.idColumn||'id');}

export function createD1Repository(db,installationId){
  if(!db?.prepare)throw new TypeError('Binding D1 inválido.');
  const tenant=installation(installationId);
  return Object.freeze({
    async listPage(resource,{limit=250,offset=0,q='',filters={},from='',to=''}={}){
      const def=definition(resource),pageSize=Math.min(500,Math.max(1,Number(limit)||250)),pageOffset=Math.max(0,Number(offset)||0),where=['installation_id = ?'],params=[tenant];
      if(def.softDelete!==false)where.push('deleted_at IS NULL');
      const search=String(q??'').trim().slice(0,160),searchColumns=Array.isArray(def.searchColumns)?def.searchColumns:[];
      if(search&&searchColumns.length){where.push(`(${searchColumns.map(column=>`CAST(${column} AS TEXT) LIKE ?`).join(' OR ')})`);for(const _column of searchColumns)params.push(`%${search}%`);}
      const filterColumns=def.filterColumns??{};
      for(const [publicName,column] of Object.entries(filterColumns)){const value=filters?.[publicName];if(value===undefined||value===null||String(value)==='')continue;where.push(`${column} = ?`);params.push(String(value));}
      const dateColumn=def.dateColumn?String(def.dateColumn):null;
      if(dateColumn&&from){where.push(`${dateColumn} >= ?`);params.push(String(from).slice(0,64));}
      if(dateColumn&&to){where.push(`${dateColumn} <= ?`);params.push(String(to).slice(0,64));}
      const sql=`SELECT ${def.read.join(', ')} FROM ${def.table} WHERE ${where.join(' AND ')} ORDER BY ${orderClause(def)} LIMIT ? OFFSET ?`;
      const result=await db.prepare(sql).bind(...params,pageSize+1,pageOffset).all(),rows=result?.results??[],hasMore=rows.length>pageSize,items=hasMore?rows.slice(0,pageSize):rows;
      return{items,limit:pageSize,offset:pageOffset,nextOffset:hasMore?pageOffset+items.length:null,hasMore,q:search,filters:{...filters},from:from||'',to:to||''};
    },
    async list(resource,{pageSize=250,maxPages=100}={}){
      const items=[];let offset=0,pages=0;
      while(pages<Math.max(1,Number(maxPages)||100)){const page=await this.listPage(resource,{limit:pageSize,offset});items.push(...page.items);pages++;if(!page.hasMore||page.nextOffset==null)break;offset=page.nextOffset;}
      return items;
    },
    async get(resource,id){
      const def=definition(resource),entityId=idValue(id),sql=`SELECT ${def.read.join(', ')} FROM ${def.table} WHERE installation_id = ? AND ${idColumn(def)} = ?${aliveClause(def)} LIMIT 1`;
      return await db.prepare(sql).bind(tenant,entityId).first();
    },
    async insert(resource,id,payload={},metadata={}){
      const def=definition(resource),entityId=idValue(id),entries=writableEntries(def,payload);for(const field of def.required)if(!Object.hasOwn(payload,field)||payload[field]==null||String(payload[field]).trim()==='')throw new Error(`Campo obrigatório: ${field}.`);if(!entries.length)throw new Error('Nenhum campo gravável informado.');
      const stamp=now(),columns=['id','installation_id',...entries.map(([column])=>column),'created_at','updated_at','version','updated_by_device'],values=[entityId,tenant,...entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value),stamp,stamp,1,metadata.deviceId??null],placeholders=columns.map(()=>'?').join(', ');
      await db.prepare(`INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${placeholders})`).bind(...values).run();return this.get(resource,entityId);
    },
    async update(resource,id,payload={},expectedVersion,metadata={}){
      const def=definition(resource),entityId=idValue(id),entries=writableEntries(def,payload),version=Number(expectedVersion);if(!Number.isInteger(version)||version<1)throw new Error('expectedVersion inválida.');if(!entries.length)throw new Error('Nenhum campo gravável informado.');
      const assignments=entries.map(([column])=>`${column} = ?`);assignments.push('updated_at = ?','version = version + 1','updated_by_device = ?');const params=[...entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value),now(),metadata.deviceId??null,tenant,entityId,version];
      const result=await db.prepare(`UPDATE ${def.table} SET ${assignments.join(', ')} WHERE installation_id = ? AND ${idColumn(def)} = ? AND version = ?${aliveClause(def)}`).bind(...params).run();if(Number(result?.meta?.changes??0)!==1)return null;return this.get(resource,entityId);
    },
    async softDelete(resource,id,expectedVersion,metadata={}){
      const def=definition(resource);if(def.softDelete===false)throw new Error('Exclusão não permitida para este recurso.');const entityId=idValue(id),version=Number(expectedVersion);if(!Number.isInteger(version)||version<1)throw new Error('expectedVersion inválida.');const stamp=now(),result=await db.prepare(`UPDATE ${def.table} SET deleted_at = ?, updated_at = ?, version = version + 1, updated_by_device = ? WHERE installation_id = ? AND ${idColumn(def)} = ? AND version = ? AND deleted_at IS NULL`).bind(stamp,stamp,metadata.deviceId??null,tenant,entityId,version).run();return Number(result?.meta?.changes??0)===1;
    },
    async batch(statements){if(!Array.isArray(statements)||!statements.length)throw new TypeError('batch exige statements.');if(typeof db.batch!=='function')throw new Error('Binding D1 sem suporte a batch.');return db.batch(statements);}
  });
}
