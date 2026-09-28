import test from 'node:test';
import assert from 'node:assert/strict';

async function load(relative){try{return await import(new URL(relative,import.meta.url));}catch(error){assert.fail(`Plano 03 ausente: ${relative}: ${error.message}`);}}

test('backup cloud só fica válido depois de manifest e hashes completos',async()=>{
  const {buildLogicalBackup,validateLogicalBackup}=await load('../cloudflare/backup/logical-backup.mjs');
  const backup=await buildLogicalBackup({installationId:'LOCADORA-GEORGE',restoreGeneration:2,tables:{customers:[{id:'C1'}],vehicles:[{id:'V1'}]},createdAt:'2026-09-27T12:00:00.000Z'});
  assert.equal(backup.manifest.status,'valid');assert.equal(validateLogicalBackup(backup),true);assert.match(backup.manifest.exportSha256,/^[a-f0-9]{64}$/);
  const incomplete=structuredClone(backup);delete incomplete.manifest.exportSha256;assert.equal(validateLogicalBackup(incomplete),false);
});
