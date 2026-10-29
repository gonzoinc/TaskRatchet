# Local desktop installation

This package targets manually installed plugins in the local Windows Codex desktop app. It requires Node.js on PATH and the app's exported `CODEX_APP_TOOLS_PIPE_PATH`. It does not support automatic switching in cloud-orchestrated Work or the standalone CLI. There are no credentials or API keys to configure.

Install from the published repository using your installed `codex` command in PowerShell:

```powershell
codex plugin marketplace add gonzoinc/TaskRatchet
codex plugin add taskratchet@taskratchet-local
```

The first command registers the GitHub-backed marketplace; the second installs its plugin. No local clone is required. `taskratchet-local` is the catalog's declared name, not a local-only installation restriction. Its display name is **TaskRatchet Local**.

After installation, restart the desktop app. Review and trust the plugin's hook definitions through the supported hook-review flow (`/hooks` is the CLI flow); installation alone does not trust hooks. Start a new desktop chat with the plugin enabled. Do not use a hook-trust bypass. In that chat, invoke `$taskratchet settings` to see and change the workspace's defaults. Hooks invoke the skill for subsequent work after trust is established.

The inspected CLI `0.165.0-alpha.1.2` supports both commands. [Official OpenAI guidance](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli) documents GitHub-backed marketplace registration. No minimum stable CLI version is asserted; if plugin commands are unavailable in your installed client, check current official guidance before proceeding. Valid installer commands do not establish this package's full installed-hook acceptance.

For local development or a ZIP, open PowerShell in the cloned or extracted package root and run:

```powershell
codex plugin marketplace add .
codex plugin add taskratchet@taskratchet-local
```

`.` must contain `.agents/plugins/marketplace.json`, not be the `.agents/plugins` directory. The catalog's `./` plugin path resolves from that repository or package root. Runtime settings and task state stay under the active workspace's `.codex/taskratchet/`; changing workspace changes that settings scope. This plugin does not install global AGENTS.md rules or change global model defaults.

Source validation uses `node --test tests/engine.test.cjs`. The original transport roundtrip was verified on desktop build 26.1023.6621.0 with CLI 0.165.0-alpha.1.2. Full installed-hook acceptance still needs a newly started chat with trusted hooks; do not infer that from passing simulated hook/controller tests.

Settings include a restoration exception: a return to the exact starting effort is preauthorized by default, even when ordinary increases require approval. Set `restoreNeedsApproval=true` if you want to approve that return too. The default is restoration after the agent explicitly marks the whole task complete, never after every turn.
