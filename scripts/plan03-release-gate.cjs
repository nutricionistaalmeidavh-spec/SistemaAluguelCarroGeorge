'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const required=[
  'db/migrations/0009_plan03_dr.sql','electron/replica/agent.cjs','electron/replica/cloud-client.cjs','electron/replica/sqlite-replica-store.cjs','electron/backup/local-backup.cjs','electron/backup/restore.cjs','electron/diagnostics.cjs','cloudflare/backup/r2-backup.mjs','cloudflare/backup/restore.mjs','cloudflare/security/hardening.mjs',
  'qa/dr/new-device.test.cjs','qa/dr/offline-reconnect.test.cjs','qa/dr/idempotent-payment.test.cjs','qa/dr/desktop-catchup.test.cjs','qa/dr/desktop-rebuild.test.cjs','qa/dr/attachment-recovery.test.cjs','qa/dr/restore-stale-device.test.cjs','qa/dr/concurrent-conflicts.test.cjs',
  'docs/runbooks/george-device-loss.md','docs/runbooks/george-pc-rebuild.md','docs/runbooks/george-cloud-restore.md','docs/runbooks/george-electron-update-reinstall.md','docs/runbooks/george-backup-verification.md',
  '.github/workflows/ci.yml','.github/workflows/windows-build.yml'
];
const missing=required.filter(file=>!fs.existsSync(path.join(root,file)));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),windows=fs.readFileSync(path.join(root,'.github/workflows/windows-build.yml'),'utf8'),ci=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
const failures=[];if(missing.length)failures.push(`arquivos ausentes: ${missing.join(', ')}`);if(!pkg.scripts?.['dr:test'])failures.push('script dr:test ausente');if(!pkg.scripts?.['cloud:migrations:local'])failures.push('gate de migrations cloud ausente');if(!windows.includes('npm run dist'))failures.push('workflow Windows não gera instalador');if(!windows.includes('npm run dr:test'))failures.push('workflow Windows não executa DR');if(!ci.includes('npm run dr:test'))failures.push('CI Linux não executa DR');
const report={ok:failures.length===0,checkedAt:new Date().toISOString(),requiredFiles:required.length,failures};fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts','plan03-release-gate.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failures.length)process.exit(1);
