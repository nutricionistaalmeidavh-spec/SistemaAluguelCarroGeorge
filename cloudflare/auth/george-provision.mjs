export const GEORGE_INSTALLATION_ID='LOCADORA-GEORGE';
export const GEORGE_ADMIN_EMAIL='georgedaut.adm@gmail.com';
const GEORGE_ADMIN_ID='USR-GEORGE-ADMIN';
const GEORGE_ADMIN_LEGACY_PASSWORD_HASH='pbkdf2-sha256$310000$fb088d29d93054f9534c620d5957891e$327213206bd0c0e8eacd737cc8f903f2035a0874d2a4f34d6df19f382a785496';
const GEORGE_ADMIN_PASSWORD_HASH='pbkdf2-sha256$100000$fb088d29d93054f9534c620d5957891e$531b64d6082559da260586e4f6c1d79626043b5d0558528b08f3fb28d8546ec0';
const DEMO_ADMIN_EMAIL='nutricionistaalmeidavh@gmail.com';
const DEMO_ADMIN_ID='USR-VICTOR-DEMO';
const DEMO_ADMIN_PASSWORD_HASH='pbkdf2-sha256$100000$fc1e2d246b172882697acbb4124437da$211ce96ca17e00102b8dde79482b32492bfaf531d8de0a3e38ef38efb1c1acd1';

async function insertInitialAdmin(db,{id,email,name,passwordHash,now}){
  await db.prepare(`INSERT INTO users (
      id,installation_id,username,name,role,active,password_hash,must_change_password,
      created_at,updated_at,version,updated_by_device,deleted_at
    ) VALUES (?,?,?,?,?,1,?,1,?,?,1,?,NULL)
    ON CONFLICT(installation_id,username) DO NOTHING`)
    .bind(
      id,
      GEORGE_INSTALLATION_ID,
      email,
      name,
      'admin',
      passwordHash,
      now,
      now,
      'SYSTEM-PROVISION'
    ).run();
}

export async function ensureGeorgeAdmin(db,{now=new Date().toISOString()}={}){
  if(!db?.prepare)throw new TypeError('database_required');

  await db.prepare(`INSERT INTO installations (id,name,created_at,updated_at,version,deleted_at)
    VALUES (?,?,?,?,1,NULL)
    ON CONFLICT(id) DO NOTHING`)
    .bind(GEORGE_INSTALLATION_ID,'Sistema Locadora George',now,now).run();

  // Provisionamento continua create-only. A única exceção é a migração do hash
  // inicial legado, ainda não utilizado pelo cliente, enquanto o primeiro acesso
  // permanece pendente. Senhas já escolhidas nunca são sobrescritas.
  await insertInitialAdmin(db,{
    id:GEORGE_ADMIN_ID,
    email:GEORGE_ADMIN_EMAIL,
    name:'George',
    passwordHash:GEORGE_ADMIN_PASSWORD_HASH,
    now
  });

  // Conta administrativa de demonstração solicitada pelo proprietário.
  // Também é create-only e exige troca da senha temporária no primeiro acesso.
  await insertInitialAdmin(db,{
    id:DEMO_ADMIN_ID,
    email:DEMO_ADMIN_EMAIL,
    name:'Victor Demo',
    passwordHash:DEMO_ADMIN_PASSWORD_HASH,
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

  return user;
}
