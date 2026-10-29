'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../lib/engine.cjs');
const store = require('../lib/storage.cjs');
const hook = require('../scripts/hook.cjs');
const { execute } = require('../scripts/switch-worker.cjs');
const { spawnSync } = require('node:child_process');
const live = { effort: 'high', model: 'test-model', turnId: 'turn-one' };
function assessed(cfg = engine.settings(), level = 'low') {
  const started = engine.begin(engine.initial(), { objective: 'Fix checkout failure' }, live, cfg).state;
  return engine.evaluate(started, { taskId: started.task.id, level, reason: 'Bounded reversible change' }, live, cfg).state;
}
function fixture(t) {
  const base = path.resolve(__dirname, '../.codex/taskratchet-validation');
  fs.mkdirSync(base, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(base, 'case-'));
  t.after(() => {
    if (!path.resolve(cwd).startsWith(base + path.sep)) throw new Error('Refusing cleanup outside test area');
    fs.rmSync(cwd, { recursive: true });
  });
  const root = store.area(cwd), file = store.threadFile(root, 'chat-one'), transcript = path.join(cwd, 'rollout.jsonl');
  const context = value => JSON.stringify({ type: 'turn_context', payload: value });
  const writeContext = (id, effort, complete = false) => fs.writeFileSync(transcript,
    context({ turn_id: id, effort, model: live.model }) + '\n' + (complete ? JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: id } }) + '\n' : ''));
  writeContext('turn-one', 'high', true);
  return { cwd, root, file, transcript, writeContext, context };
}
test('default Auto permits decreases and asks before increases', () => {
  const cfg = engine.settings();
  assert.equal(engine.gate('high', 'low', cfg), 'switch');
  assert.equal(engine.gate('medium', 'high', cfg), 'ask');
  assert.equal(engine.gate('low', 'high', cfg, true), 'switch');
  assert.equal(engine.gate('low', 'high', engine.settings({ restoreNeedsApproval: true }), true), 'ask');
});
test('Suggest asks both directions; forbidden changes stay blocked', () => {
  const cfg = engine.settings({ mode: 'suggest' });
  assert.equal(engine.gate('high', 'low', cfg), 'ask');
  assert.equal(engine.gate('medium', 'high', cfg), 'ask');
  assert.equal(engine.gate('medium', 'high', engine.settings({ mode: 'suggest', increasePolicy: 'block' })), 'blocked');
});
test('all related prompts reuse one task assessment', () => {
  const cfg = engine.settings(); let state = assessed();
  const id = state.task.id;
  for (const objective of ['yes', 'go ahead', 'PayPal only', 'that failed', 'test it', 'continue after compaction']) {
    const next = engine.begin(state, { objective }, live, cfg);
    assert.equal(next.outcome, 'task-locked'); state = next.state;
    const again = engine.evaluate(state, { taskId: id, level: 'max', reason: 'Should never apply' }, live, cfg);
    assert.equal(again.outcome, 'already-evaluated');
    assert.equal(again.state.task.decision.recommended, 'low');
  }
  assert.equal(state.task.evaluationCount, 1);
});
test('only an explained unrelated task permits another assessment', () => {
  const cfg = engine.settings(), state = assessed();
  assert.throws(() => engine.begin(state, { objective: 'Birthday message', newUnrelated: true }, live, cfg), /Explain/);
  const next = engine.begin(state, { objective: 'Birthday message', newUnrelated: true, boundaryReason: 'Personal writing instead of checkout repair' }, live, cfg);
  assert.notEqual(next.state.task.id, state.task.id);
  assert.equal(next.state.task.evaluationCount, 0);
});
test('approval is exact, task-bound, single-use, and cannot bypass block', () => {
  const cfg = engine.settings({ mode: 'suggest' }), state = assessed(cfg), token = state.task.decision.token;
  for (const text of ['yes', 'go ahead', 'approve effort wrong', 'Quoted: approve effort ' + token]) {
    assert.equal(engine.reply(state, text).task.phase, 'awaiting-approval');
  }
  const approved = engine.reply(state, 'approve effort ' + token);
  assert.equal(approved.task.phase, 'ready');
  assert.equal(approved.task.decision.approved, true);
  assert.deepEqual(engine.reply(approved, 'keep effort ' + token), approved);
  const declined = engine.reply(state, 'keep effort ' + token);
  assert.equal(declined.task.phase, 'locked');
  assert.equal(declined.task.decision.steps.length, 0);
  const blocked = assessed(engine.settings({ decreasePolicy: 'block' }));
  assert.equal(blocked.task.phase, 'locked');
  assert.equal(engine.reply(blocked, 'approve effort ' + blocked.task.decision.token).task.phase, 'locked');
});
test('baseline restoration occurs only at configured boundary, not turn completion', () => {
  let state = assessed(), cfg = engine.settings({ restoreBaseline: 'new-task' });
  state.task.held = 'low'; state.task.phase = 'locked'; state.task.decision.steps = [];
  const low = { ...live, effort: 'low' };
  const complete = engine.complete(state, low, cfg);
  assert.equal(complete.task.phase, 'completed');
  assert.equal(complete.task.held, 'low');
  const next = engine.begin(complete, { objective: 'Review a different project', newUnrelated: true, boundaryReason: 'Separate project' }, low, cfg).state;
  const result = engine.evaluate(next, { taskId: next.task.id, level: 'medium', reason: 'Routine task' }, low, cfg);
  assert.deepEqual(result.state.task.decision.steps, [{ level: 'high', restoration: true }, { level: 'medium', restoration: false }]);
  cfg = engine.settings({ restoreBaseline: 'completion' });
  assert.equal(engine.complete(state, low, cfg).task.phase, 'ready');
  assert.equal(engine.complete(state, low, engine.settings({ restoreBaseline: 'never' })).task.phase, 'completed');
});
test('invalid settings and recommendations fail closed', () => {
  for (const patch of [{ mode: 'turbo' }, { enabled: 'true' }, { maxEffort: 'low', minEffort: 'high' }, { mystery: true }, { waitTimeoutSeconds: 0 }]) assert.throws(() => engine.settings(patch));
  const cfg = engine.settings({ maxEffort: 'high' });
  const s = engine.begin(engine.initial(), { objective: 'Task' }, live, cfg).state;
  assert.throws(() => engine.evaluate(s, { taskId: s.task.id, level: 'max', reason: 'Hard' }, live, cfg), /bounds/);
});
test('completion default restores an abandoned task at the next unrelated boundary', () => {
  const cfg = engine.settings(), state = assessed(cfg);
  assert.equal(cfg.restoreBaseline, 'completion');
  state.task.held = 'low'; state.task.phase = 'locked'; state.task.decision.steps = [];
  const next = engine.begin(state, { objective: 'Different project', newUnrelated: true, boundaryReason: 'User changed projects' }, { ...live, effort: 'low' }, cfg).state;
  assert.equal(next.task.baseline, 'high'); assert.equal(next.task.restoreDue, true);
});
test('old-task approval cannot approve a new unrelated task', () => {
  const cfg = engine.settings({ mode: 'suggest' }), state = assessed(cfg), oldToken = state.task.decision.token;
  const next = engine.begin(state, { objective: 'Different task', newUnrelated: true, boundaryReason: 'User changed outcomes' }, live, cfg).state;
  const pending = engine.evaluate(next, { taskId: next.task.id, level: 'low', reason: 'Small task' }, live, cfg).state;
  assert.equal(engine.reply(pending, 'approve effort ' + oldToken).task.phase, 'awaiting-approval');
});
test('completion and related corrections never unlock another assessment', () => {
  const cfg = engine.settings(), state = assessed(cfg);
  state.task.phase = 'locked'; state.task.decision.steps = [];
  const completed = engine.complete(state, live, cfg);
  assert.equal(completed.task.phase, 'completed');
  assert.equal(engine.begin(completed, { objective: 'Actually the same bug still occurs' }, live, cfg).outcome, 'task-locked');
});
test('declined completion restoration is not offered again for the same task', () => {
  const cfg = engine.settings({ restoreNeedsApproval: true }), low = { ...live, effort: 'low' };
  let state = assessed(cfg);
  state.task.held = 'low'; state.task.phase = 'locked'; state.task.decision.steps = [];
  state = engine.complete(state, low, cfg);
  assert.equal(state.task.phase, 'awaiting-approval');
  const first = { id: state.task.decision.id, token: state.task.decision.token };
  state = engine.reply(state, 'keep effort ' + first.token);
  // The decision must survive storage/compaction and a related correction.
  state = JSON.parse(JSON.stringify(state));
  assert.equal(engine.begin(state, { objective: 'The same checkout issue still occurs' }, low, cfg).outcome, 'task-locked');
  for (let i = 0; i < 2; i++) {
    state = engine.complete(state, low, cfg);
    assert.equal(state.task.phase, 'completed');
    assert.equal(state.task.decision.action, 'hold');
    assert.equal(state.task.decision.id, first.id);
    assert.equal(state.task.decision.token, first.token);
    assert.deepEqual(state.task.decision.steps, []);
    assert.equal(state.task.held, 'low');
    assert.equal(state.task.evaluationCount, 1);
  }
});
test('a genuinely unrelated task can request baseline restoration after an earlier decline', () => {
  const cfg = engine.settings({ restoreNeedsApproval: true }), low = { ...live, effort: 'low' };
  let state = assessed(cfg);
  state.task.held = 'low'; state.task.phase = 'locked'; state.task.decision.steps = [];
  state = engine.complete(state, low, cfg);
  const oldTaskId = state.task.id, oldToken = state.task.decision.token;
  state = engine.reply(state, 'keep effort ' + oldToken);
  state = engine.begin(state, { objective: 'Review a different project', newUnrelated: true, boundaryReason: 'The user changed projects' }, low, cfg).state;
  state = engine.evaluate(state, { taskId: state.task.id, level: 'low', reason: 'A bounded independent task' }, low, cfg).state;
  assert.notEqual(state.task.id, oldTaskId);
  assert.equal(state.task.baseline, 'high');
  assert.equal(state.task.phase, 'awaiting-approval');
  assert.notEqual(state.task.decision.token, oldToken);
  assert.deepEqual(state.task.decision.steps, [{ level: 'high', restoration: true }, { level: 'low', restoration: false }]);
});
test('hook persists locks across resume/compaction and recognizes human approval', t => {
  const f = fixture(t), cfg = engine.settings({ mode: 'suggest' });
  store.write(path.join(f.root, 'settings.json'), cfg);
  store.write(f.file, assessed(cfg));
  const token = store.read(f.file, null).task.decision.token;
  const input = { cwd: f.cwd, transcript_path: f.transcript, session_id: 'chat-one', hook_event_name: 'SessionStart', source: 'compact' };
  hook.run(input, { CODEX_THREAD_ID: 'chat-one' });
  assert.equal(store.read(f.file, null).task.evaluationCount, 1);
  hook.run({ ...input, hook_event_name: 'UserPromptSubmit', turn_id: 'turn-two', prompt: 'approve effort ' + token }, { CODEX_THREAD_ID: 'chat-one' });
  assert.equal(store.read(f.file, null).task.phase, 'ready');
});
function readyJob(f, cfg = engine.settings()) {
  const state = assessed(cfg);
  state.input = { transcript: f.transcript, turnId: 'turn-one' };
  state.job = { id: 'job-one', taskId: state.task.id, decisionId: state.task.decision.id, thread: 'chat-one', sourceTurn: 'turn-one',
    target: 'low', step: { level: 'low', restoration: false }, model: live.model, policy: cfg, transcript: f.transcript, phase: 'waiting' };
  state.task.phase = 'switching'; store.write(f.file, state); return state;
}
test('worker sends exactly once after turn completion and verifies fresh effort', async t => {
  const f = fixture(t); readyJob(f); let sends = 0;
  const result = await execute(f.file, 'job-one', { send: async args => {
    sends++; assert.equal(args.effort, 'low'); assert.equal(args.threadId, 'chat-one');
    f.writeContext('turn-two', 'low');
  } });
  assert.equal(result.verified, true); assert.equal(sends, 1);
  const after = store.read(f.file, null);
  assert.equal(after.task.held, 'low'); assert.equal(after.task.evaluationCount, 1); assert.equal(after.job, null);
  await assert.rejects(execute(f.file, 'job-one', { send: async () => sends++ }), /Stale/);
  assert.equal(sends, 1);
});
test('worker waits rather than sending during an active turn', async t => {
  const f = fixture(t); f.writeContext('turn-one', 'high', false); readyJob(f);
  let waits = 0, sends = 0;
  await execute(f.file, 'job-one', { sleep: async () => { waits++; f.writeContext('turn-one', 'high', true); },
    send: async () => { sends++; f.writeContext('turn-two', 'low'); } });
  assert.equal(waits, 1); assert.equal(sends, 1);
});
test('worker cancels on new user input, settings changes or interrupted source', async t => {
  for (const cause of ['new-turn', 'settings', 'interrupt', 'cancelled']) {
    const f = fixture(t); readyJob(f); let sends = 0;
    if (cause === 'new-turn') f.writeContext('user-turn', 'high');
    if (cause === 'settings') store.write(path.join(f.root, 'settings.json'), engine.settings({ enabled: false }));
    if (cause === 'interrupt') fs.appendFileSync(f.transcript, JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'turn-one' } }) + '\n');
    if (cause === 'cancelled') store.change(f.file, state => { state.job.cancelled = true; return state; });
    const result = await execute(f.file, 'job-one', { send: async () => sends++ });
    assert.equal(result.verified, false); assert.equal(sends, 0);
  }
});
test('uncertain send and wrong fresh effort never trigger a retry', async t => {
  for (const failure of ['send-error', 'wrong-effort']) {
    const f = fixture(t); readyJob(f); let sends = 0;
    const result = await execute(f.file, 'job-one', { send: async () => {
      sends++; if (failure === 'send-error') throw new Error('Uncertain outcome');
      f.writeContext('turn-two', 'high');
    } });
    assert.equal(result.verified, false); assert.equal(sends, 1);
    assert.equal(store.read(f.file, null).job.phase, 'failed');
  }
});
test('internal continuation wrappers do not cancel their own pending switch', t => {
  const f = fixture(t); readyJob(f);
  hook.run({ cwd: f.cwd, hook_event_name: 'UserPromptSubmit', transcript_path: f.transcript,
    turn_id: 'turn-two', prompt: '<codex_delegation> [taskratchet job-one] continue </codex_delegation>' }, { CODEX_THREAD_ID: 'chat-one' });
  assert.notEqual(store.read(f.file, null).job.cancelled, true);
});
test('completion restoration verifies baseline without another assessment', async t => {
  const f = fixture(t), cfg = engine.settings(), state = assessed(cfg);
  state.task.phase = 'locked'; state.task.held = 'low'; state.task.decision.steps = [];
  const completed = engine.complete(state, { ...live, effort: 'low' }, cfg);
  completed.input = { transcript: f.transcript, turnId: 'turn-one' };
  completed.job = { id: 'restore-job', taskId: completed.task.id, decisionId: completed.task.decision.id, thread: 'chat-one', sourceTurn: 'turn-one',
    target: 'high', step: { level: 'high', restoration: true }, model: live.model, policy: cfg, transcript: f.transcript, phase: 'waiting' };
  completed.task.phase = 'switching'; store.write(f.file, completed); f.writeContext('turn-one', 'low', true);
  const result = await execute(f.file, 'restore-job', { send: async args => { assert.equal(args.effort, 'high'); f.writeContext('restored-turn', 'high'); } });
  assert.equal(result.verified, true);
  const final = store.read(f.file, null);
  assert.equal(final.task.phase, 'completed'); assert.equal(final.task.held, 'high'); assert.equal(final.task.evaluationCount, 1);
});
test('CLI uses stdin settings patches and locks related assessments', t => {
  const f = fixture(t), cli = path.resolve(__dirname, '../scripts/effort.cjs');
  const env = { ...process.env, CODEX_THREAD_ID: 'chat-one' };
  const run = (command, input) => {
    const result = spawnSync(process.execPath, [cli, command], { cwd: f.cwd, env, input: input && JSON.stringify(input), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  hook.run({ cwd: f.cwd, hook_event_name: 'SessionStart', transcript_path: f.transcript, session_id: 'chat-one' }, env);
  assert.equal(run('configure', { mode: 'suggest' }).settings.mode, 'suggest');
  assert.equal(run('assess', { objective: 'Task', level: 'low', reason: 'Small task' }).outcome, 'ask');
  assert.equal(run('assess', { objective: 'same task', level: 'max', reason: 'Should be ignored' }).outcome, 'task-locked');
  assert.equal(run('status').state.task.evaluationCount, 1);
});
