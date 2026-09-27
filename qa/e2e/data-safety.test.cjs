'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {expect}=require('../artisys-qa/node_modules/playwright/test');
const {launchLocadora}=require('./fixtures/locadora-electron.cjs');
async function login(page,user='admin'){
 await page.getByLabel('Usuário',{exact:true}).fill(user);
 await page.getByLabel('Senha',{exact:true}).fill(process.env.LOCADORA_QA_ADMIN_PASSWORD);
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.locator('.session')).toBeVisible();
}
async function company(page,name){
 await page.locator('[data-nav="backup"]').click();
 await page.locator('#settings-form [name="companyName"]').fill(name);
 await page.locator('#settings-form button').click();
 await expect(page.locator('.toast').filter({hasText:'Configurações salvas.'}).last()).toBeVisible();
}
async function sync(page){
 await page.locator('.toast').evaluateAll(nodes=>nodes.forEach(node=>node.remove()));
 await page.locator('[data-nav="sync"]').click();
 await page.locator('#sync-now').click();
 await expect(page.locator('.toast').filter({hasText:'Sincronização concluída.'}).last()).toBeVisible();
}
test('backup: export, alter, restore, synchronize and reload preserve restored data',async()=>{
 const ctx=await launchLocadora();const errors=[];ctx.page.on('pageerror',e=>errors.push(e.message));
 try{
  const p=ctx.page;await login(p);await company(p,'Empresa do backup');await sync(p);
  await p.locator('[data-nav="backup"]').click();
  const backupPath=path.join(ctx.dir,'backup-exportado.json');
  // Electron owns native downloads; save the actual emitted DownloadItem.
  await ctx.app.evaluate(({session},file)=>{
   globalThis.qaDownload=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Electron backup download timeout')),30000);
    session.defaultSession.once('will-download',(_event,item)=>{
     item.setSavePath(file);
     item.once('done',(_event,state)=>{clearTimeout(timer);state==='completed'?resolve(state):reject(new Error(`Download ${state}`));});
    });
   });
   globalThis.qaDownload.catch(()=>{});
  },backupPath);
  await p.locator('#backup-create').click();
  assert.equal(await ctx.app.evaluate(()=>globalThis.qaDownload),'completed');
  const envelope=JSON.parse(await fs.readFile(backupPath,'utf8'));
  assert.equal(envelope.snapshot.settings.companyName,'Empresa do backup');
  await company(p,'Empresa alterada');await sync(p);
  await p.locator('[data-nav="backup"]').click();
  await p.locator('#backup-file').setInputFiles(backupPath);
  await expect(p.locator('.toast').filter({hasText:'Backup restaurado.'})).toBeVisible();
  await expect(p.locator('#settings-form [name="companyName"]')).toHaveValue('Empresa do backup');
  await sync(p);await p.reload();await login(p);
  await p.locator('[data-nav="backup"]').click();
  await expect(p.locator('#settings-form [name="companyName"]')).toHaveValue('Empresa do backup');
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
  // Configure only the disposable test database; exercise real login and UI permissions.
  await p.evaluate(async password=>{
   const key='app:snapshot:v3',snapshot=JSON.parse(await window.locadoraDesktop.dbGet(key));
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password)))).map(b=>b.toString(16).padStart(2,'0')).join('');
   for(const user of snapshot.users.filter(u=>['vistoria','atendente'].includes(u.username)))user.passwordHash=hash;
   await window.locadoraDesktop.dbSet(key,JSON.stringify(snapshot));
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
