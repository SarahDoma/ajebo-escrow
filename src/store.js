import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** Tiny in-memory store with optional atomic JSON persistence. Swap for SQLite later. */
export class Store {
  constructor(file) {
    this.file = file || null;
    this.map = new Map();
    if (this.file) {
      try {
        for (const e of JSON.parse(readFileSync(this.file, 'utf8'))) this.map.set(e.id, e);
      } catch { /* first run */ }
    }
  }
  get(id) { return this.map.get(id); }
  all() { return [...this.map.values()]; }
  put(e) {
    this.map.set(e.id, e);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.all()), { mode: 0o600 });
      renameSync(tmp, this.file);
    }
  }
}
