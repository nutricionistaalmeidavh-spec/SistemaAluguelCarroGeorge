'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require('../../artisys-qa/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..','..','..');
const PUBLIC=path.join(ROOT,'.cloudflare','public');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm'};
function safeAsset(url){const pathname=decodeURIComponent(new URL(url).pathname),relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(PUBLIC,relative),root=path.resolve(PUBLIC)+path.sep;return file===path.resolve(PUBLIC,'index.html')||file.startsWith(root)?file:null;}
function assetsBinding(){return{async fetch(request){const file=safeAsset(request.url);if(!file||!fs.existsSync(file)||fs.statSync(file).isDirectory())return new Response('Not found',{status:404});return new Response(fs.readFileSync(file),{status:200,headers:{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':file.endsWith('.html')?'no-cache':'public, max-age=60'}});}};}
async function startHttp(worker,env){let server;server=http.createServer((req,res)=>{void(async()=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),headers=new Headers();for(const [key,value] of Object.entries(req.headers)){if(Array.isArray(value))for(const item of value)headers.append(key,item);else if(value!=null)headers.set(key,String(value));}const url=`http://127.0.0.1:${server.address().port}${req.url||'/'}`,init={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)&&body.length)init.body=body;const response=await worker.fetch(new Request(url,init),env,{});res.statusCode=response.status;const cookies=response.headers.getSetCookie?.()??[];for(const [key,value] of response.headers.entries())if(key!=='set-cookie')res.setHeader(key,value);if(cookies.length)res.setHeader('set-cookie',cookies);else{const cookie=response.headers.get('set-cookie');if(cookie)res.setHeader('set-cookie',cookie);}res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.statusCode=500;res.setHeader('content-type','text/plain');res.end(error?.stack||String(error));}})();});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server;}
async function launchChrome(){try{return await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});}catch{return chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});}}
async function launchCloudPwa(){
  execFileSync(process.execPath,['scripts/prepare-cloud-assets.mjs'],{cwd:ROOT,stdio:'pipe'});
  const [{FakeD1},{FakeR2},{hashPassword},workerModule]=await Promise.all([import(path.join(ROOT,'tests/helpers/fake-d1.mjs')),import(path.join(ROOT,'tests/helpers/fake-r2.mjs')),import(path.join(ROOT,'cloudflare/auth/password.mjs')),import(path.join(ROOT,'cloudflare/worker.mjs'))]);
  const db=new FakeD1(),r2=new FakeR2(),now='2026-09-27T20:00:00.000Z',password=process.env.LOCADORA_QA_ADMIN_PASSWORD||'1234',passwordHash=await hashPassword(password),installationId='LOCADORA-GEORGE',email='georgedaut.adm@gmail.com',userId='USR-QA-CLOUD';
  db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(installationId,'George QA',now,now);
  db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(userId,installationId,email,'George Admin','admin',1,passwordHash,0,now,now);
  const env={DB:db,ATTACHMENTS:r2,ASSETS:assetsBinding()},server=await startHttp(workerModule.default,env),baseUrl=`http://127.0.0.1:${server.address().port}`,browser=await launchChrome(),context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'}),page=await context.newPage();
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  async function openModule(id){
    const toggle=page.locator('#cloud-mobile-menu');
    await toggle.waitFor({state:'attached'});
    if(!await toggle.isChecked()){
      await page.locator('.mobile-appbar[for="cloud-mobile-menu"]').click();
      await page.waitForFunction(()=>document.querySelector('#cloud-mobile-menu')?.checked===true);
    }
    await page.locator(`[data-test="mobile-module-central"] [data-cloud-nav="${id}"]:not([data-cloud-shortcut])`).click();
  }
  return{db,r2,env,server,browser,context,page,baseUrl,installationId,email,password,openModule,async login(){await page.locator('#cloud-login input[name="username"]').fill(email);await page.locator('#cloud-login input[name="password"]').fill(password);await page.locator('#cloud-login button').click();await page.locator('.mobile-appbar[for="cloud-mobile-menu"]').waitFor();await page.evaluate(()=>navigator.serviceWorker?.ready);},async close(){try{await context.close();}catch{}try{await browser.close();}catch{}await new Promise(resolve=>server.close(()=>resolve()));db.close();}};
}
module.exports={launchCloudPwa};
