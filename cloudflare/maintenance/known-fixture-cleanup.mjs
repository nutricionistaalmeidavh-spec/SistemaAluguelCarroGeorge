import { writeCloudBackup } from '../backup/r2-backup.mjs';

const INSTALLATION_ID='LOCADORA-GEORGE';
const LEGACY_DEMO_USER_ID='USR-VICTOR-DEMO';
const CLEANUP_ACTION='maintenance.known_fixture_cleanup.v1';

const customerPredicate=(alias='c')=>`(
  ${alias}.id IN ('CUS-OPS','CUS-DR','CLI-PC-1')
  OR lower(COALESCE(${alias}.email,'')) IN ('total@example.test','diaria@example.test','cliente.demo@example.invalid')
  OR ${alias}.name IN ('Cliente Total','Cliente Diária','Cliente Base','Cliente Offline','Cliente Teste','Cliente Demonstração','Cliente reconstruído')
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('customer','customers') AND ax.deleted_at IS NULL
  )
)`;

const vehiclePredicate=(alias='v')=>`(
  ${alias}.id IN ('VEI-OPS','VEI-PC-1')
  OR upper(COALESCE(${alias}.plate,'')) IN ('TST1A01','TST2B02','TST0A00','OFF1A23')
  OR ${alias}.model IN ('Sedan Total','Hatch Diário','Modelo Teste','Argo Base')
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('vehicle','vehicles') AND ax.deleted_at IS NULL
  )
)`;

const rentalPredicate=(alias='r')=>`(
  ${alias}.id IN ('LOC-PARITY','LOC-PC-1','LOC-DESKTOP-1','LOC-INSP')
  OR ${alias}.attendant_id='${LEGACY_DEMO_USER_ID}'
  OR COALESCE(${alias}.notes,'') IN ('Baseline modo total','Baseline agenda diária')
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('rental','rentals') AND ax.deleted_at IS NULL
  )
  OR EXISTS (SELECT 1 FROM customers c WHERE c.installation_id='${INSTALLATION_ID}' AND c.id=${alias}.customer_id AND ${customerPredicate('c')})
  OR EXISTS (SELECT 1 FROM vehicles v WHERE v.installation_id='${INSTALLATION_ID}' AND v.id=${alias}.vehicle_id AND ${vehiclePredicate('v')})
)`;

const expensePredicate=(alias='e')=>`(
  ${alias}.description='Lavagem baseline'
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('expense','expenses') AND ax.deleted_at IS NULL
  )
  OR (${alias}.vehicle_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicles v WHERE v.installation_id='${INSTALLATION_ID}' AND v.id=${alias}.vehicle_id AND ${vehiclePredicate('v')}))
)`;

const inspectionPredicate=(alias='i')=>`(
  EXISTS (SELECT 1 FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND r.id=${alias}.rental_id AND ${rentalPredicate('r')})
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('inspection','inspections') AND ax.deleted_at IS NULL
  )
)`;

const maintenancePredicate=(alias='m')=>`(
  ${alias}.id='MNT-WEB-1'
  OR COALESCE(${alias}.notes,'')='Manutenção da fixture'
  OR EXISTS (SELECT 1 FROM vehicles v WHERE v.installation_id='${INSTALLATION_ID}' AND v.id=${alias}.vehicle_id AND ${vehiclePredicate('v')})
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('maintenance') AND ax.deleted_at IS NULL
  )
)`;

const templatePredicate=(alias='t')=>`(
  ${alias}.id='TPL-WEB-1'
  OR ${alias}.name='Contrato baseline'
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('contract_template','contractTemplate') AND ax.deleted_at IS NULL
  )
)`;

const planPredicate=(alias='bp')=>`(
  EXISTS (SELECT 1 FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND r.id=${alias}.rental_id AND ${rentalPredicate('r')})
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('billing_plan','billingPlan') AND ax.deleted_at IS NULL
  )
)`;

const installmentPredicate=(alias='bi')=>`(
  EXISTS (SELECT 1 FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND r.id=${alias}.rental_id AND ${rentalPredicate('r')})
  OR EXISTS (SELECT 1 FROM billing_plans bp WHERE bp.installation_id='${INSTALLATION_ID}' AND bp.id=${alias}.plan_id AND ${planPredicate('bp')})
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('billing_installment','billingInstallment') AND ax.deleted_at IS NULL
  )
)`;

