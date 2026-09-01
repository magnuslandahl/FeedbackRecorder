# FeedbackRecorder

Record one screen, talk through it, and hand the result to a coding agent.

FeedbackRecorder replaces the OBS + PowerShell pipeline in `..\scripts\` with a
single cross-platform app. It records the screen itself, so there is no OBS to
install, configure, or close. The design it follows is `..\docs\APP_DESIGN.md`.

Status: **working end to end, including local Swedish transcription, and it
builds installers for Windows, macOS and Linux in CI.** What is left is code
signing and macOS notarization, which need paid certificates.

## Running it

Installed:

```text
dist\FeedbackRecorder-Windows-x64-Setup.exe
```

The installer is unsigned for now, so Windows SmartScreen warns on first run —
*More info* then *Run anyway*. Check an install from the command line with:

```powershell
"%LOCALAPPDATA%\Programs\FeedbackRecorder\FeedbackRecorder.exe" --selftest
```

It prints where it is installed, where recordings go, and which model it found,
then exits. A packaged app keeps its models next to the executable rather than in
the source tree, and that is exactly the kind of difference that stays invisible
until someone records a review and gets no transcript.

From source:

```powershell
npm install
npm run vendor    # whisper.cpp and the models, ~500 MB, not in git
npm start
```

`npm run vendor` is optional. Without it the app still records, extracts
keyframes and measures the narration level; it just says the transcript is
missing instead of pretending it succeeded.

## Building

```powershell
npm run dist:dir  # unpacked, fast, for checking a change
npm run dist      # the installer
```

`vendor/` is copied in as an extra resource, outside the asar archive so the
binary can be executed and the models memory-mapped. `ggml-base.bin` and
whisper.cpp's demo and test binaries are excluded from the build, which is the
difference between a 845 MB app and a 1 GB one.

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

Recordings go to `%USERPROFILE%\Videos\FeedbackRecorder`, unless that folder has
been redirected into OneDrive or another sync root — found on a real machine,
where Windows folder redirection pointed Videos at corporate OneDrive. Recordings
are hundreds of megabytes and show whatever was on screen, so they default to
`%USERPROFILE%\FeedbackRecorder` instead of silently uploading.

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

Transcription is local; nothing leaves the machine. `npm run vendor` fetches a
whisper.cpp build and the models into `app/vendor/`, which is not in git:

```text
app/vendor/whisper/...                      whisper-cli plus its backends
app/vendor/models/ggml-small.bin            488 MB, the shipping default
app/vendor/models/ggml-silero-v5.1.2.bin    0.9 MB, enables VAD
```

The lookup tolerates the layouts the prebuilt archives actually use, including
the `Release\` folder the Windows release zip creates. Pass `--base` to fetch the
smaller, weaker model instead. macOS has no prebuilt command-line binary in the
whisper.cpp releases — only an xcframework for app embedding — so the script
compiles one from the same pinned tag, as a universal binary with the Metal
shaders embedded and nothing linked from Homebrew. That needs `cmake` and the
Xcode command line tools, and takes a few minutes the first time.

Check it against a real recording:

```powershell
node test/whisper-check.js path\to\narration.wav sv
```

Measured here: 28.6 seconds of Swedish transcribed in 4.2 seconds on CPU, as six
timestamped segments.

Whisper invents text when given silence: two runs of the older tool over the same
quiet file produced entirely different Swedish transcripts, both with segments
running past the end of the file. Two things guard against that. Voice activity
detection is on whenever the Silero model is present, and the app measures the
narration level first and refuses to transcribe audio it has already established
is too quiet, reporting the measurement instead. An empty transcript is a correct
answer; confabulated text quietly poisons the brief.

## Tests

```powershell
npm test              # the pure logic: regions, keyframes, narration, briefs
npm run test:pipeline # the media pipeline, in a real Electron renderer
npm run test:ui       # the real UI boots and renders its Ready state
npm run test:record   # a real screen recording, all the way to a package
npm run shots         # writes a screenshot of every UI state
```

`npm run test:pipeline` records a synthetic six-second clip and runs the whole
browser-side pipeline over it: MediaRecorder, the WebM duration trap, seeking,
keyframe selection, cropping to PNG, audio decode, and WAV encoding. It needs no
screen, no microphone and no whisper.cpp, so it runs on a locked machine. It is
what settled the question of whether FFmpeg was needed — it is not.

`npm run test:ui` loads the real UI with the real preload and asks the DOM what
happened, because the absence of console errors is not evidence that a window
rendered anything.

`npm run test:record` records the screen for six seconds through the real UI and
the real IPC handlers, drags a rectangle, and checks the package that comes out.
It writes to a temporary folder and deletes it again. This is the test that found
a 4K display being reported as 3841x2161.

`npm run shots -- --out=<dir>` captures every UI state to PNG, which is how the
interface gets reviewed by looking at it rather than by reading its markup. It
forces a repaint before each capture, because a window that is never shown can
hand back the previously composited frame — trust the values it prints over the
pixels when the two disagree.

## The icon

```powershell
npm run icon
```

Draws `build/icon.png`, `build/icon.ico` and `src/renderer/logo.png` from one
script, so there is no binary asset in the repository that nobody can edit. The
mark is a viewfinder with a record dot — the two things this app does that
nothing else on the machine does. Small sizes are drawn bolder and tighter
rather than scaled down, because at 16 pixels the full-size stroke is one pixel
and disappears. `npm run icon -- --preview=<file>` writes a magnified sheet of
the 16/24/32/48 renders, which is the only honest way to check a taskbar icon.

## Layout

```text
src/main/       Electron main process: displays, permissions, packaging, whisper
src/main/runtime.js  every IPC handler, with window handling injected
src/preload/    the bridge, including the shared pure logic the UI uses
src/renderer/   the five UI states and the media pipeline
src/shared/     pure logic, shared by main, renderer and tests
test/           unit tests, plus the Electron harnesses
```

The pure logic lives in `src/shared/` and is used by the main process, the
renderer and the tests, so each rule has one definition rather than three. The
IPC handlers live in `src/main/runtime.js` with windows injected, so
`test:record` drives the same handlers the app does rather than a copy that can
drift away from them.
