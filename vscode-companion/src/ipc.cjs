'use strict';
const { randomUUID } = require('node:crypto');
const MAX = 1024 * 1024;
const VERSION = '26.1021.22027';
const PIPE = '\\\\.\\pipe\\codex-ipc';
function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX) throw new Error('IPC frame too large');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
class Decoder {
  constructor(accept) { this.buffer = Buffer.alloc(0); this.accept = accept; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE();
      if (!size || size > MAX) throw new Error('Invalid IPC frame length');
      if (this.buffer.length < size + 4) return;
      const value = JSON.parse(this.buffer.subarray(4, size + 4).toString('utf8'));
      this.buffer = this.buffer.subarray(size + 4); this.accept(value);
    }
  }
}
class Client {
  constructor(socket, timeout = 5000) {
    this.socket = socket; this.timeout = timeout; this.pending = new Map(); this.clientId = 'initializing-client'; this.closed = false;
    const decoder = new Decoder(value => this.receive(value));
    socket.on('data', chunk => { try { decoder.push(chunk); } catch (e) { this.close(e); } });
    socket.on('error', e => this.close(e));
    socket.on('close', () => this.close(new Error('IPC connection closed; no retry')));
  }
  receive(message) {
    if (message.type === 'client-discovery-request') {
      this.socket.write(frame({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } })); return;
    }
    if (message.type !== 'response') return;
    const p = this.pending.get(message.requestId); if (!p) return;
    this.pending.delete(message.requestId); clearTimeout(p.timer);
    if (message.resultType !== 'success') { p.reject(new Error(`IPC rejected: ${JSON.stringify(message.error || 'unknown error')}`)); return; }
    if (message.method !== p.method) { p.reject(new Error('IPC response method mismatch')); return; }
    p.resolve({ result: message.result, owner: message.handledByClientId });
  }
  request(method, params, owner) {
    if (this.closed) return Promise.reject(new Error('IPC closed; reconnect only with a new explicit probe'));
    const base = { initialize: 0, 'thread-owner-discovery': 1, 'thread-follower-read-model-settings': 2, 'thread-follower-update-thread-settings': 3 };
    if (!(method in base)) return Promise.reject(new Error('Method not allowed'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('IPC timeout; outcome uncertain, no retry')); }, this.timeout);
      this.pending.set(requestId, { resolve, reject, timer, method });
      const msg = { type: 'request', requestId, sourceClientId: this.clientId, version: base[method], method, params, timeoutMs: this.timeout };
      if (method !== 'initialize') msg.hostId = 'local';
      if (owner) msg.targetClientId = owner;
      try { this.socket.write(frame(msg)); } catch (error) { this.close(error); }
    });
  }
  async initialize() {
    const { result } = await this.request('initialize', { clientType: 'taskratchet-vscode' });
    if (typeof result?.clientId !== 'string' || !result.clientId) throw new Error('Invalid initialization result');
    this.clientId = result.clientId;
  }
  close(error = new Error('IPC disposed')) {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.socket.destroy();
  }
}
class Adapter {
  constructor(client, chat) { this.client = client; this.chat = chat; this.owner = null; }
  async discover() {
    const reply = await this.client.request('thread-owner-discovery', { hostId: 'local', conversationId: this.chat });
    if (!reply.owner || reply.result?.supportsUntrustedAppInput !== true) throw new Error('No compatible chat owner; open selected chat in Codex first');
    this.owner = reply.owner; return this.read();
  }
  async read() {
    if (!this.owner) throw new Error('Read-only discovery required first');
    const { result } = await this.client.request('thread-follower-read-model-settings', { conversationId: this.chat }, this.owner);
    const s = result?.settings;
    if (!s?.model || !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(s.reasoningEffort)) throw new Error('Concrete model/effort unavailable');
    return { model: s.model, effort: s.reasoningEffort };
  }
  async update(expected, target) {
    const { result } = await this.client.request('thread-follower-update-thread-settings', {
      conversationId: this.chat, threadSettings: { effort: target },
      condition: { ifEffortEquals: expected.effort, ifModelEquals: expected.model }
    }, this.owner);
    if (result?.applied !== true) throw new Error('Conditional update rejected; no retry');
  }
}
module.exports = { VERSION, PIPE, MAX, frame, Decoder, Client, Adapter };
