import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {buildCloudOperations}=require('../electron/cloud-sync-operations.cjs');
const {createDesktopCloudSyncController}=require('../electron/cloud-sync-controller.cjs');
const {ReplicaAgent}=require('../electron/replica/agent.cjs');

function baseSnapshot(){return{
  version:4,customers:[],vehicles:[],rentals:[],expenses:[],users:[],ledger:[],audit:[],inspections:[],maintenance:[],
  contractTemplates:[],issuedContracts:[],billingPlans:[],billingInstallments:[],collectionActions:[],settings:{companyName:'George'},alertState:{},
  updatedAt:'2026-09-29T12:00:00.000Z'
};}

test('fase 4: snapshot inalterado não gera operações cloud',()=>{
  const before=baseSnapshot(),after=structuredClone(before);
  assert.deepEqual(buildCloudOperations(before,after),[]);
});

test('fase 4: gera operações semânticas idempotentes para cadastros e locação',()=>{
  const before=baseSnapshot(),after=baseSnapshot();
  after.customers.push({id:'CLI-PC-1',name:'Cliente PC',document:'123',phone:'16999999999',email:'pc@example.test',address:'Rua A',active:true,createdAt:'2026-09-29T12:01:00.000Z',updatedAt:'2026-09-29T12:01:00.000Z'});
  after.vehicles.push({id:'VEI-PC-1',model:'Onix',plate:'ABC1D23',year:'2025',mileage:100,category:'Padrão',color:'Prata',dailyRate:150,purchasePrice:70000,availability:'disponivel',createdAt:'2026-09-29T12:02:00.000Z',updatedAt:'2026-09-29T12:02:00.000Z'});
  after.rentals.push({id:'LOC-PC-1',customerId:'CLI-PC-1',vehicleId:'VEI-PC-1',attendantId:'USR-ADMIN',pickupAt:'2026-10-01T10:00:00.000Z',returnAt:'2026-10-03T10:00:00.000Z',periodMode:'fixed',priority:'Media',notes:'offline',dailyRate:150,billingMode:'daily',createdAt:'2026-09-29T12:03:00.000Z',updatedAt:'2026-09-29T12:03:00.000Z'});
  const operations=buildCloudOperations(before,after);
  assert.deepEqual(operations.map(x=>x.kind),['customer.create','vehicle.create','rental.create']);
  assert.equal(operations[0].payload.id,'CLI-PC-1');
  assert.equal(operations[1].payload.id,'VEI-PC-1');
  assert.equal(operations[2].payload.id,'LOC-PC-1');
  assert.equal(operations[2].payload.billingMode,'daily');
  assert.deepEqual(buildCloudOperations(before,after).map(x=>x.operationId),operations.map(x=>x.operationId));
});

test('fase 4: pagamentos e vistoria usam o id local como chave idempotente',()=>{
  const before=baseSnapshot(),after=baseSnapshot();
  const rental={id:'LOC-1',customerId:'CUS-1',vehicleId:'VEI-1',payments:[],createdAt:'2026-09-20T10:00:00.000Z',updatedAt:'2026-09-20T10:00:00.000Z'};
  before.rentals.push(structuredClone(rental));
  after.rentals.push({...rental,payments:[{id:'PAG-PC-1',amount:80,method:'PIX',paidAt:'2026-09-29T12:10:00.000Z'}]});
  const installment={id:'PAR-1',payments:[],version:3,createdAt:'2026-09-20T10:00:00.000Z',updatedAt:'2026-09-20T10:00:00.000Z'};
  before.billingInstallments.push(structuredClone(installment));
  after.billingInstallments.push({...installment,payments:[{id:'BPG-PC-1',amount:150,method:'Dinheiro',paidAt:'2026-09-29T12:11:00.000Z'}]});
  after.inspections.push({id:'VIS-PC-1',rentalId:'LOC-1',kind:'checkout',status:'completed',mileage:1234,fuelLevel:'3/4',notes:'ok',damages:[],checklist:[{id:'geral',label:'Verificação geral',done:true,evidence:null}],createdAt:'2026-09-29T12:12:00.000Z'});
  const operations=buildCloudOperations(before,after);
  assert.deepEqual(operations.map(x=>x.kind),['rental.payment','billing.payment','inspection.create']);
  assert.equal(operations[0].payload.id,'PAG-PC-1');
  assert.equal(operations[0].payload.rentalId,'LOC-1');
  assert.equal(operations[1].payload.id,'BPG-PC-1');
  assert.equal(operations[1].payload.installmentId,'PAR-1');
  assert.equal(operations[2].payload.id,'VIS-PC-1');
  assert.equal(operations[2].payload.kind,'pickup');
  assert.deepEqual(operations[2].payload.items,[{key:'geral',label:'Verificação geral',done:true,evidence:null}]);
});

