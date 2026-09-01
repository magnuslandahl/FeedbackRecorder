# FeedbackRecorder

Local, cross-platform desktop app for recording a spoken screen walkthrough and
creating an agent brief that can be used by GitHub Copilot or another coding
agent. The app lives in `app\`; the repository also contains the original
Windows-only OBS and PowerShell prototype while it is being retired.

The legacy prototype supports:

1. Start and stop OBS recording through OBS WebSocket.
2. Provide a manual fallback mode when OBS WebSocket is missing or unavailable.
3. Find the latest video file when recording stops.
4. Create a timestamped output folder.
5. Extract keyframes with FFmpeg, for example one image every two seconds.
6. Transcribe audio locally with faster-whisper, with Swedish as a first-class language.
7. Create `agent-brief.md` with the video path, transcript, keyframes, and a ready-to-use coding-agent prompt.
8. Let a Copilot skill guide the flow and run the PowerShell CLI.

## Suggested user flow

```powershell
.\scripts\review-recorder.ps1 doctor
.\scripts\review-recorder.ps1 init
.\scripts\review-recorder.ps1 miccheck   # confirm narration is actually captured
.\scripts\review-recorder.ps1 windows    # list what OBS can record
.\scripts\review-recorder.ps1 start -Window "My App"
# the user performs the app review
.\scripts\review-recorder.ps1 stop
.\scripts\review-recorder.ps1 analyze
```

`analyze` will be an optional step that uses GitHub Copilot CLI locally, for example with GPT-5.5, to improve the agent brief. Media handling, keyframes, and transcription should run locally.

## Initial development baseline

Initial CPU-first development target, recorded on 2026-08-24:

| Area | Status |
| --- | --- |
| OS | Windows 11 Enterprise |
| CPU | AMD Ryzen AI 9 HX PRO 370, 12 cores / 24 threads |
| RAM | About 60 GB |
| GPU | AMD Radeon 890M, 4 GB |
| NVIDIA/CUDA | Missing |
| Python | 3.14.3 is installed, but ML packages should run on Python 3.11/3.12 |
| Node/npm | Installed |
| GitHub Copilot CLI | Installed, `1.0.80` |
| OBS | Missing |
| FFmpeg/ffprobe | Missing |
| faster-whisper/torch | Missing |

Practical conclusion: build CPU-first. Use `faster-whisper` with `small` or `base`, `compute_type=int8`, and make GPU support optional later.

## Repository status

**FeedbackRecorder** is the primary project. The cross-platform app in `app\`
implements the design in `docs\APP_DESIGN.md`, drops OBS, and packages the
recording and transcription pipeline in one application. The older CLI remains
available temporarily for users who still depend on the OBS workflow.

`scripts\review-recorder.ps1` provides `doctor`, `miccheck`, `init`, `start`,
`stop`, `brief`, and `analyze`, with a manual
fallback when OBS WebSocket is unavailable and fail-soft behavior when FFmpeg or
Whisper are missing. Local transcription runs through
`scripts\transcribe-whisper.py` (faster-whisper), and a guiding Copilot skill
lives in `skill\SKILL.md`.

Beyond the toolchain, `doctor` also inspects what OBS would actually record:
that the current scene has enabled sources, that a rendered frame is not blank,
and that an unmuted audio input exists. `miccheck` samples live audio levels so
a silent microphone is caught before recording instead of after. `stop` waits for
OBS to finish writing the file and then closes it, so the pipeline never reads a
video OBS still holds open and nobody has to click a confirmation dialog.

Main parts:

```text
app/                        # FeedbackRecorder: the cross-platform replacement
  src/main/                 # Electron main process
  src/renderer/             # UI
  src/shared/               # code used by both

scripts/
  review-recorder.ps1       # CLI core (doctor, miccheck, windows, init, start, stop, brief, analyze)
  transcribe-whisper.py     # local transcription through faster-whisper
  install-skill.ps1         # install the Copilot skill for the current user
  run-tests.ps1             # unit tests for the pure helpers

skill/
  SKILL.md                  # Copilot skill that guides and runs the CLI
  examples/
    app-review-agent-prompt.md

docs/
  PLAN.md
  REQUIREMENTS.md
  SKILL_DESIGN.md
  DECISIONS.md
  APP_DESIGN.md             # FeedbackRecorder: the design the app in app/ follows
```

Run `.\scripts\review-recorder.ps1 doctor` to check prerequisites, then `init`
to create `config.local.json`.

## Installing the skill

```powershell
.\scripts\install-skill.ps1
```

This installs the skill for the current user and makes it available from every
repository, which is the point: you record a review while standing in the
repository of the app you are reviewing, not in this one. Restart Copilot CLI
afterwards, then ask it to record an app review.

The skill is generated from `skill\SKILL.md` with all paths made absolute, so
that file remains the single source of truth. Re-run the installer after
editing it. See `skill\README.md`.

Run `.\scripts\run-tests.ps1` to exercise the helper functions. The CLI must
keep working on both Windows PowerShell 5.1 and PowerShell 7, so run it on
both before committing changes to `review-recorder.ps1`.
