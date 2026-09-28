import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const npx=process.platform==='win32'?'npx.cmd':'npx';
const args=['--yes','wrangler@4.140.0','d1','migrations','apply','db','--local','--config','wrangler.jsonc'];
const result=spawnSync(npx,args,{cwd:root,stdio:'inherit',env:{...process.env,CI:process.env.CI??'1'}});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
