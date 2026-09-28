function segment(value){const text=String(value??'').trim();if(!/^[A-Za-z0-9_-]{1,120}$/.test(text))throw new Error('installation_id_invalid');return text;}

export async function findOrphanObjects(env,installationId,{limit=100,cursor}={}){
  if(!env?.ATTACHMENTS?.list||!env?.DB?.prepare)throw new Error('storage_unavailable');
  const installation=segment(installationId),prefix=`installations/${installation}/`;
  const listed=await env.ATTACHMENTS.list({prefix,limit:Math.max(1,Math.min(Number(limit)||100,1000)),cursor,include:['customMetadata']});
  const orphans=[];
  for(const object of listed.objects??[]){
    const row=await env.DB.prepare(`SELECT id FROM attachments WHERE installation_id = ? AND object_key = ? AND deleted_at IS NULL AND status = 'ready' LIMIT 1`).bind(installation,object.key).first();
    if(!row)orphans.push({key:object.key,size:Number(object.size??0),uploaded:object.uploaded??null});
  }
  return orphans;
}

export async function deleteOrphanObjects(env,installationId,{limit=100,cursor}={}){
  const orphans=await findOrphanObjects(env,installationId,{limit,cursor});
  if(orphans.length)await env.ATTACHMENTS.delete(orphans.map(item=>item.key));
  return{deleted:orphans.map(item=>item.key)};
}
