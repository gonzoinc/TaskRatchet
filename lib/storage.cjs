'use strict';
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./engine.cjs');
function area(cwd = process.cwd()) { return path.resolve(cwd, '.codex', 'taskratchet'); }
function threadFile(root, thread) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(thread || '')) throw new Error('Invalid thread ID');
  return path.join(root, 'threads', `${thread}.json`);
}
function read(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(fallback); }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function change(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`, handle = fs.openSync(lock, 'wx');
  try { const value = fn(read(file, engine.initial())); if (value !== undefined) write(file, value); return value; }
  finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}
function config(root) { return engine.settings(read(path.join(root, 'settings.json'), {})); }
function snapshot(file) {
  if (!file || !path.isAbsolute(file)) throw new Error('Hook did not supply an absolute transcript path');
  let latest = null;
  const contexts = [], completed = new Set(), aborted = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let item; try { item = JSON.parse(line); } catch { continue; }
    if (item.type === 'turn_context') {
      latest = { turnId: item.payload.turn_id, model: item.payload.model, effort: item.payload.effort };
      contexts.push(latest);
    }
    if (item.type === 'event_msg' && item.payload.type === 'task_complete') completed.add(item.payload.turn_id);
    if (item.type === 'event_msg' && item.payload.type === 'turn_aborted') aborted.add(item.payload.turn_id);
  }
  if (!latest) throw new Error('Unsupported transcript: no Codex turn context; keep current effort');
  return { latest, contexts, completed, aborted };
}
module.exports = { area, threadFile, read, write, change, config, snapshot };
