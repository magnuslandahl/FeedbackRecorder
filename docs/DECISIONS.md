# Technical decisions

## 1. PowerShell as the primary CLI

Decision: build the CLI in PowerShell.

Rationale:

- Windows-first.
- Minimal friction for local laptops.
- Good access to processes, paths, registry, and external CLI tools.
- Easy to run from a Copilot skill.

## 2. OBS as the recording engine

Decision: use OBS Studio and OBS WebSocket for start/stop.

Rationale:

- OBS is stable and established for screen recording.
- WebSocket provides automation without building a custom recording engine.
- Manual fallback mode lets the MVP work before WebSocket is configured.

## 3. FFmpeg for media handling

Decision: use FFmpeg/ffprobe for audio extraction and keyframes.

Rationale:

- Robust standard tool.
- Easy to extract images with `fps=1/N`.
- Easy to extract audio to WAV for Whisper.

## 4. faster-whisper for local transcription

Decision: use `faster-whisper` locally.

Rationale:

- Supports Swedish.
- Can run CPU-only with `int8`.
- Faster and more practical than original Whisper for local automation.

## 5. Copilot CLI for analysis

Decision: make Copilot analysis a separate, optional step.

Rationale:

- Media and transcription can run locally.
- Analysis, summarization, and agent prompts are a good use of GPT-5.5 through Copilot.
- The flow still works offline or partially without the analysis step.

## 6. Fail-soft output

Decision: always create a run folder and a brief if a video can be identified.

Rationale:

- The user should not lose the review material because transcription or analysis fails.
- Errors should be visible in the brief and in `run.json`.
