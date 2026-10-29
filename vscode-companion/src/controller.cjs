'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { engine, store } = require('./policy.cjs');
function snapshot(file, chat) {
  // Match the explicitly selected rollout to the explicitly selected chat.
  const first = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(x => x?.type === 'session_meta');
  if (first?.payload?.id !== chat) throw new Error('Rollout belongs to another chat');
  return store.snapshot(file);
}
class Controller {
  constructor({ file, transcript, chat, adapter, config, snapshot: readSnapshot = snapshot }) {
    Object.assign(this, { file, transcript, chat, adapter, config, readSnapshot });
    this.epoch = 0; this.stopped = false;
  }
  state() { return store.read(this.file, engine.initial()); }
  change(fn) { return store.change(this.file, fn); }
  async live(idle = true) {
    if (this.stopped) throw new Error('Companion stopped; probe again explicitly');
    const before = this.readSnapshot(this.transcript, this.chat);
    const actual = await this.adapter.read();
    const after = this.readSnapshot(this.transcript, this.chat);
    if (after.latest.turnId !== before.latest.turnId) throw new Error('Another turn started during read');
    if (after.aborted.has(after.latest.turnId) || (idle && !after.completed.has(after.latest.turnId))) throw new Error('Selected chat must be idle after a completed turn');
    return { ...actual, turnId: after.latest.turnId };
  }
  async submit(args) {
    if (!args || !['begin', 'related', 'complete'].includes(args.op)) throw new Error('Allowed requests: begin, related, complete');
    const state = this.state();
    if (state.job && state.job.phase !== 'failed') throw new Error('Resolve or cancel the pending switch first');
    const cfg = this.config();
    if (!cfg.enabled) throw new Error('TaskRatchet disabled');
    if (args.op === 'related' || (args.op === 'begin' && state.task && !args.newUnrelated)) return { outcome: 'task-locked', state };
    const live = await this.live(false);
    let next;
    if (args.op === 'complete') {
      if (state.task && (live.model !== state.task.model || live.effort !== state.task.held)) state.task.manualOverride = true;
      next = engine.complete(state, live, cfg);
    }
    else {
      next = engine.begin(state, args, live, cfg).state;
      next = engine.evaluate(next, { taskId: next.task.id, level: args.level, reason: args.reason }, live, cfg).state;
    }
    next.task.vscodeSourceTurn = live.turnId;
    next.task.vscodeRequestedAt = Date.now();
    // A new decision owns its own dispatch gate; an earlier multi-step Apply is settled.
    next.task.vscodeAwaitApply = false;
    this.change(current => { if (current.revision !== state.revision || current.job) throw new Error('Task changed during assessment'); return next; });
    return this.dispatch();
  }
  async reply(token, approve) {
    // Called only by the native VS Code approval command; bridge deliberately has no approval operation.
    this.change(state => engine.reply(state, `${approve ? 'approve' : 'keep'} effort ${token}`));
    return this.dispatch();
  }
  async dispatch() {
    const initial = this.state(), decision = initial.task?.decision;
    if (initial.job || initial.task?.phase !== 'ready') return { outcome: initial.task?.phase || 'no-task', state: initial };
    if (decision.action === 'ask' && !decision.approved) throw new Error('Approval required');
    const source = this.readSnapshot(this.transcript, this.chat);
    if (source.latest.turnId !== initial.task.vscodeSourceTurn || source.aborted.has(source.latest.turnId)) {
      this.cancel('Competing input or interrupted source turn before switch');
      throw new Error('Another turn started before dispatch; decision cancelled');
    }
    if (!source.completed.has(source.latest.turnId)) {
      if (Date.now() - initial.task.vscodeRequestedAt > decision.policy.waitTimeoutSeconds * 1000) {
        this.cancel('Source turn completion timed out'); throw new Error('Source turn timeout; no retry');
      }
      return { outcome: 'waiting-source-turn', state: initial };
    }
    const live = await this.live(), cfg = this.config();
    if (JSON.stringify(cfg) !== JSON.stringify(decision.policy)) throw new Error('Rules changed; cancel this decision and begin an explicitly unrelated task');
    if (live.effort !== initial.task.held || live.model !== initial.task.model) {
      this.change(state => { state.task.manualOverride = true; state.task.phase = 'locked'; state.task.decision.steps = []; state.revision++; return state; });
      throw new Error('Manual model/effort change detected; preserved, no switch');
    }
    const step = decision.steps[0]; if (!step) throw new Error('No approved step');
    const epoch = this.epoch, id = randomUUID();
    this.change(state => {
      if (state.revision !== initial.revision || state.job) throw new Error('Stale task before dispatch');
      state.job = { id, adapter: 'vscode', taskId: state.task.id, decisionId: decision.id, phase: 'dispatching', target: step.level, model: live.model, sourceTurn: live.turnId, transcript: this.transcript, thread: this.chat, policy: cfg };
      state.revision++; return state;
    });
    try {
      // A second concrete read narrows the race; the wire condition handles model/effort drift.
      const checked = await this.live();
      const s = this.state();
      if (epoch !== this.epoch || s.job?.id !== id || checked.turnId !== live.turnId || checked.effort !== live.effort || checked.model !== live.model) throw new Error('Competing input or cancellation before dispatch');
      await this.adapter.update(live, step.level);
      this.change(state => {
        if (epoch !== this.epoch || state.job?.id !== id || state.job.cancelled) throw new Error('Cancelled while update was in flight; outcome uncertain');
        state.job.phase = 'sent'; state.job.sentAt = Date.now(); state.revision++; return state;
      });
      return { outcome: 'awaiting-saved-turn', target: step.level, state: this.state() };
    } catch (error) {
      this.change(state => { if (state.job?.id === id) { state.job.phase = 'failed'; state.job.error = error.message; state.task.phase = 'locked'; state.revision++; } return state; });
      throw error;
    }
  }
  async verify() {
    const original = this.state(), job = original.job;
    if (!job || job.adapter !== 'vscode' || job.phase !== 'sent') return { outcome: 'nothing-to-verify' };
    const snap = this.readSnapshot(this.transcript, this.chat);
    const sourceIndex = snap.contexts.findLastIndex(x => x.turnId === job.sourceTurn);
    if (sourceIndex < 0) throw new Error('Source turn missing from selected rollout');
    const live = snap.contexts.slice(sourceIndex + 1).find(x => x.turnId !== job.sourceTurn);
    if (!live) {
      if (Date.now() - job.sentAt > job.policy.waitTimeoutSeconds * 1000) { this.cancel('No saved fresh-turn verification before timeout'); throw new Error('Verification timed out; no retry'); }
      return { outcome: 'awaiting-saved-turn' };
    }
    if (live.effort !== job.target || live.model !== job.model || snap.aborted.has(live.turnId)) { this.cancel('Saved effort/model mismatch or aborted turn'); throw new Error('Fresh-turn verification failed; no retry'); }
    this.change(state => {
      if (state.job?.id !== job.id || state.task?.id !== job.taskId || state.task.decision?.id !== job.decisionId) throw new Error('Stale verification');
      state.lastSwitch = { id: job.id, sourceTurn: job.sourceTurn, verifiedTurn: live.turnId, effort: live.effort, verifiedAt: new Date().toISOString() };
      state.task.held = live.effort; state.task.restoreDue = false; state.task.decision.steps.shift();
      state.task.phase = state.task.decision.steps.length ? 'ready' : state.task.decision.completionRestore ? 'completed' : 'locked';
      state.task.vscodeAwaitApply = state.task.decision.steps.length > 0;
      if (state.task.decision.steps.length) { state.task.vscodeSourceTurn = live.turnId; state.task.vscodeRequestedAt = Date.now(); }
      state.job = null; state.revision++; return state;
    });
    // Further steps wait for an explicit Apply command after this turn finishes.
    return { outcome: 'verified', effort: live.effort };
  }
  cancel(reason = 'Cancelled by user') {
    this.epoch++;
    this.change(state => {
      if (state.job) { state.job.phase = 'failed'; state.job.cancelled = true; state.job.error = reason; }
      if (state.task) { state.task.phase = 'locked'; if (state.task.decision) state.task.decision.steps = []; }
      state.revision++; return state;
    });
  }
}
module.exports = { Controller, snapshot };
