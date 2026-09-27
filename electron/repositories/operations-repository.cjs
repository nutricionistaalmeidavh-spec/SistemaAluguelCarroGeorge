const { insertRows, selectRows, clearTables } = require('./core-repository.cjs');

const INSERT_ORDER = ['inspections','inspection_items','maintenance','audit_log','alert_state','app_settings'];
const CLEAR_ORDER = ['inspection_items','inspections','maintenance','audit_log','alert_state','app_settings'];

function createOperationsRepository(db) {
  return Object.freeze({
    clear(){ clearTables(db, CLEAR_ORDER); },
    replace(dataset){ for (const table of INSERT_ORDER) insertRows(db, table, dataset?.[table] ?? []); },
    load(target={}){ for (const table of INSERT_ORDER) target[table] = selectRows(db, table); return target; }
  });
}

module.exports = { createOperationsRepository };
