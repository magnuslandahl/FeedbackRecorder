# Scripts

The CLI implementation lives here.

## Files

- `review-recorder.ps1` — PowerShell CLI with commands `doctor`, `init`,
  `start`, `stop`, `brief`, and `analyze`. Run it from the repo root:

  ```powershell
  .\scripts\review-recorder.ps1 doctor
  .\scripts\review-recorder.ps1 init
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
`-NoTranscribe`, `-ConfigPath <path>`, `-Force` (init), and `-Json` (doctor).
Run `.\scripts\review-recorder.ps1 help` for details.

## Design

- Fail-soft: once a video is found, a run folder and `agent-brief.md` are always
  produced. Missing tools are reported, not fatal.
- State between `start` and `stop` is kept in `runs\.state.json`.
- Configuration comes from `config.local.json` (created by `init`), deep-merged
  over built-in defaults.
