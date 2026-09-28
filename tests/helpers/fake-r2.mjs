function cloneBytes(value){
  if(value instanceof ArrayBuffer)return new Uint8Array(value.slice(0));
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));
  if(typeof value==='string')return new TextEncoder().encode(value);
  if(value instanceof Blob)return null;
  throw new TypeError('unsupported fake r2 value');
}

export class FakeR2{
  constructor(){this.objects=new Map();this.failDelete=false;this.putCalls=[];this.deleteCalls=[];}
  async put(key,value,options={}){
    let bytes=cloneBytes(value);if(bytes===null)bytes=new Uint8Array(await value.arrayBuffer());
    const object={key,size:bytes.byteLength,etag:`etag-${this.objects.size+1}`,httpEtag:`\"etag-${this.objects.size+1}\"`,uploaded:new Date(),httpMetadata:{...(options.httpMetadata??{})},customMetadata:{...(options.customMetadata??{})}};
    this.objects.set(key,{object,bytes:new Uint8Array(bytes)});this.putCalls.push({key,options});return object;
  }
  async get(key){
    const found=this.objects.get(key);if(!found)return null;
    const bytes=new Uint8Array(found.bytes);
    return{...found.object,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),writeHttpMetadata(headers){for(const [name,value] of Object.entries(found.object.httpMetadata??{}))if(value!=null)headers.set(name,value);}};
  }
  async head(key){const found=this.objects.get(key);return found?{...found.object}:null;}
  async delete(key){this.deleteCalls.push(key);if(this.failDelete)throw new Error('fake_r2_delete_failure');for(const item of Array.isArray(key)?key:[key])this.objects.delete(item);}
  async list({prefix='',limit=1000,cursor}={}){
    const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix)).sort();
    const start=cursor?Number(cursor):0,end=Math.min(keys.length,start+limit);
    return{objects:keys.slice(start,end).map(key=>({...this.objects.get(key).object})),truncated:end<keys.length,cursor:end<keys.length?String(end):undefined,delimitedPrefixes:[]};
  }
}
