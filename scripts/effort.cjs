'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const engine = require('../lib/engine.cjs');
const store = require('../lib/storage.cjs');
function schedule(root, file, thread) {
  if (process.platform !== 'win32' || !process.env.CODEX_APP_TOOLS_PIPE_PATH) throw new Error('Automatic changes require the local Windows desktop app-tools connection');
  const cfg = store.config(root);
  let job;
  store.change(file, state => {
    if (!cfg.enabled) throw new Error('Disabled');
    if (state.job) throw new Error('A switch already exists; do not schedule it again');
    const task = state.task, decision = task?.decision;
    if (!decision || task.phase !== 'ready' || !decision.steps.length) throw new Error('No ready switch');
    if (decision.action === 'ask' && !decision.approved) throw new Error('Human approval is required');
    if (JSON.stringify(cfg) !== JSON.stringify(decision.policy)) throw new Error('Settings changed; keep current effort until the next unrelated task');
    const live = store.snapshot(state.input?.transcript).latest;
    if (live.effort !== task.held || live.model !== task.model) throw new Error('Model or effort changed manually; keep the user selection');
    job = { id: randomUUID(), thread, sourceTurn: live.turnId, transcript: state.input.transcript,
      taskId: task.id, decisionId: decision.id, target: decision.steps[0].level,
      step: decision.steps[0], model: live.model, policy: cfg, phase: 'waiting', createdAt: new Date().toISOString() };
    state.job = job; task.phase = 'switching'; state.revision++; return state;
  });
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'switch-worker.cjs'), file, job.id],
      { detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd(), env: process.env });
    child.on('error', error => store.change(file, state => {
      if (state.job?.id === job.id) { state.job.phase = 'failed'; state.job.error = error.message; state.task.phase = 'locked'; }
      return state;
    }));
    child.unref(); return { scheduled: true, jobId: job.id, target: job.target,
      instruction: 'Finish this evaluation turn now. Do not start substantive work or schedule another helper. The helper sends a continuation after this turn ends.' };
  } catch (error) {
    store.change(file, state => { if (state.job?.id === job.id) { state.job.phase = 'failed'; state.job.error = error.message; state.task.phase = 'locked'; } return state; });
    throw error;
  }
}
function main() {
  const command = process.argv[2] || 'status', root = store.area();
  if (command === 'settings') return { location: path.join(root, 'settings.json'), settings: store.config(root) };
  if (command === 'configure') {
    const patch = JSON.parse(fs.readFileSync(0, 'utf8'));
    const cfg = engine.settings({ ...store.config(root), ...patch });
    store.write(path.join(root, 'settings.json'), cfg);
    return { settings: cfg, applies: 'New task decisions. Disabling or changing settings also cancels unsent helpers.' };
  }
  const thread = process.env.CODEX_THREAD_ID, file = store.threadFile(root, thread);
  const cfg = store.config(root), state = store.read(file, engine.initial());
  if (command === 'status') {
    const live = state.input?.transcript ? store.snapshot(state.input.transcript).latest : null;
    if (live && state.task && !state.job && (live.effort !== state.task.held || live.model !== state.task.model)) {
      store.change(file, current => {
        if (!current.job && current.task?.id === state.task.id) {
          current.task.held = live.effort; current.task.baseline = live.effort; current.task.model = live.model;
          current.task.manualOverride = true; current.task.phase = 'locked';
          current.revision++;
        }
        return current;
      });
    }
    return { stateFile: file, settings: cfg, state: store.read(file, engine.initial()), live };
  }
  if (command === 'schedule') return schedule(root, file, thread);
  const live = store.snapshot(state.input?.transcript).latest;
  let outcome;
  if (command === 'assess') {
    const args = JSON.parse(fs.readFileSync(0, 'utf8'));
    store.change(file, current => {
      if (current.job && !args.newUnrelated) { outcome = 'switch-pending'; return current; }
      const started = engine.begin(current, args, live, cfg);
      // A locked task cannot be rerated, even after completing a turn or the task.
      if (started.outcome === 'task-locked') { outcome = 'task-locked'; return current; }
      const evaluated = engine.evaluate(started.state, { taskId: started.state.task.id, level: args.level, reason: args.reason }, live, cfg);
      outcome = evaluated.outcome; return evaluated.state;
    });
    const updated = store.read(file, null);
    return { outcome, task: updated.task, approval: updated.task?.phase === 'awaiting-approval' ? {
      approve: `approve effort ${updated.task.decision.token}`, keep: `keep effort ${updated.task.decision.token}` } : null };
  }
  if (command === 'complete') {
    store.change(file, current => engine.complete(current, live, cfg));
    return { task: store.read(file, null).task };
  }
  throw new Error('Use status, settings, configure, assess, schedule or complete');
}
if (require.main === module) { try { console.log(JSON.stringify(main(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { schedule, main };
