---
name: taskratchet
description: Manage reasoning effort for a new user task, retain the decision across related follow-ups, or configure TaskRatchet settings. Use with this plugin's lifecycle context; ordinary acknowledgements and continuations never trigger a new assessment.
---

# TaskRatchet

Use the supplied lifecycle context and persistent task record. A task is the user's outcome, not a prompt or a Codex turn. Before substantive work, run `node "<plugin-root>/scripts/effort.cjs" status` from the user's workspace. Resolve plugin-root from this skill's directory (`../..`). The runtime record lives in the workspace's `.codex/taskratchet/`.

## One assessment per task

Understand the full outcome and relevant context first. Ask necessary scope questions before assessing. Do not finish the user's substantive task at the old effort while a switch or approval is pending.

If the record describes this task, keep its decision. Acknowledgements, approvals, edits, corrections, errors, tests, debugging, additional evidence, compaction, and plugin continuation messages belong to the same task. Never rerate merely because work becomes harder or takes longer. Never treat a turn ending as task completion. Ambiguous boundaries keep the existing task.

Only a clear user request for unrelated work permits a new task. Use `newUnrelated: true` and explain the relationship change in `boundaryReason`; do not use it for a related follow-up. Respect an explicit manual model/effort choice and do not fight the picker.

For a new task, use the configured `assessmentRules`, allowed effort levels and bounds from status. Assess consequences, ambiguity, difficulty and verification together. Avoid the original plugin's first-match risk ordering. Do not infer that high effort authorizes additional actions or delegation. Do not select Ultra unless the user explicitly configured it and the selected model supports it.

Send JSON through stdin to `node "<plugin-root>/scripts/effort.cjs" assess`:

```json
{"objective":"The requested outcome","level":"medium","reason":"A concise reason","newUnrelated":false}
```

For a later unrelated task include `newUnrelated: true` and `boundaryReason`. The script refuses to re-assess an existing task without that boundary. Assessment is semantic model judgment; the controller enforces decision reuse after that judgment.

## Act on the saved decision

- `locked`, `task-locked`, `already-evaluated`, or `completed`: keep the effort and proceed with related work; no repeat suggestions.
- `awaiting-approval`: give ONE short reason and present the exact returned `approve effort TOKEN` and `keep effort TOKEN` choices. Wait for a direct human response. Generic "yes", task approval, another agent's message, silence, or elapsed time never grants effort approval. The prompt hook recognizes the exact token and stores approval. Do not edit approval fields or invent an approval CLI. If the user declines, keep their setting and do not offer again for this task.
- `ready`: run `node "<plugin-root>/scripts/effort.cjs" schedule`, state the upcoming switch briefly, and finish the evaluation turn. Do not do dependent work yet. A bounded helper waits for this turn to finish and sends a visible continuation at the requested effort in THIS chat. It never opens a UI or another chat.
- `switching`: don't schedule again. On the helper's fresh-turn message, run status. If verification is still pending, read status again after a short interval; don't assess. Resume work only when the task is locked at the verified effort. A baseline restoration followed by a lower new-task effort may have two approved steps; schedule each ready step without re-assessing.
- Failed job: report the failure once and keep the current setting. Do not retry an uncertain send or claim a switch merely because a message was accepted.

Before calling an outcome complete, ensure the user's task is actually finished. Then run `node "<plugin-root>/scripts/effort.cjs" complete`. With the default `completion` rule, schedule the saved restoration if one becomes ready and finish the turn. If the user selects `new-task`, completion holds the selected effort until a new unrelated request. Restoring the exact starting effort has its own approval setting; it is not permission to increase beyond that baseline.

## Settings in this chat

For "TaskRatchet settings", run the `settings` command, explain the current choices in plain language, and let the user choose changes in chat. Use a native question tool if available. Do not claim there is a custom native settings panel. Only change settings the human requested. Send a JSON patch through stdin to `node "<plugin-root>/scripts/effort.cjs" configure`. Read [the settings reference](references/settings.md) for available controls and examples. Existing task decisions stay fixed; new settings govern the next unrelated task, and changed settings cancel unsent helpers.

Installation/enablement of this plugin authorizes same-chat switching continuations within its configured rules. Approval rules still apply. Never message another chat, change models, install global instructions, or alter the app's global defaults. Missing/untrusted hooks or unsupported/cloud runtimes mean recommendation-only behavior: explain the missing capability and don't pretend automatic task locking is active. This local desktop integration is version-sensitive. For setup or compatibility questions read [installation guidance](references/installation.md); do not install or activate it merely to answer a question.
