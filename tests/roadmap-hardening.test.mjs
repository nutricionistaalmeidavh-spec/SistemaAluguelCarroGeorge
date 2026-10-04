import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../cloudflare/worker.mjs';
import { publicVersion } from '../cloudflare/config.mjs';
import { WORK_AREAS, rentalStatusLabel } from '../src/ui/semantics.mjs';
import { handleAuthRoute } from '../cloudflare/api/auth-routes.mjs';

const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('versão pública identifica build e commit sem depender de banco',async()=>{
  const info=publicVersion({BUILD_SHA:'abc123def456',BUILD_TIME:'2026-10-04T12:00:00.000Z'});
  assert.equal(info.ok,true);
  assert.equal(info.commit,'abc123def456');
  assert.equal(info.builtAt,'2026-10-04T12:00:00.000Z');
  const response=await worker.fetch(new Request('https://example.test/api/v1/version'),{BUILD_SHA:'abc123def456',BUILD_TIME:'2026-10-04T12:00:00.000Z'},{});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),info);
});

test('Desktop e PWA usam a mesma semântica para áreas e status de locação',async()=>{
  assert.deepEqual(WORK_AREAS.map(item=>item.label),['Hoje','Locações','Clientes','Frota','Financeiro']);
  assert.equal(rentalStatusLabel('reserva'),'Agendada');
  assert.equal(rentalStatusLabel('retirada'),'Retirada em andamento');
  assert.equal(rentalStatusLabel('em_uso'),'Em uso');
  assert.equal(rentalStatusLabel('devolucao'),'Finalizada');
  const [desktop,cloud]=await Promise.all([source('src/app.mjs'),source('src/cloud/ui/common.mjs')]);
  assert.match(desktop,/WORK_AREAS/);
  assert.match(cloud,/WORK_AREAS/);
});

test('login cloud não publica e-mail administrativo fixo no bundle',async()=>{
  const [desktop,cloud]=await Promise.all([source('src/app.mjs'),source('src/cloud-app.mjs')]);
  assert.doesNotMatch(desktop,/georgedaut\.adm@gmail\.com/i);
  assert.doesNotMatch(cloud,/georgedaut\.adm@gmail\.com/i);
  assert.match(cloud,/autocomplete="username"/);
});

test('recuperação de acesso é self-hosted por código de uso único',async()=>{
  const issued=[];
  const service={
    async issueRecoveryCode(auth){issued.push(auth.userId);return{code:'RECOVERY-TEST-CODE',expiresAt:'2026-10-05T12:00:00.000Z'};},
    async recoverAccess(input){assert.equal(input.username,'admin@example.test');assert.equal(input.recoveryCode,'RECOVERY-TEST-CODE');assert.match(input.newPasswordHash,/^pbkdf2-sha256\$/);return{ok:true};}
  };
  const auth={installationId:'INST-1',userId:'USR-1',role:'admin',active:true};
  const issue=await handleAuthRoute(new Request('https://example.test/api/v1/auth/recovery-code',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{}, {},{service,auth});
  assert.equal(issue.status,201);
  assert.equal((await issue.json()).recoveryCode,'RECOVERY-TEST-CODE');
  assert.deepEqual(issued,['USR-1']);
  const recover=await handleAuthRoute(new Request('https://example.test/api/v1/auth/recover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installationId:'INST-1',username:'admin@example.test',recoveryCode:'RECOVERY-TEST-CODE',newPassword:'nova-senha-segura'})}),{}, {},{service,auth:null});
  assert.equal(recover.status,200);
  assert.deepEqual(await recover.json(),{ok:true});
});

test('design system usa tokens e o CI possui gate de acessibilidade responsiva',async()=>{
  const [styles,pkg,ci]=await Promise.all([source('styles.css'),source('package.json'),source('.github/workflows/ci.yml')]);
  assert.match(styles,/--color-bg:/);
  assert.match(styles,/--color-primary:/);
  assert.match(styles,/var\(--color-primary\)/);
  const parsed=JSON.parse(pkg);
  assert.ok(parsed.devDependencies?.['axe-core']);
  assert.equal(typeof parsed.scripts?.['e2e:a11y'],'string');
  assert.match(ci,/Accessibility and responsive QA/);
  assert.match(ci,/npm run e2e:a11y/);
});

test('detalhes de build ficam somente em diagnóstico avançado',async()=>{
  const [desktopAdmin,cloudAdmin]=await Promise.all([source('src/ui/system.mjs'),source('src/cloud/ui/administration.mjs')]);
  assert.match(desktopAdmin,/data-build-version/);
  assert.match(cloudAdmin,/data-admin-build-version/);
  assert.match(desktopAdmin,/Diagnóstico avançado/);
  assert.match(cloudAdmin,/Diagnóstico avançado/);
});