const issuedPredicate=(alias='ic')=>`(
  EXISTS (SELECT 1 FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND r.id=${alias}.rental_id AND ${rentalPredicate('r')})
  OR (${alias}.template_id IS NOT NULL AND EXISTS (SELECT 1 FROM contract_templates t WHERE t.installation_id='${INSTALLATION_ID}' AND t.id=${alias}.template_id AND ${templatePredicate('t')}))
  OR EXISTS (
    SELECT 1 FROM audit_log ax
    WHERE ax.installation_id='${INSTALLATION_ID}' AND ax.actor_id='${LEGACY_DEMO_USER_ID}'
      AND ax.entity_id=${alias}.id AND ax.entity_type IN ('issued_contract','issuedContract') AND ax.deleted_at IS NULL
  )
)`;

async function alreadyRan(db){
  const row=await db.prepare(`SELECT id FROM audit_log WHERE installation_id=? AND action=? AND deleted_at IS NULL ORDER BY at DESC LIMIT 1`)
    .bind(INSTALLATION_ID,CLEANUP_ACTION).first();
  return Boolean(row);
}
async function count(db,table,predicate,alias){
  const row=await db.prepare(`SELECT COUNT(*) AS total FROM ${table} ${alias} WHERE ${alias}.installation_id='${INSTALLATION_ID}' AND ${predicate}`).first();
  return Number(row?.total)||0;
}
async function collectR2Keys(env){
  const rows=await env.DB.prepare(`SELECT a.object_key AS objectKey
    FROM attachments a
    WHERE a.installation_id='${INSTALLATION_ID}' AND a.deleted_at IS NULL AND (
      a.created_by='${LEGACY_DEMO_USER_ID}'
      OR a.id='FOTO-LEGACY-001'
      OR lower(COALESCE(a.local_path,'')) LIKE '%baseline.jpg%'
      OR (a.entity_type='inspection' AND EXISTS (
        SELECT 1 FROM inspections i WHERE i.installation_id='${INSTALLATION_ID}' AND i.id=a.entity_id AND ${inspectionPredicate('i')}
      ))
      OR (a.entity_type='contract' AND EXISTS (
        SELECT 1 FROM issued_contracts ic WHERE ic.installation_id='${INSTALLATION_ID}' AND ic.id=a.entity_id AND ${issuedPredicate('ic')}
      ))
    )`).all();
  return (rows?.results??[]).map(row=>row.objectKey).filter(Boolean);
}

