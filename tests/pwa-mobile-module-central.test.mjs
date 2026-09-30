import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mobileNavigationGroups,mobileNavHtml,mobileLabelFor } from '../src/cloud/ui/common.mjs';

const admin={id:'USR',role:'admin',permissions:['*']};

test('central mobile segue a ordem operacional aprovada',()=>{
  const groups=mobileNavigationGroups(admin);
  assert.deepEqual(groups.map(group=>group.items.map(item=>item.id)),[
    ['overview','rentals','customers','billing','inspections'],
    ['finance','delinquency','vehicles','maintenance'],
    ['contracts','documents','alerts','administration']
  ]);
  assert.equal(mobileLabelFor('inspections','Vistorias'),'Vistoria');
  assert.equal(mobileLabelFor('administration','Administração'),'Configurações');
});

test('central mobile mantém data-cloud-nav e não duplica permissões',()=>{
  const html=mobileNavHtml(admin,'rentals');
  for(const id of ['overview','rentals','customers','billing','inspections','finance','delinquency','vehicles','maintenance','contracts','documents','alerts','administration']){
    assert.match(html,new RegExp(`data-cloud-nav="${id}"`));
  }
  assert.match(html,/Configurações/);
  assert.match(html,/Vistoria/);
  assert.match(html,/aria-current="page"/);
});

test('shell mobile usa central de módulos em vez de navegação horizontal',async()=>{
  const [app,styles]=await Promise.all([
    readFile(new URL('../src/cloud-app.mjs',import.meta.url),'utf8'),
    readFile(new URL('../styles.css',import.meta.url),'utf8')
  ]);
  assert.match(app,/id="cloud-mobile-menu"/);
  assert.match(app,/data-test="mobile-module-central"/);
  assert.match(app,/mobileNavHtml\(user,safeView\)/);
  assert.match(styles,/\.mobile-appbar\{/);
  assert.match(styles,/\.mobile-module-grid\{/);
  assert.match(styles,/@media\(max-width:900px\)[\s\S]*?\.cloud-shell \.sidebar\{display:none/);
  assert.doesNotMatch(styles,/@media\(max-width:900px\)[\s\S]*?\.sidebar nav\{display:flex;overflow:auto/);
});
