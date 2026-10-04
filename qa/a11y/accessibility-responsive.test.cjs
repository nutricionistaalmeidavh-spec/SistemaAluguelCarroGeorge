'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {launchCloudPwa}=require('../e2e/fixtures/cloud-pwa.cjs');

async function assertNoSeriousA11y(page,label){
  const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
  await page.addScriptTag({content:axeSource});
  const result=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
  const blocking=result.violations.filter(item=>['critical','serious'].includes(item.impact));
  assert.deepEqual(blocking.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.length})),[],label);
}

test('PWA permanece operável e sem violações graves em viewports críticos',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());const {page}=fx;
  await fx.login();
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:768,height:1024}]){
    await page.setViewportSize(viewport);
    await page.waitForTimeout(50);
    const overflow=await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-window.innerWidth);
    assert.ok(overflow<=1,`overflow horizontal em ${viewport.width}px: ${overflow}px`);
  }
  await assertNoSeriousA11y(page,'Hoje');
  await fx.openModule('rentals');
  await assertNoSeriousA11y(page,'Locações');
  await fx.openModule('finance');
  await assertNoSeriousA11y(page,'Financeiro');
});

test('menu mobile e ações principais são navegáveis por teclado',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());const {page}=fx;await fx.login();
  await page.setViewportSize({width:390,height:844});
  const appbar=page.locator('.mobile-appbar[for="cloud-mobile-menu"]');
  await appbar.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#cloud-mobile-menu').isChecked(),true);
  const first=page.locator('[data-test="mobile-module-central"] [data-cloud-nav]').first();
  await first.focus();
  assert.ok(await first.evaluate(node=>node===document.activeElement));
});
