# Skill

The Copilot skill lives here. It guides the user and runs the PowerShell CLI.

- `SKILL.md` — the skill definition (thin guidance over `scripts\review-recorder.ps1`).
- `examples\app-review-agent-prompt.md` — a standalone coding-agent prompt for a run.

The skill is thin by design:

- It does not implement OBS, FFmpeg, or Whisper logic itself.
- It runs scripts from `scripts\`.
- It interprets error messages and helps the user move forward.
- It supports a guided app-review flow with fail-soft fallbacks.

When moved to the Copilot skills format, this can become
`.github\skills\obs-review-recorder\SKILL.md`.
