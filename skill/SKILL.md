---
name: obs-review-recorder
description: Record an app review with OBS and turn it into a coding-agent brief. Guides the user through the local PowerShell CLI (scripts/review-recorder.ps1) to check prerequisites, start/stop an OBS recording (with a manual fallback), extract keyframes, transcribe audio locally with faster-whisper (Swedish-first), and produce agent-brief.md. Use this when asked to "record an app review", "start app-review recorder", "create an agent brief from a review", "run the OBS review skill", or "record app review".
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

## Step 3: Start recording

```powershell
.\scripts\review-recorder.ps1 start
```

- If OBS WebSocket connects, recording starts automatically.
- If it cannot connect, the CLI falls back to manual mode and tells the user to
  press record in OBS themselves. You can force this with `start -Manual`.

Then tell the user clearly: **perform the app review now**, and run `stop` when done.

## Step 4: Stop and build the brief

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

## Step 5 (optional): Improve the brief with Copilot

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
