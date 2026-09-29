'use strict';
const SESSION_KEY='cloud:desktop-session:v1';
function normalizeBase(value){const url=new URL(String(value??'').trim());if(!['https:','http:'].includes(url.protocol))throw new Error('cloud_url_invalid');return url.origin;}
function codeError(code,status=0,details=null){const error=new Error(code);error.code=code;error.status=Number(status)||0;error.details=details;return error;}
function sessionCookie(response){const values=typeof response?.headers?.getSetCookie==='function'?response.headers.getSetCookie():[response?.headers?.get?.('set-cookie')].filter(Boolean);for(const value of values){const match=String(value).match(/(?:^|[,;]\s*)(locadora_session=[^;,\s]+)/i);if(match)return match[1];}return null;}
function createDesktopCloudAuth({baseUrl,installationId,deviceId,store,safeStorage,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  if(!store?.getJson||!store?.setJson||!store?.remove)throw new TypeError('cloud_auth_store_required');if(!safeStorage)throw new TypeError('cloud_auth_safe_storage_required');if(typeof fetchImpl!=='function')throw new TypeError('cloud_auth_fetch_required');
  const base=normalizeBase(baseUrl);const installation=String(installationId??'').trim(),device=String(deviceId??'').trim();if(!installation||!device)throw new TypeError('cloud_auth_identity_required');
  function ensureSecure(){if(!safeStorage.isEncryptionAvailable?.())throw codeError('secure_storage_unavailable');}
  function encrypt(value){ensureSecure();return safeStorage.encryptString(String(value)).toString('base64');}
  function decrypt(value){if(!value||!safeStorage.isEncryptionAvailable?.())return null;try{return safeStorage.decryptString(Buffer.from(String(value),'base64'));}catch{return null;}}
  function read(){const saved=store.getJson(SESSION_KEY,null);if(!saved?.cookieEncrypted)return null;const cookie=decrypt(saved.cookieEncrypted);if(!cookie)return null;return{...saved,cookie};}
  function clear(){store.remove(SESSION_KEY);return true;}
  function save({cookie,user,expiresAt}){const record={baseUrl:base,cookieEncrypted:encrypt(cookie),user:user??null,expiresAt:expiresAt??null,updatedAt:new Date().toISOString()};store.setJson(SESSION_KEY,record);return{...record,cookie};}
  async function request(path,{method='GET',body=null,cookie=null}={}){const controller=timeoutMs>0?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;const headers={accept:'application/json',origin:base};if(cookie)headers.cookie=cookie;if(body!=null)headers['content-type']='application/json';try{const response=await fetchImpl(`${base}${path}`,{method,headers,body:body==null?undefined:JSON.stringify(body),signal:controller?.signal,cache:'no-store'});let data={};try{data=await response.json();}catch{}if(!response.ok)throw codeError(data?.error||`cloud_http_${response.status}`,response.status,data);return{response,data};}finally{if(timer)clearTimeout(timer);}}
  async function establish(path,input){ensureSecure();const {response,data}=await request(path,{method:'POST',body:{...input,installationId:installation,deviceId:device}}),cookie=sessionCookie(response);if(!cookie)throw codeError('cloud_session_cookie_missing',502);save({cookie,user:data.user,expiresAt:data.expiresAt});return{ok:true,user:data.user,expiresAt:data.expiresAt,baseUrl:base,deviceId:device};}
  async function login({username,password}={}){return establish('/api/v1/auth/login',{username:String(username??'').trim().toLowerCase(),password:String(password??'')});}
  async function firstAccess({username,currentPassword,newPassword}={}){return establish('/api/v1/auth/first-access',{username:String(username??'').trim().toLowerCase(),currentPassword:String(currentPassword??''),newPassword:String(newPassword??'')});}
  async function restore(){const current=read();if(!current)return null;if(current.expiresAt&&Date.parse(current.expiresAt)<=Date.now()){clear();return null;}try{const {data}=await request('/api/v1/auth/me',{cookie:current.cookie});const merged=save({cookie:current.cookie,user:data.user,expiresAt:current.expiresAt});return{ok:true,user:merged.user,expiresAt:merged.expiresAt,baseUrl:base,deviceId:device};}catch(error){if(error?.status===401||error?.status===403)clear();throw error;}}
  async function logout(){const current=read();try{if(current?.cookie)await request('/api/v1/auth/logout',{method:'POST',cookie:current.cookie});}finally{clear();}return{ok:true};}
  function status(){const current=read();return{configured:true,authenticated:Boolean(current?.cookie),user:current?.user??null,expiresAt:current?.expiresAt??null,baseUrl:base,deviceId:device};}
  function replicaCredential(){const current=read();return current?.cookie?{baseUrl:base,cookie:current.cookie}:null;}
  return Object.freeze({login,firstAccess,restore,logout,status,replicaCredential,clear,SESSION_KEY});
}
module.exports={createDesktopCloudAuth,SESSION_KEY};
