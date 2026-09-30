import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { navHtml } from '../../../src/cloud/ui/common.mjs';
import { rentalsHtml } from '../../../src/cloud/ui/rentals.mjs';
import { billingHtml } from '../../../src/cloud/ui/billing.mjs';
import { financeHtml } from '../../../src/cloud/ui/finance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=join(root,'qa-artifacts','pwa-payments');
await mkdir(out,{recursive:true});
const css=(await Promise.all(['styles.css','styles-p1.css','styles-p2.css','styles-payments.css'].map(file=>readFile(join(root,file),'utf8')))).join('\n');
const user={id:'USR-GEORGE',name:'George',username:'georgedaut.adm@gmail.com',role:'admin',active:true};
const customer={id:'CUS-FRANCISCO',name:'FRANCISCO ROGERIO DE CASTRO AFONSO'};
const vehicle={id:'VEI-1',model:'Fiat Strada',plate:'ABC1D23',availability:'locado'};
const rental={id:'LOC-2027-01',customerId:customer.id,vehicleId:vehicle.id,status:'em_uso',periodMode:'continuous',pickupAt:'2027-04-24T12:00:00.000Z',returnAt:null,dailyRate:100,total:900,billingMode:'daily',priority:'Média',notes:'',payments:[]};
const dates=['2029-04-27','2027-07-03','2030-03-07','2027-04-26','2029-08-24','2027-09-05','2029-10-17','2027-12-13','2029-08-05'];
const installments=dates.map((dueAt,index)=>({id:`PAR-${index+1}`,rentalId:rental.id,customerId:customer.id,sequence:index+1,dueAt,amount:100,paidAmount:index===1?50:0,status:index===1?'partial':'open'}));
const ledger=installments.map(item=>({id:`FIN-${item.id}`,kind:'billing_receivable',rentalId:rental.id,installmentId:item.id,description:`Diária #${item.sequence}`,amount:item.amount,paidAmount:item.paidAmount,status:item.status,dueAt:item.dueAt}));
const snapshot={customers:[customer],vehicles:[vehicle],rentals:[rental],billingInstallments:installments,billingPlans:[],billingPayments:[],expenses:[],ledger,audit:[],maintenance:[],inspections:[],contractTemplates:[],issuedContracts:[],collectionActions:[],attachments:[],alertState:{},settings:{}};

function shell(view,content){return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="app-shell cloud-shell"><aside class="sidebar"><div class="brand"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Locadora George</strong></div></div><nav>${navHtml(user,view)}</nav><div class="sidebar-foot"><small>George</small><button type="button">Sair</button></div></aside><main class="workspace"><header class="topbar"><div><strong>Sincronizado</strong><small>Sessão validada pelo servidor</small></div><div class="actions"><button type="button">Atualizar</button><button type="button">Sincronizar</button></div></header><section id="cloud-view">${content}</section></main></div></body></html>`;}

const screens=[
  ['00-central-modulos-mobile.png','rentals',rentalsHtml(snapshot,user),true],
  ['01-cobrancas-mobile.png','billing',billingHtml(snapshot,user),false],
  ['02-locacoes-mobile.png','rentals',rentalsHtml(snapshot,user),false],
  ['03-financeiro-mobile.png','finance',financeHtml(snapshot,user),false]
];
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  for(const [file,view,content,openMenu] of screens){
    await page.setContent(shell(view,content),{waitUntil:'load'});
    if(openMenu)await page.locator('#cloud-mobile-menu').check({force:true});
    await page.screenshot({path:join(out,file),fullPage:true});
  }
}finally{await browser.close();}
console.log(`Capturas PWA salvas em ${out}`);
