import { BACKUP_TABLES,safeBackupTable } from './tables.mjs';

export async function fetchInstallationTable(db,installationId,table,{limit=500,offset=0}={}){
  const safe=safeBackupTable(table);
  if(!safe)throw new Error('backup_table_invalid');
  const rows=await db.prepare(`SELECT * FROM ${safe} WHERE installation_id = ? ORDER BY rowid LIMIT ? OFFSET ?`)
    .bind(String(installationId),Math.min(1000,Math.max(1,Number(limit)||500)),Math.max(0,Number(offset)||0)).all();
  return rows?.results??[];
}

export async function* exportInstallation(db,installationId,{pageSize=500,tables=BACKUP_TABLES}={}){
  for(const table of tables){
    let offset=0,index=0;
    while(true){
      const rows=await fetchInstallationTable(db,installationId,table,{limit:pageSize,offset});
      if(!rows.length)break;
      yield{table,index,offset,rows};
      offset+=rows.length;
      index++;
      if(rows.length<pageSize)break;
    }
  }
}
