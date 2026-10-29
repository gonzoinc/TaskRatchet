'use strict';
const { VERSION } = require('./ipc.cjs');
function validateHost({ platform, trusted, version, active }) {
  if (platform !== 'win32') throw new Error('Prototype supports Windows-local extension hosts only');
  if (!trusted) throw new Error('Trust this disposable workspace before using TaskRatchet');
  if (version !== VERSION) throw new Error(`Requires Codex ${VERSION}; unsupported version, stopped`);
  if (!active) throw new Error('Open the existing Codex chat first');
}
module.exports = { validateHost };
