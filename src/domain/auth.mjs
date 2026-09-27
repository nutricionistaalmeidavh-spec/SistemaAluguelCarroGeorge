const PERMISSIONS = {
  admin: ['*'],
  atendente: ['rental.read','rental.write','customer.read','customer.write','vehicle.read','vehicle.write','finance.read','finance.write','billing.read','billing.write','contracts.read','contracts.write','backup.create','inspection.read','maintenance.read','alerts.read','alerts.write','reports.read','documents.read','sync.read','sync.write'],
  vistoriador: ['rental.read','vehicle.read','inspection.read','inspection.write','maintenance.read','alerts.read','documents.read','contracts.read','sync.read','sync.write']
};

export function seedUsers() {
  return [
    { id:'USR-001', username:'admin', name:'Administrador', role:'admin', active:true, passwordHash:'03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4' },
    { id:'USR-002', username:'atendente', name:'Atendente', role:'atendente', active:true, passwordHash:'e94e143d3a999c2004bed70fdc93ae37470fb3c3c5cd328fa20fbd053e65c4f9' },
    { id:'USR-003', username:'vistoria', name:'Vistoriador', role:'vistoriador', active:true, passwordHash:'97f6af0cf0f6145713026cfe1c3eb59490e3bc3a1e7b48bea143c28b5c11b7b0' }
  ];
}

export function can(user, permission) { if (!user?.active) return false; const list = PERMISSIONS[user.role] ?? []; return list.includes('*') || list.includes(permission); }
export function requirePermission(user, permission) { if (!can(user, permission)) throw new Error(`Permissão negada: ${permission}`); }
async function sha256(text) { const data = new TextEncoder().encode(text); const digest = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,'0')).join(''); }
export async function authenticate(users, username, password) { const normalized = String(username ?? '').trim().toLowerCase(); const user = users.find((item) => item.active && item.username.toLowerCase() === normalized); if (!user) return null; return (await sha256(String(password ?? ''))) === user.passwordHash ? user : null; }
