'use strict';
const fs=require('node:fs'),path=require('node:path'); const ROOT=path.resolve(__dirname,'..');
const readDir=(dir,ext)=>fs.readdirSync(path.join(ROOT,dir)).filter(x=>x.endsWith(ext)).map(x=>fs.readFileSync(path.join(ROOT,dir,x),'utf8')).join('\n');
const tests=readDir('tests','.test.mjs');
const e2e=fs.existsSync(path.join(ROOT,'qa','e2e'))?readDir('qa/e2e','.test.cjs'):'';
const flows=fs.readdirSync(path.join(ROOT,'qa','artisys-qa','flows','locadora')).filter(x=>x.endsWith('.json')).map(x=>fs.readFileSync(path.join(ROOT,'qa','artisys-qa','flows','locadora',x),'utf8')).join('\n');
const checks=[
 ['Auth/RBAC',['authenticate','can('],['login','Usuário ou senha inválidos']],
 ['Clientes/Frota',['addCustomer','addVehicle'],['clientes','frota']],
 ['Reservas',['createRental','moveRental'],['reservas','new-rental']],
 ['Vistorias',['createInspection','completeInspection'],['vistorias','Vistorias']],
 ['Manutenção',['scheduleMaintenance','completeMaintenance'],['manutencao','Manutenção']],
 ['Financeiro',['registerPayment','getFinancialSummary'],['financeiro','Financeiro']],
 ['Backup',['createBackupEnvelope','restoreBackupEnvelope'],['backup','Backup']],
 ['Sync',['exchangeSnapshots','mergeSnapshots'],['sync','PC ↔ Mobile']],
 ['Comercial',['createBillingPlan','delinquencySummary'],['cobrancas','inadimplencia']]
];
let fail=[];const rows=checks.map(([area,code,user])=>{const domain=code.every(t=>tests.includes(t));const pathOk=user.some(t=>e2e.includes(t)||flows.includes(t));if(!domain||!pathOk)fail.push(area);return {area,domain,pathOk};});
const out=['# Locadora vertical coverage','','| Área | Regra/domínio testado | Caminho UI/E2E |','|---|---:|---:|',...rows.map(r=>`| ${r.area} | ${r.domain?'yes':'NO'} | ${r.pathOk?'yes':'NO'} |`),'',`Covered: ${rows.length-fail.length}/${rows.length}`].join('\n');
fs.mkdirSync(path.join(ROOT,'qa','reports'),{recursive:true});fs.writeFileSync(path.join(ROOT,'qa','reports','vertical-coverage.md'),out);
console.log(out);if(fail.length){console.error('Missing vertical coverage:',fail.join(', '));process.exit(1);}
