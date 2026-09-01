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
- [x] Close OBS after `stop`, waiting for its outputs to go idle first so the
      "still currently active" prompt never blocks an unattended run.
- [x] Make the skill trigger on how people actually ask ("spela in en review
      till dig", "do a visual review"), and hand the finished brief back to the
      agent that invoked it instead of ending on a file path.

## FeedbackRecorder (`app\`)

The cross-platform replacement described in `docs\APP_DESIGN.md`. It retires the
PowerShell CLI and its Copilot skill once it reaches parity — not before.

- [x] Electron app that records the screen itself, with no OBS anywhere in it.
- [x] Pick a display from thumbnails, capture at its native pixel size, and
      report it when Chromium hands back something smaller.
- [x] Hide the main window while recording and show a bar on a screen that is
      not being recorded.
- [x] Frame a rectangle after the recording, with a scrubber to check it holds.
- [x] Keyframes taken where the screen changed, cropped to the region.
- [x] Microphone only, with a level meter before and during recording.
- [x] Measure the narration level, and refuse to hand audio already known to be
      too quiet to a transcriber that would invent text for it.
- [x] Correlate transcript segments with keyframes.
- [x] Verify the output against the recording's duration.
- [x] Copy a ready-made prompt that carries the brief itself.
- [x] Settle whether FFmpeg is needed: it is not. `npm run test:pipeline` proves
      the browser path end to end, 14/14, including the WebM `Infinity` duration
      trap.

- [ ] Bundle whisper.cpp and a `small` GGML model under `app\vendor\`, plus the
      Silero VAD model so voice activity detection is on rather than worked
      around by the narration-level gate.
- [ ] Package installers for Windows and macOS, signed, and notarized on macOS.
- [ ] Test on macOS: TCC prompts, the restart-after-approval step for Screen
      Recording, and blank `desktopCapturer` thumbnails as the permission signal.
- [ ] Re-frame an existing package without re-recording. The source recording and
      the chosen region are already kept for exactly this.
- [ ] Decide whether the app also writes a plain shareable (cropped) recording.
- [ ] Retire `scripts\review-recorder.ps1` and the installed skill at parity, and
      rename the repository and the CLI to match.

## Later improvements to the PowerShell CLI

These stay open only while the CLI does.

- [ ] Record a region of the screen from the CLI (`start -Region`), either by
      dragging a rectangle or by coordinates. Verified as feasible: a
      `crop_filter` with `relative=false` and `x/y/cx/cy` sets an absolute
      rectangle over obs-websocket, but the canvas has to be resized to match
      and restored afterwards. Documented as a manual OBS step for now.

- [ ] Report the narration level in `run.json` and the brief, so "0 segments"
      always arrives with a stated cause (measured: speech ~-27 dB mean, the
      empty run -48.9 dB). Keep Whisper's VAD on — with `--no-vad` the same
      quiet file produced two entirely different Swedish transcripts.
- [ ] Installation help through `doctor --fix`.
- [ ] Let `doctor --fix` also repair OBS capture (add a Display Capture source,
      bind the mic to a device that is actually live).
- [ ] Profiles for fast/balanced/high transcription quality.
- [ ] OCR on keyframes.
- [ ] Automatic clustering of review segments.
- [ ] Support for multiple languages in the same recording.
- [ ] Export to GitHub issue, PR comment, or project card.
