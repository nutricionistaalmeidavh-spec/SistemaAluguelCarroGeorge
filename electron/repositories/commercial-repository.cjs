const { insertRows, selectRows, clearTables } = require('./core-repository.cjs');

const INSERT_ORDER = [
  'rental_payments','expenses','ledger','contract_templates','issued_contracts',
  'billing_plans','billing_installments','billing_payments','billing_payment_conflicts','collection_actions'
];
const CLEAR_ORDER = [
  'collection_actions','billing_payment_conflicts','billing_payments','billing_installments','billing_plans',
  'issued_contracts','contract_templates','ledger','rental_payments','expenses'
];

function createCommercialRepository(db) {
  return Object.freeze({
    clear(){ clearTables(db, CLEAR_ORDER); },
    replace(dataset){ for (const table of INSERT_ORDER) insertRows(db, table, dataset?.[table] ?? []); },
    load(target={}){ for (const table of INSERT_ORDER) target[table] = selectRows(db, table); return target; }
  });
}

module.exports = { createCommercialRepository };
