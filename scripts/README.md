# Scripts

The CLI implementation lives here.

## Files

- `review-recorder.ps1` — PowerShell CLI with commands `doctor`, `miccheck`,
  `init`, `start`, `stop`, `brief`, and `analyze`. Run it from the repo root:

  ```powershell
  .\scripts\review-recorder.ps1 doctor
  .\scripts\review-recorder.ps1 init
  .\scripts\review-recorder.ps1 miccheck
  .\scripts\review-recorder.ps1 start
  .\scripts\review-recorder.ps1 stop
  .\scripts\review-recorder.ps1 analyze
  ```

- `transcribe-whisper.py` — thin wrapper around `faster-whisper`. Called by
  `stop`, but also runnable directly:

  ```powershell
  .\.venv\Scripts\python.exe .\scripts\transcribe-whisper.py `
    --audio runs\<id>\audio.wav `
    --model small --language sv --compute-type int8 --device cpu `
    --output-json runs\<id>\transcript.json `
    --output-txt runs\<id>\transcript.txt
  ```

## Options

`review-recorder.ps1` accepts: `-Manual`, `-VideoPath <path>`, `-NoKeyframes`,
`-NoTranscribe`, `-ConfigPath <path>`, `-Seconds <n>` (miccheck), `-Force`
(init), and `-Json` (doctor).
Run `.\scripts\review-recorder.ps1 help` for details.

## Design

- Fail-soft: once a video is found, a run folder and `agent-brief.md` are always
  produced. Missing tools are reported, not fatal.
- State between `start` and `stop` is kept in `runs\.state.json`.
- Configuration comes from `config.local.json` (created by `init`), deep-merged
  over built-in defaults.

## Capture readiness

A green toolchain still yields a useless run if OBS captures nothing, so
`doctor` additionally verifies, whenever the WebSocket is reachable:

- OBS's recording directory matches `obs.recordingDirectory`, so `stop` can find
  the file.
- The current scene has at least one enabled source.
- A frame rendered via `GetSourceScreenshot` is not blank. Brightness *range* is
  used rather than mean, so a dark theme is not mistaken for a black capture.
- At least one audio input exists and is unmuted.

`miccheck` goes one step further and subscribes to `InputVolumeMeters` to sample
real levels. It distinguishes a live device (has a noise floor) from a dead one
(digital silence), because a muted or disconnected microphone otherwise only
surfaces as an empty transcript after the review is over. Output-capture devices
such as Desktop Audio are reported informationally, since they are legitimately
silent when nothing is playing.
