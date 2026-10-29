<p align="center">
  <img src="./assets/TaskRatchet_ Ratchet Canyon Progression.png" width="100%" alt="TaskRatchet canyon illustration: an effort dial stays locked while a sequence of tasks moves forward">
</p>

# TaskRatchet

**Choose effort for the task. Keep it through the follow-ups.**

TaskRatchet is a Codex plugin for automatic or suggested reasoning-effort changes. It assesses the whole task once, saves the decision, and keeps it through corrections, debugging, approvals, and tests.

[Get started](#get-started) · [Settings](skills/taskratchet/references/settings.md) · [Compatibility](#compatibility)

## One task, one decision

For a checkout investigation, the conversation can change without becoming a new task:

| You say | TaskRatchet does |
| --- | --- |
| “Investigate why checkout fails.” | Understand the outcome and assess effort once. |
| “It only happens with PayPal.” | Keep the saved decision. |
| “Go ahead and fix it.” | Keep the saved decision. |
| “That failed; here’s the error.” | Keep the saved decision. |
| “Now review a different project.” | Recognize unrelated work and allow a new assessment. |

Task boundaries are agent judgments. The controller persists the resulting task record so a new prompt, a completed turn, or conversation compaction does not itself trigger another effort assessment.

## Two modes. Your rules.

| Mode | When a different effort is recommended |
| --- | --- |
| **Auto** | Apply changes permitted by your rules. Ask when a rule requires approval. |
| **Suggest** | Offer the change once and wait for your choice. Declining holds the current effort for that task. |

The defaults are:

- **Auto mode**, with automatic decreases only.
- **Approval for increases**, rather than treating an ordinary “yes” as effort approval.
- **Restore the starting effort when the whole task is complete.** Ending a turn is not completion.

Returning to the exact starting effort is preauthorized by default. Set `restoreNeedsApproval` if you also want to approve that return.

After installation, ask `$taskratchet settings` in the existing chat to configure mode, direction, approval rules, restoration, effort bounds, and the assessment rubric. Settings and task records are workspace-scoped under `.codex/taskratchet/`. See the [settings reference](skills/taskratchet/references/settings.md).

## Get started

This early version targets the **local Windows Codex desktop app** and requires Node.js on PATH. It needs no separate UI or API key.

Clone the repository, then register its local marketplace from PowerShell:

```powershell
git clone https://github.com/gonzoinc/TaskRatchet.git
Set-Location ./TaskRatchet
codex plugin marketplace add .
```

If you already cloned or extracted TaskRatchet, open PowerShell in that folder and run only the marketplace command. This registers the catalog; install the plugin in the desktop app.

Restart the desktop app. Open the **Plugins Directory**, select **TaskRatchet Local**, and install **TaskRatchet**. Review and trust its hook definitions through the supported hook-review flow, then start a new desktop chat with the plugin enabled. Installation alone does not trust hooks. In that chat, begin with:

```text
$taskratchet settings
```

See [installation details](skills/taskratchet/references/installation.md) for requirements and compatibility limits.

## What happens during a switch

<p align="center">
  <img src="./assets/TaskRatchet Gear and Progress Emblem.png" width="440" alt="TaskRatchet gear, effort dial, and padlock emblem representing a saved task decision">
</p>

TaskRatchet finishes the brief assessment turn, then sends a visible continuation to the same chat at the chosen effort. It verifies that fresh turn’s setting before the agent continues the original task. Related follow-ups reuse the saved decision; a declined suggestion is not offered again.

Manual effort choices take precedence. An uncertain send is reported rather than retried automatically, and the plugin does not change your model or global app defaults.

## Compatibility

| Surface | Current boundary |
| --- | --- |
| **Windows Codex desktop** | Message-based effort switching verified. Full installed-hook acceptance is still pending. |
| **Codex in VS Code** | Investigation only; automatic switching is not supported by this package yet. |
| **Standalone CLI / cloud-orchestrated Work** | Automatic switching unsupported. |

The desktop connection and transcript format are version-sensitive. Missing or untrusted hooks do not establish automatic task locking.

## Validation

Run the maintained behavior suite from the repository root:

```powershell
node --test tests/engine.test.cjs
```

The maintained suite has **20 behavior tests** covering task locking, approval tokens, restoration, cancellation, and single-send behavior.

The desktop transport was separately verified by starting a High-effort turn and restoring Medium in the same chat on desktop build `26.1023.6621.0` / CLI `0.165.0-alpha.1.2`. Full installed-hook acceptance still requires a new chat with trusted hooks; these checks are not a usage benchmark.

## License

Licensed under the [MIT License](LICENSE).
