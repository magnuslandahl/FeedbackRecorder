# TODO

## MVP

- [ ] Implement `scripts\review-recorder.ps1 doctor`.
- [ ] Implement config loading from `config.local.json`.
- [ ] Implement `init` that creates sample config.
- [ ] Implement FFmpeg checks and keyframe extraction.
- [ ] Implement audio extraction to WAV.
- [ ] Implement `scripts\transcribe-whisper.py` with faster-whisper.
- [ ] Implement `brief` that creates `agent-brief.md`.
- [ ] Implement manual recording mode.
- [ ] Implement OBS WebSocket start/stop.
- [ ] Implement optional `analyze` command through Copilot CLI.
- [ ] Create the first `skill\SKILL.md`.

## Later improvements

- [ ] Installation help through `doctor --fix`.
- [ ] Profiles for fast/balanced/high transcription quality.
- [ ] Better keyframe selection based on scene changes.
- [ ] OCR on keyframes.
- [ ] Automatic clustering of review segments.
- [ ] Support for multiple languages in the same recording.
- [ ] Export to GitHub issue, PR comment, or project card.
- [ ] UI or simple TUI on top of the PowerShell CLI.
