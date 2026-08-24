# TODO

## MVP

- [x] Implement `scripts\review-recorder.ps1 doctor`.
- [x] Implement config loading from `config.local.json`.
- [x] Implement `init` that creates sample config.
- [x] Implement FFmpeg checks and keyframe extraction.
- [x] Implement audio extraction to WAV.
- [x] Implement `scripts\transcribe-whisper.py` with faster-whisper.
- [x] Implement `brief` that creates `agent-brief.md`.
- [x] Implement manual recording mode.
- [x] Implement OBS WebSocket start/stop.
- [x] Implement optional `analyze` command through Copilot CLI.
- [x] Create the first `skill\SKILL.md`.

## Later improvements

- [ ] Installation help through `doctor --fix`.
- [ ] Profiles for fast/balanced/high transcription quality.
- [ ] Better keyframe selection based on scene changes.
- [ ] OCR on keyframes.
- [ ] Automatic clustering of review segments.
- [ ] Support for multiple languages in the same recording.
- [ ] Export to GitHub issue, PR comment, or project card.
- [ ] UI or simple TUI on top of the PowerShell CLI.
