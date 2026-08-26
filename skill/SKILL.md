---
name: obs-review-recorder
description: Record an app review with OBS and turn it into a coding-agent brief. Guides the user through the local PowerShell CLI (scripts/review-recorder.ps1) to check prerequisites, launch OBS, pick which window to record, start/stop the recording (with a manual fallback), extract keyframes, transcribe audio locally with faster-whisper (Swedish-first), and produce agent-brief.md. Use this when asked to "record an app review", "start app-review recorder", "create an agent brief from a review", "run the OBS review skill", or "record app review".
---

# OBS Review Recorder

Guide the user through recording an application review and producing an
`agent-brief.md` that another coding agent can act on. This skill is a **thin
layer** over the local PowerShell CLI at `scripts/review-recorder.ps1`. Do not
reimplement OBS, FFmpeg, or Whisper logic — run the CLI and interpret its output.

All commands run from the repository root on Windows PowerShell.

## Design principle: always keep going

Every step is fail-soft. If automation fails, fall back and continue:

- OBS WebSocket missing → use manual mode (`start -Manual`).
- OBS not running → `start` and `windows` launch it automatically.
- FFmpeg missing → the brief is still created, without keyframes/transcript.
- Whisper fails → the brief notes the failure and continues.
- Copilot CLI fails → the original brief is preserved.

Never stop the whole flow because one optional tool is unavailable.

## Step 1: Check prerequisites

```powershell
.\scripts\review-recorder.ps1 doctor
```

Read the output. For each item marked `[MISS]` or `[WARN]`, offer the exact
`fix:` command shown. Required for full functionality: FFmpeg + ffprobe (media),
and the Whisper venv (transcription). OBS is required to actually record;
without OBS WebSocket, manual mode still works.

When OBS is running, `doctor` also reports whether OBS would capture anything
useful: `OBS scene sources`, `OBS video output`, and `OBS audio inputs`. If any
of those are `[MISS]`, the recording would be a black screen or silent audio —
resolve them before starting, otherwise the review has to be redone.

Common fixes:

```powershell
winget install OBSProject.OBSStudio
winget install Gyan.FFmpeg
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip faster-whisper
```

## Step 2: First-time setup

If `config.local.json` does not exist, run:

```powershell
.\scripts\review-recorder.ps1 init
```

Then help the user edit `config.local.json`:

- `obs.recordingDirectory` — where OBS writes recordings.
- `obs.password` — the OBS WebSocket password (Tools → WebSocket Server Settings).
- `transcription.model` / `transcription.language` — default `small` / `sv`.

## Step 3: Choose what to record

Never start a recording without knowing what OBS is pointed at. OBS keeps
whatever source was selected last, so recording "the app" easily captures the
previous window instead — and that is only discovered after the review is over,
when it has to be redone.

```powershell
.\scripts\review-recorder.ps1 windows -Json
```

This starts OBS if it is not running and returns the capturable windows plus an
`active` field describing what OBS would record right now. **Ask the user which
window to record**, listing the titles from the output. If they want the whole
screen instead, use `-Display`.

If the command reports that OBS is waiting on a dialog (for example
`OBS Studio Crash Detected`), tell the user to click through it and run again —
OBS does not start its WebSocket server until that dialog is answered.

## Step 4: Start recording

Before a first review on a new machine, confirm the microphone actually reaches
OBS. A muted or disconnected mic otherwise only shows up as an empty transcript
after the review is already over:

```powershell
.\scripts\review-recorder.ps1 miccheck
```

Ask the user to speak during the sample. `speech-level signal` means narration
will be captured; `digital silence` on a microphone means it must be fixed in
OBS → Settings → Audio first.

```powershell
.\scripts\review-recorder.ps1 start -Window "<title the user picked>"
.\scripts\review-recorder.ps1 start -Display          # whole screen
```

- `start` launches OBS itself when it is not running.
- The CLI echoes what it will record. Repeat that back to the user before they
  begin.
- Exit code 2 means the pattern matched no window, or several. The CLI lists the
  candidates and records nothing — ask the user which one they meant and retry.
- If OBS cannot be reached at all, the CLI falls back to manual mode and asks the
  user to press record themselves. You can force this with `start -Manual`.

Then tell the user clearly: **perform the app review now**, and run `stop` when done.

## Step 5: Stop and build the brief

```powershell
.\scripts\review-recorder.ps1 stop
```

This stops the recording, finds the latest video, creates a timestamped folder
under `runs\`, extracts keyframes, extracts audio, transcribes it, and writes
`agent-brief.md` plus `run.json`.

Report back to the user:

- The run folder path.
- Which pipeline steps succeeded/were skipped (from the CLI output or `run.json`).
- The path to `agent-brief.md`.

If a step was skipped, explain why and how to enable it (usually a missing tool).

## Step 6 (optional): Improve the brief with Copilot

Only if the user wants a sharper brief and Copilot CLI is available:

```powershell
.\scripts\review-recorder.ps1 analyze
```

This rewrites `agent-brief.md` (keeping the original as `agent-brief.raw.md`).
If it fails, the original brief is preserved — say so and move on.

## Regenerating a brief

To rebuild `agent-brief.md` from an existing run without re-recording:

```powershell
.\scripts\review-recorder.ps1 brief            # latest run
.\scripts\review-recorder.ps1 brief runs\<id>  # a specific run
```

## Handing off to a coding agent

The `## Coding-agent prompt` section of `agent-brief.md` is ready to paste into
GitHub Copilot or another agent. See `skill/examples/app-review-agent-prompt.md`
for a standalone version of that prompt.

## Notes

- The CLI is fully runnable without this skill; the skill only guides the flow.
- Media handling and transcription run locally. Only `analyze` uses Copilot CLI.
- Swedish is a first-class transcription language (`language = sv`).
