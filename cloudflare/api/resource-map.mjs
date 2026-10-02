const commonRead=['id','created_at AS createdAt','updated_at AS updatedAt','version','updated_by_device AS updatedByDevice'];
const readOnly=(table,readPermission,read)=>({table,readPermission,writePermission:null,read:[...commonRead,...read],writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']});

const definitions={
  customers:{table:'customers',readPermission:'customer.read',writePermission:'customer.write',read:[...commonRead,'name','document','phone','email','address','driver_license_json AS driverLicenseJson','active'],writable:{name:'name',document:'document',phone:'phone',email:'email',address:'address',driverLicenseJson:'driver_license_json',active:'active'},required:['name'],collectionMethods:['GET','POST'],itemMethods:['GET','PATCH','DELETE']},
  vehicles:{table:'vehicles',readPermission:'vehicle.read',writePermission:'vehicle.write',read:[...commonRead,'model','plate','year','mileage','category','color','daily_rate AS dailyRate','purchase_price AS purchasePrice','availability','documents_json AS documentsJson'],writable:{model:'model',plate:'plate',year:'year',mileage:'mileage',category:'category',color:'color',dailyRate:'daily_rate',purchasePrice:'purchase_price',availability:'availability',documentsJson:'documents_json'},required:['model','plate'],collectionMethods:['GET','POST'],itemMethods:['GET','PATCH','DELETE']},
  rentals:readOnly('rentals','rental.read',['vehicle_id AS vehicleId','customer_id AS customerId','attendant_id AS attendantId','pickup_at AS pickupAt','return_at AS returnAt','period_mode AS periodMode','continuous_closed_at AS continuousClosedAt','status','priority','notes','daily_rate AS dailyRate','days','total','billing_mode AS billingMode','payment_status AS paymentStatus']),
  rentalPayments:readOnly('rental_payments','finance.read',['rental_id AS rentalId','installment_id AS installmentId','amount','method','paid_at AS paidAt']),
  expenses:readOnly('expenses','finance.read',['vehicle_id AS vehicleId','description','category','amount','due_at AS dueAt','paid']),
  ledger:readOnly('ledger','finance.read',['kind','billing_purpose AS billingPurpose','rental_id AS rentalId','expense_id AS expenseId','installment_id AS installmentId','vehicle_id AS vehicleId','description','amount','paid_amount AS paidAmount','status','due_at AS dueAt','paid_at AS paidAt']),
  inspections:readOnly('inspections','inspection.read',['rental_id AS rentalId','vehicle_id AS vehicleId','kind','status','mileage','fuel_level AS fuelLevel','notes','damages_json AS damagesJson','completed_at AS completedAt']),
  inspectionItems:readOnly('inspection_items','inspection.read',['inspection_id AS inspectionId','item_key AS itemKey','label','done','evidence']),
  maintenance:readOnly('maintenance','maintenance.read',['vehicle_id AS vehicleId','type','due_at AS dueAt','due_mileage AS dueMileage','notes','cost_estimate AS costEstimate','status','started_at AS startedAt','completed_at AS completedAt','cost']),
  billingPlans:readOnly('billing_plans','billing.read',['rental_id AS rentalId','customer_id AS customerId','vehicle_id AS vehicleId','purpose','frequency','custom_days AS customDays','amount','occurrences','first_due_at AS firstDueAt','fine_percent AS finePercent','interest_monthly_percent AS interestMonthlyPercent','active','generation_mode AS generationMode','generation_closed_at AS generationClosedAt']),
  billingInstallments:readOnly('billing_installments','billing.read',['plan_id AS planId','rental_id AS rentalId','customer_id AS customerId','vehicle_id AS vehicleId','sequence','due_at AS dueAt','amount','paid_amount AS paidAmount','status','fine_percent AS finePercent','interest_monthly_percent AS interestMonthlyPercent','sync_conflict AS syncConflict']),
  billingPayments:readOnly('billing_payments','billing.read',['installment_id AS installmentId','amount','method','paid_at AS paidAt']),
  collectionActions:readOnly('collection_actions','billing.read',['installment_id AS installmentId','rental_id AS rentalId','customer_id AS customerId','channel','note','promise_at AS promiseAt','next_action_at AS nextActionAt','actor_id AS actorId']),
  contractTemplates:readOnly('contract_templates','contracts.read',['name','body','active','is_default AS isDefault','template_version AS templateVersion']),
  issuedContracts:readOnly('issued_contracts','contracts.read',['rental_id AS rentalId','template_id AS templateId','template_name AS templateName','template_version AS templateVersion','rendered_text AS renderedText']),
  alertState:readOnly('alert_state','alerts.read',['state_json AS stateJson']),
  appSettings:{table:'app_settings',readPermission:'rental.read',writePermission:null,read:['installation_id AS id','settings_json AS settingsJson','updated_at AS updatedAt','version','updated_by_device AS updatedByDevice'],writable:{},required:[],collectionMethods:['GET'],itemMethods:[],softDelete:false,orderBy:'updated_at DESC',idColumn:'installation_id'},
  attachments:readOnly('attachments','documents.read',['entity_type AS entityType','entity_id AS entityId','mime_type AS mimeType','size_bytes AS sizeBytes','sha256','created_by AS createdBy','status'])
};

const queryMetadata={
  customers:{searchColumns:['name','document','phone','email'],orderBy:'updated_at DESC, id'},
  vehicles:{searchColumns:['model','plate','category','color'],filterColumns:{status:'availability'},orderBy:'updated_at DESC, id'},
  rentals:{searchColumns:['id','status','priority','notes'],filterColumns:{status:'status',customerId:'customer_id',vehicleId:'vehicle_id'},dateColumn:'pickup_at',orderBy:'pickup_at DESC, id DESC'},
  rentalPayments:{filterColumns:{rentalId:'rental_id',installmentId:'installment_id'},dateColumn:'paid_at',orderBy:'paid_at DESC, id DESC'},
  expenses:{searchColumns:['description','category'],filterColumns:{vehicleId:'vehicle_id',paid:'paid'},dateColumn:'due_at',orderBy:'COALESCE(due_at,updated_at) DESC, id DESC'},
  ledger:{searchColumns:['description','status','kind'],filterColumns:{status:'status',rentalId:'rental_id',vehicleId:'vehicle_id',kind:'kind'},dateColumn:'due_at',orderBy:'COALESCE(due_at,updated_at) DESC, id DESC'},
  inspections:{searchColumns:['id','kind','status','notes'],filterColumns:{status:'status',rentalId:'rental_id',vehicleId:'vehicle_id'},dateColumn:'COALESCE(completed_at,created_at)',orderBy:'COALESCE(completed_at,created_at) DESC, id DESC'},
  inspectionItems:{filterColumns:{inspectionId:'inspection_id'},orderBy:'created_at DESC, id DESC'},
  maintenance:{searchColumns:['type','status','notes'],filterColumns:{status:'status',vehicleId:'vehicle_id'},dateColumn:'COALESCE(due_at,created_at)',orderBy:'COALESCE(due_at,created_at) DESC, id DESC'},
  billingPlans:{filterColumns:{rentalId:'rental_id',customerId:'customer_id',vehicleId:'vehicle_id',active:'active'},dateColumn:'first_due_at',orderBy:'first_due_at DESC, id DESC'},
  billingInstallments:{searchColumns:['id','status'],filterColumns:{status:'status',rentalId:'rental_id',customerId:'customer_id',vehicleId:'vehicle_id',planId:'plan_id'},dateColumn:'due_at',orderBy:'due_at DESC, id DESC'},
  billingPayments:{filterColumns:{installmentId:'installment_id'},dateColumn:'paid_at',orderBy:'paid_at DESC, id DESC'},
  collectionActions:{filterColumns:{installmentId:'installment_id',rentalId:'rental_id',customerId:'customer_id'},dateColumn:'created_at',orderBy:'created_at DESC, id DESC'},
  contractTemplates:{searchColumns:['name'],filterColumns:{active:'active'},orderBy:'updated_at DESC, id DESC'},
  issuedContracts:{searchColumns:['template_name','rental_id'],filterColumns:{rentalId:'rental_id',templateId:'template_id'},dateColumn:'created_at',orderBy:'created_at DESC, id DESC'},
  attachments:{searchColumns:['id','entity_type','entity_id','mime_type','status'],filterColumns:{entityType:'entity_type',entityId:'entity_id',status:'status'},dateColumn:'created_at',orderBy:'created_at DESC, id DESC'}
};
for(const [name,meta] of Object.entries(queryMetadata))Object.assign(definitions[name],meta);

for(const definition of Object.values(definitions)){Object.freeze(definition.read);Object.freeze(definition.writable);Object.freeze(definition.required);Object.freeze(definition.collectionMethods);Object.freeze(definition.itemMethods);Object.freeze(definition);}
export const RESOURCE_MAP=Object.freeze(definitions);
export function getResourceDefinition(name){return RESOURCE_MAP[String(name||'')]??null;}
