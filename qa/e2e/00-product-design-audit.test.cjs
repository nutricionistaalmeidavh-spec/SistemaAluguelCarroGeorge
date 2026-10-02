'use strict';
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

const OUTPUT=path.resolve('qa-artifacts/product-design-mobile-audit');
fs.mkdirSync(OUTPUT,{recursive:true});

async function shot(page,name){
  await page.waitForTimeout(250);
  await page.screenshot({path:path.join(OUTPUT,name),fullPage:true});
}

test('Product Design audit: captura telas principais do PWA mobile',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());const {page}=fx;
  await fx.login();
  await shot(page,'01-overview.png');
  const modules=[
    ['customers','02-customers.png'],
    ['vehicles','03-vehicles.png'],
    ['rentals','04-rentals.png'],
    ['inspections','05-inspections.png'],
    ['finance','06-finance.png'],
    ['billing','07-billing.png'],
    ['delinquency','08-delinquency.png'],
    ['contracts','09-contracts.png'],
    ['documents','10-documents.png'],
    ['alerts','11-alerts.png'],
    ['maintenance','12-maintenance.png'],
    ['administration','13-administration.png']
  ];
  for(const [id,name] of modules){
    await fx.openModule(id);
    await page.locator('#cloud-view').waitFor({state:'visible'});
    await shot(page,name);
  }
});
