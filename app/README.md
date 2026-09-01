# FeedbackRecorder

Record one screen, talk through it, and hand the result to a coding agent.

FeedbackRecorder replaces the OBS + PowerShell pipeline in `..\scripts\` with a
single cross-platform app. It records the screen itself, so there is no OBS to
install, configure, or close. The design it follows is `..\docs\APP_DESIGN.md`.

Status: **the pipeline works end to end; whisper.cpp is not bundled yet.** A
recording without a transcriber still produces a package — video, keyframes and a
measured narration level — and says the transcript is missing rather than
pretending it succeeded.

## Running it

```powershell
npm install
npm start
```

## What it does

1. **Ready.** Pick a microphone and test it, and pick a screen from thumbnails.
   Only the microphone is recorded; system audio is never captured.
2. **Recording.** The main window hides and a small bar shows the elapsed time,
   a live level meter, and *Stop*. On more than one screen the bar sits on a
   screen that is not being recorded.
3. **Framing.** Drag a rectangle over the part that matters, and scrub through
   the recording to check it holds for all of it. The whole screen is the
   default.
4. **Processing.** Keyframes are taken where the screen actually changed, cropped
   to the region. Transcription runs from the moment you press Stop, in parallel
   with framing, because the crop does not affect the audio.
5. **Done.** *Copy prompt* puts the whole brief on the clipboard, narration and
   frame references included, so it works in a chat with no file access.

## The package

```text
2026-09-01-113000/
  agent-brief.md      # the handover document
  transcript.txt
  transcript.json     # segments with timestamps
  narration.wav       # 16 kHz mono, what was transcribed
  frames/             # keyframes, cropped to the chosen region
  recording.webm      # the full recording of the chosen screen
  run.json            # what ran, what degraded, measured levels, display, region
```

## Transcription

Transcription is local. Put a whisper.cpp build and a GGML model here:

```text
app/vendor/whisper/whisper-cli.exe      (or whisper-cli on macOS)
app/vendor/models/ggml-small.bin
app/vendor/models/ggml-silero-v5.1.2.bin   (optional, enables VAD)
```

A shipped build bundles both, so nothing has to be installed. `vendor/` is not in
git.

Whisper invents text when given silence: two runs of the older tool over the same
quiet file produced entirely different Swedish transcripts, both with segments
running past the end of the file. So the app measures the narration level first
and refuses to transcribe audio it has already established is too quiet, instead
reporting what it measured. An empty transcript is a correct answer; confabulated
text quietly poisons the brief.

## Tests

```powershell
npm test              # the pure logic: regions, keyframes, narration, briefs
npm run test:pipeline # the media pipeline, in a real Electron renderer
```

`npm run test:pipeline` records a synthetic six-second clip and runs the whole
browser-side pipeline over it: MediaRecorder, the WebM duration trap, seeking,
keyframe selection, cropping to PNG, audio decode, and WAV encoding. It needs no
screen, no microphone and no whisper.cpp, so it runs on a locked machine. It is
what settled the question of whether FFmpeg was needed — it is not.

## Layout

```text
src/main/       Electron main process: displays, permissions, packaging, whisper
src/preload/    the bridge, including the shared pure logic the UI uses
src/renderer/   the five UI states and the media pipeline
src/shared/     pure logic, shared by main, renderer and tests
test/           unit tests, plus the Electron media harness
```

The pure logic lives in `src/shared/` and is used by the main process, the
renderer and the tests, so each rule has one definition rather than three.
