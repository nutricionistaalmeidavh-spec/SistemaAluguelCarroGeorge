import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeSnapshots } from '../src/domain/sync.mjs';

test('sync merge: edição de cliente no PC e vistoria no celular sobrevivem ao mesmo conflito',()=>{
  const server={version:3,updatedAt:'2026-09-14T10:05:00Z',customers:[{id:'C1',name:'Ana PC',updatedAt:'2026-09-14T10:05:00Z'}],vehicles:[],rentals:[],expenses:[],users:[],ledger:[],audit:[],inspections:[],maintenance:[],alertState:[],settings:{companyName:'Locadora'}};
  const client={version:3,updatedAt:'2026-09-14T10:06:00Z',customers:[{id:'C1',name:'Ana',updatedAt:'2026-09-14T10:00:00Z'}],vehicles:[],rentals:[],expenses:[],users:[],ledger:[],audit:[],inspections:[{id:'VIS-1',rentalId:'R1',status:'completed',updatedAt:'2026-09-14T10:06:00Z'}],maintenance:[],alertState:[],settings:{companyName:'Locadora'}};
  const result=exchangeSnapshots({serverRevision:5,serverSnapshot:server,baseRevision:4,clientSnapshot:client});
  assert.equal(result.action,'merge');assert.equal(result.conflict,true);assert.equal(result.nextRevision,6);
  assert.equal(result.snapshot.customers[0].name,'Ana PC');assert.equal(result.snapshot.inspections[0].id,'VIS-1');
});


test('sync merge preserva alertState concorrente de PC e celular',()=>{
 const server={version:4,updatedAt:'2026-09-14T10:05:00Z',customers:[],vehicles:[],rentals:[],expenses:[],users:[],ledger:[],audit:[],inspections:[],maintenance:[],alertState:{A:{status:'acknowledged',updatedAt:'2026-09-14T10:05:00Z'}},settings:{}};
 const client={...server,updatedAt:'2026-09-14T10:06:00Z',alertState:{B:{status:'dismissed',updatedAt:'2026-09-14T10:06:00Z'}}};
 const result=exchangeSnapshots({serverRevision:2,serverSnapshot:server,baseRevision:1,clientSnapshot:client});
 assert.equal(result.snapshot.alertState.A.status,'acknowledged');assert.equal(result.snapshot.alertState.B.status,'dismissed');
});
