---
name: feedback-recorder
description: Use FeedbackRecorder's legacy OBS workflow to record a spoken, on-screen walkthrough, transcribe it locally, and hand the result back to the agent that asked for it. Use this whenever the user wants to show something on screen instead of typing it out - "let me record a review for you", "I want to do a visual review", "let me show you the bug", "can I just show you in the app", "record my screen", "jag vill spela in en review till dig", "nu gör vi en visuell review", "kan jag visa dig i appen i stället" - and for the individual steps - "start the review recorder", "stop the recording", "create an agent brief from a review", "regenerate the brief". Also covers plain screen recordings with no review intent. Drives the local PowerShell CLI (scripts/review-recorder.ps1): prerequisite checks, window selection, start/stop, keyframe extraction, faster-whisper transcription (Swedish-first), and agent-brief.md.
---

# FeedbackRecorder legacy OBS workflow

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

## First: who is the recording for?

Two different requests arrive through this skill, and they end differently.
Decide which one this is before recording, because it changes what happens after
`stop`.

**A review for you.** The user says something like "let me record a review for
you", "I want to do a visual review", or "jag vill spela in en review till dig".
They are not asking for a video file — they are giving you work, using their
screen and their voice instead of typing it out. Finish with the handover in
Step 7.

**A recording.** The user wants the video, keyframes or transcript for their own
use — a demo, a bug report to send on, documentation. Finish by reporting the
paths and stop there.

When it is genuinely ambiguous, ask once. Everything up to `stop` is identical
either way, so the question can also wait until the recording is done.

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

If the user wants only part of the screen — one panel, or everything except the
chat windows they have open — the CLI cannot set that up, but OBS can: a display
capture with a **Crop/Pad** filter records a fixed rectangle. Point them at
"Recording a rectangle instead of a whole window" in `scripts/README.md`, and
record with `start -Display` afterwards, since the crop lives on the display
source.

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

This stops the recording, waits for OBS to finish writing the file, closes OBS,
finds the video, creates a timestamped folder under `runs\`, extracts keyframes,
extracts audio, transcribes it, and writes `agent-brief.md` plus `run.json`.

OBS is closed on purpose: it holds the recording open while it runs, and it is
not needed for the rest of the pipeline. Pass `-KeepObsOpen` to leave it running
when the user is about to record again.

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

## Step 7: Hand the result back

Only when the recording was **a review for you** (see the top of this skill).

Do not end with a file path. The user spoke their intent instead of typing it,
so `agent-brief.md` *is* their message to you. Read it:

```powershell
Get-Content "<run folder>\agent-brief.md" -Raw
```

Then answer as if they had written it:

1. Say back, in the user's own language, what you understood them to be asking
   for — as concrete changes, not as a retelling of the video.
2. Separate what the transcript actually says from what you inferred from the
   keyframes, so a misheard word is visible before it turns into a wrong change.
3. Name the files or areas you would touch, and carry on with the work.

If the transcript is empty, say so plainly and work from the keyframes alone
rather than filling the gap with guesses. An empty transcript usually means the
microphone was muted — `miccheck` before the next recording.

The `## Coding-agent prompt` section of `agent-brief.md` is a ready-made version
of this handover, for pasting into a different agent. See
`skill/examples/app-review-agent-prompt.md` for a standalone copy.

## Regenerating a brief

To rebuild `agent-brief.md` from an existing run without re-recording:

```powershell
.\scripts\review-recorder.ps1 brief            # latest run
.\scripts\review-recorder.ps1 brief runs\<id>  # a specific run
```

## Notes

- The CLI is fully runnable without this skill; the skill only guides the flow.
- Media handling and transcription run locally. Only `analyze` uses Copilot CLI.
- Swedish is a first-class transcription language (`language = sv`).
