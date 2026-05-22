import { DatabaseSync } from 'node:sqlite';

export default class Database {
  constructor(filename, options = {}) {
    this._db = new DatabaseSync(filename, {
      readOnly: options.readonly === true || options.readOnly === true,
    });
  }

  prepare(sql) {
    return this._db.prepare(sql);
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  pragma(source) {
    const sql = /^\s*pragma\b/i.test(source) ? source : `PRAGMA ${source}`;
    return this._db.prepare(sql).all();
  }

  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (err) {
        try { this.exec('ROLLBACK'); } catch { /* noop */ }
        throw err;
      }
    };
  }

  close() {
    return this._db.close();
  }
}