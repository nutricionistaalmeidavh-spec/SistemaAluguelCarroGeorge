import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { handleBillingRoute } from '../cloudflare/api/billing-routes.mjs';

function setup(){
  const db=new FakeD1(),ids=seedOperationFixture(db),now='2026-09-27T12:00:00.000Z',rentalId='LOC-BILL-HTTP',planId='PLAN-BILL-HTTP',installmentId='PAR-BILL-HTTP';
  db.sqlite.prepare(`INSERT INTO rentals
    (id,installation_id,vehicle_id,customer_id,attendant_id,pickup_at,return_at,period_mode,status,daily_rate,days,total,billing_mode,payment_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rentalId,ids.installationId,ids.vehicleId,ids.customerId,ids.userId,'2026-10-01T10:00:00.000Z','2026-10-02T10:00:00.000Z','fixed','em_uso',90,1,90,'daily','aberto',now,now);
  db.sqlite.prepare(`INSERT INTO billing_plans
    (id,installation_id,rental_id,customer_id,vehicle_id,purpose,frequency,amount,occurrences,first_due_at,active,created_at,updated_at)
    VALUES (?,?,?,?,?,'rental_schedule','daily',90,1,'2026-10-01',1,?,?)`).run(planId,ids.installationId,rentalId,ids.customerId,ids.vehicleId,now,now);
  db.sqlite.prepare(`INSERT INTO billing_installments
    (id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,1,'2026-10-01',90,0,'open',?,?)`).run(installmentId,ids.installationId,planId,rentalId,ids.customerId,ids.vehicleId,now,now);
  db.sqlite.prepare(`INSERT INTO ledger
    (id,installation_id,kind,billing_purpose,rental_id,installment_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at)
    VALUES ('FIN-INST-HTTP',?,'billing_receivable','rental_schedule',?,?,?,'Diária',90,0,'open','2026-10-01',?,?)`).run(ids.installationId,rentalId,installmentId,ids.vehicleId,now,now);
  db.sqlite.prepare(`INSERT INTO ledger
    (id,installation_id,kind,billing_purpose,rental_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at)
    VALUES ('FIN-PARENT-HTTP',?,'receivable','rental',?,?,'Locação',90,0,'open','2026-10-01',?,?)`).run(ids.installationId,rentalId,ids.vehicleId,now,now);
  return{db,env:{DB:db},installmentId,auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-BILL-HTTP',role:'admin',active:true}};
}
function request(id,{key='OP-BILL-HTTP',body={amount:45,method:'pix'}}={}){const headers={'content-type':'application/json'};if(key)headers['idempotency-key']=key;return new Request(`https://example.test/api/v1/billing/installments/${encodeURIComponent(id)}/payments`,{method:'POST',headers,body:JSON.stringify(body)});}

test('rota de parcela exige idempotency key e persiste uma única cobrança',async()=>{
  const ctx=setup();try{
    const missing=await handleBillingRoute(request(ctx.installmentId,{key:null}),ctx.env,{}, {auth:ctx.auth});assert.equal(missing.status,400);
    const first=await handleBillingRoute(request(ctx.installmentId,{key:'OP-BILL-1'}),ctx.env,{}, {auth:ctx.auth});assert.equal(first.status,201);
    const replay=await handleBillingRoute(request(ctx.installmentId,{key:'OP-BILL-1'}),ctx.env,{}, {auth:ctx.auth});assert.equal(replay.status,200);
    assert.equal((await first.json()).item.id,(await replay.json()).item.id);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM billing_payments'),1);
  }finally{ctx.db.close();}
});

test('vistoriador não consegue registrar recebimento de parcela',async()=>{
  const ctx=setup();try{
    const response=await handleBillingRoute(request(ctx.installmentId,{key:'OP-BILL-DENY'}),ctx.env,{}, {auth:{...ctx.auth,role:'vistoriador'}});
    assert.equal(response.status,403);assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM billing_payments'),0);
  }finally{ctx.db.close();}
});
