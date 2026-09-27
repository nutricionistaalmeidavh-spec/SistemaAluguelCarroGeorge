import { mkdir,copyFile,access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'node_modules','sql.js','dist');
const target=path.join(root,'vendor','sqlite');
await mkdir(target,{recursive:true});
for(const name of ['sql-wasm.js','sql-wasm.wasm']){
  await access(path.join(source,name));
  await copyFile(path.join(source,name),path.join(target,name));
}
console.log('SQLite WASM vendorizado em vendor/sqlite.');