export async function cleanupKnownFixtureData(env,{actorId='SYSTEM-CLEANUP',force=false}={}){
  if(!env?.DB?.prepare||typeof env.DB.batch!=='function')throw new Error('database_unavailable');
  if(!force&&await alreadyRan(env.DB))return{ok:true,alreadyRan:true};

  const backup=env?.ATTACHMENTS?.put?await writeCloudBackup(env,INSTALLATION_ID):null;
  const r2Keys=await collectR2Keys(env);
  if(env?.ATTACHMENTS?.delete&&r2Keys.length){
    for(let i=0;i<r2Keys.length;i+=500)await env.ATTACHMENTS.delete(r2Keys.slice(i,i+500));
  }

  const before={
    customers:await count(env.DB,'customers',customerPredicate('c'),'c'),
    vehicles:await count(env.DB,'vehicles',vehiclePredicate('v'),'v'),
    rentals:await count(env.DB,'rentals',rentalPredicate('r'),'r'),
    expenses:await count(env.DB,'expenses',expensePredicate('e'),'e'),
    inspections:await count(env.DB,'inspections',inspectionPredicate('i'),'i'),
    maintenance:await count(env.DB,'maintenance',maintenancePredicate('m'),'m'),
    contractTemplates:await count(env.DB,'contract_templates',templatePredicate('t'),'t'),
    billingPlans:await count(env.DB,'billing_plans',planPredicate('bp'),'bp'),
    billingInstallments:await count(env.DB,'billing_installments',installmentPredicate('bi'),'bi'),
    issuedContracts:await count(env.DB,'issued_contracts',issuedPredicate('ic'),'ic'),
    attachments:r2Keys.length
  };

  const statements=[
    env.DB.prepare(`DELETE FROM billing_payment_conflicts WHERE installation_id='${INSTALLATION_ID}' AND installment_id IN (SELECT bi.id FROM billing_installments bi WHERE bi.installation_id='${INSTALLATION_ID}' AND ${installmentPredicate('bi')})`),
    env.DB.prepare(`DELETE FROM billing_payments WHERE installation_id='${INSTALLATION_ID}' AND installment_id IN (SELECT bi.id FROM billing_installments bi WHERE bi.installation_id='${INSTALLATION_ID}' AND ${installmentPredicate('bi')})`),
    env.DB.prepare(`DELETE FROM collection_actions WHERE installation_id='${INSTALLATION_ID}' AND (
      actor_id='${LEGACY_DEMO_USER_ID}'
      OR rental_id IN (SELECT r.id FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND ${rentalPredicate('r')})
      OR customer_id IN (SELECT c.id FROM customers c WHERE c.installation_id='${INSTALLATION_ID}' AND ${customerPredicate('c')})
      OR installment_id IN (SELECT bi.id FROM billing_installments bi WHERE bi.installation_id='${INSTALLATION_ID}' AND ${installmentPredicate('bi')})
    )`),
    env.DB.prepare(`DELETE FROM inspection_items WHERE installation_id='${INSTALLATION_ID}' AND inspection_id IN (SELECT i.id FROM inspections i WHERE i.installation_id='${INSTALLATION_ID}' AND ${inspectionPredicate('i')})`),
    env.DB.prepare(`DELETE FROM attachments WHERE installation_id='${INSTALLATION_ID}' AND (
      created_by='${LEGACY_DEMO_USER_ID}' OR id='FOTO-LEGACY-001' OR lower(COALESCE(local_path,'')) LIKE '%baseline.jpg%'
      OR (entity_type='inspection' AND entity_id IN (SELECT i.id FROM inspections i WHERE i.installation_id='${INSTALLATION_ID}' AND ${inspectionPredicate('i')}))
      OR (entity_type='contract' AND entity_id IN (SELECT ic.id FROM issued_contracts ic WHERE ic.installation_id='${INSTALLATION_ID}' AND ${issuedPredicate('ic')}))
    )`),
    env.DB.prepare(`DELETE FROM issued_contracts WHERE installation_id='${INSTALLATION_ID}' AND ${issuedPredicate('issued_contracts')}`.replaceAll('issued_contracts.','issued_contracts.')),
    env.DB.prepare(`DELETE FROM rental_payments WHERE installation_id='${INSTALLATION_ID}' AND rental_id IN (SELECT r.id FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND ${rentalPredicate('r')})`),
    env.DB.prepare(`DELETE FROM ledger WHERE installation_id='${INSTALLATION_ID}' AND (
      rental_id IN (SELECT r.id FROM rentals r WHERE r.installation_id='${INSTALLATION_ID}' AND ${rentalPredicate('r')})
      OR expense_id IN (SELECT e.id FROM expenses e WHERE e.installation_id='${INSTALLATION_ID}' AND ${expensePredicate('e')})
      OR vehicle_id IN (SELECT v.id FROM vehicles v WHERE v.installation_id='${INSTALLATION_ID}' AND ${vehiclePredicate('v')})
      OR installment_id IN (SELECT bi.id FROM billing_installments bi WHERE bi.installation_id='${INSTALLATION_ID}' AND ${installmentPredicate('bi')})
    )`),
    env.DB.prepare(`DELETE FROM billing_installments WHERE installation_id='${INSTALLATION_ID}' AND ${installmentPredicate('billing_installments')}`),
    env.DB.prepare(`DELETE FROM billing_plans WHERE installation_id='${INSTALLATION_ID}' AND ${planPredicate('billing_plans')}`),
    env.DB.prepare(`DELETE FROM inspections WHERE installation_id='${INSTALLATION_ID}' AND ${inspectionPredicate('inspections')}`),
    env.DB.prepare(`DELETE FROM maintenance WHERE installation_id='${INSTALLATION_ID}' AND ${maintenancePredicate('maintenance')}`),
    env.DB.prepare(`DELETE FROM expenses WHERE installation_id='${INSTALLATION_ID}' AND ${expensePredicate('expenses')}`),
    env.DB.prepare(`DELETE FROM contract_templates WHERE installation_id='${INSTALLATION_ID}' AND ${templatePredicate('contract_templates')}`),
    env.DB.prepare(`DELETE FROM rentals WHERE installation_id='${INSTALLATION_ID}' AND ${rentalPredicate('rentals')}`),
    env.DB.prepare(`DELETE FROM customers WHERE installation_id='${INSTALLATION_ID}' AND ${customerPredicate('customers')}`),
    env.DB.prepare(`DELETE FROM vehicles WHERE installation_id='${INSTALLATION_ID}' AND ${vehiclePredicate('vehicles')}`)
  ];
  const results=await env.DB.batch(statements);
  const deleted=results.map(result=>Number(result?.meta?.changes)||0);
  const now=new Date().toISOString(),details={backupId:backup?.id??null,before,r2Deleted:r2Keys.length,deletedRows:deleted.reduce((sum,n)=>sum+n,0)};
  await env.DB.prepare(`INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version,updated_by_device,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,NULL)`)
    .bind(`AUD-${crypto.randomUUID()}`,INSTALLATION_ID,actorId,CLEANUP_ACTION,'installation',INSTALLATION_ID,JSON.stringify(details),now,now,now,'SYSTEM-FIXTURE-CLEANUP').run();
  return{ok:true,alreadyRan:false,...details};
}

export const knownFixtureCleanupAction=CLEANUP_ACTION;
