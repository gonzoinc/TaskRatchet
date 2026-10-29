# TaskRatchet VS Code companion prototype

An experimental adapter for the **existing Codex chat UI**, with Auto/Suggest policies and task locking from TaskRatchet's unchanged shared engine. Windows-local VS Code extension host only; exact Codex extension **26.1021.22027** required. This uses private IPC, not a supported OpenAI extension API. Live acceptance is pending.

The agent submits one assessment through a local file bridge; permitted decreases apply automatically after that exact source turn finishes. Suggestions/increases requiring approval wait for a native VS Code Approve/Keep action. Related prompts hold the task effort; task completion restores its baseline unless rules/explicit manual choice/declined restoration prevent it. Native commands are controls only, with no extra chat UI. See [agent instructions](AGENT-BRIDGE.md).

## Build and automated checks

From the maintained `vscode-companion` directory:

```powershell
node scripts/build.cjs ..
node --test tests/prototype.test.cjs
```

Build packages `../lib/engine.cjs`, `../lib/storage.cjs`, `../settings.default.json` unchanged and records their hashes inside the VSIX at `extension/shared/source-hashes.json`. Development uses those same repository sources directly. Output: `../dist/taskratchet-companion-0.0.1.vsix`. No external dependencies or global installs; no generated policy copies are maintained in source.

## User-led live test

1. Manually install the VSIX through VS Code's **Extensions: Install from VSIX**, or launch an Extension Development Host for this directory. Open a disposable local workspace and an existing disposable Codex chat; submit a harmless message and wait for completion.
2. Run `/status` in that chat to obtain its ID. Locate its saved rollout JSONL in your Codex sessions directory. Run **TaskRatchet: Probe disposable chat (read only)**; enter that ID and select that exact rollout. Probe matches the session ID and reads owner/settings; it does not change effort. Stop and report any permission/version/discovery error.
3. Only after Probe passes, give that Codex agent `AGENT-BRIDGE.md` and ask it to submit one bounded decrease using the request command, or run the documented request yourself. The agent finishes its turn. On `awaiting-saved-turn`, observe the normal composer, send a harmless message in that same chat, then run **TaskRatchet: Verify saved effort**. A UI-only fallback fails verification.
4. Check Status stays at one assessment through two related follow-ups. Test Suggest mode (Edit shared rules), Keep, approval, then completion/restoration with the same saved-turn verification. Mark a genuinely unrelated task explicitly; only that permits a fresh assessment. Do not type another prompt during the short apply operation.

**Cancel pending switch** stops further dispatch and never retries an uncertain update. An update already accepted by Codex may still affect the composer; inspect it and restore manually if needed. Settings use the same workspace `.codex/taskratchet/settings.json`, state uses the same per-chat records. Do not run the desktop switch worker against this selected chat at the same time. On restart, unresolved jobs block Probe: inspect and resolve them deliberately rather than silently replaying.

Mocks establish protocol/policy behavior only. No live pipe, VS Code launch, extension installation or existing-chat mutation is performed by the automated tests. Private IPC can change without notice. WSL/remote hosts, actual installed-icon behavior and automatic task-boundary detection are outside this prototype's live acceptance. The bridge requires the agent to follow the supplied assessment instructions; it is not a per-prompt model classifier.
