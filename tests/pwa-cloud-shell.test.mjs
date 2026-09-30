import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shell do PWA possui layout próprio e navegação mobile sem scroll lateral',async()=>{
  const [styles,paymentStyles]=await Promise.all([
    readFile(new URL('../styles.css',import.meta.url),'utf8'),
    readFile(new URL('../styles-payments.css',import.meta.url),'utf8')
  ]);
  assert.match(styles,/\.app-shell\{/,'app-shell precisa receber o grid do layout cloud');
  assert.match(styles,/\.cloud-shell #cloud-view\{/,'conteúdo cloud precisa de padding próprio');
  assert.match(styles,/\.sidebar-foot\{/,'rodapé do usuário precisa de layout próprio');
  assert.match(paymentStyles,/grid-template-columns:minmax\(0,1fr\)/,'grid mobile não pode crescer pela largura mínima da navegação');
  assert.match(paymentStyles,/grid-template-rows:auto 1fr/,'shell mobile precisa manter topo e conteúdo separados');
  assert.match(paymentStyles,/\.mobile-appbar\{/,'mobile precisa expor um único acesso à central de módulos');
  assert.match(paymentStyles,/\.mobile-module-grid\{display:grid/,'central precisa organizar os módulos em cards');
  assert.match(paymentStyles,/\.sidebar nav\{display:block;min-width:0;max-width:100%;overflow:visible\}/,'menu mobile não pode depender de scroll horizontal');
});
