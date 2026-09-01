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
`.github\skills\feedback-recorder\SKILL.md`.

## Installing

```powershell
.\scripts\install-skill.ps1
```

This makes the skill available from every repository, so a review can be
recorded while standing in the repository of the app being reviewed. Restart
Copilot CLI afterwards to pick it up.

The installer **generates** the user-level skill from `SKILL.md` rather than
copying it, so this file stays the single source of truth. It rewrites every
repo-relative path to an absolute one, because an installed skill is invoked
from wherever the user is working. `review-recorder.ps1` anchors its config,
`.venv` and `runs\` to its own location, so it behaves identically from any
directory.

Each rewrite is asserted, and installation aborts without writing if `SKILL.md`
no longer contains what the installer expects — otherwise an edit here could
silently produce an installed skill whose paths resolve to nothing, and that
would only surface mid-review.

Re-run the installer after editing `SKILL.md`. To remove it:

```powershell
.\scripts\install-skill.ps1 -Uninstall
```
