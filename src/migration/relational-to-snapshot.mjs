const list = value => Array.isArray(value) ? value : [];
const boolean = value => Boolean(Number(value));
function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function group(rows, key) {
  const map = new Map();
  for (const row of list(rows)) {
    const value = row?.[key];
    if (value == null) continue;
    const values = map.get(String(value)) ?? [];
    values.push(row);
    map.set(String(value), values);
  }
  return map;
}
function syncFields(row) {
  const patch = {};
  if (Number(row?.version || 1) > 1) patch.syncVersion = Number(row.version);
  if (row?.updated_by_device) patch.updatedByDevice = row.updated_by_device;
  if (row?.deleted_at) patch.deletedAt = row.deleted_at;
  return patch;
}

export function relationalToSnapshot(dataset) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) throw new TypeError('dataset é obrigatório.');
  const meta = dataset.meta ?? {};
  const settingsRow = list(dataset.app_settings)[0];
  const alertRow = list(dataset.alert_state)[0];
  const rentalPayments = group(dataset.rental_payments, 'rental_id');
  const inspectionItems = group(dataset.inspection_items, 'inspection_id');
  const legacyInspectionPhotos = group(dataset.legacy_inspection_photos, 'inspection_id');
  const attachmentPhotos = group(list(dataset.attachments).filter(row => row.entity_type === 'inspection' && row.status !== 'deleted'), 'entity_id');
  const billingPayments = group(dataset.billing_payments, 'installment_id');
  const billingConflicts = group(dataset.billing_payment_conflicts, 'installment_id');

  const snapshot = {
    version:Number(meta.snapshot_version || 4),
    updatedAt:meta.updated_at ?? new Date(0).toISOString(),
    customers:[], vehicles:[], rentals:[], expenses:[], users:[], ledger:[], audit:[], inspections:[], maintenance:[],
    contractTemplates:[], issuedContracts:[], billingPlans:[], billingInstallments:[], collectionActions:[],
    alertState:parseJson(alertRow?.state_json, {}),
    settings:parseJson(settingsRow?.settings_json, {})
  };
  const restorePoint = parseJson(meta.restore_point_json, null);
  if (restorePoint) snapshot.restorePoint = restorePoint;

  snapshot.users = list(dataset.users).map(row => ({
    id:row.id, username:row.username, name:row.name, role:row.role, active:boolean(row.active),
    ...(row.password_hash ? { passwordHash:row.password_hash } : {}), ...syncFields(row)
  }));

  snapshot.customers = list(dataset.customers).map(row => ({
    id:row.id, name:row.name, document:row.document ?? '', phone:row.phone ?? '', email:row.email ?? '', address:row.address ?? '',
    active:boolean(row.active), createdAt:row.created_at, updatedAt:row.updated_at,
    ...(row.driver_license_json ? { driverLicense:parseJson(row.driver_license_json, {}) } : {}), ...syncFields(row)
  }));

  snapshot.vehicles = list(dataset.vehicles).map(row => ({
    id:row.id, model:row.model, plate:row.plate, year:row.year ?? '', mileage:Number(row.mileage || 0), category:row.category ?? '', color:row.color ?? '',
    dailyRate:Number(row.daily_rate || 0), purchasePrice:Number(row.purchase_price || 0), availability:row.availability ?? 'disponivel',
    createdAt:row.created_at, updatedAt:row.updated_at,
    ...(row.documents_json ? { documents:parseJson(row.documents_json, {}) } : {}), ...syncFields(row)
  }));

  snapshot.rentals = list(dataset.rentals).map(row => ({
    id:row.id, vehicleId:row.vehicle_id, customerId:row.customer_id, attendantId:row.attendant_id ?? null,
    pickupAt:row.pickup_at, returnAt:row.return_at ?? null, periodMode:row.period_mode ?? 'fixed', continuousClosedAt:row.continuous_closed_at ?? null,
    status:row.status, priority:row.priority ?? 'Media', notes:row.notes ?? '', dailyRate:Number(row.daily_rate || 0), days:Number(row.days || 1),
    total:Number(row.total || 0), billingMode:row.billing_mode ?? 'total', paymentStatus:row.payment_status ?? 'aberto',
    payments:(rentalPayments.get(String(row.id)) ?? []).sort((a,b) => String(a.paid_at).localeCompare(String(b.paid_at))).map(payment => ({
      id:payment.id, amount:Number(payment.amount || 0), method:payment.method, paidAt:payment.paid_at,
      ...(payment.installment_id ? { installmentId:payment.installment_id } : {}), ...syncFields(payment)
    })),
    createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.expenses = list(dataset.expenses).map(row => ({
    id:row.id, description:row.description, category:row.category ?? '', amount:Number(row.amount || 0), dueAt:row.due_at ?? '', paid:boolean(row.paid),
    vehicleId:row.vehicle_id ?? null, createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.ledger = list(dataset.ledger).map(row => ({
    id:row.id, kind:row.kind,
    ...(row.billing_purpose ? { billingPurpose:row.billing_purpose } : {}),
    ...(row.rental_id ? { rentalId:row.rental_id } : {}),
    ...(row.expense_id ? { expenseId:row.expense_id } : {}),
    ...(row.installment_id ? { installmentId:row.installment_id } : {}),
    ...(row.vehicle_id ? { vehicleId:row.vehicle_id } : {}),
    description:row.description, amount:Number(row.amount || 0), paidAmount:Number(row.paid_amount || 0), status:row.status,
    dueAt:row.due_at ?? null, createdAt:row.created_at,
    ...(row.paid_at ? { paidAt:row.paid_at } : {}), ...syncFields(row)
  }));

  snapshot.inspections = list(dataset.inspections).map(row => {
    const legacy=(legacyInspectionPhotos.get(String(row.id)) ?? []).map(photo => ({
      id:photo.id, name:photo.name ?? 'foto.jpg', type:photo.mime_type ?? 'image/jpeg', dataUrl:photo.data_url, createdAt:photo.created_at
    }));
    const attachments=(attachmentPhotos.get(String(row.id)) ?? []).map(photo => ({
      id:photo.id, attachmentId:photo.id, name:'foto.jpg', mimeType:photo.mime_type ?? 'image/jpeg', sizeBytes:Number(photo.size_bytes||0),
      sha256:photo.sha256, createdAt:photo.created_at
    }));
    return {
      id:row.id, rentalId:row.rental_id, vehicleId:row.vehicle_id, kind:row.kind, status:row.status,
      mileage:row.mileage == null ? null : Number(row.mileage), fuelLevel:row.fuel_level ?? '', notes:row.notes ?? '',
      damages:parseJson(row.damages_json, []), completedAt:row.completed_at ?? null, createdAt:row.created_at,
      checklist:(inspectionItems.get(String(row.id)) ?? []).map(item => ({ id:item.item_key, label:item.label, done:boolean(item.done), evidence:item.evidence ?? null })),
      photos:[...attachments,...legacy],
      ...syncFields(row)
    };
  });

  snapshot.maintenance = list(dataset.maintenance).map(row => ({
    id:row.id, vehicleId:row.vehicle_id, type:row.type, dueAt:row.due_at ?? '', dueMileage:row.due_mileage == null ? null : Number(row.due_mileage),
    notes:row.notes ?? '', costEstimate:Number(row.cost_estimate || 0), status:row.status, startedAt:row.started_at ?? null,
    completedAt:row.completed_at ?? null, cost:Number(row.cost || 0), createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.contractTemplates = list(dataset.contract_templates).map(row => ({
    id:row.id, name:row.name, body:row.body, active:boolean(row.active), isDefault:boolean(row.is_default), version:Number(row.template_version || 1),
    createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.issuedContracts = list(dataset.issued_contracts).map(row => ({
    id:row.id, rentalId:row.rental_id, templateId:row.template_id ?? null, templateName:row.template_name,
    templateVersion:Number(row.template_version || 1), renderedText:row.rendered_text, createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.billingPlans = list(dataset.billing_plans).map(row => ({
    id:row.id, rentalId:row.rental_id, customerId:row.customer_id, vehicleId:row.vehicle_id, purpose:row.purpose, frequency:row.frequency,
    customDays:row.custom_days == null ? null : Number(row.custom_days), amount:Number(row.amount || 0), occurrences:Number(row.occurrences || 0),
    firstDueAt:row.first_due_at, finePercent:Number(row.fine_percent || 0), interestMonthlyPercent:Number(row.interest_monthly_percent || 0),
    active:boolean(row.active), createdAt:row.created_at, updatedAt:row.updated_at,
    ...(row.generation_mode ? { generationMode:row.generation_mode } : {}),
    ...(row.generation_closed_at ? { generationClosedAt:row.generation_closed_at } : {}), ...syncFields(row)
  }));

  snapshot.billingInstallments = list(dataset.billing_installments).map(row => ({
    id:row.id, planId:row.plan_id, rentalId:row.rental_id, customerId:row.customer_id, vehicleId:row.vehicle_id,
    sequence:Number(row.sequence || 0), dueAt:row.due_at, amount:Number(row.amount || 0), paidAmount:Number(row.paid_amount || 0), status:row.status,
    finePercent:Number(row.fine_percent || 0), interestMonthlyPercent:Number(row.interest_monthly_percent || 0),
    payments:(billingPayments.get(String(row.id)) ?? []).sort((a,b) => String(a.paid_at).localeCompare(String(b.paid_at))).map(payment => ({
      id:payment.id, amount:Number(payment.amount || 0), method:payment.method, paidAt:payment.paid_at, ...syncFields(payment)
    })),
    paymentConflicts:(billingConflicts.get(String(row.id)) ?? []).map(conflict => ({
      id:conflict.id, reason:conflict.reason, payment:parseJson(conflict.payment_json, null), detectedAt:conflict.detected_at,
      ...(conflict.payment_id ? { paymentId:conflict.payment_id } : {}), ...syncFields(conflict)
    })),
    syncConflict:boolean(row.sync_conflict), createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.collectionActions = list(dataset.collection_actions).map(row => ({
    id:row.id, installmentId:row.installment_id, rentalId:row.rental_id, customerId:row.customer_id, channel:row.channel, note:row.note,
    promiseAt:row.promise_at ?? null, nextActionAt:row.next_action_at ?? null, actorId:row.actor_id ?? null,
    createdAt:row.created_at, updatedAt:row.updated_at, ...syncFields(row)
  }));

  snapshot.audit = list(dataset.audit_log).map(row => ({
    id:row.id, at:row.at, actorId:row.actor_id ?? null, action:row.action, entityType:row.entity_type, entityId:row.entity_id ?? null,
    details:parseJson(row.details_json, {}), ...syncFields(row)
  }));

  return snapshot;
}
