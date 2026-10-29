'use strict';
const fs = require('node:fs');
const path = require('node:path');
const store = require('../lib/storage.cjs');
const engine = require('../lib/engine.cjs');
function run(input, env = process.env) {
  const event = input.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit'].includes(event) || input.agent_id) return {};
  const thread = env.CODEX_THREAD_ID || input.session_id;
  const root = store.area(input.cwd || process.cwd()), file = store.threadFile(root, thread);
  const cfg = store.config(root);
  if (!cfg.enabled) return {};
  let current;
  store.change(file, state => {
    const jobId = state.job?.id;
    const internal = event === 'UserPromptSubmit' && jobId && input.prompt?.includes(`[taskratchet ${jobId}]`);
    current = event === 'UserPromptSubmit' && !internal ? engine.reply(state, input.prompt || '') : state;
    current.input = { transcript: input.transcript_path || state.input?.transcript,
      turnId: input.turn_id || state.input?.turnId, event,
      lastUserTurnId: !internal && event === 'UserPromptSubmit' ? input.turn_id : state.input?.lastUserTurnId };
    if (event === 'UserPromptSubmit' && !internal && current.job && input.turn_id !== current.job.sourceTurn) {
      current.job.cancelled = true; current.job.reason = 'User input takes precedence';
    }
    // A manual picker change pins the current task; don't fight it or rerate.
    if (current.task && !current.job && current.input.transcript) {
      try {
        const live = store.snapshot(current.input.transcript).latest;
        if (live.effort !== current.task.held && !['assessing', 'ready', 'awaiting-approval'].includes(current.task.phase)) {
          current.task.held = live.effort; current.task.baseline = live.effort;
          current.task.manualOverride = true; current.task.phase = 'locked';
        }
      } catch { /* Agent's status command will explain unsupported transcript formats. */ }
    }
    return current;
  });
  const skill = path.resolve(__dirname, '../skills/taskratchet/SKILL.md');
  const task = current.task;
  const guidance = [
    `TaskRatchet is enabled. Read ${skill} before handling effort or task boundaries.`,
    `Mode ${cfg.mode}; automatic direction ${cfg.automaticDirection}; return to baseline ${cfg.restoreBaseline}.`,
    task ? `Existing task ${JSON.stringify({ id: task.id, objective: task.objective, phase: task.phase, held: task.held, baseline: task.baseline, evaluationCount: task.evaluationCount })}.` : 'No task assessment yet. Understand the full requested outcome before assessing once.',
    'Related follow-ups, approvals, corrections, failed checks, and continuation messages keep the same task. Do not reevaluate or offer again. Only clearly unrelated user work opens a new task.',
    task?.phase === 'ready' ? 'The decision is ready; schedule the existing decision without assessing again.' : '',
    task?.phase === 'awaiting-approval' ? 'An effort offer is pending. Do not repeat it or infer approval from unrelated yes/go messages. Exact approve/keep effort tokens are recognized by this hook.' : '',
    current.job ? `A switch helper is ${current.job.cancelled ? 'cancelled' : current.job.phase}; do not schedule another or do dependent work before verification.` : '',
  ].filter(Boolean).join('\n');
  return { hookSpecificOutput: { hookEventName: event, additionalContext: guidance } };
}
if (require.main === module) {
  try { const input = JSON.parse(fs.readFileSync(0, 'utf8')); console.log(JSON.stringify(run(input))); }
  catch (error) { console.log(JSON.stringify({ systemMessage: `TaskRatchet unavailable: ${error.message}. Keep the current effort; do not guess that a switch occurred.` })); }
}
module.exports = { run };
