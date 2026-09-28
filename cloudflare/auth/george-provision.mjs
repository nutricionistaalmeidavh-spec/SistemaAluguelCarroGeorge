export const GEORGE_INSTALLATION_ID='LOCADORA-GEORGE';
export const GEORGE_ADMIN_EMAIL='georgedaut.adm@gmail.com';
const GEORGE_ADMIN_ID='USR-GEORGE-ADMIN';
const GEORGE_ADMIN_PASSWORD_HASH='pbkdf2-sha256$310000$fb088d29d93054f9534c620d5957891e$327213206bd0c0e8eacd737cc8f903f2035a0874d2a4f34d6df19f382a785496';

export async function ensureGeorgeAdmin(db,{now=new Date().toISOString()}={}){
  if(!db?.prepare)throw new TypeError('database_required');

  await db.prepare(`INSERT INTO installations (id,name,created_at,updated_at,version,deleted_at)
    VALUES (?,?,?,?,1,NULL)
    ON CONFLICT(id) DO NOTHING`)
    .bind(GEORGE_INSTALLATION_ID,'Sistema Locadora George',now,now).run();

  await db.prepare(`INSERT INTO users (
      id,installation_id,username,name,role,active,password_hash,must_change_password,
      created_at,updated_at,version,updated_by_device,deleted_at
    ) VALUES (?,?,?,?,?,1,?,1,?,?,1,?,NULL)
    ON CONFLICT(installation_id,username) DO UPDATE SET
      id=users.id,
      name=excluded.name,
      role=excluded.role,
      active=1,
      password_hash=excluded.password_hash,
      must_change_password=1,
      updated_at=excluded.updated_at,
      updated_by_device=excluded.updated_by_device,
      version=users.version+1,
      deleted_at=NULL
    WHERE users.deleted_at IS NOT NULL`)
    .bind(
      GEORGE_ADMIN_ID,
      GEORGE_INSTALLATION_ID,
      GEORGE_ADMIN_EMAIL,
      'George',
      'admin',
      GEORGE_ADMIN_PASSWORD_HASH,
      now,
      now,
      'SYSTEM-PROVISION'
    ).run();

  const user=await db.prepare(`SELECT id,installation_id,username,name,role,active,password_hash,must_change_password,deleted_at
    FROM users WHERE installation_id=? AND lower(username)=lower(?) LIMIT 1`)
    .bind(GEORGE_INSTALLATION_ID,GEORGE_ADMIN_EMAIL).first();

  if(!user||user.deleted_at)throw new Error('george_admin_provision_failed');

  await db.prepare(`UPDATE users SET active=0,updated_at=?,version=version+1
    WHERE installation_id=? AND lower(username)='admin' AND active=1 AND deleted_at IS NULL`)
    .bind(now,GEORGE_INSTALLATION_ID).run();

  return user;
}
