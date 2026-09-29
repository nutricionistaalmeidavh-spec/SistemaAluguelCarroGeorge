import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);

function memoryStore(){const data=new Map();return{data,get:k=>data.get(String(k))??null,set:(k,v)=>{data.set(String(k),String(v));return true;},remove:k=>{data.delete(String(k));return true;},getJson(k,fallback=null){const raw=data.get(String(k));if(raw==null)return fallback;try{return JSON.parse(raw);}catch{return fallback;}},setJson(k,v){data.set(String(k),JSON.stringify(v));return true;}};}
function safeStorage(){return{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(`ENC:${value}`),decryptString:value=>Buffer.from(value).toString().replace(/^ENC:/,'')};}
function response(body,{status=200,cookie=null}={}){const headers={'content-type':'application/json'};if(cookie)headers['set-cookie']=cookie;return new Response(JSON.stringify(body),{status,headers});}

test('desktop cloud auth usa a mesma identidade cloud e persiste somente cookie criptografado',async()=>{
  const {createDesktopCloudAuth}=require('../electron/cloud-auth.cjs');
  const store=memoryStore(),calls=[];
  const fetchImpl=async(url,init={})=>{calls.push({url,init});return response({ok:true,user:{id:'USR-1',username:'george@example.com',name:'George',role:'admin',active:true},expiresAt:'2099-01-01T00:00:00.000Z'},{cookie:'locadora_session=opaque-token; Path=/; HttpOnly; Secure; SameSite=Strict'});};
  const auth=createDesktopCloudAuth({baseUrl:'https://locadora.example',installationId:'LOCADORA-GEORGE',deviceId:'GEORGE-PC',store,safeStorage:safeStorage(),fetchImpl});
  const result=await auth.login({username:'george@example.com',password:'secret-value'});
  assert.equal(result.user.username,'george@example.com');
  const sent=JSON.parse(calls[0].init.body);assert.deepEqual(sent,{installationId:'LOCADORA-GEORGE',username:'george@example.com',password:'secret-value',deviceId:'GEORGE-PC'});
  const saved=store.getJson('cloud:desktop-session:v1');assert.equal(saved.baseUrl,'https://locadora.example');assert.match(saved.cookieEncrypted,/^[A-Za-z0-9+/]+=*$/);assert.equal(JSON.stringify(saved).includes('secret-value'),false);assert.equal(JSON.stringify(saved).includes('opaque-token'),false);
  assert.deepEqual(auth.replicaCredential(),{baseUrl:'https://locadora.example',cookie:'locadora_session=opaque-token'});
});

test('desktop restaura sessão persistente, valida /auth/me e logout limpa apenas a sessão do PC',async()=>{
  const {createDesktopCloudAuth}=require('../electron/cloud-auth.cjs');
  const store=memoryStore(),storage=safeStorage(),calls=[];
  const cookie='locadora_session=desktop-session';store.setJson('cloud:desktop-session:v1',{baseUrl:'https://locadora.example',cookieEncrypted:storage.encryptString(cookie).toString('base64'),expiresAt:'2099-01-01T00:00:00.000Z',user:{id:'USR-1'}});
  const fetchImpl=async(url,init={})=>{calls.push({url,init});if(String(url).endsWith('/auth/me'))return response({ok:true,user:{id:'USR-1',username:'george@example.com',name:'George',role:'admin',active:true}});return response({ok:true});};
  const auth=createDesktopCloudAuth({baseUrl:'https://locadora.example',installationId:'LOCADORA-GEORGE',deviceId:'GEORGE-PC',store,safeStorage:storage,fetchImpl});
  const restored=await auth.restore();assert.equal(restored.user.id,'USR-1');assert.equal(calls[0].init.headers.cookie,cookie);
  await auth.logout();assert.equal(store.get('cloud:desktop-session:v1'),null);assert.equal(calls.at(-1).init.headers.cookie,cookie);
});

