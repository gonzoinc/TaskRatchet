'use strict';
const net = require('node:net');
const { randomUUID } = require('node:crypto');
// The exported app-tools connection was tested on Windows desktop 26.1023.6621.0.
// No default daemon socket, privileged internal IPC, new client, or fallback API.
function send({ threadId, turnId, effort, prompt }) {
  const endpoint = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  if (process.platform !== 'win32' || !endpoint) throw new Error('Requires the local Windows desktop app-tools connection');
  if (threadId !== process.env.CODEX_THREAD_ID) throw new Error('Only the calling chat can be changed');
  return new Promise((resolve, reject) => {
    const id = randomUUID(), socket = net.createConnection(endpoint);
    let buffer = Buffer.alloc(0), done = false;
    const end = (err, result) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); err ? reject(err) : resolve(result); };
    const timer = setTimeout(() => end(new Error('Send outcome unknown; do not retry automatically')), 30000);
    socket.once('connect', () => {
      const body = Buffer.from(JSON.stringify({ id, jsonrpc: '2.0', method: 'tools/call', params: {
        namespace: 'codex_app', tool: 'send_message_to_thread', callerSource: 'codex', hostId: 'local',
        threadId, turnId, callId: `taskratchet-${id}`,
        arguments: { threadId, hostId: 'local', thinking: effort, prompt },
      } }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
    });
    socket.on('error', err => end(err));
    socket.on('close', () => { if (!done) end(new Error('Connection closed; send outcome unknown')); });
    socket.on('data', bytes => {
      try {
        buffer = Buffer.concat([buffer, bytes]);
        while (buffer.length >= 4) {
          const size = buffer.readUInt32LE(0);
          if (!size || size > 16 * 1024 * 1024) throw new Error('Invalid app frame');
          if (buffer.length < size + 4) return;
          const response = JSON.parse(buffer.subarray(4, size + 4).toString()); buffer = buffer.subarray(size + 4);
          if (response.id !== id) continue;
          if (response.error || response.result?.success !== true) return end(new Error('App rejected the effort continuation'));
          end(null, { accepted: true });
        }
      } catch (err) { end(err); }
    });
  });
}
module.exports = { send };
