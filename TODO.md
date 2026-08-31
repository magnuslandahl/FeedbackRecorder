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
- [x] Wait for OBS to finish writing before reading the recording, and verify
      extracted audio and keyframes against the video duration.
- [x] Add `scripts\run-tests.ps1` covering the pure helpers.
- [x] Correlate transcript segments with keyframes so the agent can resolve
      "this button" to an actual screen.
- [x] Let the user choose which window to record (`windows`, `start -Window`),
      and launch OBS automatically when it is not running.
- [x] Install the skill for the current user (`scripts\install-skill.ps1`) so a
      review can be recorded from the repository of the app being reviewed.

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
