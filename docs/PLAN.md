# Plan

## MVP

Build a Windows-first PowerShell CLI that can be run directly and later orchestrated by a Copilot skill.

### Commands

| Command | Purpose |
| --- | --- |
| `doctor` | Check prerequisites and provide clear remediation steps. |
| `init` | Create sample config and local folder structure. |
| `start` | Start OBS recording through WebSocket or enter manual fallback mode. |
| `stop` | Stop OBS recording, find the latest video, and create run output. |
| `brief` | Create or regenerate `agent-brief.md`. |
| `analyze` | Optional: use Copilot CLI to improve the brief. |

### Output per run

```text
runs\
  2026-08-24-1100\
    review.mp4
    audio.wav
    transcript.txt
    transcript.json
    keyframes\
      frame-000001.jpg
      frame-000002.jpg
    agent-brief.md
    run.json
```

### Config

Planned config file: `config.local.json`.

```json
{
  "obs": {
    "webSocketUrl": "ws://127.0.0.1:4455",
    "password": "",
    "recordingDirectory": "C:\\Users\\<user>\\Videos"
  },
  "ffmpeg": {
    "ffmpegPath": "ffmpeg",
    "ffprobePath": "ffprobe",
    "keyframeIntervalSeconds": 2,
    "imageQuality": 2
  },
  "transcription": {
    "enabled": true,
    "pythonPath": ".venv\\Scripts\\python.exe",
    "model": "small",
    "language": "sv",
    "computeType": "int8"
  },
  "copilot": {
    "enabled": true,
    "cliPath": "copilot",
    "model": "gpt-5.5",
    "reasoningEffort": "medium"
  }
}
```

## Implementation steps

1. Create `doctor` and config loading.
2. Create `init`, writing sample config without overwriting local config.
3. Add FFmpeg-based keyframe extraction.
4. Add local transcription with `faster-whisper`.
5. Create `agent-brief.md` from video, transcript, and keyframes.
6. Add OBS WebSocket start/stop.
7. Add manual fallback mode.
8. Add `analyze` through GitHub Copilot CLI.
9. Package as a Copilot skill that guides the user through the same steps.

## MVP acceptance criteria

1. `doctor` shows exactly what is missing and how to install it.
2. The tool works even when OBS WebSocket is unavailable, through manual fallback mode.
3. A stopped recording always results in a timestamped run folder.
4. Keyframes are extracted when FFmpeg is available.
5. A transcript is created when the Whisper environment is available.
6. If transcription fails, a brief is still created with a clear placeholder and failure reason.
7. `agent-brief.md` is directly usable as prompt material for a coding agent.
