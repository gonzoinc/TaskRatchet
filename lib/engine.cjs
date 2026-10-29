'use strict';
const { randomUUID } = require('node:crypto');
const defaults = require('../settings.default.json');
const levels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const rank = level => levels.indexOf(level);
const copy = value => structuredClone(value);
function settings(patch = {}) {
  for (const key of Object.keys(patch)) if (!(key in defaults)) throw new Error(`Unknown setting: ${key}`);
  const cfg = { ...copy(defaults), ...patch };
  for (const key of ['enabled', 'restoreNeedsApproval']) if (typeof cfg[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  const enums = { mode: ['auto', 'suggest'], automaticDirection: ['lower-only', 'higher-only', 'both', 'none'],
    increasePolicy: ['allow', 'ask', 'block'], decreasePolicy: ['allow', 'ask', 'block'], restoreBaseline: ['new-task', 'completion', 'never'] };
  for (const [key, values] of Object.entries(enums)) if (!values.includes(cfg[key])) throw new Error(`Invalid ${key}`);
  if (!Array.isArray(cfg.allowedEfforts) || !cfg.allowedEfforts.length || new Set(cfg.allowedEfforts).size !== cfg.allowedEfforts.length || cfg.allowedEfforts.some(x => rank(x) < 0)) throw new Error('Invalid allowedEfforts');
  if (!cfg.allowedEfforts.includes(cfg.minEffort) || !cfg.allowedEfforts.includes(cfg.maxEffort) || rank(cfg.minEffort) > rank(cfg.maxEffort)) throw new Error('Invalid effort bounds');
  if (!Number.isInteger(cfg.waitTimeoutSeconds) || cfg.waitTimeoutSeconds < 30 || cfg.waitTimeoutSeconds > 1800) throw new Error('waitTimeoutSeconds must be 30..1800');
  if (typeof cfg.assessmentRules !== 'string' || !cfg.assessmentRules.trim() || cfg.assessmentRules.length > 4000) throw new Error('Invalid assessmentRules');
  return cfg;
}
function initial() { return { version: 1, revision: 0, task: null, input: null, job: null }; }
function requireLive(live) {
  if (!live || rank(live.effort) < 0 || !live.turnId || !live.model) throw new Error('Concrete current effort, model and turn ID are required');
}
function begin(state, args, live, cfg) {
  requireLive(live);
  if (!cfg.enabled) throw new Error('TaskRatchet is disabled');
  if (state.task && !args.newUnrelated) return { state, outcome: 'task-locked' };
  if (!args.objective?.trim() || args.objective.length > 1000) throw new Error('A short task objective is required');
  if (state.task && (!args.boundaryReason?.trim() || args.boundaryReason.length > 1000)) throw new Error('Explain why the user requested a new unrelated task');
  const next = copy(state), old = next.task;
  // Leaving an unfinished task is also a task boundary: don't drift the baseline down.
  const restoreDue = !!(old && cfg.restoreBaseline !== 'never' && old.held === live.effort && old.baseline !== live.effort);
  next.task = { id: randomUUID(), objective: args.objective, boundaryReason: args.boundaryReason || 'first task',
    baseline: restoreDue ? old.baseline : live.effort, held: live.effort, model: live.model,
    restoreDue, phase: 'assessing', evaluationCount: 0, decision: null, manualOverride: false, restorationDeclined: false };
  next.job = null; next.revision++;
  return { state: next, outcome: 'task-started' };
}
function gate(from, target, cfg, restoration = false) {
  if (from === target) return 'hold';
  if (restoration) return cfg.restoreNeedsApproval ? 'ask' : 'switch';
  const up = rank(target) > rank(from), policy = up ? cfg.increasePolicy : cfg.decreasePolicy;
  if (policy === 'block') return 'blocked';
  const directionAllowed = cfg.automaticDirection === 'both' || (up ? cfg.automaticDirection === 'higher-only' : cfg.automaticDirection === 'lower-only');
  return cfg.mode === 'suggest' || policy === 'ask' || !directionAllowed ? 'ask' : 'switch';
}
function evaluate(state, args, live, cfg) {
  requireLive(live);
  if (!cfg.enabled) throw new Error('TaskRatchet is disabled');
  if (!state.task || state.task.id !== args.taskId) throw new Error('Task ID changed');
  if (state.task.decision) return { state, outcome: 'already-evaluated' };
  if (!cfg.allowedEfforts.includes(args.level) || rank(args.level) < rank(cfg.minEffort) || rank(args.level) > rank(cfg.maxEffort)) throw new Error('Recommendation is outside configured effort bounds');
  if (!args.reason?.trim() || args.reason.length > 1000) throw new Error('A short assessment reason is required');
  const next = copy(state), task = next.task;
  const from = task.restoreDue ? task.baseline : live.effort;
  const result = gate(from, args.level, cfg);
  const steps = [];
  if (task.restoreDue && task.baseline !== live.effort) steps.push({ level: task.baseline, restoration: true });
  if (result !== 'blocked' && args.level !== (steps.at(-1)?.level || live.effort)) steps.push({ level: args.level, restoration: false });
  const restoreApproval = steps.some(step => step.restoration) && cfg.restoreNeedsApproval;
  const action = restoreApproval || result === 'ask' ? 'ask' : steps.length ? 'switch' : result;
  task.evaluationCount = 1;
  task.decision = { id: randomUUID(), token: randomUUID().slice(0, 8), recommended: args.level, reason: args.reason,
    action, steps, rejected: result === 'blocked', approved: false, policy: copy(cfg) };
  task.phase = action === 'ask' ? 'awaiting-approval' : action === 'switch' ? 'ready' : 'locked';
  next.revision++;
  return { state: next, outcome: action };
}
function reply(state, prompt) {
  const next = copy(state), task = next.task, decision = task?.decision;
  if (!decision || task.phase !== 'awaiting-approval') return next;
  const text = prompt.trim().toLowerCase();
  if (text === `approve effort ${decision.token}`) { decision.approved = true; task.phase = 'ready'; }
  else if (text === `keep effort ${decision.token}`) {
    // A declined return is settled for this task, including later completion bookkeeping.
    if (decision.steps.some(step => step.restoration)) task.restorationDeclined = true;
    decision.steps = []; decision.action = 'hold'; task.phase = 'locked';
  }
  else return next;
  next.revision++;
  return next;
}
function complete(state, live, cfg) {
  requireLive(live);
  const next = copy(state), task = next.task;
  if (!task) throw new Error('No task');
  if ((next.job && next.job.phase !== 'failed') || task.phase === 'awaiting-approval') throw new Error('Resolve the pending decision first');
  if (next.job?.phase === 'failed') { next.lastFailure = next.job; next.job = null; }
  task.phase = 'completed';
  if (cfg.restoreBaseline === 'completion' && live.effort !== task.baseline && !task.manualOverride && !task.restorationDeclined) {
    task.decision = { id: randomUUID(), token: randomUUID().slice(0, 8), action: cfg.restoreNeedsApproval ? 'ask' : 'switch',
      reason: 'Return to the starting effort after task completion', steps: [{ level: task.baseline, restoration: true }],
      approved: false, policy: copy(cfg), completionRestore: true };
    task.phase = cfg.restoreNeedsApproval ? 'awaiting-approval' : 'ready';
  }
  next.revision++; return next;
}
module.exports = { defaults, levels, rank, settings, initial, begin, evaluate, gate, reply, complete };
