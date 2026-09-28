const commonRead=['id','created_at AS createdAt','updated_at AS updatedAt','version','updated_by_device AS updatedByDevice'];

const definitions={
  customers:{
    table:'customers',readPermission:'customer.read',writePermission:'customer.write',
    read:[...commonRead,'name','document','phone','email','address','driver_license_json AS driverLicenseJson','active'],
    writable:{name:'name',document:'document',phone:'phone',email:'email',address:'address',driverLicenseJson:'driver_license_json',active:'active'},
    required:['name'],collectionMethods:['GET','POST'],itemMethods:['GET','PATCH','DELETE']
  },
  vehicles:{
    table:'vehicles',readPermission:'vehicle.read',writePermission:'vehicle.write',
    read:[...commonRead,'model','plate','year','mileage','category','color','daily_rate AS dailyRate','purchase_price AS purchasePrice','availability','documents_json AS documentsJson'],
    writable:{model:'model',plate:'plate',year:'year',mileage:'mileage',category:'category',color:'color',dailyRate:'daily_rate',purchasePrice:'purchase_price',availability:'availability',documentsJson:'documents_json'},
    required:['model','plate'],collectionMethods:['GET','POST'],itemMethods:['GET','PATCH','DELETE']
  },
  rentals:{
    table:'rentals',readPermission:'rental.read',writePermission:'rental.write',
    read:[...commonRead,'vehicle_id AS vehicleId','customer_id AS customerId','attendant_id AS attendantId','pickup_at AS pickupAt','return_at AS returnAt','period_mode AS periodMode','continuous_closed_at AS continuousClosedAt','status','priority','notes','daily_rate AS dailyRate','days','total','billing_mode AS billingMode','payment_status AS paymentStatus'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  expenses:{
    table:'expenses',readPermission:'finance.read',writePermission:'finance.write',
    read:[...commonRead,'vehicle_id AS vehicleId','description','category','amount','due_at AS dueAt','paid'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  inspections:{
    table:'inspections',readPermission:'inspection.read',writePermission:'inspection.write',
    read:[...commonRead,'rental_id AS rentalId','vehicle_id AS vehicleId','kind','status','mileage','fuel_level AS fuelLevel','notes','damages_json AS damagesJson','completed_at AS completedAt'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  maintenance:{
    table:'maintenance',readPermission:'maintenance.read',writePermission:'maintenance.write',
    read:[...commonRead,'vehicle_id AS vehicleId','type','due_at AS dueAt','due_mileage AS dueMileage','notes','cost_estimate AS costEstimate','status','started_at AS startedAt','completed_at AS completedAt','cost'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  billingInstallments:{
    table:'billing_installments',readPermission:'billing.read',writePermission:'billing.write',
    read:[...commonRead,'plan_id AS planId','rental_id AS rentalId','customer_id AS customerId','vehicle_id AS vehicleId','sequence','due_at AS dueAt','amount','paid_amount AS paidAmount','status','fine_percent AS finePercent','interest_monthly_percent AS interestMonthlyPercent','sync_conflict AS syncConflict'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  }
};

for(const definition of Object.values(definitions)){
  Object.freeze(definition.read);Object.freeze(definition.writable);Object.freeze(definition.required);
  Object.freeze(definition.collectionMethods);Object.freeze(definition.itemMethods);Object.freeze(definition);
}
export const RESOURCE_MAP=Object.freeze(definitions);
export function getResourceDefinition(name){return RESOURCE_MAP[String(name||'')]??null;}
