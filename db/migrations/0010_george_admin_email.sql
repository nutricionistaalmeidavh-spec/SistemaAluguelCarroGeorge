-- Provisionamento inicial da operação exclusiva do George.
-- A senha temporária nunca é versionada em texto puro; somente o hash PBKDF2.

INSERT INTO installations (id,name,created_at,updated_at,version,deleted_at)
VALUES ('LOCADORA-GEORGE','Sistema Locadora George','2026-09-28T01:40:00.000Z','2026-09-28T01:40:00.000Z',1,NULL)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  updated_at=excluded.updated_at,
  deleted_at=NULL;

-- Remove o login legado genérico para evitar que admin/1234 continue como caminho de acesso.
UPDATE users
SET active=0,
    updated_at='2026-09-28T01:40:00.000Z',
    version=version+1
WHERE installation_id='LOCADORA-GEORGE'
  AND lower(username)='admin'
  AND deleted_at IS NULL;

INSERT INTO users (
  id,installation_id,username,name,role,active,password_hash,must_change_password,
  created_at,updated_at,version,updated_by_device,deleted_at
)
VALUES (
  'USR-GEORGE-ADMIN','LOCADORA-GEORGE','georgedaut.adm@gmail.com','George','admin',1,
  'pbkdf2-sha256$310000$fb088d29d93054f9534c620d5957891e$327213206bd0c0e8eacd737cc8f903f2035a0874d2a4f34d6df19f382a785496',
  1,'2026-09-28T01:40:00.000Z','2026-09-28T01:40:00.000Z',1,'SYSTEM-PROVISION',NULL
)
ON CONFLICT(installation_id,username) DO UPDATE SET
  name=excluded.name,
  role='admin',
  active=1,
  password_hash=excluded.password_hash,
  must_change_password=1,
  updated_at=excluded.updated_at,
  updated_by_device=excluded.updated_by_device,
  version=users.version+1,
  deleted_at=NULL;
