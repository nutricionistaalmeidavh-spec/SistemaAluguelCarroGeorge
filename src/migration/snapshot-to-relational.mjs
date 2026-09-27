const clone = value => value == null ? value : (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const list = value => Array.isArray(value) ? value : [];
const json = value => value == null ? null : JSON.stringify(value);
const flag = value => value === false ? 0 : value ? 1 : 0;

function timestamps(item, fallback) {
  const created = item?.createdAt ?? item?.at ?? item?.paidAt ?? fallback;
  const updated = item?.updatedAt ?? item?.completedAt ?? item?.paidAt ?? item?.at ?? created;
  return { created_at:created, updated_at:updated };
}

function mutable(item, installationId, deviceId, fallback) {
  return {
    id:String(item.id),
    installation_id:installationId,
    ...timestamps(item, fallback),
    version:Math.max(1, Number(item?.syncVersion ?? 1) || 1),
    updated_by_device:item?.updatedByDevice ?? deviceId ?? null,
    deleted_at:item?.deletedAt ?? null
  };
}

export function snapshotToRelational(snapshot, { installationId, deviceId } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('snapshot é obrigatório.');
  if (!installationId) throw new TypeError('installationId é obrigatório.');
  if (!deviceId) throw new TypeError('deviceId é obrigatório.');

  const fallback = snapshot.updatedAt ?? new Date(0).toISOString();
  const settings = clone(snapshot.settings ?? {});
  const dataset = {
    meta:{
      snapshot_version:Number(snapshot.version || 0),
      updated_at:fallback,
      restore_point_json:json(snapshot.restorePoint ?? null)
    },
    installations:[{
      id:String(installationId),
      name:String(settings.companyName || 'Sistema Locadora George'),
      created_at:fallback,
      updated_at:fallback,
      version:1,
      updated_by_device:String(deviceId),
      deleted_at:null
    }],
    devices:[{
      id:String(deviceId), installation_id:String(installationId), name:'Dispositivo de migração', kind:'migration', active:1,
      last_seen_at:fallback, created_at:fallback, updated_at:fallback, version:1, updated_by_device:String(deviceId), deleted_at:null
    }],
    users:[], customers:[], vehicles:[], rentals:[], rental_payments:[], expenses:[], ledger:[],
    inspections:[], inspection_items:[], legacy_inspection_photos:[], maintenance:[], contract_templates:[],
    issued_contracts:[], billing_plans:[], billing_installments:[], billing_payments:[], billing_payment_conflicts:[],
    collection_actions:[], audit_log:[], alert_state:[], app_settings:[]
  };

  for (const item of list(snapshot.users)) dataset.users.push({
    ...mutable(item, installationId, deviceId, fallback), username:String(item.username ?? ''), name:String(item.name ?? ''),
    role:String(item.role ?? ''), active:flag(item.active !== false), password_hash:item.passwordHash ?? null
  });

  for (const item of list(snapshot.customers)) dataset.customers.push({
    ...mutable(item, installationId, deviceId, fallback), name:String(item.name ?? ''), document:item.document ?? null,
    phone:item.phone ?? null, email:item.email ?? null, address:item.address ?? null,
    driver_license_json:json(item.driverLicense ?? null), active:flag(item.active !== false)
  });

  for (const item of list(snapshot.vehicles)) dataset.vehicles.push({
    ...mutable(item, installationId, deviceId, fallback), model:String(item.model ?? ''), plate:String(item.plate ?? ''), year:item.year == null ? null : String(item.year),
    mileage:Number(item.mileage || 0), category:item.category ?? null, color:item.color ?? null, daily_rate:Number(item.dailyRate || 0),
    purchase_price:Number(item.purchasePrice || 0), availability:String(item.availability ?? 'disponivel'), documents_json:json(item.documents ?? null)
  });

  for (const item of list(snapshot.rentals)) {
    dataset.rentals.push({
      ...mutable(item, installationId, deviceId, fallback), vehicle_id:item.vehicleId, customer_id:item.customerId, attendant_id:item.attendantId ?? null,
      pickup_at:item.pickupAt, return_at:item.returnAt ?? null, period_mode:item.periodMode ?? 'fixed', continuous_closed_at:item.continuousClosedAt ?? null,
      status:item.status, priority:item.priority ?? null, notes:item.notes ?? null, daily_rate:Number(item.dailyRate || 0), days:Number(item.days || 1),
      total:Number(item.total || 0), billing_mode:item.billingMode ?? 'total', payment_status:item.paymentStatus ?? 'aberto'
    });
    for (const payment of list(item.payments)) dataset.rental_payments.push({
      ...mutable(payment, installationId, deviceId, payment.paidAt ?? fallback), rental_id:item.id, installment_id:payment.installmentId ?? null,
      amount:Number(payment.amount || 0), method:String(payment.method ?? ''), paid_at:payment.paidAt ?? fallback
    });
  }

  for (const item of list(snapshot.expenses)) dataset.expenses.push({
    ...mutable(item, installationId, deviceId, fallback), vehicle_id:item.vehicleId ?? null, description:String(item.description ?? ''), category:item.category ?? null,
    amount:Number(item.amount || 0), due_at:item.dueAt ?? null, paid:flag(item.paid)
  });

  for (const item of list(snapshot.ledger)) dataset.ledger.push({
    ...mutable(item, installationId, deviceId, fallback), kind:String(item.kind ?? ''), billing_purpose:item.billingPurpose ?? null,
    rental_id:item.rentalId ?? null, expense_id:item.expenseId ?? null, installment_id:item.installmentId ?? null, vehicle_id:item.vehicleId ?? null,
    description:String(item.description ?? ''), amount:Number(item.amount || 0), paid_amount:Number(item.paidAmount || 0), status:String(item.status ?? 'open'),
    due_at:item.dueAt ?? null, paid_at:item.paidAt ?? null
  });

  for (const item of list(snapshot.inspections)) {
    dataset.inspections.push({
      ...mutable(item, installationId, deviceId, fallback), rental_id:item.rentalId, vehicle_id:item.vehicleId, kind:item.kind, status:item.status,
      mileage:item.mileage == null ? null : Number(item.mileage), fuel_level:item.fuelLevel ?? null, notes:item.notes ?? null,
      damages_json:json(item.damages ?? []), completed_at:item.completedAt ?? null
    });
    for (const check of list(item.checklist)) dataset.inspection_items.push({
      ...mutable({ id:`${item.id}:${check.id}`, createdAt:item.createdAt, updatedAt:item.updatedAt ?? item.completedAt }, installationId, deviceId, fallback),
      inspection_id:item.id, item_key:String(check.id), label:String(check.label ?? ''), done:flag(check.done), evidence:check.evidence ?? null
    });
    for (const photo of list(item.photos)) dataset.legacy_inspection_photos.push({
      id:String(photo.id), installation_id:installationId, inspection_id:item.id, name:photo.name ?? 'foto.jpg', mime_type:photo.type ?? 'image/jpeg',
      data_url:photo.dataUrl ?? null, created_at:photo.createdAt ?? item.createdAt ?? fallback
    });
  }

  for (const item of list(snapshot.maintenance)) dataset.maintenance.push({
    ...mutable(item, installationId, deviceId, fallback), vehicle_id:item.vehicleId, type:String(item.type ?? ''), due_at:item.dueAt || null,
    due_mileage:item.dueMileage == null ? null : Number(item.dueMileage), notes:item.notes ?? null, cost_estimate:Number(item.costEstimate || 0),
    status:String(item.status ?? 'scheduled'), started_at:item.startedAt ?? null, completed_at:item.completedAt ?? null, cost:Number(item.cost || 0)
  });

  for (const item of list(snapshot.contractTemplates)) dataset.contract_templates.push({
    ...mutable(item, installationId, deviceId, fallback), name:String(item.name ?? ''), body:String(item.body ?? ''), active:flag(item.active !== false),
    is_default:flag(item.isDefault), template_version:Math.max(1, Number(item.version || 1))
  });

  for (const item of list(snapshot.issuedContracts)) dataset.issued_contracts.push({
    ...mutable(item, installationId, deviceId, fallback), rental_id:item.rentalId, template_id:item.templateId ?? null, template_name:String(item.templateName ?? ''),
    template_version:Math.max(1, Number(item.templateVersion || 1)), rendered_text:String(item.renderedText ?? '')
  });

  for (const item of list(snapshot.billingPlans)) dataset.billing_plans.push({
    ...mutable(item, installationId, deviceId, fallback), rental_id:item.rentalId, customer_id:item.customerId, vehicle_id:item.vehicleId,
    purpose:item.purpose ?? 'additional', frequency:item.frequency, custom_days:item.customDays ?? null, amount:Number(item.amount || 0), occurrences:Number(item.occurrences || 0),
    first_due_at:item.firstDueAt, fine_percent:Number(item.finePercent || 0), interest_monthly_percent:Number(item.interestMonthlyPercent || 0), active:flag(item.active !== false),
    generation_mode:item.generationMode ?? null, generation_closed_at:item.generationClosedAt ?? null
  });

  for (const item of list(snapshot.billingInstallments)) {
    dataset.billing_installments.push({
      ...mutable(item, installationId, deviceId, fallback), plan_id:item.planId, rental_id:item.rentalId, customer_id:item.customerId, vehicle_id:item.vehicleId,
      sequence:Number(item.sequence || 0), due_at:item.dueAt, amount:Number(item.amount || 0), paid_amount:Number(item.paidAmount || 0), status:item.status,
      fine_percent:Number(item.finePercent || 0), interest_monthly_percent:Number(item.interestMonthlyPercent || 0), sync_conflict:flag(item.syncConflict)
    });
    for (const payment of list(item.payments)) dataset.billing_payments.push({
      ...mutable(payment, installationId, deviceId, payment.paidAt ?? fallback), installment_id:item.id, amount:Number(payment.amount || 0),
      method:String(payment.method ?? ''), paid_at:payment.paidAt ?? fallback
    });
    for (const conflict of list(item.paymentConflicts)) dataset.billing_payment_conflicts.push({
      ...mutable(conflict, installationId, deviceId, conflict.detectedAt ?? fallback), installment_id:item.id,
      payment_id:conflict.payment?.id ?? conflict.paymentId ?? null, reason:String(conflict.reason ?? 'unknown'),
      payment_json:json(conflict.payment ?? null), detected_at:conflict.detectedAt ?? fallback
    });
  }

  for (const item of list(snapshot.collectionActions)) dataset.collection_actions.push({
    ...mutable(item, installationId, deviceId, fallback), installment_id:item.installmentId, rental_id:item.rentalId, customer_id:item.customerId,
    channel:String(item.channel ?? ''), note:String(item.note ?? ''), promise_at:item.promiseAt ?? null, next_action_at:item.nextActionAt ?? null, actor_id:item.actorId ?? null
  });

  for (const item of list(snapshot.audit)) dataset.audit_log.push({
    ...mutable(item, installationId, deviceId, item.at ?? fallback), actor_id:item.actorId ?? null, action:String(item.action ?? ''),
    entity_type:String(item.entityType ?? ''), entity_id:item.entityId ?? null, details_json:json(item.details ?? {}), at:item.at ?? fallback
  });

  dataset.alert_state.push({
    id:'ALERT-STATE', installation_id:installationId, state_json:json(snapshot.alertState ?? {}), created_at:fallback, updated_at:fallback,
    version:1, updated_by_device:deviceId, deleted_at:null
  });
  dataset.app_settings.push({ installation_id:installationId, settings_json:json(settings), updated_at:fallback, version:1, updated_by_device:deviceId });

  return dataset;
}
