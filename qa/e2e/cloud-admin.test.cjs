'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

test('PWA mobile administra empresa, auditoria, backups e dispositivos sem Electron',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());const {page,db,installationId}=fx;await fx.login();
  await fx.openModule('administration');
  await page.locator('[data-test="admin-screen"]').waitFor();
  assert.equal(await page.locator('[data-test="admin-settings"]').isVisible(),true,'Empresa deve abrir por padrão');
  for(const selector of ['[data-test="admin-backups"]','[data-test="admin-devices"]','[data-test="admin-audit"]'])assert.equal(await page.locator(selector).isVisible(),false,`${selector} deve iniciar recolhido`);

  const form=page.locator('#admin-settings-form');
  await form.locator('input[name="companyName"]').fill('Locadora George QA');
  await form.locator('input[name="document"]').fill('12345678900');
  await form.locator('input[name="phone"]').fill('16999999999');
  await form.locator('input[name="address"]').fill('Rua QA, 100');
  await form.locator('button').click();
  await page.getByText('Configurações salvas.').waitFor();
  const settings=JSON.parse(db.sqlite.prepare('SELECT settings_json FROM app_settings WHERE installation_id=?').get(installationId).settings_json);
  assert.equal(settings.companyName,'Locadora George QA');
  assert.equal(db.scalar('SELECT COUNT(*) FROM audit_log WHERE installation_id=? AND action=?',installationId,'settings.update'),1);

  await page.locator('[data-admin-tab="backup"]').click();
  await page.locator('#admin-backup-create').click();
  await page.getByText('Backup cloud concluído.').waitFor();
  assert.equal(db.scalar('SELECT COUNT(*) FROM cloud_backups WHERE installation_id=? AND status=?',installationId,'valid'),1);
  const restoreButton=page.locator('[data-admin-restore]').first();await restoreButton.waitFor();await restoreButton.click();
  const restoreForm=page.locator('#admin-restore-form');assert.equal(await restoreForm.isVisible(),true);assert.equal(await restoreForm.locator('input[name="password"]').getAttribute('type'),'password');assert.equal(await restoreForm.locator('input[name="confirmation"]').count(),1);

  await page.locator('#admin-restore-cancel').click();
  await page.locator('[data-admin-tab="security"]').click();
  const devices=page.locator('[data-admin-devices-body] tr');assert.ok(await devices.count()>=1,'deveria listar o PWA autenticado como dispositivo');
  await page.locator('[data-admin-tab="audit"]').click();
  await page.locator('#admin-audit-filter input[name="action"]').fill('settings.update');await page.getByRole('button',{name:'Filtrar'}).click();
  await page.locator('[data-admin-audit-body]').getByText('settings.update').waitFor();
});
