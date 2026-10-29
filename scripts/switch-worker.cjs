'use strict';
const path = require('node:path');
const store = require('../lib/storage.cjs');
const desktop = require('../lib/desktop.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function execute(file, id, dependencies = {}) {
  const send = dependencies.send || desktop.send, sleep = dependencies.sleep || delay;
  const start = store.read(file, null), job = start?.job;
  if (!job || job.id !== id || job.phase !== 'waiting') throw new Error('Stale or already-dispatched job');
  const root = path.dirname(path.dirname(file));
  const deadline = Date.now() + job.policy.waitTimeoutSeconds * 1000;
  const current = () => {
    const state = store.read(file, null);
    if (state?.job?.id !== id || state.task?.id !== job.taskId || state.task.decision?.id !== job.decisionId || state.job.cancelled) throw new Error('Switch cancelled by newer user work');
    if (JSON.stringify(store.config(root)) !== JSON.stringify(job.policy)) throw new Error('Settings changed; switch cancelled');
    return state;
  };
  const update = fn => store.change(file, state => { if (state.job?.id !== id) throw new Error('Stale switch'); fn(state); state.revision++; return state; });
  try {
    for (;;) {
      current();
      const transcript = store.snapshot(job.transcript);
      if (transcript.aborted.has(job.sourceTurn)) throw new Error('Source turn interrupted; switch cancelled');
      if (transcript.latest.turnId !== job.sourceTurn) throw new Error('Another turn began first; switch cancelled');
      if (transcript.completed.has(job.sourceTurn)) break;
      if (Date.now() >= deadline) throw new Error('Source turn did not finish before timeout');
      await sleep(1000);
    }
    // Persist dispatch intent before sending: uncertain outcomes are never retried.
    current();
    update(state => { state.job.phase = 'dispatching'; });
    const prompt = `[taskratchet ${id}] Switching to ${job.target} effort${job.step.restoration ? ' to restore the task baseline' : ' for this task'}. This is a continuation of the SAME task, not new user work. Read the installed taskratchet skill and run its status command. Do not assess again. Verify the current effort against the pending job. If more approved steps remain, schedule the next step and finish this turn; otherwise continue the original user task from the existing conversation. If this was a completion restoration, only confirm restoration and finish. Never send another switching message on your own.`;
    await send({ threadId: job.thread, turnId: job.sourceTurn, effort: job.target, prompt });
    update(state => { state.job.phase = 'sent'; });
    for (;;) {
      current();
      const transcript = store.snapshot(job.transcript), live = transcript.latest;
      if (live.turnId !== job.sourceTurn) {
        if (live.model !== job.model || live.effort !== job.target) throw new Error('Fresh-turn effort verification failed; do not retry');
        update(state => {
          state.lastSwitch = { id, sourceTurn: job.sourceTurn, verifiedTurn: live.turnId, effort: live.effort, verifiedAt: new Date().toISOString() };
          state.task.held = live.effort; state.task.restoreDue = false;
          state.task.decision.steps.shift();
          state.task.phase = state.task.decision.steps.length ? 'ready' : state.task.decision.completionRestore ? 'completed' : 'locked';
          state.job = null;
        });
        return { verified: true, effort: live.effort };
      }
      if (Date.now() >= deadline) throw new Error('No fresh-turn confirmation; send outcome remains uncertain');
      await sleep(250);
    }
  } catch (error) {
    store.change(file, state => {
      if (state.job?.id === id) { state.job.phase = 'failed'; state.job.error = error.message; state.task.phase = 'locked'; }
      return state;
    });
    return { verified: false, error: error.message };
  }
}
if (require.main === module) execute(process.argv[2], process.argv[3]).catch(() => { process.exitCode = 1; });
module.exports = { execute };
