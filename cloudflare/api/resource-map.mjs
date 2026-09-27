const commonRead=['id','created_at AS createdAt','updated_at AS updatedAt','version','updated_by_device AS updatedByDevice'];

const definitions={
  customers:{
    table:'customers',
    read:[...commonRead,'name','document','phone','email','address','driver_license_json AS driverLicenseJson','active'],
    writable:{name:'name',document:'document',phone:'phone',email:'email',address:'address',driverLicenseJson:'driver_license_json',active:'active'},
    required:['name'],
    collectionMethods:['GET','POST'],itemMethods:['GET','PATCH','DELETE']
  },
  vehicles:{
    table:'vehicles',
    read:[...commonRead,'model','plate','year','mileage','category','color','daily_rate AS dailyRate','purchase_price AS purchasePrice','availability','documents_json AS documentsJson'],
    writable:{model:'model',plate:'plate',year:'year',mileage:'mileage',category:'category',color:'color',dailyRate:'daily_rate',purchasePrice:'purchase_price',availability:'availability',documentsJson:'documents_json'},
    required:['model','plate'],
    collectionMethods:['GET','POST'],itemMethods:['GET','PATCH','DELETE']
  },
  rentals:{
    table:'rentals',
    read:[...commonRead,'vehicle_id AS vehicleId','customer_id AS customerId','attendant_id AS attendantId','pickup_at AS pickupAt','return_at AS returnAt','period_mode AS periodMode','continuous_closed_at AS continuousClosedAt','status','priority','notes','daily_rate AS dailyRate','days','total','billing_mode AS billingMode','payment_status AS paymentStatus'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  expenses:{
    table:'expenses',
    read:[...commonRead,'vehicle_id AS vehicleId','description','category','amount','due_at AS dueAt','paid'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  inspections:{
    table:'inspections',
    read:[...commonRead,'rental_id AS rentalId','vehicle_id AS vehicleId','kind','status','mileage','fuel_level AS fuelLevel','notes','damages_json AS damagesJson','completed_at AS completedAt'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  },
  maintenance:{
    table:'maintenance',
    read:[...commonRead,'vehicle_id AS vehicleId','type','due_at AS dueAt','due_mileage AS dueMileage','notes','cost_estimate AS costEstimate','status','started_at AS startedAt','completed_at AS completedAt','cost'],
    writable:{},required:[],collectionMethods:['GET'],itemMethods:['GET']
  }
};

for(const definition of Object.values(definitions)){
  Object.freeze(definition.read);Object.freeze(definition.writable);Object.freeze(definition.required);
  Object.freeze(definition.collectionMethods);Object.freeze(definition.itemMethods);Object.freeze(definition);
}
export const RESOURCE_MAP=Object.freeze(definitions);
export function getResourceDefinition(name){return RESOURCE_MAP[String(name||'')]??null;}
