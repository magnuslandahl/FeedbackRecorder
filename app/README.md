# FeedbackRecorder

Record one screen, talk through it, and hand the result to a coding agent.

FeedbackRecorder replaces the OBS + PowerShell pipeline in `..\scripts\` with a
single cross-platform app. It records the screen itself, so there is no OBS to
install, configure, or close. The design it follows is `..\docs\APP_DESIGN.md`.

Status: **working end to end, including local transcription in the language of
your choice, and it
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
   Only the microphone is recorded; system audio is never captured. An existing
   video can be dropped here instead, which skips to step 3.
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

## Importing an existing video

A video dropped on the Ready state — or picked with *Choose a video…* — joins the
pipeline at the point a fresh recording reaches when the user presses Stop. It
gets a package, its audio is measured and transcribed, and it is framed by hand.
Everything from framing onwards is the same code, so the two routes cannot drift
apart; `npm run test:import` is what holds that.

Three things are deliberate:

- **The extension list is a filter, not the verdict.** Whether a file can be
  played is settled by trying to play it, because that depends on the codecs
  inside the container rather than on the name. What the list buys is a sentence
  that says "that is not a video" for a PDF, instead of a codec error that reads
  like a bug.
- **The file is copied by the main process, not read through the renderer.** A
  screen recording can be gigabytes, and the renderer already holds one copy to
  decode its audio. `webUtils.getPathForFile` supplies the path; a `File` with no
  path behind it falls back to copying the bytes.
- **The copy keeps its extension.** `recording.mp4` rather than `recording.webm`,
  because renaming an MP4 would make the file lie about its format to every
  player that opens it. The stem stays `recording` so a package has one shape.

The brief says the video was imported and names the file, because the frames may
predate the code an agent is being asked about — claiming this app recorded them
would misdescribe what the agent is looking at.

## Versioning

`src/shared/version.js` decides what a build calls itself; `scripts/write-build-info.js`
writes `src/shared/build-info.json` from the environment GitHub Actions already
sets, and `src/main/build-info.js` reads it back with a fallback.

The generated file is not committed. A build number in git would mean every build
dirtying a tracked file, and would be a lie the moment the same commit were built
twice. Its absence means somebody is running from source, and the app says
`development build`, which is the honest answer.

```powershell
npm run build-info    # stamp a build locally, to see what a release would show
```

The semantic version stays in `package.json` and is bumped by hand in a pull
request. The alternative — CI incrementing it on every merge — would need a push
back to a protected branch, and would make the number say "this changed a lot"
when nothing did.

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
  recording.webm      # the recording, or the imported video under its own extension
  run.json            # what ran, what degraded, measured levels, source, region, build
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

### Language

The language is chosen in the UI before recording, stored in `settings.json`, and
passed to whisper.cpp as `-l`. `src/shared/languages.js` holds the list that is
offered and normalises whatever is in the settings file, so a stale or
hand-edited value cannot reach the transcriber and cost a recording its
transcript.

`-l` is always passed, including `auto`. whisper.cpp documents `-l LANG [en]`, so
leaving the flag out does not mean "detect" — it means English. Omitting it for
auto is what this used to do, and it transcribed every other language as if it
were English, confidently and with no error to notice. With `-l auto`, the
detected language comes back in `result.language` while `params.language` still
echoes `auto`, so the two are kept apart rather than reporting `auto` as if it
were a language somebody spoke.

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
npm run test:import   # a video dropped on the real UI, all the way to a package
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

`npm run test:import` generates a WebM in the renderer, drops it on the real UI
as a `File` the way an operating system would, and checks the package that comes
out — including that a PDF is refused by name and leaves the app where it was.
Like the pipeline test it needs no screen, microphone or whisper.cpp, so it runs
in CI. It is what stops the imported and recorded routes drifting apart.

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
