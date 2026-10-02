export const GEORGE_INSTALLATION_ID='LOCADORA-GEORGE';
export const GEORGE_ADMIN_EMAIL='georgedaut.adm@gmail.com';
export const DEMO_INSTALLATION_ID='LOCADORA-DEMO-VICTOR';
export const DEMO_ADMIN_EMAIL='nutricionistaalmeidavh@gmail.com';
const GEORGE_ADMIN_ID='USR-GEORGE-ADMIN';
const DEMO_ADMIN_ID='USR-VICTOR-DEMO-ISOLATED';
const LEGACY_DEMO_ADMIN_ID='USR-VICTOR-DEMO';
const GEORGE_ADMIN_LEGACY_PASSWORD_HASH='pbkdf2-sha256$310000$fb088d29d93054f9534c620d5957891e$327213206bd0c0e8eacd737cc8f903f2035a0874d2a4f34d6df19f382a785496';
const GEORGE_ADMIN_PASSWORD_HASH='pbkdf2-sha256$100000$fb088d29d93054f9534c620d5957891e$531b64d6082559da260586e4f6c1d79626043b5d0558528b08f3fb28d8546ec0';
const DEMO_ADMIN_PASSWORD_HASH='pbkdf2-sha256$100000$fc1e2d246b172882697acbb4124437da$211ce96ca17e00102b8dde79482b32492bfaf531d8de0a3e38ef38efb1c1acd1';

async function ensureInstallation(db,{id,name,now}){
  await db.prepare(`INSERT INTO installations (id,name,created_at,updated_at,version,deleted_at)
    VALUES (?,?,?,?,1,NULL)
    ON CONFLICT(id) DO NOTHING`).bind(id,name,now,now).run();
}
async function insertInitialAdmin(db,{id,installationId,email,name,passwordHash,mustChangePassword=1,now}){
  await db.prepare(`INSERT INTO users (
      id,installation_id,username,name,role,active,password_hash,must_change_password,
      created_at,updated_at,version,updated_by_device,deleted_at
    ) VALUES (?,?,?,?,?,1,?,?,?, ?,1,?,NULL)
    ON CONFLICT(installation_id,username) DO NOTHING`)
    .bind(id,installationId,email,name,'admin',passwordHash,Number(mustChangePassword)?1:0,now,now,'SYSTEM-PROVISION').run();
}
async function ensureDemoAdmin(db,{now}){
  await ensureInstallation(db,{id:DEMO_INSTALLATION_ID,name:'Ambiente Demo Victor',now});
  const legacy=await db.prepare(`SELECT id,username,name,role,active,password_hash,must_change_password,deleted_at
    FROM users WHERE installation_id=? AND lower(username)=lower(?) LIMIT 1`)
    .bind(GEORGE_INSTALLATION_ID,DEMO_ADMIN_EMAIL).first();
  const existing=await db.prepare(`SELECT id,username,name,role,active,password_hash,must_change_password,deleted_at
    FROM users WHERE installation_id=? AND lower(username)=lower(?) LIMIT 1`)
    .bind(DEMO_INSTALLATION_ID,DEMO_ADMIN_EMAIL).first();
  if(!existing){
    await insertInitialAdmin(db,{
      id:DEMO_ADMIN_ID,
      installationId:DEMO_INSTALLATION_ID,
      email:DEMO_ADMIN_EMAIL,
      name:legacy?.name||'Victor Demo',
      passwordHash:legacy?.password_hash||DEMO_ADMIN_PASSWORD_HASH,
      mustChangePassword:legacy?.must_change_password??1,
      now
    });
  }
  if(legacy){
    await db.prepare(`UPDATE users SET active=0,updated_at=?,version=version+1,updated_by_device=?
      WHERE installation_id=? AND id=? AND active=1`)
      .bind(now,'SYSTEM-DEMO-ISOLATION',GEORGE_INSTALLATION_ID,legacy.id).run();
    await db.prepare(`UPDATE sessions SET revoked_at=COALESCE(revoked_at,?)
      WHERE installation_id=? AND user_id=? AND revoked_at IS NULL`)
      .bind(now,GEORGE_INSTALLATION_ID,legacy.id).run();
  }
  return db.prepare(`SELECT id,installation_id,username,name,role,active,password_hash,must_change_password,deleted_at
    FROM users WHERE installation_id=? AND lower(username)=lower(?) LIMIT 1`)
    .bind(DEMO_INSTALLATION_ID,DEMO_ADMIN_EMAIL).first();
}
export function loginInstallation(installationId,username){
  return String(username??'').trim().toLowerCase()===DEMO_ADMIN_EMAIL.toLowerCase()?DEMO_INSTALLATION_ID:String(installationId??'').trim();
}
export async function ensureGeorgeAdmin(db,{now=new Date().toISOString()}={}){
  if(!db?.prepare)throw new TypeError('database_required');

  await ensureInstallation(db,{id:GEORGE_INSTALLATION_ID,name:'Sistema Locadora George',now});
  await insertInitialAdmin(db,{
    id:GEORGE_ADMIN_ID,
    installationId:GEORGE_INSTALLATION_ID,
    email:GEORGE_ADMIN_EMAIL,
    name:'George',
    passwordHash:GEORGE_ADMIN_PASSWORD_HASH,
    mustChangePassword:1,
    now
  });

  let user=await db.prepare(`SELECT id,installation_id,username,name,role,active,password_hash,must_change_password,deleted_at
    FROM users WHERE installation_id=? AND lower(username)=lower(?) LIMIT 1`)
    .bind(GEORGE_INSTALLATION_ID,GEORGE_ADMIN_EMAIL).first();

  if(!user)throw new Error('george_admin_provision_failed');

  if(Number(user.active)===1&&user.deleted_at==null&&Number(user.must_change_password)===1&&user.password_hash===GEORGE_ADMIN_LEGACY_PASSWORD_HASH){
    const migrated=await db.prepare(`UPDATE users SET password_hash=?,updated_at=?,version=version+1,updated_by_device=?
      WHERE installation_id=? AND id=? AND active=1 AND deleted_at IS NULL AND must_change_password=1 AND password_hash=?`)
      .bind(GEORGE_ADMIN_PASSWORD_HASH,now,'SYSTEM-PROVISION',GEORGE_INSTALLATION_ID,user.id,GEORGE_ADMIN_LEGACY_PASSWORD_HASH).run();
    if(Number(migrated?.meta?.changes??0)===1)user={...user,password_hash:GEORGE_ADMIN_PASSWORD_HASH};
  }

  await db.prepare(`UPDATE users SET active=0,updated_at=?,version=version+1
    WHERE installation_id=? AND lower(username)='admin' AND active=1 AND deleted_at IS NULL`)
    .bind(now,GEORGE_INSTALLATION_ID).run();

  await ensureDemoAdmin(db,{now});
  return user;
}
