import test from 'node:test';
import assert from 'node:assert/strict';

async function load(relative){try{return await import(new URL(relative,import.meta.url));}catch(error){assert.fail(`Plano 03 ausente: ${relative}: ${error.message}`);}}

test('headers de segurança incluem CSP, anti-frame e nosniff',async()=>{
  const {securityHeaders}=await load('../cloudflare/security/hardening.mjs');const headers=securityHeaders();
  assert.match(headers['content-security-policy'],/default-src 'self'/);assert.equal(headers['x-content-type-options'],'nosniff');assert.equal(headers['x-frame-options'],'DENY');assert.equal(headers['referrer-policy'],'no-referrer');
});

test('origin validation bloqueia escrita cross-site e aceita same-origin',async()=>{
  const {validateRequestOrigin}=await load('../cloudflare/security/hardening.mjs');
  const same=new Request('https://app.exemplo.com/api/george/customers',{method:'POST',headers:{origin:'https://app.exemplo.com'}});
  const evil=new Request('https://app.exemplo.com/api/george/customers',{method:'POST',headers:{origin:'https://evil.example'}});
  assert.equal(validateRequestOrigin(same),true);assert.equal(validateRequestOrigin(evil),false);
});

test('throttle bloqueia novas tentativas depois do limite',async()=>{
  const {loginThrottleDecision}=await load('../cloudflare/security/hardening.mjs');
  assert.equal(loginThrottleDecision({failures:4,blockedUntil:null},new Date('2026-09-27T12:00:00Z')).blocked,false);
  const decision=loginThrottleDecision({failures:5,blockedUntil:'2026-09-27T12:15:00.000Z'},new Date('2026-09-27T12:00:00Z'));assert.equal(decision.blocked,true);assert.ok(decision.retryAfterSeconds>=899);
});
