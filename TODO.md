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
- [x] Verify OBS capture readiness in `doctor` (scene sources, non-blank frame,
      unmuted audio) so a green toolchain cannot hide a useless recording.
- [x] Implement `miccheck` that samples live OBS audio levels.

## Later improvements

- [ ] Installation help through `doctor --fix`.
- [ ] Let `doctor --fix` also repair OBS capture (add a Display Capture source,
      bind the mic to a device that is actually live).
- [ ] Profiles for fast/balanced/high transcription quality.
- [ ] Better keyframe selection based on scene changes.
- [ ] OCR on keyframes.
- [ ] Automatic clustering of review segments.
- [ ] Support for multiple languages in the same recording.
- [ ] Export to GitHub issue, PR comment, or project card.
- [ ] UI or simple TUI on top of the PowerShell CLI.
