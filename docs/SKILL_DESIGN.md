# Skill design

The skill should be a thin guidance layer on top of the local PowerShell CLI.

It should not duplicate heavy logic. The CLI must be runnable manually without the skill.

## Skill responsibilities

1. Explain the flow to the user.
2. Run `doctor` and interpret the result.
3. Help the user fix missing prerequisites.
4. Run `init` the first time.
5. Start recording with `start`.
6. Instruct the user to perform the app review.
7. Stop recording with `stop`.
8. Show where `agent-brief.md` was created.
9. Run `analyze` through Copilot CLI when needed.

## Suggested skill triggers

Example phrases:

- "start app-review recorder"
- "record an app review"
- "create an agent brief from a review"
- "run the OBS review skill"
- "record app review"

## Suggested skill structure

```text
skill\
  SKILL.md
  examples\
    app-review-agent-prompt.md
```

When the skill is later moved to the Copilot skills format, the corresponding structure can become:

```text
.github\
  skills\
    obs-review-recorder\
      SKILL.md
```

## Important design principle

The skill should always be able to continue even when automation fails:

- If OBS WebSocket is missing: use manual mode.
- If FFmpeg is missing: create a brief without keyframes and clearly mark what is missing.
- If Whisper fails: create a transcript placeholder and continue.
- If Copilot CLI fails: keep the original brief and show the failure reason.
