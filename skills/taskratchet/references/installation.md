# Local desktop installation

This package targets manually installed plugins in the local Windows Codex desktop app. It requires Node.js on PATH and the app's exported `CODEX_APP_TOOLS_PIPE_PATH`. It does not support automatic switching in cloud-orchestrated Work or the standalone CLI. There are no credentials or API keys to configure.

The source folder is also a local marketplace. Clone it, then register the catalog from PowerShell with your installed `codex` command:

```powershell
git clone https://github.com/gonzoinc/TaskRatchet.git
Set-Location ./TaskRatchet
codex plugin marketplace add .
```

If you already cloned or extracted TaskRatchet, open PowerShell in that folder and run only the marketplace command. `.` must be the repository or extracted package root containing `.agents/plugins/marketplace.json`, not the `.agents/plugins` directory. The catalog is `taskratchet-local`, its displayed name is **TaskRatchet Local**, and its `./` plugin path resolves from the repository root.

Restart the desktop app. Open the **Plugins Directory**, select **TaskRatchet Local**, and install **TaskRatchet**. Review and trust the plugin's hook definitions through the supported hook-review flow (`/hooks` is the CLI flow); installation alone does not trust hooks. Start a new desktop chat with the plugin enabled. Do not use a hook-trust bypass. In that chat, invoke `$taskratchet settings` to see and change the workspace's defaults. Hooks invoke the skill for subsequent work after trust is established.

This separates CLI catalog setup from desktop installation, following [official OpenAI guidance](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli). The inspected CLI `0.165.0-alpha.1.2` also exposes `codex plugin add taskratchet@taskratchet-local`, but that command has not established this package's desktop installed-hook acceptance. No minimum stable CLI version is asserted; if marketplace commands are unavailable in your installed client, check current official guidance before proceeding.

If installing the ZIP elsewhere, extract it, then add that extracted marketplace folder instead. Runtime settings and task state stay under the active workspace's `.codex/taskratchet/`; changing workspace changes that settings scope. This plugin does not install global AGENTS.md rules or change global model defaults.

Source validation uses `node --test tests/engine.test.cjs`. The original transport roundtrip was verified on desktop build 26.1023.6621.0 with CLI 0.165.0-alpha.1.2. Full installed-hook acceptance still needs a newly started chat with trusted hooks; do not infer that from passing simulated hook/controller tests.

Settings include a restoration exception: a return to the exact starting effort is preauthorized by default, even when ordinary increases require approval. Set `restoreNeedsApproval=true` if you want to approve that return too. The default is restoration after the agent explicitly marks the whole task complete, never after every turn.
