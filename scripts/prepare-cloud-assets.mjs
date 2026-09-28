import { cp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const output=join(root,'.cloudflare','public');
const files=['index.html','security.html','styles.css','styles-p1.css','styles-p2.css','manifest.webmanifest','sw.js'];
const directories=['src','assets',join('vendor','sqlite')];

await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const file of files)await cp(join(root,file),join(output,file));
for(const directory of directories){
  const source=join(root,directory);
  try{await readdir(source);}catch{continue;}
  await mkdir(join(output,directory),{recursive:true});
  await cp(source,join(output,directory),{recursive:true});
}
const cloudIndexPath=join(output,'index.html');
let cloudIndex=await readFile(cloudIndexPath,'utf8');
const marker='  <meta name="locadora-runtime" content="cloud" />\n';
if(!cloudIndex.includes('name="locadora-runtime"'))cloudIndex=cloudIndex.replace('  <meta name="viewport" content="width=device-width,initial-scale=1" />\n',`  <meta name="viewport" content="width=device-width,initial-scale=1" />\n${marker}`);
const securityShortcut='  <a id="cloud-security-console" href="./security.html" style="position:fixed;right:16px;bottom:16px;z-index:9999" aria-label="Segurança e recuperação">Segurança</a>\n';
if(!cloudIndex.includes('id="cloud-security-console"'))cloudIndex=cloudIndex.replace('</body>',`${securityShortcut}</body>`);
await writeFile(cloudIndexPath,cloudIndex,'utf8');
console.log(`Cloud PWA assets preparados em ${output}`);
