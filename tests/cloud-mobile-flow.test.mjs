import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { createRentalOperation } from '../cloudflare/domain/rentals.mjs';
import { createInspectionOperation } from '../cloudflare/domain/inspections.mjs';
import { routeApi } from '../cloudflare/api/router.mjs';

function ctx(db){const ids=seedOperationFixture(db);return{db,auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-MOBILE',role:'admin',active:true},...ids};}

test('locação diária cloud cria plano, parcelas e recebíveis sem dupla gravação',async()=>{
  const db=new FakeD1();
  try{
    const c=ctx(db);
    const result=await createRentalOperation(c,{customerId:c.customerId,vehicleId:c.vehicleId,pickupAt:'2026-10-01T10:00:00.000Z',returnAt:'2026-10-04T10:00:00.000Z',dailyRate:80,periodMode:'fixed',billingMode:'daily'},'OP-MOBILE-RENT');
    assert.equal(result.result.billingMode,'daily');assert.equal(result.result.days,3);assert.equal(result.result.total,240);
    assert.equal(db.scalar('SELECT COUNT(*) FROM billing_plans WHERE installation_id=? AND rental_id=?',c.installationId,result.result.id),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM billing_installments WHERE installation_id=? AND rental_id=?',c.installationId,result.result.id),3);
    assert.equal(db.scalar("SELECT COUNT(*) FROM ledger WHERE installation_id=? AND rental_id=? AND kind='billing_receivable' AND billing_purpose='rental_schedule'",c.installationId,result.result.id),3);
    assert.equal(db.scalar("SELECT COUNT(*) FROM ledger WHERE installation_id=? AND rental_id=? AND kind='receivable' AND billing_purpose='rental'",c.installationId,result.result.id),1);
    assert.equal(db.scalar("SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id='OP-MOBILE-RENT'",c.installationId),1);
  }finally{db.close();}
});

test('vistoria cloud cria cabeçalho e checklist atomicamente e gera delta',async()=>{
  const db=new FakeD1();
  try{
    const c=ctx(db),rental=await createRentalOperation(c,{customerId:c.customerId,vehicleId:c.vehicleId,pickupAt:'2026-10-10T10:00:00.000Z',returnAt:'2026-10-11T10:00:00.000Z',dailyRate:100,periodMode:'fixed'},'OP-INSP-RENT');
    const created=await createInspectionOperation(c,{rentalId:rental.result.id,kind:'pickup',mileage:12345,fuelLevel:'3/4',notes:'Sem avarias',items:[{key:'pneus',label:'Pneus',done:true},{key:'luzes',label:'Luzes',done:true}]},'OP-INSP-1');
    assert.equal(created.result.status,'completed');assert.equal(created.result.vehicleId,c.vehicleId);
    assert.equal(db.scalar('SELECT COUNT(*) FROM inspections WHERE installation_id=? AND id=?',c.installationId,created.result.id),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM inspection_items WHERE installation_id=? AND inspection_id=?',c.installationId,created.result.id),2);
    assert.equal(db.scalar("SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id='OP-INSP-1' AND entity_type='inspection'",c.installationId),1);
  }finally{db.close();}
});

test('API expõe parcelas para financeiro mobile como somente leitura',async()=>{
  const db=new FakeD1();
  try{
    const c=ctx(db),rental=await createRentalOperation(c,{customerId:c.customerId,vehicleId:c.vehicleId,pickupAt:'2026-10-20T10:00:00.000Z',returnAt:'2026-10-22T10:00:00.000Z',dailyRate:90,periodMode:'fixed',billingMode:'daily'},'OP-BILL-LIST');
    const request=new Request('https://app.test/api/v1/billingInstallments',{method:'GET'});
    const response=await routeApi(request,{DB:db},null,{auth:c.auth});
    assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.items.filter(item=>item.rentalId===rental.result.id).length,2);
    assert.equal(body.items.find(item=>item.rentalId===rental.result.id).amount,90);
  }finally{db.close();}
});
