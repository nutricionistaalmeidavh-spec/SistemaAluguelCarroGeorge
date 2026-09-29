'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessCloudFirstMigration}=require('../../electron/migration/cloud-first-migration.cjs');

function dataset(overrides={}){return{customers:[],vehicles:[],rentals:[],rental_payments:[],expenses:[],inspections:[],inspection_items:[],maintenance:[],ledger:[],contract_templates:[],issued_contracts:[],billing_plans:[],billing_installments:[],billing_payments:[],billing_payment_conflicts:[],collection_actions:[],attachments:[],...overrides};}

test('DR cloud-first: novo PC vazio adota D1/R2; duas bases populadas permanecem bloqueadas',()=>{
  const cloud=dataset({customers:[{id:'CUS-CLOUD'}],attachments:[{id:'ATT-CLOUD'}]});
  const newPc=assessCloudFirstMigration({localDataset:dataset(),cloudSnapshot:cloud,replicaState:{initialized:false}});
  assert.equal(newPc.mode,'new-device');
  assert.equal(newPc.localRows,0);
  assert.equal(newPc.cloudRows,2);

  const existingPc=assessCloudFirstMigration({localDataset:dataset({vehicles:[{id:'VEI-LOCAL'}]}),cloudSnapshot:cloud,replicaState:{initialized:false}});
  assert.equal(existingPc.mode,'blocked');
  assert.equal(existingPc.reason,'both_datasets_populated');
});

test('DR cloud-first: PC existente pode semear apenas uma nuvem de negócio vazia',()=>{
  const local=dataset({customers:[{id:'CUS-LOCAL'}],vehicles:[{id:'VEI-LOCAL'}],attachments:[{id:'ATT-LOCAL'}]});
  const result=assessCloudFirstMigration({localDataset:local,cloudSnapshot:dataset(),replicaState:{initialized:false}});
  assert.equal(result.mode,'seed-cloud');
  assert.equal(result.localRows,3);
  assert.equal(result.cloudRows,0);
});
