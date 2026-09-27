const DEFAULT_ITERATIONS=310_000;
const KEY_BYTES=32;
const SALT_BYTES=16;
const encoder=new TextEncoder();

function bytesToHex(bytes){return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');}
function hexToBytes(hex){if(!/^[0-9a-f]+$/i.test(hex)||hex.length%2)throw new Error('Hash inválido.');return Uint8Array.from(hex.match(/../g),value=>Number.parseInt(value,16));}
function equalBytes(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
async function sha256Bytes(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(String(value))));}
async function derive(password,salt,iterations){
  const key=await crypto.subtle.importKey('raw',encoder.encode(String(password)),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,KEY_BYTES*8);
  return new Uint8Array(bits);
}

export async function hashPassword(password,{iterations=DEFAULT_ITERATIONS,salt=null}={}){
  const rounds=Number(iterations);if(!Number.isInteger(rounds)||rounds<1)throw new TypeError('iterations inválido.');
  const saltBytes=salt?hexToBytes(String(salt)):crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest=await derive(password,saltBytes,rounds);
  return `pbkdf2-sha256$${rounds}$${bytesToHex(saltBytes)}$${bytesToHex(digest)}`;
}

export async function verifyPassword(password,encoded){
  const value=String(encoded||'').trim();
  const match=value.match(/^pbkdf2-sha256\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/i);
  if(match){
    try{
      const rounds=Number(match[1]),salt=hexToBytes(match[2]),expected=hexToBytes(match[3]);
      if(!Number.isInteger(rounds)||rounds<1||expected.length!==KEY_BYTES)return{ok:false,needsUpgrade:false};
      const actual=await derive(password,salt,rounds);return{ok:equalBytes(actual,expected),needsUpgrade:false};
    }catch{return{ok:false,needsUpgrade:false};}
  }
  if(/^[0-9a-f]{64}$/i.test(value)){
    const actual=await sha256Bytes(password),expected=hexToBytes(value),ok=equalBytes(actual,expected);
    return{ok,needsUpgrade:ok};
  }
  return{ok:false,needsUpgrade:false};
}
