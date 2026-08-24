# OBSReviewRecorder

Local Windows tool for recording an app review with OBS and creating an agent brief that can be used by GitHub Copilot or another coding agent.

The goal is a minimal working version first:

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
.\scripts\review-recorder.ps1 start
# the user performs the app review
.\scripts\review-recorder.ps1 stop
.\scripts\review-recorder.ps1 analyze
```

`analyze` will be an optional step that uses GitHub Copilot CLI locally, for example with GPT-5.5, to improve the agent brief. Media handling, keyframes, and transcription should run locally.

## Local machine profile, initial check

Checked on the primary laptop on 2026-08-24:

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

## Repo-status

The MVP CLI is implemented. `scripts\review-recorder.ps1` provides `doctor`,
`init`, `start`, `stop`, `brief`, and `analyze`, with a manual fallback when OBS
WebSocket is unavailable and fail-soft behavior when FFmpeg or Whisper are
missing. Local transcription runs through `scripts\transcribe-whisper.py`
(faster-whisper), and a guiding Copilot skill lives in `skill\SKILL.md`.

Main parts:

```text
scripts/
  review-recorder.ps1       # CLI core (doctor, init, start, stop, brief, analyze)
  transcribe-whisper.py     # local transcription through faster-whisper

skill/
  SKILL.md                  # Copilot skill that guides and runs the CLI
  examples/
    app-review-agent-prompt.md

docs/
  PLAN.md
  REQUIREMENTS.md
  SKILL_DESIGN.md
  DECISIONS.md
```

Run `.\scripts\review-recorder.ps1 doctor` to check prerequisites, then `init`
to create `config.local.json`.

