# TaskRatchet VS Code agent bridge (prototype)

Use only after the user has selected a disposable chat and passed the companion's read-only probe. It is a private API experiment, Windows local only, pinned to Codex 26.1021.22027. The user stays in the existing Codex chat. No model change is requested.

Evaluate the entire requested outcome once, before work. Read the workspace's `.codex/taskratchet/settings.json` assessmentRules (defaults in repository `../settings.default.json`, or installed `shared/settings.default.json`), then choose a recommended effort and give a short reason. Submit through the command below. Never reassess acknowledgements, corrections, questions or related follow-ups. Ask for a new unrelated boundary only when the user really requested a different outcome. Do not invent approval. Human approval is exclusively the companion's native Approve/Keep command; the request bridge has no approval operation.

From the installed extension directory (or this prototype source directory), run:

```powershell
node scripts/request.cjs 'C:/path/to/disposable-workspace' '{"op":"begin","objective":"Describe the complete requested outcome","level":"medium","reason":"One full assessment of complexity and risk"}'
```

Read `.codex/taskratchet/vscode-response.json` in that workspace for the matching sequence. `waiting-source-turn` means the one assessment was recorded and will apply after this exact turn finishes; end this turn without continuing the main work. `awaiting-saved-turn` means a conditional next-turn setting was accepted, not verified. The user sends the next bounded prompt in this same chat and invokes **Verify saved effort**. Never report a verified switch before that command confirms it. Do not submit another request until the response exists. No automatic new-message injection is implemented.

For related prompts use `{"op":"related"}` only if status is needed; generally continue work without bridge traffic. For a genuinely unrelated user outcome submit a fresh begin with `"newUnrelated":true,"boundaryReason":"Why this is a distinct user outcome"`. For true task completion submit `{"op":"complete"}`; default rules restore the original baseline. Suggestions or rule-required increases wait for one native human approval. A denied restoration stays denied for that task.

If the user changes effort/model manually, preserve that choice. On failures/cancellation do not retry or clear the job; inspect status with the user. A conditional update does not atomically assert chat-idle status: do not type or submit another prompt while a switch is being applied. Saved-turn verification detects unsupported backend fallback. Multi-step transitions require **Apply next approved step** after the verification turn has finished. No post-prompt classifier or hook is installed.
