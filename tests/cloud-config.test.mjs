import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJsonc(path){
  const raw=await readFile(new URL(`../${path}`,import.meta.url),'utf8');
  return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,''));
}

test('Cloudflare config declara Worker, assets, D1 e R2 sem segredos reais',async()=>{
  const config=await readJsonc('wrangler.jsonc');
  assert.equal(config.main,'cloudflare/worker.mjs');
  assert.equal(config.compatibility_date,'2026-09-27');
  assert.equal(config.assets?.directory,'.');
  assert.equal(config.assets?.binding,'ASSETS');
  assert.equal(config.d1_databases?.length,1);
  assert.equal(config.d1_databases[0].binding,'DB');
  assert.equal(config.d1_databases[0].migrations_dir,'db/migrations');
  assert.equal(config.r2_buckets?.length,1);
  assert.equal(config.r2_buckets[0].binding,'ATTACHMENTS');
  const serialized=JSON.stringify(config);
  assert.doesNotMatch(serialized,/api[_-]?token|secret|password/i);
  assert.match(config.d1_databases[0].database_id,/LOCAL|PLACEHOLDER/i);
  assert.match(config.r2_buckets[0].bucket_name,/local|dev/i);
});

test('Worker mínimo expõe health sem exigir bindings de banco',async()=>{
  const {default:worker}=await import('../cloudflare/worker.mjs');
  const response=await worker.fetch(new Request('https://example.test/api/v1/health'),{},{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',/application\/json/);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(typeof body.appVersion,'string');
  assert.equal(typeof body.schemaVersion,'number');
});
