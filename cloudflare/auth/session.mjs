const COOKIE_NAME='locadora_session';
const DEFAULT_TTL_SECONDS=7*24*60*60;
const encoder=new TextEncoder();

function bytesToHex(bytes){return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');}
async function sha256Hex(value){return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(String(value)))));}
function randomHex(bytes=32){return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));}

export function buildSessionCookie(token,{maxAge=DEFAULT_TTL_SECONDS}={}){
  return `${COOKIE_NAME}=${encodeURIComponent(String(token))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0,Math.floor(Number(maxAge)||0))}`;
}
export function clearSessionCookie(){return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;}
export function readSessionToken(request){
  const cookie=request?.headers?.get?.('cookie')??'';
  for(const part of cookie.split(';')){const [name,...rest]=part.trim().split('=');if(name===COOKIE_NAME)return decodeURIComponent(rest.join('='));}
  return null;
}
export async function hashSessionToken(token){return sha256Hex(token);}

export async function createSessionRecord(db,{installationId,userId,deviceId=null,userAgent='',ttlSeconds=DEFAULT_TTL_SECONDS}={}){
  if(!db?.prepare)throw new TypeError('Binding D1 inválido.');
  if(!installationId||!userId)throw new TypeError('Sessão sem identidade.');
  const token=randomHex(32),tokenHash=await hashSessionToken(token),id=`SES-${crypto.randomUUID()}`,createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+Math.max(60,Number(ttlSeconds)||DEFAULT_TTL_SECONDS)*1000).toISOString();
  const userAgentHash=userAgent?await sha256Hex(userAgent):null;
  await db.prepare('INSERT INTO sessions (id, installation_id, user_id, token_hash, device_id, user_agent_hash, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').bind(id,String(installationId),String(userId),tokenHash,deviceId?String(deviceId):null,userAgentHash,createdAt,createdAt,expiresAt).run();
  return{token,expiresAt,id};
}

export async function resolveSession(request,env){
  const db=env?.DB,token=readSessionToken(request);if(!db?.prepare||!token)return null;
  const tokenHash=await hashSessionToken(token),stamp=new Date().toISOString();
  const row=await db.prepare(`SELECT s.id AS session_id, s.installation_id, s.user_id, s.device_id, s.expires_at, u.username, u.name, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id AND u.installation_id = s.installation_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1 AND u.deleted_at IS NULL LIMIT 1`).bind(tokenHash,stamp).first();
  if(!row)return null;
  try{await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND installation_id = ?').bind(stamp,row.session_id,row.installation_id).run();}catch{}
  return{sessionId:row.session_id,installationId:row.installation_id,userId:row.user_id,deviceId:row.device_id??null,username:row.username,name:row.name,role:row.role,active:Boolean(row.active)};
}

export async function revokeSessionToken(db,token){
  if(!db?.prepare||!token)return false;
  const tokenHash=await hashSessionToken(token),stamp=new Date().toISOString();
  const result=await db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(stamp,tokenHash).run();
  return Number(result?.meta?.changes??0)>0;
}