test('desktop mantém sessão criptografada para trabalho offline quando validação de rede falha',async()=>{
  const {createDesktopCloudAuth}=require('../electron/cloud-auth.cjs');
  const store=memoryStore(),storage=safeStorage(),cookie='locadora_session=offline-session';store.setJson('cloud:desktop-session:v1',{baseUrl:'https://locadora.example',cookieEncrypted:storage.encryptString(cookie).toString('base64'),expiresAt:'2099-01-01T00:00:00.000Z',user:{id:'USR-1',username:'george@example.com',role:'admin'}});
  const auth=createDesktopCloudAuth({baseUrl:'https://locadora.example',installationId:'LOCADORA-GEORGE',deviceId:'GEORGE-PC',store,safeStorage:storage,fetchImpl:async()=>{throw new TypeError('offline');}});
  await assert.rejects(auth.restore(),/offline/);assert.equal(auth.status().authenticated,true);assert.equal(auth.status().user.id,'USR-1');
});

test('desktop nunca grava sessão cloud em texto puro quando safeStorage não está disponível',async()=>{
  const {createDesktopCloudAuth}=require('../electron/cloud-auth.cjs');
  const store=memoryStore(),unsafe={isEncryptionAvailable:()=>false};
  const auth=createDesktopCloudAuth({baseUrl:'https://locadora.example',installationId:'LOCADORA-GEORGE',deviceId:'GEORGE-PC',store,safeStorage:unsafe,fetchImpl:async()=>response({ok:true,user:{id:'U'},expiresAt:'2099-01-01T00:00:00.000Z'},{cookie:'locadora_session=plain-secret; Path=/; HttpOnly'})});
  await assert.rejects(auth.login({username:'u@example.com',password:'password-value'}),/secure_storage_unavailable/);assert.equal(store.get('cloud:desktop-session:v1'),null);
});

test('preload e main expõem fluxo cloud e não iniciam mais runtime LAN',()=>{
  const preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8'),main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  for(const name of ['cloudAuthStatus','cloudAuthLogin','cloudAuthFirstAccess','cloudAuthLogout','cloudSyncStatus','cloudSyncNow','cloudSyncConflicts','cloudSyncResolveConflict'])assert.match(preload,new RegExp(name));
  for(const channel of ['locadora:cloud-auth:status','locadora:cloud-auth:login','locadora:cloud-auth:first-access','locadora:cloud-auth:logout','locadora:cloud-sync:conflicts','locadora:cloud-sync:resolve-conflict'])assert.match(main,new RegExp(channel));
  assert.match(main,/initializeLocalStorage\(/);assert.match(main,/startReplica\(/);assert.match(main,/locadora:\/\/app\/index\.html/);
  assert.match(main,/registerSchemesAsPrivileged/);assert.match(main,/createAppProtocolHandler/);
  assert.doesNotMatch(main,/startLanSync|startSyncServer|sync-info|pairingUrls/);
  assert.match(main,/https:\/\/sistemaaluguelcarrogeorge\.sistema-artisys\.workers\.dev/);
});

test('desktop cria backup verificado antes do primeiro ciclo de réplica cloud',()=>{
  const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  const start=main.indexOf('async function startPlan03()');
  const end=main.indexOf('function cloudFailure',start);
  const body=main.slice(start,end);
  const backup=body.indexOf('await ensureDailyBackup()');
  const replica=body.indexOf('await startReplica()');
  assert.ok(backup>=0&&replica>=0&&backup<replica,'backup deve acontecer antes da réplica cloud');
});

test('protocolo privado entrega módulos ESM sem expor servidor HTTP/LAN',async()=>{
  const {createAppProtocolHandler,mimeType}=require('../electron/app-protocol.cjs');
  assert.equal(mimeType('/tmp/app.mjs'),'text/javascript; charset=utf-8');
  assert.equal(mimeType('/tmp/index.html'),'text/html; charset=utf-8');
  const handler=createAppProtocolHandler({rootDir:fileURLToPath(new URL('..',import.meta.url))});
  const response=await handler(new Request('locadora://app/index.html'));
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.match(await response.text(),/src\/bootstrap\.mjs/);
});
