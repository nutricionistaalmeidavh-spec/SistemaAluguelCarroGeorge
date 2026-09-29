import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { handleRentalRoute } from '../cloudflare/api/rental-routes.mjs';

function req(path,{method='POST',key='OP-HTTP',body={}}={}){const headers={'content-type':'application/json'};if(key)headers['idempotency-key']=key;return new Request(`https://example.test${path}`,{method,headers,body:JSON.stringify(body)});}
function setup(){const db=new FakeD1(),ids=seedOperationFixture(db);const auth={installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-HTTP',role:'admin',active:true};return{db,env:{DB:db},auth,...ids};}

test('POST /rentals exige idempotency key e cria pela operação transacional',async()=>{
  const ctx=setup();
  try{
    const body={id:'LOC-DESKTOP-1',customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-12-01T10:00:00.000Z',returnAt:'2026-12-03T10:00:00.000Z',dailyRate:120};
    const missing=await handleRentalRoute(req('/api/v1/rentals',{key:null,body}),ctx.env,{}, {auth:ctx.auth});
    assert.equal(missing.status,400);assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rentals'),0);
    const created=await handleRentalRoute(req('/api/v1/rentals',{key:'OP-HTTP-RENT',body}),ctx.env,{}, {auth:ctx.auth});
    assert.equal(created.status,201);const payload=await created.json();assert.equal(payload.ok,true);assert.equal(payload.item.status,'reserva');
    assert.equal(payload.item.id,'LOC-DESKTOP-1');
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rentals'),1);
  }finally{ctx.db.close();}
});

test('POST /rentals/:id/payments repete a mesma resposta lógica sem duplicar pagamento',async()=>{
  const ctx=setup();
  try{
    const create=await handleRentalRoute(req('/api/v1/rentals',{key:'OP-HTTP-BASE',body:{customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-12-10T10:00:00.000Z',returnAt:'2026-12-12T10:00:00.000Z',dailyRate:100}}),ctx.env,{}, {auth:ctx.auth});
    const rental=(await create.json()).item;
    const paymentReq=()=>req(`/api/v1/rentals/${encodeURIComponent(rental.id)}/payments`,{key:'OP-HTTP-PAY',body:{id:'PAG-DESKTOP-1',amount:75,method:'pix'}});
    const one=await handleRentalRoute(paymentReq(),ctx.env,{}, {auth:ctx.auth});
    const two=await handleRentalRoute(paymentReq(),ctx.env,{}, {auth:ctx.auth});
    assert.equal(one.status,201);assert.equal(two.status,200);
    assert.equal((await one.json()).item.id,'PAG-DESKTOP-1');
    assert.equal((await two.json()).item.id,'PAG-DESKTOP-1');
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rental_payments'),1);
  }finally{ctx.db.close();}
});

test('rota de operação aplica RBAC antes de qualquer mutação',async()=>{
  const ctx=setup();
  try{
    const inspector={...ctx.auth,role:'vistoriador'};
    const response=await handleRentalRoute(req('/api/v1/rentals',{key:'OP-DENY',body:{customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-12-20T10:00:00.000Z',returnAt:'2026-12-21T10:00:00.000Z',dailyRate:100}}),ctx.env,{}, {auth:inspector});
    assert.equal(response.status,403);assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rentals'),0);
  }finally{ctx.db.close();}
});
