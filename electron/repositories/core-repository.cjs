function assertIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(value))) throw new Error(`Identificador SQL inválido: ${value}`);
  return String(value);
}

function insertRows(db, table, rows=[]) {
  assertIdentifier(table);
  for (const row of rows || []) {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined);
    if (!entries.length) continue;
    const columns = entries.map(([key]) => assertIdentifier(key));
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
    db.prepare(sql).run(...entries.map(([, value]) => value));
  }
}

function selectRows(db, table) {
  assertIdentifier(table);
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function clearTables(db, tables=[]) {
  for (const table of tables) {
    assertIdentifier(table);
    db.exec(`DELETE FROM ${table};`);
  }
}

const INSERT_ORDER = ['installations','devices','users','customers','vehicles','rentals'];
const CLEAR_ORDER = ['rentals','vehicles','customers','users','devices','installations'];

function createCoreRepository(db) {
  return Object.freeze({
    clear(){ clearTables(db, CLEAR_ORDER); },
    replace(dataset){ for (const table of INSERT_ORDER) insertRows(db, table, dataset?.[table] ?? []); },
    load(target={}){ for (const table of INSERT_ORDER) target[table] = selectRows(db, table); return target; }
  });
}

module.exports = { createCoreRepository, insertRows, selectRows, clearTables };