test('fase 4: update versionado carrega expectedVersion e não faz last-write-wins',()=>{
  const before=baseSnapshot(),after=baseSnapshot();
  before.customers.push({id:'CUS-1',name:'Antigo',phone:'1',active:true,syncVersion:4});
  after.customers.push({id:'CUS-1',name:'Novo',phone:'1',active:true,syncVersion:4});
  const [operation]=buildCloudOperations(before,after);
  assert.equal(operation.kind,'customer.update');
  assert.equal(operation.payload.id,'CUS-1');
  assert.equal(operation.payload.expectedVersion,4);
  assert.equal(operation.payload.data.name,'Novo');
  assert.match(operation.operationId,/^desktop:customer\.update:CUS-1:/);
});

test('fase 4: controller deduplica operationId já durável inclusive após falha',async()=>{
  const items=[{id:'Q-1',operationId:'desktop:customer.create:CUS-1',status:'failed'}],enqueued=[];
  const outbox={
    async list(){return structuredClone(items);},
    async enqueue(op){enqueued.push(op);items.push({id:`Q-${items.length+1}`,...op,status:'pending'});return op;},
    async summary(){return{total:items.length,pending:items.filter(x=>x.status==='pending').length,failed:items.filter(x=>x.status==='failed').length};}
  };
  const controller=createDesktopCloudSyncController({outbox,runOutbox:async()=>({synced:0}),api:{},authenticated:()=>true});
  await controller.enqueueOperations([
    {operationId:'desktop:customer.create:CUS-1',kind:'customer.create',payload:{id:'CUS-1'}},
    {operationId:'desktop:vehicle.create:VEI-1',kind:'vehicle.create',payload:{id:'VEI-1'}}
  ]);
  assert.deepEqual(enqueued.map(x=>x.operationId),['desktop:vehicle.create:VEI-1']);
  assert.equal((await controller.status()).total,2);
});

test('fase 4: processo principal persiste snapshot antes de enfileirar e entregar operações cloud',()=>{
  const source=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  assert.match(source,/buildCloudOperations/);
  assert.match(source,/createDesktopCloudSyncController/);
  assert.match(source,/createOutbox/);
  assert.match(source,/relationalStore\.saveSnapshot\(snapshot\)[\s\S]{0,700}enqueueOperations\(buildCloudOperations/);
  assert.match(source,/cloudAuth\?\.status\?\.\(\)\.authenticated/);
});

test('fase 5: ReplicaAgent notifica somente depois de um ciclo cloud aplicado com sucesso',async()=>{
  const notifications=[];
  let state={initialized:true,cursor:4,restoreGeneration:1,lastSyncAt:null,lastError:null};
  const agent=new ReplicaAgent({
    client:{async changes(after){assert.equal(after,4);return{changes:[],cursor:5,restoreGeneration:1,hasMore:false};}},
    local:{async applyChanges(changes){assert.deepEqual(changes,[]);}},
    stateStore:{load:()=>structuredClone(state),save:next=>{state=structuredClone(next);return next;},error(){throw new Error('não deveria falhar');}},
    onSynced:status=>notifications.push(status)
  });
  const result=await agent.syncNow();
  assert.equal(result.cursor,5);
  assert.equal(notifications.length,1);
  assert.equal(notifications[0].cursor,5);
});

test('fase 5: repository.reload troca o cache do renderer pelo snapshot canônico já gravado no SQLite',async()=>{
  const previousWindow=globalThis.window;
  let persisted=JSON.stringify(baseSnapshot());
  const bridge={
    snapshotLoad:async()=>persisted,snapshotSave:async value=>{persisted=String(value);return true;},
    dbGet:async()=>null,dbSet:async()=>true,dbRemove:async()=>true,
    putAttachment:async input=>input,getAttachment:async()=>null,removeAttachment:async()=>true,listAttachments:async()=>[]
  };
  globalThis.window={locadoraDesktop:bridge};
  try{
    const {createRepository}=await import(`../src/storage/repository.mjs?phase5=${Date.now()}`);
    const repository=await createRepository();
    assert.equal(repository.load().settings.companyName,'George');
    const cloud=baseSnapshot();cloud.settings.companyName='George Cloud';cloud.updatedAt='2026-09-29T12:30:00.000Z';persisted=JSON.stringify(cloud);
    const refreshed=await repository.reload();
    assert.equal(refreshed.settings.companyName,'George Cloud');
    assert.equal(repository.load().updatedAt,'2026-09-29T12:30:00.000Z');
  }finally{globalThis.window=previousWindow;}
});
