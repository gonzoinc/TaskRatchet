'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { store } = require('./policy.cjs');
const names = root => ({ binding: path.join(root, 'vscode-binding.json'), request: path.join(root, 'vscode-request.json'), response: path.join(root, 'vscode-response.json') });
function bind(root, chat) {
  const binding = { version: 1, chat, nonce: randomUUID(), nextSequence: 1 };
  store.write(names(root).binding, binding); return binding;
}
function enqueue(root, args) {
  if (!args || !['begin', 'related', 'complete'].includes(args.op)) throw new Error('Bridge cannot approve or change settings');
  const p = names(root), binding = store.read(p.binding, null);
  if (!binding) throw new Error('Run TaskRatchet: Probe disposable chat in VS Code first');
  const value = { ...args, chat: binding.chat, nonce: binding.nonce, sequence: binding.nextSequence };
  fs.mkdirSync(root, { recursive: true });
  // A single outstanding mailbox prevents lost requests. Never overwrite it.
  fs.writeFileSync(p.request, JSON.stringify(value), { flag: 'wx' });
  return { sequence: value.sequence, chat: value.chat, response: p.response };
}
async function consume(root, binding, controller) {
  const p = names(root);
  if (!fs.existsSync(p.request)) return null;
  const stat = fs.statSync(p.request);
  if (stat.size > 8192) throw new Error('Bridge request exceeds limit; stopped');
  const req = JSON.parse(fs.readFileSync(p.request, 'utf8'));
  if (req.nonce !== binding.nonce || req.chat !== binding.chat || req.sequence !== binding.nextSequence || !['begin', 'related', 'complete'].includes(req.op)) throw new Error('Stale or invalid request; stopped, probe again');
  // Consume the sequence durably before any possible mutation. Crashes never replay sends.
  binding.nextSequence++; store.write(p.binding, binding); fs.unlinkSync(p.request);
  let response;
  try { const result = await controller.submit(req); response = { sequence: req.sequence, outcome: result.outcome, target: result.target }; }
  catch (error) { response = { sequence: req.sequence, error: error.message }; }
  store.write(p.response, response); return response;
}
module.exports = { bind, enqueue, consume, names };
