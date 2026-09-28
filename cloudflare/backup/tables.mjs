export const BACKUP_TABLES=Object.freeze(['users','customers','vehicles','rentals','rental_payments','expenses','inspections','inspection_items','maintenance','audit_log','alert_state','app_settings','ledger','contract_templates','issued_contracts','billing_plans','billing_installments','billing_payments','billing_payment_conflicts','collection_actions','attachments','operation_receipts']);
export const RESTORE_INSERT_ORDER=BACKUP_TABLES;
export const RESTORE_DELETE_ORDER=Object.freeze([...BACKUP_TABLES].reverse());
export function safeBackupTable(name){const table=String(name||'');return BACKUP_TABLES.includes(table)?table:null;}
