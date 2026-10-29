'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { frame, Decoder, Client, Adapter, VERSION, PIPE } = require('../src/ipc.cjs');
const { Controller, snapshot } = require('../src/controller.cjs');
const { engine, store } = require('../src/policy.cjs');
const bridge = require('../src/bridge.cjs');
const scratch = path.resolve(__dirname, '../../.codex/vscode-integration/fixtures');
fs.mkdirSync(scratch, { recursive: true });
function fixture(t, patch = {}) {
  const dir = fs.mkdtempSync(path.join(scratch, 'case-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let live = { model: 'test-model', effort: 'high', turnId: 't1' };
  let snap = { latest: live, contexts: [live], completed: new Set(['t1']), aborted: new Set() };
  const calls = [], cfg = engine.settings(patch);
  const adapter = { async read() { return { model: live.model, effort: live.effort }; }, async update(expected, target) { calls.push({ expected, target }); live = { ...live, effort: target }; } };
  const controller = new Controller({ file: path.join(dir, 'threads/chat.json'), transcript: path.join(dir, 'rollout.jsonl'), chat: 'chat', adapter, config: () => structuredClone(cfg), snapshot: () => snap });
  return { dir, controller, adapter, calls, cfg, setLive(value) { live = { ...live, ...value }; }, next(effort, id = 't2', complete = true) { live = { ...live, effort, turnId: id }; snap = { ...snap, latest: live, contexts: [...snap.contexts, live], completed: new Set([...snap.completed, ...(complete ? [id] : [])]) }; }, snap: () => snap };
}
const begin = (extra = {}) => ({ op: 'begin', objective: 'One bounded outcome', level: 'medium', reason: 'Full task assessment', ...extra });
test('host guard pins exact version and refuses unsupported context before connection', () => {
  const { validateHost } = require('../src/guard.cjs'), ok = { platform: 'win32', trusted: true, version: VERSION, active: true };
  assert.doesNotThrow(() => validateHost(ok));
  for (const patch of [{ platform: 'linux' }, { trusted: false }, { version: '26.1022.1' }, { active: false }]) assert.throws(() => validateHost({ ...ok, ...patch }));
});
test('little-endian codec tolerates split/coalesced UTF8 frames', () => {
  const seen = [], d = new Decoder(x => seen.push(x)), a = frame({ s: 'café' }), b = frame({ x: 2 });
  assert.equal(a.readUInt32LE(), a.length - 4); d.push(a.subarray(0, 2)); d.push(Buffer.concat([a.subarray(2), b]));
  assert.deepEqual(seen, [{ s: 'café' }, { x: 2 }]);
});
test('codec rejects oversized and invalid JSON before dispatch', () => {
  const d = new Decoder(() => assert.fail('must not dispatch')), tooBig = Buffer.alloc(4); tooBig.writeUInt32LE(0xffffffff);
  assert.throws(() => d.push(tooBig), /length/);
  const bad = Buffer.from([1, 0, 0, 0, 123]); assert.throws(() => new Decoder(() => {}).push(bad), SyntaxError);
});
class Socket extends EventEmitter { constructor() { super(); this.sent = []; } write(bytes) { this.sent.push(JSON.parse(bytes.subarray(4))); } destroy() { this.destroyed = true; } }
function respond(socket, index, result, extras = {}) { const req = socket.sent[index]; socket.emit('data', frame({ type: 'response', requestId: req.requestId, method: req.method, resultType: 'success', result, ...extras })); }
test('initialization and owner routing use pinned versions and decline ownership', async () => {
  const socket = new Socket(), client = new Client(socket), initializing = client.initialize();
  assert.equal(socket.sent[0].sourceClientId, 'initializing-client'); assert.equal(socket.sent[0].version, 0);
  respond(socket, 0, { clientId: 'me' }); await initializing;
  const adapter = new Adapter(client, 'chat'), discovering = adapter.discover();
  assert.equal(socket.sent[1].version, 1); respond(socket, 1, { supportsUntrustedAppInput: true }, { handledByClientId: 'owner' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.sent[2].version, 2); assert.equal(socket.sent[2].targetClientId, 'owner');
  respond(socket, 2, { settings: { model: 'm', reasoningEffort: 'high' } }); assert.equal((await discovering).effort, 'high');
  const updating = adapter.update({ model: 'm', effort: 'high' }, 'medium');
  assert.equal(socket.sent[3].version, 3); assert.deepEqual(socket.sent[3].params.condition, { ifModelEquals: 'm', ifEffortEquals: 'high' });
  assert.equal('activeTurnId' in socket.sent[3].params, false); assert.deepEqual(socket.sent[3].params.threadSettings, { effort: 'medium' });
  respond(socket, 3, { applied: true }); await updating;
  socket.emit('data', frame({ type: 'client-discovery-request', requestId: 'd' })); assert.deepEqual(socket.sent[4].response, { canHandle: false });
  assert.equal(VERSION, '26.1021.22027'); assert.equal(PIPE, '\\\\.\\pipe\\codex-ipc'); client.close();
});
test('protocol rejection, unknown method and permission errors never retry', async () => {
  const socket = new Socket(), client = new Client(socket);
  const p = client.request('initialize', {}); socket.emit('data', frame({ type: 'response', requestId: socket.sent[0].requestId, resultType: 'error', error: 'permission-denied' }));
  await assert.rejects(p, /permission-denied/); await assert.rejects(client.request('turn/start', {}), /not allowed/);
  const q = client.request('initialize', {}); socket.emit('error', Object.assign(new Error('EPERM'), { code: 'EPERM' })); await assert.rejects(q, /EPERM/);
  assert.equal(socket.sent.length, 2); assert.equal(client.closed, true);
});
test('response method mismatch and timeout fail closed', async () => {
  const socket = new Socket(), client = new Client(socket, 10), p = client.request('initialize', {});
  respond(socket, 0, {}, { method: 'wrong' }); await assert.rejects(p, /mismatch/);
  await assert.rejects(client.request('initialize', {}), /timeout/); assert.equal(socket.sent.length, 2); client.close();
});
test('discovery rejects missing owner/settings and update false', async () => {
  const adapter = new Adapter({ request: async () => ({ result: {} }) }, 'chat'); await assert.rejects(adapter.discover(), /owner/);
  adapter.owner = 'owner'; await assert.rejects(adapter.read(), /unavailable/); await assert.rejects(adapter.update({ model: 'm', effort: 'high' }, 'low'), /rejected/);
});
test('Auto decreases once, verifies actual saved next turn, related prompts hold', async t => {
  const f = fixture(t), result = await f.controller.submit(begin()); assert.equal(result.outcome, 'awaiting-saved-turn'); assert.equal(f.calls.length, 1);
  assert.equal(f.controller.state().task.held, 'high'); assert.equal((await f.controller.verify()).outcome, 'awaiting-saved-turn');
  f.next('medium'); assert.equal((await f.controller.verify()).outcome, 'verified');
  for (const op of [{ op: 'related' }, begin({ level: 'low', reason: 'correction' })]) assert.equal((await f.controller.submit(op)).outcome, 'task-locked');
  assert.equal(f.controller.state().task.evaluationCount, 1); assert.equal(f.calls.length, 1);
});
test('Suggest mode and increase require human token; stale token cannot dispatch', async t => {
  for (const cfg of [{ mode: 'suggest' }, {}]) {
    const f = fixture(t, cfg); await f.controller.submit(begin({ level: cfg.mode ? 'medium' : 'max' }));
    assert.equal(f.calls.length, 0); assert.equal(f.controller.state().task.phase, 'awaiting-approval');
    await f.controller.reply('stale-token', true); assert.equal(f.calls.length, 0);
    await f.controller.reply(f.controller.state().task.decision.token, true); assert.equal(f.calls.length, 1);
  }
});
test('Keep declines suggestion once and denied completion restoration stays declined', async t => {
  const f = fixture(t, { restoreNeedsApproval: true }); await f.controller.submit(begin()); f.next('medium'); await f.controller.verify();
  await f.controller.submit({ op: 'complete' }); const token = f.controller.state().task.decision.token;
  await f.controller.reply(token, false); assert.equal(f.controller.state().task.restorationDeclined, true);
  await f.controller.submit({ op: 'complete' }); assert.equal(f.controller.state().task.phase, 'completed'); assert.equal(f.calls.length, 1);
});
test('completion restores original baseline and genuinely unrelated task resets assessment', async t => {
  const f = fixture(t); await f.controller.submit(begin()); f.next('medium'); await f.controller.verify();
  await f.controller.submit({ op: 'complete' }); assert.equal(f.calls[1].target, 'high');
  f.next('high', 't3'); await f.controller.verify(); assert.equal(f.controller.state().task.phase, 'completed');
  await f.controller.submit(begin({ newUnrelated: true, boundaryReason: 'Different requested outcome', level: 'high' }));
  assert.equal(f.controller.state().task.baseline, 'high'); assert.equal(f.controller.state().task.evaluationCount, 1);
});
test('new unrelated task restores preserved baseline before applying next recommendation', async t => {
  const f = fixture(t); await f.controller.submit(begin()); f.next('medium'); await f.controller.verify();
  await f.controller.submit(begin({ newUnrelated: true, boundaryReason: 'Distinct next outcome', level: 'low' }));
  assert.equal(f.calls.at(-1).target, 'high'); f.next('high', 't3'); await f.controller.verify();
  assert.equal(f.controller.state().task.vscodeAwaitApply, true); assert.equal(f.controller.state().task.vscodeSourceTurn, 't3');
  await f.controller.dispatch(); assert.equal(f.calls.at(-1).target, 'low'); f.next('low', 't4'); await f.controller.verify();
  assert.equal(f.controller.state().task.phase, 'locked'); assert.equal(f.controller.state().task.baseline, 'high');
});
test('completion after explicit intermediate Apply restores baseline automatically once source turn ends', async t => {
  const f = fixture(t);
  // Task A lowers once. A genuinely unrelated B preserves high before its low recommendation.
  await f.controller.submit(begin()); f.next('medium'); await f.controller.verify();
  await f.controller.submit(begin({ newUnrelated: true, boundaryReason: 'Different outcome B', level: 'low' }));
  f.next('high', 't3'); await f.controller.verify();
  assert.equal(f.controller.state().task.vscodeAwaitApply, true);
  await f.controller.dispatch(); // Explicit native Apply for B's second approved step.
  f.next('low', 't4', false); await f.controller.verify();
  assert.equal(f.controller.state().task.vscodeAwaitApply, false);
  assert.deepEqual(f.calls.map(x => x.target), ['medium', 'high', 'low']);
  assert.equal((await f.controller.submit({ op: 'complete' })).outcome, 'waiting-source-turn');
  // Exercise the actual timer's eligibility conditions against the real persisted controller flow.
  const autoTick = async () => {
    const s = f.controller.state();
    if (s.task?.phase === 'ready' && !s.task.vscodeAwaitApply && !s.job) return f.controller.dispatch();
  };
  assert.equal((await autoTick()).outcome, 'waiting-source-turn');
  assert.deepEqual(f.calls.map(x => x.target), ['medium', 'high', 'low']);
  f.snap().completed.add('t4');
  assert.equal((await autoTick()).outcome, 'awaiting-saved-turn');
  await autoTick(); // Already-sent restoration cannot dispatch again.
  assert.deepEqual(f.calls.map(x => x.target), ['medium', 'high', 'low', 'high']);
  f.next('high', 't5'); await f.controller.verify();
  assert.equal(f.controller.state().task.phase, 'completed');
  assert.equal(f.controller.state().task.vscodeAwaitApply, false);
  await f.controller.submit({ op: 'complete' }); await autoTick();
  assert.equal(f.calls.length, 4);
});
test('manual effort change before approval or completion is preserved', async t => {
  const f = fixture(t, { mode: 'suggest' }); await f.controller.submit(begin()); f.setLive({ effort: 'low' });
  await assert.rejects(f.controller.reply(f.controller.state().task.decision.token, true), /Manual/); assert.equal(f.calls.length, 0);
  await f.controller.submit({ op: 'complete' }); assert.equal(f.calls.length, 0); assert.equal(f.controller.state().task.manualOverride, true);
});
test('rule changes and policy blocks prevent sends', async t => {
  const f = fixture(t, { mode: 'suggest' }); await f.controller.submit(begin()); f.cfg.increasePolicy = 'block';
  await assert.rejects(f.controller.reply(f.controller.state().task.decision.token, true), /Rules changed/); assert.equal(f.calls.length, 0);
  const blocked = fixture(t, { decreasePolicy: 'block' }); await blocked.controller.submit(begin()); assert.equal(blocked.calls.length, 0); assert.equal(blocked.controller.state().task.decision.rejected, true);
});
test('active source waits once, then dispatches after completion; aborted source stops', async t => {
  const f = fixture(t); f.snap().completed.clear(); assert.equal((await f.controller.submit(begin())).outcome, 'waiting-source-turn'); assert.equal(f.calls.length, 0);
  assert.equal((await f.controller.dispatch()).outcome, 'waiting-source-turn'); assert.equal(f.controller.state().task.evaluationCount, 1);
  f.snap().completed.add('t1'); await f.controller.dispatch(); assert.equal(f.calls.length, 1);
  const aborted = fixture(t); aborted.snap().aborted.add('t1'); await assert.rejects(aborted.controller.submit(begin()), /idle/);
});
test('fresh user turn while waiting cancels the recorded decision', async t => {
  const f = fixture(t); f.snap().completed.clear(); await f.controller.submit(begin()); f.next('high');
  await assert.rejects(f.controller.dispatch(), /Another turn/); assert.equal(f.calls.length, 0); assert.equal(f.controller.state().task.phase, 'locked');
});
test('active source timeout cancels without a send or another assessment', async t => {
  const f = fixture(t); f.snap().completed.clear(); await f.controller.submit(begin());
  f.controller.change(s => { s.task.vscodeRequestedAt = 0; return s; });
  await assert.rejects(f.controller.dispatch(), /timeout/); assert.equal(f.calls.length, 0); assert.equal(f.controller.state().task.evaluationCount, 1);
});
test('manual competing turn between reads cancels before send', async t => {
  const f = fixture(t); let reads = 0;
  f.adapter.read = async () => { if (++reads === 3) f.next('high'); return { effort: 'high', model: 'test-model' }; };
  await assert.rejects(f.controller.submit(begin()), /Another turn|Competing/); assert.equal(f.calls.length, 0); assert.equal(f.controller.state().job.phase, 'failed');
});
test('cancellation while dispatch is in flight prevents verification or retry', async t => {
  const f = fixture(t); let resolve, entered;
  const started = new Promise(r => { entered = r; }); f.adapter.update = async () => { entered(); await new Promise(r => { resolve = r; }); };
  const applying = f.controller.submit(begin()); await started; f.controller.cancel(); resolve();
  await assert.rejects(applying, /Cancelled/); assert.equal(f.controller.state().job.phase, 'failed'); assert.equal((await f.controller.dispatch()).outcome, 'locked');
});
test('uncertain transport mutation persists failed job and is not resent', async t => {
  const f = fixture(t); f.adapter.update = async () => { f.calls.push('send'); throw new Error('timeout'); };
  await assert.rejects(f.controller.submit(begin()), /timeout/); await f.controller.dispatch(); assert.equal(f.calls.length, 1); assert.equal(f.controller.state().job.phase, 'failed');
});
test('UI-only update fallback fails saved verification; earliest fresh turn wins', async t => {
  const f = fixture(t); await f.controller.submit(begin()); f.next('high'); f.next('medium', 't3');
  await assert.rejects(f.controller.verify(), /verification failed/); assert.equal(f.controller.state().job.phase, 'failed');
});
test('saved turn timeout does not retry', async t => {
  const f = fixture(t); await f.controller.submit(begin()); f.controller.change(s => { s.job.sentAt = 0; return s; });
  await assert.rejects(f.controller.verify(), /timed out/); assert.equal(f.calls.length, 1);
});
test('selected rollout requires matching session metadata', t => {
  const f = fixture(t), file = path.join(f.dir, 'one.jsonl');
  fs.writeFileSync(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'wrong' } }), JSON.stringify({ type: 'turn_context', payload: { turn_id: 't1', effort: 'high', model: 'm' } })].join('\n'));
  assert.throws(() => snapshot(file, 'chat'), /another chat/);
});
test('bridge consumes once, refuses approval, and rejects stale selection/replays', async t => {
  const f = fixture(t), binding = bridge.bind(f.dir, 'chat');
  assert.throws(() => bridge.enqueue(f.dir, { op: 'approve' }), /cannot approve/);
  const req = bridge.enqueue(f.dir, begin()); assert.equal(req.sequence, 1);
  assert.throws(() => bridge.enqueue(f.dir, begin()), /EEXIST/);
  assert.equal((await bridge.consume(f.dir, binding, f.controller)).outcome, 'awaiting-saved-turn');
  assert.equal(await bridge.consume(f.dir, binding, f.controller), null); assert.equal(binding.nextSequence, 2); assert.equal(f.calls.length, 1);
  fs.writeFileSync(bridge.names(f.dir).request, JSON.stringify({ ...begin(), nonce: binding.nonce, chat: 'chat', sequence: 1 }));
  await assert.rejects(bridge.consume(f.dir, binding, f.controller), /Stale/); assert.equal(f.calls.length, 1);
});
test('source request CLI loads canonical policy and queues exactly one scoped request', t => {
  const { spawnSync } = require('node:child_process'), f = fixture(t);
  const area = store.area(f.dir), binding = bridge.bind(area, 'chat');
  const script = path.resolve(__dirname, '../scripts/request.cjs');
  const run = args => spawnSync(process.execPath, [script, f.dir, JSON.stringify(args)], { encoding: 'utf8' });
  const accepted = run(begin());
  assert.equal(accepted.status, 0, accepted.stderr);
  const response = JSON.parse(accepted.stdout), queued = JSON.parse(fs.readFileSync(bridge.names(area).request, 'utf8'));
  assert.deepEqual(response, { sequence: 1, chat: 'chat', response: bridge.names(area).response });
  assert.equal(queued.nonce, binding.nonce);
  assert.equal(queued.chat, 'chat'); assert.equal(queued.sequence, 1); assert.equal(queued.op, 'begin');
  const replay = run(begin()); assert.equal(replay.status, 1); assert.match(replay.stderr, /EEXIST/);
  assert.deepEqual(JSON.parse(fs.readFileSync(bridge.names(area).request, 'utf8')), queued);
  const approval = run({ op: 'approve' }); assert.equal(approval.status, 1); assert.match(approval.stderr, /cannot approve/);
});

test('development shares the repository policy and ZIP primitives are well formed', () => {
  const repo = path.resolve(__dirname, '../..');
  assert.strictEqual(engine, require(path.join(repo, 'lib/engine.cjs')));
  assert.strictEqual(store, require(path.join(repo, 'lib/storage.cjs')));
  const { zip, crc32 } = require('../scripts/build.cjs'); assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const bytes = zip([['extension/package.json', Buffer.from('{}')]]); assert.equal(bytes.readUInt32LE(), 0x04034b50); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
});
