const test=require('node:test');const assert=require('node:assert/strict');const {expect}=require('@playwright/test');
const {launchLocadora,login}=require('./helpers.cjs');

test('backup: export, alter, restore, synchronize and reload preserve restored data',async()=>{
 const ctx=await launchLocadora();
 try{
  const p=ctx.page;await login(p);
  await p.locator('[data-nav="backup"]').click();
  await p.locator('#settings-form [name="companyName"]').fill('Empresa do backup');
  await p.locator('#settings-form button[type="submit"]').click();
  const download=await Promise.all([p.waitForEvent('download'),p.locator('#backup-create').click()]).then(([item])=>item);
  const backup=await require('node:fs/promises').readFile(await download.path(),'utf8');
  const envelope=JSON.parse(backup);
  await p.locator('#settings-form [name="companyName"]').fill('Empresa alterada');
  await p.locator('#settings-form button[type="submit"]').click();
  await p.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await expect(p.locator('.toast').filter({hasText:'Backup restaurado'})).toBeVisible();
  await expect(p.locator('#settings-form [name="companyName"]')).toHaveValue('Empresa do backup');
  await p.locator('[data-nav="sync"]').click();
  if(await p.locator('#sync-now').count())await p.locator('#sync-now').click();
  await p.reload();await login(p);await p.locator('[data-nav="backup"]').click();
  await expect(p.locator('#settings-form [name="companyName"]')).toHaveValue('Empresa do backup');
  const errors=ctx.errors;
  // Reject a modified backup without changing the persisted data.
  envelope.snapshot.settings.companyName='Backup adulterado';
  await p.locator('#backup-file').setInputFiles({name:'corrompido.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(envelope))});
  await expect(p.locator('.toast').filter({hasText:'Falha de integridade'})).toBeVisible();
  await expect(p.locator('#settings-form [name="companyName"]')).toHaveValue('Empresa do backup');
  assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});
test('permissions: inspector and attendant respect read, write and restore restrictions',async()=>{
 const ctx=await launchLocadora();
 try{
  const p=ctx.page;await p.locator('#login').waitFor();
  // Configure only the disposable test database through the same snapshot boundary used by the desktop repository.
  await p.evaluate(async password=>{
   const snapshot=JSON.parse(await window.locadoraDesktop.snapshotLoad());
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password)))).map(b=>b.toString(16).padStart(2,'0')).join('');
   for(const user of snapshot.users.filter(u=>['vistoria','atendente'].includes(u.username)))user.passwordHash=hash;
   await window.locadoraDesktop.snapshotSave(snapshot);
  },process.env.LOCADORA_QA_ADMIN_PASSWORD);
  await p.reload();await login(p,'vistoria');
  await p.locator('[data-nav="frota"]').click();await expect(p.locator('#view h1')).toHaveText('Frota');
  await expect(p.locator('#new-vehicle')).toHaveCount(0);
  for(const id of ['financeiro','backup','auditoria','clientes','cobrancas'])await expect(p.locator(`[data-nav="${id}"]`)).toHaveCount(0);
  await p.locator('[data-nav="reservas"]').click();await expect(p.locator('#new-rental')).toHaveCount(0);
  await p.locator('[data-nav="vistorias"]').click();await expect(p.locator('#view h1')).toHaveText('Vistorias');
  await p.locator('#logout').click();await login(p,'atendente');
  await p.locator('[data-nav="backup"]').click();
  await expect(p.locator('#backup-create')).toBeVisible();
  await expect(p.locator('#backup-file')).toHaveCount(0);
  await expect(p.locator('#settings-form')).toHaveCount(0);
  await expect(p.locator('[data-nav="auditoria"]')).toHaveCount(0);
  await p.locator('[data-nav="frota"]').click();await expect(p.locator('#new-vehicle')).toBeVisible();
 }finally{await ctx.close();}
});
