import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { handleRentalRoute } from '../cloudflare/api/rental-routes.mjs';

function setup(){const db=new FakeD1(),ids=seedOperationFixture(db);return{db,env:{DB:db},auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'WEB-1',role:'admin',active:true},...ids};}
function request(path,{key='OP-1',body={}}={}){const headers={'content-type':'application/json'};if(key)headers['idempotency-key']=key;return new Request(`https://app.test${path}`,{method:'POST',headers,body:JSON.stringify(body)});}
async function call(ctx,path,opts){const response=await handleRentalRoute(request(path,opts),ctx.env,null,{auth:ctx.auth});return{response,body:await response.json()};}

async function createRental(ctx,{id='LOC-LIFE',periodMode='fixed',billingMode='total',pickupAt='2026-10-01T10:00:00.000Z',returnAt='2026-10-03T10:00:00.000Z'}={}){const result=await call(ctx,'/api/v1/rentals',{key:`CREATE-${id}`,body:{id,customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt,returnAt:periodMode==='continuous'?null:returnAt,periodMode,dailyRate:100,billingMode}});assert.equal(result.response.status,201);return result.body.item;}

test('rental lifecycle enforces inspection gates and updates vehicle atomically',async()=>{const ctx=setup();try{
  await createRental(ctx);
  let result=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-1',body:{status:'retirada'}});assert.equal(result.response.status,200);assert.equal(result.body.item.status,'retirada');
  result=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-2',body:{status:'em_uso'}});assert.equal(result.response.status,409);assert.equal(result.body.error,'pickup_inspection_required');
  const now='2026-10-01T10:30:00.000Z';ctx.db.sqlite.prepare(`INSERT INTO inspections(id,installation_id,rental_id,vehicle_id,kind,status,mileage,fuel_level,notes,damages_json,completed_at,created_at,updated_at,version,updated_by_device,deleted_at) VALUES(?,?,?,?,?,'completed',0,'Cheio','','[]',?,?,?,1,?,NULL)`).run('VIS-OUT',ctx.installationId,'LOC-LIFE',ctx.vehicleId,'pickup',now,now,now,'WEB-1');
  result=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-3',body:{status:'em_uso'}});assert.equal(result.response.status,200);assert.equal(result.body.item.status,'em_uso');assert.equal(ctx.db.scalar('SELECT availability FROM vehicles WHERE installation_id=? AND id=?',ctx.installationId,ctx.vehicleId),'locado');
  result=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-4',body:{status:'devolucao'}});assert.equal(result.response.status,409);assert.equal(result.body.error,'return_inspection_required');
  ctx.db.sqlite.prepare(`INSERT INTO inspections(id,installation_id,rental_id,vehicle_id,kind,status,mileage,fuel_level,notes,damages_json,completed_at,created_at,updated_at,version,updated_by_device,deleted_at) VALUES(?,?,?,?,?,'completed',0,'Cheio','','[]',?,?,?,1,?,NULL)`).run('VIS-IN',ctx.installationId,'LOC-LIFE',ctx.vehicleId,'return',now,now,now,'WEB-1');
  result=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-5',body:{status:'devolucao'}});assert.equal(result.response.status,200);assert.equal(result.body.item.status,'devolucao');assert.equal(ctx.db.scalar('SELECT availability FROM vehicles WHERE installation_id=? AND id=?',ctx.installationId,ctx.vehicleId),'disponivel');
}finally{ctx.db.close();}});

test('rental advance replay is idempotent and emits one change',async()=>{const ctx=setup();try{await createRental(ctx);const first=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-REPLAY',body:{status:'retirada'}});const second=await call(ctx,'/api/v1/rentals/LOC-LIFE/advance',{key:'ADV-REPLAY',body:{status:'retirada'}});assert.equal(first.response.status,200);assert.equal(second.response.status,200);assert.equal(second.body.replayed,true);assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id=?',ctx.installationId,'ADV-REPLAY'),1);}finally{ctx.db.close();}});

test('continuous rental must close schedule before final return and closure is idempotent',async()=>{const ctx=setup();try{
  await createRental(ctx,{id:'LOC-CONT',periodMode:'continuous',billingMode:'daily',pickupAt:'2026-10-01T10:00:00.000Z'});
  await call(ctx,'/api/v1/rentals/LOC-CONT/advance',{key:'CONT-A1',body:{status:'retirada'}});
  const now='2026-10-01T10:30:00.000Z';ctx.db.sqlite.prepare(`INSERT INTO inspections(id,installation_id,rental_id,vehicle_id,kind,status,mileage,fuel_level,notes,damages_json,completed_at,created_at,updated_at,version,updated_by_device,deleted_at) VALUES(?,?,?,?,?,'completed',0,'Cheio','','[]',?,?,?,1,?,NULL)`).run('VIS-C1',ctx.installationId,'LOC-CONT',ctx.vehicleId,'pickup',now,now,now,'WEB-1');
  await call(ctx,'/api/v1/rentals/LOC-CONT/advance',{key:'CONT-A2',body:{status:'em_uso'}});
  let result=await call(ctx,'/api/v1/rentals/LOC-CONT/advance',{key:'CONT-A3',body:{status:'devolucao'}});assert.equal(result.response.status,409);
  result=await call(ctx,'/api/v1/rentals/LOC-CONT/close-continuous',{key:'CONT-CLOSE',body:{returnAt:'2026-10-03T10:05:00.000Z'}});assert.equal(result.response.status,200);assert.equal(result.body.item.continuousClosedAt,'2026-10-03T10:05:00.000Z');assert.equal(result.body.item.days,3);assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM billing_installments WHERE installation_id=? AND rental_id=?',ctx.installationId,'LOC-CONT'),3);
  const replay=await call(ctx,'/api/v1/rentals/LOC-CONT/close-continuous',{key:'CONT-CLOSE',body:{returnAt:'2026-10-03T10:05:00.000Z'}});assert.equal(replay.response.status,200);assert.equal(replay.body.replayed,true);
}finally{ctx.db.close();}});
