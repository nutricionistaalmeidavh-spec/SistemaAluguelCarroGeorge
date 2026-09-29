'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

const MIME=Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.cjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon'
});
function mimeType(file){return MIME[path.extname(file).toLowerCase()]||'application/octet-stream';}
function createAppProtocolHandler({rootDir}={}){
  const root=path.resolve(String(rootDir||''));
  if(!rootDir)throw new TypeError('app_protocol_root_required');
  return async function handle(request){
    const url=new URL(request.url);
    let relative=decodeURIComponent(url.pathname||'/');
    if(relative==='/'||relative==='')relative='/index.html';
    relative=relative.replace(/^[/\\]+/,'');
    const file=path.resolve(root,relative);
    if(file!==root&&!file.startsWith(`${root}${path.sep}`))return new Response('Forbidden',{status:403,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
    try{
      const body=await fs.readFile(file);
      return new Response(body,{status:200,headers:{'content-type':mimeType(file),'cache-control':'no-store'}});
    }catch(error){
      if(error?.code==='ENOENT'||error?.code==='EISDIR')return new Response('Not found',{status:404,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
      throw error;
    }
  };
}
module.exports={createAppProtocolHandler,mimeType};
