const PERMISSIONS=Object.freeze({
  admin:Object.freeze(['*']),
  atendente:Object.freeze(['rental.read','rental.write','customer.read','customer.write','vehicle.read','vehicle.write','finance.read','finance.write','billing.read','billing.write','contracts.read','contracts.write','backup.create','inspection.read','maintenance.read','alerts.read','alerts.write','reports.read','documents.read','sync.read','sync.write']),
  vistoriador:Object.freeze(['rental.read','vehicle.read','inspection.read','inspection.write','maintenance.read','alerts.read','documents.read','contracts.read','sync.read','sync.write'])
});

export function canCloud(user,permission){
  if(!user||user.active===false||user.active===0)return false;
  const list=PERMISSIONS[user.role]??[];return list.includes('*')||list.includes(permission);
}
