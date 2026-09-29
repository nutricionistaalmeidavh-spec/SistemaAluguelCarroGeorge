import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { handleInspectionRoute } from '../cloudflare/api/inspection-routes.mjs';
import { createRentalOperation, advanceRentalOperation } from '../cloudflare/domain/rentals.mjs';

function setup(){const db=new FakeD1(),ids=seedOperationFixture(db),auth={installationId:ids.installationId,userId:ids.userId,deviceId:'WEB-INSP',role:'admin',active:true};return{db,env:{DB:db},auth,...ids};}
function req(body,key='INSP-1'){return new Request('https://app.test/api/v1/inspections',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});}
async function call(ctx,body,key){const response=await handleInspectionRoute(req(body,key),ctx.env,null,{auth:ctx.auth});return{response,body:await response.json()};}
async function rental(ctx,id='LOC-INSP'){await createRentalOperation({db:ctx.db,auth:ctx.auth},{id,customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-10-01T10:00:00.000Z',returnAt:'2026-10-03T10:00:00.000Z',dailyRate:100,billingMode:'total'},`CREATE-${id}`);return id;}
const checklist=[{key:'documents',label:'Documentos',done:true},{key:'mileage',label:'Quilometragem',done:true}];

test('pickup inspection is allowed for reservation and duplicate pickup is rejected',async()=>{const ctx=setup();try{await rental(ctx);let result=await call(ctx,{id:'VIS-PICK',rentalId:'LOC-INSP',kind:'pickup',mileage:1000,fuelLevel:'Cheio',items:checklist},'PICK-1');assert.equal(result.response.status,201);result=await call(ctx,{id:'VIS-PICK-2',rentalId:'LOC-INSP',kind:'pickup',mileage:1001,fuelLevel:'Cheio',items:checklist},'PICK-2');assert.equal(result.response.status,409);assert.equal(result.body.error,'inspection_already_exists');}finally{ctx.db.close();}});

test('return inspection is blocked before rental is in use and allowed after pickup + lifecycle advance',async()=>{const ctx=setup();try{await rental(ctx);let result=await call(ctx,{id:'VIS-EARLY',rentalId:'LOC-INSP',kind:'return',mileage:1002,fuelLevel:'3/4',items:checklist},'RET-EARLY');assert.equal(result.response.status,409);assert.equal(result.body.error,'return_inspection_not_allowed');await call(ctx,{id:'VIS-PICK',rentalId:'LOC-INSP',kind:'pickup',mileage:1000,fuelLevel:'Cheio',items:checklist},'PICK-OK');await advanceRentalOperation({db:ctx.db,auth:ctx.auth},{rentalId:'LOC-INSP',status:'retirada'},'ADV-RET');await advanceRentalOperation({db:ctx.db,auth:ctx.auth},{rentalId:'LOC-INSP',status:'em_uso'},'ADV-USE');result=await call(ctx,{id:'VIS-RETURN',rentalId:'LOC-INSP',kind:'return',mileage:1100,fuelLevel:'3/4',items:checklist},'RET-OK');assert.equal(result.response.status,201);assert.equal(result.body.item.kind,'return');}finally{ctx.db.close();}});

test('completed inspection requires every checklist item done',async()=>{const ctx=setup();try{await rental(ctx);const result=await call(ctx,{id:'VIS-INCOMPLETE',rentalId:'LOC-INSP',kind:'pickup',mileage:1000,fuelLevel:'Cheio',items:[{key:'documents',label:'Documentos',done:false}]},'PICK-BAD');assert.equal(result.response.status,400);assert.equal(result.body.error,'inspection_checklist_incomplete');}finally{ctx.db.close();}});
