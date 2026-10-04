import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const rootUrl=new URL('../',import.meta.url),root=fileURLToPath(rootUrl);
const pkg=JSON.parse(await readFile(new URL('package.json',rootUrl),'utf8'));
function gitSha(){try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return'';}}
const commit=String(process.env.BUILD_SHA||process.env.GITHUB_SHA||gitSha()||'unknown').trim(),builtAt=String(process.env.BUILD_TIME||new Date().toISOString()),data={appVersion:String(pkg.version||'0.0.0'),commit,builtAt};
const output=`export const BUILD_INFO=Object.freeze(${JSON.stringify(data,null,2)});\nexport function shortBuildCommit(value=BUILD_INFO.commit){const commit=String(value??'').trim();return commit&&commit!=='development'&&commit!=='unknown'?commit.slice(0,8):commit||'unknown';}\n`;
await writeFile(new URL('src/build-info.mjs',rootUrl),output,'utf8');console.log(`build metadata: ${data.appVersion} @ ${commit.slice(0,12)}`);
