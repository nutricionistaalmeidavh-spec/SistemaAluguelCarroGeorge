'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const required=[
  'db/migrations/0009_plan03_dr.sql','electron/replica/agent.cjs','electron/replica/cloud-client.cjs','electron/replica/sqlite-replica-store.cjs','electron/backup/local-backup.cjs','electron/backup/restore.cjs','electron/diagnostics.cjs','electron/migration/cloud-first-migration.cjs','cloudflare/backup/r2-backup.mjs','cloudflare/backup/restore.mjs','cloudflare/security/hardening.mjs','cloudflare/api/migration-routes.mjs','security.html','src/security-app.mjs',
  'qa/dr/new-device.test.cjs','qa/dr/offline-reconnect.test.cjs','qa/dr/idempotent-payment.test.cjs','qa/dr/desktop-catchup.test.cjs','qa/dr/desktop-rebuild.test.cjs','qa/dr/attachment-recovery.test.cjs','qa/dr/restore-stale-device.test.cjs','qa/dr/concurrent-conflicts.test.cjs','qa/dr/cloud-first-bootstrap.test.cjs',
  'docs/runbooks/george-device-loss.md','docs/runbooks/george-pc-rebuild.md','docs/runbooks/george-cloud-restore.md','docs/runbooks/george-electron-update-reinstall.md','docs/runbooks/george-backup-verification.md','docs/runbooks/manual-operacao-cloud.md','docs/runbooks/migracao-versao-cloud.md','docs/runbooks/cloud-disaster-recovery.md',
  '.github/workflows/ci.yml','.github/workflows/windows-build.yml'
];
const missing=required.filter(file=>!fs.existsSync(path.join(root,file)));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),windows=fs.readFileSync(path.join(root,'.github/workflows/windows-build.yml'),'utf8'),ci=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'),cloudAssets=fs.readFileSync(path.join(root,'scripts/prepare-cloud-assets.mjs'),'utf8'),main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8'),preload=fs.readFileSync(path.join(root,'electron/preload.cjs'),'utf8'),app=fs.readFileSync(path.join(root,'src/app.mjs'),'utf8'),readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
const failures=[];
if(missing.length)failures.push(`arquivos ausentes: ${missing.join(', ')}`);
if(!pkg.scripts?.['dr:test'])failures.push('script dr:test ausente');
if(!pkg.scripts?.['cloud:migrations:local'])failures.push('gate de migrations cloud ausente');
if(!pkg.scripts?.check?.includes('cloudflare/api/migration-routes.mjs'))failures.push('migration-routes fora do gate estático');
if(!pkg.scripts?.['check:plan03']?.includes('electron/migration/cloud-first-migration.cjs'))failures.push('preflight de migração fora do gate plan03');
if(!windows.includes('npm run dist'))failures.push('workflow Windows não gera instalador');
if(!windows.includes('npm run dr:test'))failures.push('workflow Windows não executa DR');
if(!ci.includes('npm run dr:test'))failures.push('CI Linux não executa DR');
if(!cloudAssets.includes("'security.html'"))failures.push('console de segurança não é publicada nos assets cloud');
if(/startSyncServer|locadora:sync-info|pairingUrls/.test(main))failures.push('runtime LAN voltou ao processo principal');
if(/getSyncInfo|locadora:sync-info/.test(preload))failures.push('bridge LAN voltou ao renderer');
if(/PC ↔ Mobile|Token de pareamento|Servidor do PC/.test(app))failures.push('UI LAN voltou ao produto');
if(!/D1/.test(readme)||!/R2/.test(readme)||!/mesma conta/i.test(readme))failures.push('README cloud-first incompleto');
if(!/locadora:cloud-devices:list/.test(main)||!/locadora:migration:status/.test(main))failures.push('gestão de dispositivo/migração ausente do desktop');
const report={ok:failures.length===0,checkedAt:new Date().toISOString(),requiredFiles:required.length,failures};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(root,'artifacts','plan03-release-gate.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
