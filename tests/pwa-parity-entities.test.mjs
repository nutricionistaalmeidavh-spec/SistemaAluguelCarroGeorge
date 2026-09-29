import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPayload, customersHtml } from '../src/cloud/ui/customers.mjs';
import { vehiclePayload, vehiclesHtml } from '../src/cloud/ui/vehicles.mjs';

const admin={id:'USR-A',role:'admin',active:true};

function form(entries){return{get:name=>entries[name]??null};}

test('customer payload preserves complete contact and CNH fields',()=>{
  const payload=customerPayload(form({name:'Ana',document:'123',phone:'1699',email:'ana@example.test',address:'Rua A',licenseNumber:'CNH1',licenseCategory:'B',licenseExpiry:'2027-01-02',active:'1'}),{id:'CUS-1',version:4});
  assert.equal(payload.id,'CUS-1');
  assert.equal(payload.version,4);
  assert.equal(payload.name,'Ana');
  assert.equal(payload.email,'ana@example.test');
  assert.equal(payload.address,'Rua A');
  assert.equal(payload.active,1);
  assert.deepEqual(JSON.parse(payload.driverLicenseJson),{number:'CNH1',category:'B',expiry:'2027-01-02'});
});

test('customer HTML exposes complete parity fields and versioned edit/delete actions',()=>{
  const html=customersHtml({customers:[{id:'CUS-1',name:'Ana',document:'123',phone:'1699',email:'ana@example.test',address:'Rua A',active:1,version:3,driverLicense:{number:'CNH1',category:'B',expiry:'2027-01-02'}}]},admin);
  for(const field of ['name="document"','name="phone"','name="email"','name="address"','name="licenseNumber"','name="licenseCategory"','name="licenseExpiry"'])assert.match(html,new RegExp(field));
  assert.match(html,/data-customer-edit="CUS-1"/);
  assert.match(html,/data-customer-delete="CUS-1"/);
  assert.match(html,/CNH1/);
});

test('vehicle payload preserves complete fleet and document metadata',()=>{
  const payload=vehiclePayload(form({model:'Onix',plate:'abc1d23',year:'2025',mileage:'1234',category:'Hatch',color:'Prata',dailyRate:'150.50',purchasePrice:'70000',availability:'disponivel',insuranceExpiry:'2027-02-01',licensingExpiry:'2027-03-01',inspectionExpiry:'2027-04-01',renavam:'999',chassis:'ABC'}),{id:'VEI-1',version:7});
  assert.equal(payload.plate,'ABC1D23');
  assert.equal(payload.version,7);
  assert.equal(payload.mileage,1234);
  assert.equal(payload.dailyRate,150.5);
  assert.equal(payload.purchasePrice,70000);
  assert.deepEqual(JSON.parse(payload.documentsJson),{insuranceExpiry:'2027-02-01',licensingExpiry:'2027-03-01',inspectionExpiry:'2027-04-01',renavam:'999',chassis:'ABC'});
});

test('fleet HTML exposes full parity fields and versioned edit/delete actions',()=>{
  const html=vehiclesHtml({vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',year:'2025',mileage:1234,category:'Hatch',color:'Prata',dailyRate:150,purchasePrice:70000,availability:'disponivel',version:7,documents:{insuranceExpiry:'2027-02-01',licensingExpiry:'2027-03-01',inspectionExpiry:'2027-04-01',renavam:'999',chassis:'ABC'}}]},admin);
  for(const field of ['name="year"','name="mileage"','name="category"','name="color"','name="dailyRate"','name="purchasePrice"','name="availability"','name="insuranceExpiry"','name="licensingExpiry"','name="inspectionExpiry"','name="renavam"','name="chassis"'])assert.match(html,new RegExp(field));
  assert.match(html,/data-vehicle-edit="VEI-1"/);
  assert.match(html,/data-vehicle-delete="VEI-1"/);
  assert.match(html,/ABC1D23/);
});
