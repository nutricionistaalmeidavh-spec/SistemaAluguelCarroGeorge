import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shell do PWA possui layout próprio e espaçamento responsivo do conteúdo',async()=>{
  const styles=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(styles,/\.app-shell\{/,'app-shell precisa receber o grid do layout cloud');
  assert.match(styles,/\.cloud-shell #cloud-view\{/,'conteúdo cloud precisa de padding próprio');
  assert.match(styles,/\.sidebar-foot\{/,'rodapé do usuário precisa de layout próprio');
});
