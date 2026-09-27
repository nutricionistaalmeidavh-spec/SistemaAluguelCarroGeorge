import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function text(path){return readFile(new URL(`../${path}`, import.meta.url),'utf8');}

test('build Windows usa identidade exclusiva do George', async()=>{
  const pkg=JSON.parse(await text('package.json'));
  assert.equal(pkg.name,'locadoracarros-george');
  assert.equal(pkg.build.appId,'com.artisys.locadora.george');
  assert.equal(pkg.build.productName,'Sistema Locadora George');
  assert.equal(pkg.build.executableName,'Sistema-Locadora-George');
  assert.equal(pkg.build.artifactName,'Sistema-Locadora-George-Setup-${version}.${ext}');
  assert.equal(pkg.build.nsis.shortcutName,'Sistema Locadora George');
  assert.equal(pkg.build.nsis.uninstallDisplayName,'Sistema Locadora George');
});

test('desktop usa AppData, sessionData, AUMID e SQLite exclusivos do George', async()=>{
  const source=await text('electron/main.cjs');
  assert.match(source,/Sistema Locadora George/);
  assert.match(source,/com\.artisys\.locadora\.george/);
  assert.match(source,/app\.setAppUserModelId/);
  assert.match(source,/app\.setPath\('userData'/);
  assert.match(source,/app\.setPath\('sessionData'/);
  assert.match(source,/mkdirSync\([^\n]+recursive:true/);
  assert.match(source,/locadora-george\.sqlite/);
  assert.doesNotMatch(source,/path\.join\(userData,'locadora\.sqlite'\)/);
});

test('PWA usa identidade, armazenamento e cache exclusivos do George', async()=>{
  const storage=await text('src/storage/pwa-sqlite.mjs');
  const sw=await text('sw.js');
  const manifest=JSON.parse(await text('manifest.webmanifest'));
  const index=await text('index.html');
  assert.match(storage,/DB_FILE='locadora-george\.sqlite'/);
  assert.match(storage,/IDB_NAME='artisys-locadora-george-web'/);
  assert.match(sw,/CACHE_PREFIX='artisys-locadora-george-'/);
  assert.match(sw,/key\.startsWith\(CACHE_PREFIX\)&&key!==CACHE/);
  assert.equal(manifest.id,'artisys-locadora-george');
  assert.equal(manifest.name,'Sistema Locadora George');
  assert.equal(manifest.short_name,'Locadora George');
  assert.match(index,/<title>Sistema Locadora George<\/title>/);
});

test('workflow publica artefato George sem confundir com o produto base', async()=>{
  const workflow=await text('.github/workflows/windows-build.yml');
  assert.match(workflow,/Sistema-Locadora-George-Windows/);
  assert.match(workflow,/Sistema-Locadora-George-Setup-\*\.exe/);
});
