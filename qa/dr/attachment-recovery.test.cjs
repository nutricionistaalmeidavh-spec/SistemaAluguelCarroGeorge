'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {replicateAttachment}=require('../../electron/replica/cycle.cjs');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

test('anexo local perdido é recuperado do R2 e versão corrompida não substitui cópia boa',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'george-dr-attachment-')),target=path.join(root,'ATT-1.bin'),good=Buffer.from('foto-documento-integro'),meta={id:'ATT-1',sha256:sha(good)};
  try{
    const local={async putAttachment(_meta,data){const tmp=`${target}.tmp`;fs.writeFileSync(tmp,data);fs.renameSync(tmp,target);}};
    await replicateAttachment({attachment:async()=>good},local,meta);
    assert.equal(sha(fs.readFileSync(target)),meta.sha256);
    await assert.rejects(replicateAttachment({attachment:async()=>Buffer.from('objeto-r2-corrompido')},local,meta),error=>error?.code==='attachment_checksum_mismatch');
    assert.equal(sha(fs.readFileSync(target)),meta.sha256,'arquivo bom anterior deve permanecer intacto');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
