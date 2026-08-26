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

## Reading the recording

`stop` must not trust a zero exit code. Two failures in this pipeline produce
plausible-looking output rather than an error, and both silently cost the user a
review that has already been performed:

- OBS reports the output path as soon as it stops, while the muxer is still
  flushing. Reading immediately gives a short file, so `stop` waits for the file
  size to settle first.
- PowerShell converts a native program's stderr into error records. Under
  `$ErrorActionPreference = 'Stop'` an informational ffmpeg message therefore
  becomes a terminating error that kills ffmpeg mid-write. All native calls go
  through `Invoke-NativeCapture`, which redirects stderr to a file and decides
  success from the exit code.

Outcomes are then verified rather than assumed: extracted audio is compared
against the video duration, and the keyframe count against what the duration
implies. A shortfall is recorded as a `partial` step in the brief.

## Linking speech to the screen

A transcript beside an unordered pile of screenshots is not actionable: "this
button is wrong" cannot be resolved to a screen. The brief therefore contains a
`## Timeline` table pairing every spoken sentence with the keyframes that were
on screen while it was said.

The mapping needs no extra probing. `ffmpeg -vf fps=1/N` emits output frame _k_
(1-based) at exactly `(k-1) * N` seconds — verified against `showinfo` rather
than assumed — so the frame number is itself a timestamp. A sentence spanning
`start` to `end` maps to frames `floor(start/N)+1` through `floor(end/N)+1`.

The range starts at the frame at or *before* `start`, not the first frame inside
the sentence. Speech beginning at 6.4 s refers to what the reviewer was already
looking at, which is the frame sampled at 6 s. This also handles a short
sentence falling entirely between two frames, and indices past the last frame
are clamped so a segment Whisper times beyond the video still cites a real
screenshot.

## Tests

```powershell
.\scripts\run-tests.ps1
```

Unit tests for the pure helpers: `Invoke-NativeCapture`, `Wait-ForStableFile`,
`Get-BmpLuma`, `Get-Prop`, `Get-MediaDuration`, `Format-Invariant`,
`Format-Timecode`, and `Get-ReviewTimeline`. They are
loaded out of `review-recorder.ps1` with the PowerShell parser, so there is no
duplicated copy to maintain and running them has no side effects. Fixtures are
generated in-process, so the only external dependency is ffmpeg for the duration
test, which is skipped when it is unavailable.

Run on both hosts before committing, since the CLI supports both:

```powershell
powershell.exe -NoProfile -File scripts\run-tests.ps1   # Windows PowerShell 5.1
pwsh           -NoProfile -File scripts\run-tests.ps1   # PowerShell 7+
```
