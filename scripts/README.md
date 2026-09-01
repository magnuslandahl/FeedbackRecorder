# Scripts

The CLI implementation lives here.

## Files

- `review-recorder.ps1` — PowerShell CLI with commands `doctor`, `miccheck`,
  `windows`, `init`, `start`, `stop`, `brief`, and `analyze`. Run it from the
  repo root:

  ```powershell
  .\scripts\review-recorder.ps1 doctor
  .\scripts\review-recorder.ps1 init
  .\scripts\review-recorder.ps1 miccheck
  .\scripts\review-recorder.ps1 windows
  .\scripts\review-recorder.ps1 start -Window "My App"
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

- `install-skill.ps1` — install the Copilot skill for the current user, so a
  review can be recorded from any repository. See `skill\README.md`.

  ```powershell
  .\scripts\install-skill.ps1
  ```

## Options

`review-recorder.ps1` accepts: `-Window <text>`, `-Display`, `-NoLaunch`,
`-Manual`, `-VideoPath <path>`, `-NoKeyframes`, `-NoTranscribe`,
`-ConfigPath <path>`, `-Seconds <n>` (miccheck), `-Force` (init), `-KeepObsOpen`
(stop), and `-Json` (doctor, windows).
Run `.\scripts\review-recorder.ps1 help` for details.

## Design

- Fail-soft: once a video is found, a run folder and `agent-brief.md` are always
  produced. Missing tools are reported, not fatal.
- State between `start` and `stop` is kept in `runs\.state.json`.
- Configuration comes from `config.local.json` (created by `init`), deep-merged
  over built-in defaults.

## Choosing what gets recorded

`start` records whatever the OBS scene points at, which is the wrong thing as
soon as the user has more than one app open — and the mistake is only visible
after the review has already been performed. `windows` lists what OBS can
capture and `start -Window` selects one:

```powershell
.\scripts\review-recorder.ps1 windows
.\scripts\review-recorder.ps1 start -Window "My App"
.\scripts\review-recorder.ps1 start -Display     # whole screen instead
```

`-Window` is matched in tiers — exact title, process name, then substrings — so
an exact title never loses to an accidental substring. A pattern matching
several windows is reported with the candidates and **nothing is recorded**,
because guessing wastes the whole review. `windows -Json` exists so an agent can
list the choices and ask which one to record.

Selecting a target also enables that source in the scene and disables the
competing capture sources. Only capture sources are touched, so overlays the
user added to the scene survive. If the scene has no window capture source, one
is created, so a fresh OBS install works without manual setup.

### Recording a rectangle instead of a whole window

OBS has no "region" source, but a display capture plus a **Crop/Pad** filter is
the same thing, and the CLI leaves filters alone — so a crop set up by hand
survives every `start`. Set it on the *display* source and record with
`start -Display`; `start -Window` enables a different source, which has no crop
on it.

1. In the preview, hold **Alt** and drag a handle of the display capture to crop
   it interactively. For exact numbers use **Filters → + → Crop/Pad**, untick
   *Relative*, and set X / Y / Width / Height.
2. Then fix the canvas, or the recording is mostly black: **Settings → Video**,
   set *Base (Canvas) Resolution* to the region's size and *Output (Scaled)
   Resolution* to the same value, and drag the cropped source to 0,0. Cropping
   shrinks the image, not the canvas, so without this the region sits in the
   corner of a full-size frame.

Step 2 is worth doing regardless of cropping. On the development machine OBS
defaulted to a 1920x1080 canvas scaled down to a 1280x720 output, which blurs
exactly the thing the keyframes exist to show: on-screen text. Recording a region
at its native size is the sharpest input this pipeline can get.

The trade-off against `-Window`: a rectangle is fixed to screen coordinates. Move
or resize the app mid-review and the recording keeps filming the rectangle, while
window capture follows the window. Use a region for "look at this one panel", and
when it matters that nothing else on screen — chat windows, other repositories —
ends up in the video.

`start` launches OBS when it is not running. After an unclean exit OBS opens a
modal dialog *before* it loads plugins, so the WebSocket server never starts;
`--disable-shutdown-check` was observed not to suppress this reliably. The
dialog is therefore detected by window title and reported immediately instead of
waiting out the full startup timeout and silently dropping to manual mode. Use
`-NoLaunch`, or `obs.launchIfNotRunning: false`, to keep the tool from starting
OBS at all.

## Closing OBS after a recording

`stop` closes OBS before it reads the video. OBS holds the file while it runs and
is not needed by the rest of the pipeline; leaving it open has already produced
one `partial file` failure in this project. `-KeepObsOpen`, or
`obs.closeAfterStop: false`, keeps it running for a user who is about to record
again.

Two things make an unattended close work.

**Wait for the outputs to go idle first.** `StopRecord` returns when OBS accepts
the request, not when the recorder has flushed and closed the container. Closing
immediately after it loses that race, and OBS then opens a modal *"OBS is still
currently active"* prompt — which nobody is there to click when an agent is
driving the tool, so the close turns into a silent hang. `Wait-ObsOutputsIdle`
polls record, stream, virtual camera and replay buffer until none report
`outputActive`. If OBS cannot be asked at all, it proceeds rather than blocking:
failing to ask is no worse than never having asked.

**Ask the window to close; never kill the process.** OBS writes a per-session
sentinel file and removes it on a clean exit. A killed process leaves that
sentinel behind, and the *next* launch opens a crash-recovery dialog before
plugins load — so the WebSocket server never starts and the following review is
the one that pays for it. A hung OBS is therefore reported and left alone: a
stuck process is recoverable, a poisoned next launch is not.

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
`Format-Timecode`, `Get-ReviewTimeline`, `ConvertFrom-ObsWindowItem`,
`Find-ObsWindowMatch`, `Test-ObsDialogTitle`, and `Get-SelfInvocation`. They are
loaded out of `review-recorder.ps1` with the PowerShell parser, so there is no
duplicated copy to maintain and running them has no side effects. Fixtures are
generated in-process, so the only external dependency is ffmpeg for the duration
test, which is skipped when it is unavailable.

Run on both hosts before committing, since the CLI supports both:

```powershell
powershell.exe -NoProfile -File scripts\run-tests.ps1   # Windows PowerShell 5.1
pwsh           -NoProfile -File scripts\run-tests.ps1   # PowerShell 7+
```
