# Local desktop installation

This package targets manually installed plugins in the local Windows Codex desktop app. It requires Node.js on PATH and the app's exported `CODEX_APP_TOOLS_PIPE_PATH`. It does not support automatic switching in cloud-orchestrated Work or the standalone CLI. There are no credentials or API keys to configure.

The source folder is also a local marketplace. To install it manually, run these commands from the cloned repository root in PowerShell (use your installed `codex` command):

```powershell
codex plugin marketplace add .
codex plugin add taskratchet@taskratchet-local
```

Review and trust the plugin's hook definitions through the supported hook-review flow (`/hooks` in Codex CLI); installation alone does not trust hooks. Start a new desktop chat after installation. Do not use a hook-trust bypass. In that chat, invoke `$taskratchet settings` to see and change the workspace's defaults. Hooks invoke the skill for subsequent work after trust is established.

If installing the ZIP elsewhere, extract it, then add that extracted marketplace folder instead. Runtime settings and task state stay under the active workspace's `.codex/taskratchet/`; changing workspace changes that settings scope. This plugin does not install global AGENTS.md rules or change global model defaults.

Source validation uses `node --test tests/engine.test.cjs`. The original transport roundtrip was verified on desktop build 26.1023.6621.0 with CLI 0.165.0-alpha.1.2. Full installed-hook acceptance still needs a newly started chat with trusted hooks; do not infer that from passing simulated hook/controller tests.

Settings include a restoration exception: a return to the exact starting effort is preauthorized by default, even when ordinary increases require approval. Set `restoreNeedsApproval=true` if you want to approve that return too. The default is restoration after the agent explicitly marks the whole task complete, never after every turn.
