// Tiny durable JSON store: atomic writes (temp file + rename), debounced saves, and a
// synchronous flush for shutdown so nothing is lost on restarts or redeploys.
'use strict';

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} file   where to keep the data
   * @param {() => any} snapshot  returns the data to persist
   */
  constructor(file, snapshot) {
    this.file = file;
    this.snapshot = snapshot;
    this.timer = null;
    this.dirty = false;
  }

  load(fallback) {
    for (const f of [this.file, this.file + '.bak']) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try the backup copy */ }
    }
    return fallback;
  }

  /** Save soon (coalesces bursts of changes into one write). */
  save(delay = 150) {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, delay);
  }

  /** Write now, atomically. Keeps the previous good file as .bak. */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.snapshot()));
      try { fs.copyFileSync(this.file, this.file + '.bak'); } catch { /* first save */ }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.dirty = true;
      console.warn(`Could not save ${path.basename(this.file)}:`, e.message);
    }
  }
}

module.exports = { JsonStore };
