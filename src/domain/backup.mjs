function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2,'0')).join('');
}

async function checksum(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function createBackupEnvelope(snapshot) {
  const payload = JSON.stringify(snapshot);
  return JSON.stringify({ format:'artisys-locadora-backup', schemaVersion:2, createdAt:new Date().toISOString(), checksum:await checksum(payload), snapshot });
}

export async function restoreBackupEnvelope(raw) {
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (envelope?.format !== 'artisys-locadora-backup' || !envelope.snapshot) throw new Error('Backup inválido.');
  const actual = await checksum(JSON.stringify(envelope.snapshot));
  if (actual !== envelope.checksum) throw new Error('Falha de integridade do backup.');
  return envelope.snapshot;
}

export function isLegacyBackupPayload(raw) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return false; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.format === 'artisys-locadora-backup') return false;
  return Array.isArray(value.customers) || Array.isArray(value.vehicles) || Array.isArray(value.rentals) || Array.isArray(value.expenses);
}

// A restore starts a new data generation: stale devices must adopt it, not merge
// records intentionally removed by the restore back into the restored snapshot.
export function prepareSnapshotRestore(backup,current,{id=crypto.randomUUID(),at=new Date().toISOString()}={}) {
  const next=structuredClone(backup);
  const generation=Math.max(Number(current?.restorePoint?.generation)||0,Number(backup?.restorePoint?.generation)||0)+1;
  next.restorePoint={generation,id};
  next.updatedAt=at;
  return next;
}
