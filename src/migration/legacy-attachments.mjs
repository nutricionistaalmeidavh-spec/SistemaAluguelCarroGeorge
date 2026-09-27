function clone(value){return value==null?value:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));}

const SUPPORTED_MIME=new Set(['image/jpeg','image/png','image/webp']);

export function parseLegacyImageDataUrl(value){
  if(typeof value!=='string')throw new Error('Data URL de imagem ausente.');
  const match=/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value.trim());
  if(!match)throw new Error('Formato de imagem/data URL legado não suportado.');
  const normalizedMime=match[1].toLowerCase()==='image/jpg'?'image/jpeg':match[1].toLowerCase();
  if(!SUPPORTED_MIME.has(normalizedMime))throw new Error('Formato de imagem legado não suportado.');
  const binary=typeof Buffer!=='undefined'
    ?new Uint8Array(Buffer.from(match[2],'base64'))
    :Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0));
  if(!binary.byteLength)throw new Error('Imagem legada vazia.');
  return{mimeType:normalizedMime,bytes:binary};
}

function attachmentReference(photo,metadata){
  return{
    id:photo.id,
    attachmentId:metadata.id,
    name:photo.name??'foto.jpg',
    mimeType:metadata.mimeType,
    sizeBytes:Number(metadata.sizeBytes||0),
    sha256:metadata.sha256,
    createdAt:photo.createdAt??metadata.createdAt??new Date().toISOString()
  };
}

export async function migrateLegacyAttachments(snapshot,attachmentStore,{actorId=null}={}){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('snapshot é obrigatório.');
  if(!attachmentStore?.put)throw new TypeError('attachmentStore é obrigatório.');
  const next=clone(snapshot),errors=[];let migrated=0;
  for(const inspection of next.inspections??[]){
    const photos=Array.isArray(inspection.photos)?inspection.photos:[];
    for(let index=0;index<photos.length;index+=1){
      const photo=photos[index];
      if(photo?.attachmentId)continue;
      if(!photo?.dataUrl)continue;
      try{
        const parsed=parseLegacyImageDataUrl(photo.dataUrl);
        const metadata=await attachmentStore.put({
          id:`ATT-${photo.id}`,
          entityType:'inspection',
          entityId:inspection.id,
          mimeType:parsed.mimeType,
          bytes:parsed.bytes,
          createdBy:actorId
        });
        if(!metadata?.id||!metadata?.sha256||!Number(metadata?.sizeBytes))throw new Error('Attachment não foi confirmado pelo armazenamento.');
        photos[index]=attachmentReference(photo,metadata);
        migrated+=1;
      }catch(error){
        errors.push({inspectionId:inspection.id,photoId:photo?.id??null,message:String(error?.message??error)});
      }
    }
  }
  return{snapshot:next,migrated,errors};
}
