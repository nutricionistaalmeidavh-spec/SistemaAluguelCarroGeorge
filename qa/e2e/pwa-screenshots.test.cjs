'use strict';
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

const OUT=path.resolve(__dirname,'..','..','qa-artifacts','pwa-screenshots');

async function shot(page,name){
  fs.mkdirSync(OUT,{recursive:true});
  await page.waitForTimeout(150);
  await page.screenshot({path:path.join(OUT,name),fullPage:false});
}

test('captura visual do PWA mobile para revisão',async t=>{
  const fx=await launchCloudPwa();
  t.after(()=>fx.close());
  const {page}=fx;
  await page.setViewportSize({width:390,height:844});

  await shot(page,'01-login.png');
  await fx.login();
  await shot(page,'02-hoje.png');

  const appbar=page.locator('.mobile-appbar[for="cloud-mobile-menu"]');
  await appbar.click();
  await page.waitForFunction(()=>document.querySelector('#cloud-mobile-menu')?.checked===true);
  await shot(page,'03-menu.png');

  for(const [id,file] of [
    ['rentals','04-locacoes.png'],
    ['customers','05-clientes.png'],
    ['vehicles','06-frota.png'],
    ['finance','07-financeiro.png'],
    ['administration','08-configuracoes.png']
  ]){
    await fx.openModule(id);
    await shot(page,file);
  }

  const security=page.locator('[data-admin-tab="security"]');
  await security.waitFor({state:'visible'});
  await security.click();
  await shot(page,'09-configuracoes-seguranca.png');
});
