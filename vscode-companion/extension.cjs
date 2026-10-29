'use strict';
const vscode = require('vscode');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { PIPE, Client, Adapter } = require('./src/ipc.cjs');
const { validateHost } = require('./src/guard.cjs');
const { Controller, snapshot } = require('./src/controller.cjs');
const bridge = require('./src/bridge.cjs');
const { store } = require('./src/policy.cjs');
let active = null, queue = Promise.resolve(), polling = false;
function guard() {
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  validateHost({ platform: process.platform, trusted: vscode.workspace.isTrusted, version: extension?.packageJSON.version, active: extension?.isActive });
}
function stop() { if (active) { active.controller.stopped = true; active.client.close(); active = null; } }
function serial(fn) {
  const result = queue.then(fn); queue = result.catch(() => {}); return result;
}
function notify(result) {
  if (!result) return;
  const message = result.error ? `TaskRatchet stopped: ${result.error}` : `TaskRatchet: ${result.outcome}${result.target ? ` (${result.target}; send a short message in the selected Codex chat, then Verify saved effort)` : ''}`;
  if (result.error) void vscode.window.showErrorMessage(message); else void vscode.window.showInformationMessage(message);
}
async function probe() {
  stop(); guard();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('Open a local disposable workspace first');
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick(); if (!folder) return;
  if (folder.uri.scheme !== 'file') throw new Error('Local file workspace required');
  const chat = await vscode.window.showInputBox({ prompt: 'Disposable Codex chat ID from /status (this explicitly selects the only chat TaskRatchet may control)', validateInput: x => /^[a-zA-Z0-9_-]{1,100}$/.test(x) ? null : 'Use the complete chat ID' }); if (!chat) return;
  const files = await vscode.window.showOpenDialog({ canSelectMany: false, title: 'Select this disposable chat’s rollout JSONL (read-only)', filters: { Rollout: ['jsonl'] } }); if (!files?.length) return;
  const transcript = files[0].fsPath; snapshot(transcript, chat);
  const client = new Client(net.createConnection(PIPE));
  try {
    await client.initialize(); const adapter = new Adapter(client, chat); const live = await adapter.discover();
    const root = store.area(folder.uri.fsPath), file = store.threadFile(root, chat);
    const controller = new Controller({ file, transcript, chat, adapter, config: () => store.config(root) });
    await controller.live(); // Require an idle saved turn before enabling even the bridge.
    if (controller.state().job) throw new Error('Existing pending/failed job; inspect shared status before selecting this chat');
    const binding = bridge.bind(root, chat); active = { client, controller, root, binding };
    void vscode.window.showInformationMessage(`Read-only probe passed: ${live.model}, ${live.effort}. No effort changed. Agent bridge enabled for selected chat only.`);
  } catch (error) { client.close(); throw error; }
}
function current() { guard(); if (!active) throw new Error('Run the read-only disposable-chat probe first'); return active; }
async function approval() {
  const { controller } = current(), s = controller.state(), d = s.task?.decision;
  if (s.task?.phase !== 'awaiting-approval' || !d) throw new Error('No pending suggestion');
  const result = await vscode.window.showWarningMessage(`${d.reason}. Plan: ${d.steps.map(x => `${x.level}${x.restoration ? ' (baseline)' : ''}`).join(' → ') || 'hold'}. Approval ${d.token}`, { modal: true }, 'Approve effort', 'Keep effort');
  if (!result) return;
  // The captured token fails closed if another task/decision replaced it while the prompt was open.
  return notify(await controller.reply(d.token, result === 'Approve effort'));
}
function activate(context) {
  const commands = {
    probe,
    approve: approval,
    apply: async () => notify(await current().controller.dispatch()),
    verify: async () => notify(await current().controller.verify()),
    complete: async () => notify(await current().controller.submit({ op: 'complete' })),
    cancel: async () => { current().controller.cancel(); void vscode.window.showInformationMessage('TaskRatchet cancelled; an already accepted composer update may require manual restoration. No automatic retry.'); },
    status: async () => { const s = current().controller.state(); void vscode.window.showInformationMessage(`TaskRatchet: ${s.task?.objective || 'no task'}; ${s.task?.phase || 'idle'}; assessments ${s.task?.evaluationCount || 0}; ${s.job?.phase || 'no pending update'}`); },
    settings: async () => {
      const { root, controller } = current(); if (controller.state().job) throw new Error('Resolve pending switch before changing rules');
      const file = path.join(root, 'settings.json'); if (!fs.existsSync(file)) store.write(file, store.config(root));
      return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }
  };
  for (const [name, fn] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`taskratchet.${name}`, () => (name === 'cancel' ? Promise.resolve().then(fn) : serial(fn)).catch(error => vscode.window.showErrorMessage(`TaskRatchet stopped: ${error.message}`))));
  const timer = setInterval(() => {
    if (polling) return; polling = true;
    serial(async () => {
    if (!active) return;
    try {
      guard(); const result = await bridge.consume(active.root, active.binding, active.controller); if (result) notify(result);
      if (!result && active.controller.state().task?.phase === 'ready' && !active.controller.state().task.vscodeAwaitApply && !active.controller.state().job) {
        const applied = await active.controller.dispatch(); if (applied.outcome !== 'waiting-source-turn') notify(applied);
      }
    }
    catch (error) { stop(); await vscode.window.showErrorMessage(`TaskRatchet bridge stopped: ${error.message}. No retries; run Probe explicitly after resolving it.`); }
    }).finally(() => { polling = false; });
  }, 1000);
  context.subscriptions.push({ dispose() { clearInterval(timer); stop(); } });
}
function deactivate() { stop(); }
module.exports = { activate, deactivate };
