import test from 'node:test';
import assert from 'node:assert/strict';
import { PWA_NAV, navigationFor, buildCloudSnapshot } from '../src/cloud/ui/common.mjs';
import { getResourceDefinition } from '../cloudflare/api/resource-map.mjs';

const admin={id:'USR-A',role:'admin',active:true};
const attendant={id:'USR-T',role:'atendente',active:true};
const inspector={id:'USR-V',role:'vistoriador',active:true};

test('PWA aprovada possui os 12 módulos e navegação respeita permissões',()=>{
  assert.deepEqual(PWA_NAV.map(item=>item.id),[
    'overview','customers','vehicles','rentals','inspections','finance',
    'billing','delinquency','contracts','documents','alerts','maintenance'
  ]);
  assert.equal(navigationFor(admin).length,12);
  assert.equal(navigationFor(attendant).length,12);
  const inspectorIds=navigationFor(inspector).map(item=>item.id);
  assert.deepEqual(inspectorIds,[
    'overview','vehicles','rentals','inspections','contracts','documents','alerts','maintenance'
  ]);
});

test('snapshot cloud adapta JSON, pagamentos e anexos ao formato usado pelos domínios desktop',()=>{
  const snapshot=buildCloudSnapshot({
    customers:[{id:'CUS-1',name:'Ana',driverLicenseJson:JSON.stringify({number:'CNH-1',category:'B',expiry:'2027-01-10'})}],
    vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',documentsJson:JSON.stringify({insuranceExpiry:'2027-02-01',renavam:'123'})}],
    rentals:[{id:'LOC-1',customerId:'CUS-1',vehicleId:'VEI-1',status:'em_uso'}],
    rentalPayments:[{id:'PAG-1',rentalId:'LOC-1',amount:100,method:'PIX',paidAt:'2026-09-29T12:00:00Z'}],
    inspections:[{id:'VIS-1',rentalId:'LOC-1',vehicleId:'VEI-1',kind:'pickup',status:'completed',damagesJson:'["risco"]'}],
    inspectionItems:[{id:'VII-1',inspectionId:'VIS-1',itemKey:'pneus',label:'Pneus',done:1,evidence:null}],
    attachments:[{id:'ATT-1',entityType:'inspection',entityId:'VIS-1',mimeType:'image/jpeg',sizeBytes:123,sha256:'abc'}],
    billingInstallments:[{id:'PAR-1',rentalId:'LOC-1',amount:100,paidAmount:50,status:'partial'}],
    billingPayments:[{id:'BPG-1',installmentId:'PAR-1',amount:50,method:'PIX',paidAt:'2026-09-29T12:00:00Z'}],
    maintenance:[],expenses:[],ledger:[],billingPlans:[],collectionActions:[],contractTemplates:[],issuedContracts:[],
    alertState:[{id:'STATE',stateJson:JSON.stringify({alerts:{'rental:LOC-1':{status:'acknowledged'}}})}]
  });
  assert.deepEqual(snapshot.customers[0].driverLicense,{number:'CNH-1',category:'B',expiry:'2027-01-10'});
  assert.equal(snapshot.vehicles[0].documents.renavam,'123');
  assert.equal(snapshot.rentals[0].payments[0].id,'PAG-1');
  assert.deepEqual(snapshot.inspections[0].damages,['risco']);
  assert.deepEqual(snapshot.inspections[0].checklist,[{id:'pneus',label:'Pneus',done:true,evidence:null}]);
  assert.deepEqual(snapshot.inspections[0].photos,[{attachmentId:'ATT-1',name:'ATT-1',mimeType:'image/jpeg',sizeBytes:123,sha256:'abc'}]);
  assert.equal(snapshot.billingInstallments[0].payments[0].id,'BPG-1');
  assert.equal(snapshot.alertState.alerts['rental:LOC-1'].status,'acknowledged');
});

test('resource map expõe somente leituras necessárias à paridade e não abre escrita genérica de workflow',()=>{
  const expected=[
    'ledger','rentalPayments','billingPlans','billingInstallments','collectionActions',
    'contractTemplates','issuedContracts','inspectionItems','alertState','attachments'
  ];
  for(const name of expected){
    const definition=getResourceDefinition(name);
    assert.ok(definition,`recurso ausente: ${name}`);
    assert.ok(definition.collectionMethods.includes('GET'));
  }
  for(const name of ['ledger','rentalPayments','billingPlans','collectionActions','contractTemplates','issuedContracts','inspectionItems','alertState','attachments']){
    const definition=getResourceDefinition(name);
    assert.deepEqual(definition.collectionMethods,['GET'],`${name} não deve aceitar escrita genérica`);
    assert.deepEqual(definition.itemMethods,['GET']);
  }
  assert.equal(getResourceDefinition('sqlite_master'),null);
});
