'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'qa','dr'),files=fs.readdirSync(dir).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>path.join('qa','dr',name));
if(!files.length){console.error('Nenhum teste DR encontrado.');process.exit(2);}
console.log(`Executando ${files.length} cenários DR em série...`);
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
if(result.error)throw result.error;
process.exit(result.status??1);
