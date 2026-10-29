# Settings

Settings belong to the workspace: `.codex/taskratchet/settings.json`. Defaults ship in `settings.default.json`. Settings are editable through this skill in the existing chat, or with JSON stdin to the plugin's `configure` command. No extra UI, API key, classifier model call, or background service is required.

| Setting | Choices | Default |
| --- | --- | --- |
| enabled | true / false | true |
| mode | auto / suggest | auto |
| automaticDirection | lower-only / higher-only / both / none | lower-only |
| increasePolicy | allow / ask / block | ask |
| decreasePolicy | allow / ask / block | allow |
| restoreBaseline | new-task / completion / never | completion |
| restoreNeedsApproval | true / false | false |
| minEffort / maxEffort | allowed levels | low / max |
| allowedEfforts | model-supported levels the agent may select | low, medium, high, xhigh, max |
| waitTimeoutSeconds | 30–1800 | 900 |
| assessmentRules | short task-rating guidance, up to 4000 characters | supplied risk/difficulty rubric |

`automaticDirection` limits automatic changes, not explicit human approval. An increase with policy `ask` requires approval even in Auto. Policy `block` prohibits that direction even after ordinary approval. Suggest mode requests approval for any recommended change. Returning to the exact starting effort is a separate, preauthorized exception when `restoreNeedsApproval=false`.

Examples of requested JSON patches:

```json
{"mode":"suggest"}
```
```json
{"mode":"auto","automaticDirection":"lower-only","increasePolicy":"ask","restoreBaseline":"completion"}
```
```json
{"mode":"auto","automaticDirection":"both","increasePolicy":"allow","decreasePolicy":"allow"}
```

The task lock survives all related follow-ups, including a declined suggestion. Switching mode mid-task doesn't trigger a new assessment. Settings changes invalidate unsent switches; they never silently rewrite a pending decision. Explicit manual picker changes take precedence. Keep `allowedEfforts` compatible with the selected model. The app rejects unavailable levels; the plugin reports that failure without choosing another model.

Changing to unrelated work also leaves the old task. When restoration is enabled, that boundary returns to the old starting effort before applying the new task decision, even if the previous task was abandoned rather than marked complete. This prevents the starting effort from drifting downward across tasks.
