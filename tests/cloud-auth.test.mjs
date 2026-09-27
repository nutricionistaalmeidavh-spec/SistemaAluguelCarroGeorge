import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../cloudflare/auth/password.mjs';
import { buildSessionCookie, clearSessionCookie, readSessionToken } from '../cloudflare/auth/session.mjs';
import { handleAuthRoute, sanitizeAuthUser } from '../cloudflare/api/auth-routes.mjs';
import { canCloud } from '../cloudflare/auth/permissions.mjs';

const demoPass=['fixture','credential','value'].join('-');
const wrongPass=['different','fixture','value'].join('-');
const sessionValue=['opaque','session','fixture'].join('-');
async function sha256(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}

test('password cloud usa PBKDF2 e reconhece hash SHA-256 legado para upgrade',async()=>{
  const encoded=await hashPassword(demoPass,{iterations:1000});
  assert.match(encoded,/^pbkdf2-sha256\$1000\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.deepEqual(await verifyPassword(demoPass,encoded),{ok:true,needsUpgrade:false});
  assert.deepEqual(await verifyPassword(wrongPass,encoded),{ok:false,needsUpgrade:false});
  const legacy=await sha256(demoPass);
  assert.deepEqual(await verifyPassword(demoPass,legacy),{ok:true,needsUpgrade:true});
  assert.deepEqual(await verifyPassword(wrongPass,legacy),{ok:false,needsUpgrade:false});
});

test('cookie de sessão é opaco, HttpOnly, Secure e SameSite Strict',()=>{
  const cookie=buildSessionCookie(sessionValue,{maxAge:3600});
  assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Strict/i);assert.match(cookie,/Path=\//i);
  assert.equal(readSessionToken(new Request('https://example.test',{headers:{cookie:`x=1; locadora_session=${sessionValue}; y=2`}})),sessionValue);
  assert.match(clearSessionCookie(),/Max-Age=0/i);
});

test('login não devolve material de autenticação e emite sessão segura',async()=>{
  const encoded=await hashPassword(demoPass,{iterations:1000});
  const calls=[];
  const service={
    async findUser(installationId,username){calls.push(['find',installationId,username]);return{id:'USR-1',installation_id:'INST-1',username:'admin',name:'Administrador',role:'admin',active:1,password_hash:encoded};},
    async upgradePassword(){calls.push(['upgrade']);},
    async createSession(){calls.push(['session']);return{token:sessionValue,expiresAt:'2099-01-01T00:00:00.000Z'};},
    async revokeSession(){calls.push(['revoke']);}
  };
  const request=new Request('https://example.test/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installationId:'INST-1',username:'admin',password:demoPass})});
  const response=await handleAuthRoute(request,{}, {},{service});
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie')??'',/HttpOnly/i);
  const body=await response.json();
  assert.equal(body.user.id,'USR-1');
  assert.equal(body.user.role,'admin');
  assert.equal('password_hash' in body.user,false);
  assert.equal('passwordHash' in body.user,false);
  assert.deepEqual(calls.map(row=>row[0]),['find','session']);
  assert.deepEqual(sanitizeAuthUser({id:'U',installation_id:'I',username:'x',name:'X',role:'admin',active:1,password_hash:'fixture-only'}),{id:'U',username:'x',name:'X',role:'admin',active:true});
});

test('RBAC cloud espelha papéis operacionais e falha fechado',()=>{
  assert.equal(canCloud({role:'admin',active:true},'anything'),true);
  assert.equal(canCloud({role:'atendente',active:true},'customer.write'),true);
  assert.equal(canCloud({role:'vistoriador',active:true},'inspection.write'),true);
  assert.equal(canCloud({role:'vistoriador',active:true},'customer.read'),false);
  assert.equal(canCloud({role:'desconhecido',active:true},'rental.read'),false);
  assert.equal(canCloud({role:'admin',active:false},'rental.read'),false);
});
