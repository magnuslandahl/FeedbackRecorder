# FeedbackRecorder — app design

Status: **proposal, nothing built.** FeedbackRecorder is a cross-platform desktop
app that replaces the OBS + PowerShell pipeline with a single application. The
PowerShell CLI in `scripts\` keeps working until FeedbackRecorder produces an
equivalent package.

The name drops "OBS" because OBS is gone (section 9) and "review" because the
same recording is useful when nothing is being reviewed. What the app always
does is record feedback for someone else to act on.

## 1. Why an app

The current tool works, but almost every hard problem in it is an OBS problem,
not a review problem:

- The WebSocket connection, its password, and its retry logic.
- The crash-recovery dialog that opens *before* plugins load, so the WebSocket
  server never starts and the next review is the one that pays for it.
- The sentinel file that forbids ever killing the process.
- Scene sources that have to be enabled and disabled to pick a capture target.
- The "still currently active" prompt when closing OBS too soon after stopping.
- Window capture versus region capture, neither of which OBS exposes simply.

An app that captures the screen itself deletes that entire category. What remains
is the part that carries the value: keyframes, transcript, and a brief an agent
can act on.

The second reason is macOS. The CLI is Windows-only by construction. A reviewer
on a Mac has nothing today.

## 2. What carries over

Not the code — the decisions that took evidence to find. These are requirements
for the app, not suggestions:

- **Whisper's VAD stays on.** Two `--no-vad` runs over the same quiet 20.7 s file
  produced entirely different Swedish transcripts, both with segments running
  past the end of the file. An empty transcript is a correct answer; confabulated
  text silently poisons the brief.
- **Report the narration level.** Measured on real runs: speech averages about
  -27 dB, a failed run -48.9 dB. "0 segments" must always arrive with a stated
  cause, or the user is left guessing whether the tool or the microphone failed.
- **Correlate transcript segments with keyframes.** "This button" is only
  resolvable if the agent can map a spoken moment to a frame.
- **Verify output against the video duration.** Extracted audio and keyframe
  counts must be checked against the source length. Both failure modes in this
  pipeline produce plausible output with a zero exit code.
- **Fail soft.** A missing optional tool degrades the package; it never aborts
  the run. The review has already been performed by the time processing starts,
  and it cannot be re-recorded from memory.
- **Check the microphone before recording, not after.** A muted mic otherwise
  only surfaces as an empty transcript once the review is over.

## 3. Stack

Decision: **Electron, and no separate recorder.**

Rationale:

- Chromium is already in the app, and Chromium is the recorder. `getDisplayMedia`
  (via `setDisplayMediaRequestHandler` in the main process) and `getUserMedia`
  cover screen and microphone on both platforms, over ScreenCaptureKit on
  macOS 13+ and Windows Graphics Capture on Windows.
- `MediaRecorder` writes the file without a bundled encoder.
- The framing step is a still image and a rectangle drawn on a canvas, which is
  ordinary web UI.
- Shelling out to helper binaries is already how the current tool works.

Tauri is the lighter alternative, but screen and audio capture would have to be
written per platform. That is the riskiest part of the project, so it should sit
on the most travelled path, not the least.

Decision: **do not bundle OBS, or any other recorder.**

OBS is not headless — it is a GUI application. Shipping it would mean bundling
roughly 400 MB, installing virtual-camera drivers, and taking back every problem
listed in section 1. `libobs` is a C++ integration project, not a dependency.
FFmpeg's own capture devices are the other candidate and are worse: `avfoundation`
screen capture on macOS is a poor fit for TCC permissions, `gdigrab` on Windows
misses hardware-accelerated windows, and audio device naming differs per
platform. None of it is needed when the runtime already captures screens.

Licensing decides this as much as engineering. **OBS is GPLv2**: bundling it into
a distributed application makes that application GPL too. whisper.cpp is MIT.
FFmpeg is LGPL only if built without GPL components such as libx264 — most
prebuilt "static FFmpeg" downloads are GPL builds. For an app that may be handed
to colleagues, that rules OBS out on its own.

Decision: **whisper.cpp instead of a Python venv.**

Rationale:

- It is a single binary with a model file. `faster-whisper` needs Python, pip and
  a virtualenv — acceptable for a developer tool on one machine, hostile as an
  application install. The current venv is 277 MB before any model.
- Metal acceleration on macOS matters, because the Mac is the platform with no
  existing option.
- It supports Swedish and emits segment-level JSON, which is what the
  keyframe correlation needs.
- MIT licensed, so it can be bundled without constraining the app.

## 3b. Media processing: Chromium, not FFmpeg

Decision: **no FFmpeg.** FFmpeg did five things in the old pipeline, and Chromium
does all five, because the file being processed is one Chromium itself produced:

| Job | FFmpeg did | FeedbackRecorder does |
| --- | --- | --- |
| Keyframes | `fps=1/N` | seek a `<video>`, draw to canvas |
| Crop | `-vf crop` | source rectangle in `drawImage` |
| Audio to 16 kHz mono WAV | `-ar 16000 -ac 1` | `AudioContext({ sampleRate: 16000 })` and `decodeAudioData` |
| Duration | `ffprobe` | `video.duration`, after the seek below |
| Narration level | `volumedetect` | measured directly from the decoded samples |

This was an open question until it was measured rather than argued about.
`app/test/electron/` records a synthetic six-second clip in a real Electron
renderer and runs the whole pipeline over it. All fourteen checks pass: VP9/Opus
WebM out of `MediaRecorder`, full resolution preserved, keyframes found at the
points the synthetic screen changed, PNGs with real headers cropped to the
region, audio decoded straight to 16 kHz so no resampling code is needed, and
narration measured at -27.0 dBFS — the same figure real speech produced in the
OBS-based tool.

That removes the last licensing question and roughly 100 MB from every platform
build, and makes the level measurement better rather than worse: the samples are
already in memory, so nothing is decoded twice.

The trap is confirmed too, which is why it is worth naming. WebM written by
`MediaRecorder` carries no duration in its header, and the harness records
`video.duration` as `Infinity` before the element is seeked past the end, and
`5.9` seconds after. Left alone it produces plausible output with no error, which
is the failure mode this project keeps meeting.

If the browser path ever proves insufficient, bundling an LGPL FFmpeg build is
the fallback and changes nothing else in the design.

## 3c. What ships in a build

The app must work immediately after install, with no downloads and no
prerequisites. Measured sizes from the current machine:

| Component | Size | Note |
| --- | --- | --- |
| Electron runtime | ~150 MB | includes the recorder and all media processing |
| whisper.cpp build | ~20 MB | binary plus its CPU backends, per architecture |
| `small` model (GGML) | 488 MB | Swedish-capable, the shipping default |
| `base` model (GGML) | 148 MB | faster, noticeably weaker |
| Silero VAD model | 0.9 MB | measured; too cheap not to ship |

So a complete installer is roughly 660 MB per platform with `small` bundled. That
is the price of "no setup", and it is the right trade for a tool whose whole
point is that the reviewer does not have to prepare anything.

Measured on the development machine: 28.6 seconds of Swedish narration
transcribed in 4.2 seconds on CPU with `small` and VAD enabled, producing six
timestamped segments. The faster-whisper pipeline it replaces returned the same
content as a single undivided block, so the segment-level correlation to
keyframes is better here, not merely preserved.

`small` ships because it is the current default and Swedish quality is the reason
this project exists. `medium` stays an optional download for anyone who wants it;
it is around 1.5 GB and cannot be justified in the base install.

macOS needs both arm64 and x64 builds, or a universal binary; the model file is
architecture-independent and is shared.

## 4. Recording flow and UI states

One window, one column, five states:

1. **Ready.** Microphone device picker with a live level meter and a *Test*
   button; permission status for screen and microphone; a display picker
   (section 4b). Recording is disabled until the microphone
   is either confirmed or explicitly declined.
2. **Recording.** Elapsed time, a live level meter so a mic that dies mid-review
   is visible immediately, and *Stop*. The main window stays out of the way.
3. **Framing.** A still from the recording with a rectangle drawn over it, and a
   scrubber to move through the video. *Use whole screen* is the default and
   Enter accepts it, because most reviews do not need a crop.
4. **Processing.** Progress per step, with anything that degraded stated as it
   happens rather than at the end.
5. **Done.** The package summary: duration, keyframe count, transcript segment
   count, measured narration level, and anything that degraded. A *Copy prompt*
   button and a *Reveal in folder* button.

The level meter appears in the first two states on purpose. Silent narration is
the failure this project has hit most often.

## 4b. Choosing a display

Decision: **one display, chosen before recording, from a picker showing live
thumbnails.**

One rather than all, because recording every display multiplies encode load and
file size for footage nobody will look at, and each display is a separate capture
stream — several video files, several framing steps, and a package that no longer
has one obvious thing in it. The reviewer knows which screen they are about to
review on; unlike a rectangle, that is not a guess they have to make before they
have seen anything. Picking the wrong screen costs a re-record, which is the same
price the current tool pays for the wrong window, and cheaper than carrying the
overhead on every recording that got it right.

Thumbnails rather than names: "Display 2" says nothing about which physical
monitor it is, while a thumbnail is recognisable at a glance.
`desktopCapturer.getSources({ types: ['screen'] })` provides both.

Four things fall out of that decision:

**The picker replaces Chromium's.** `setDisplayMediaRequestHandler` hands the
chosen source straight to the renderer, so Chromium's own picker never opens.
That is wanted: its picker also offers windows and browser tabs, which section 9
drops, and it cannot show the microphone state that has to be checked in the same
breath.

**Capture at the display's native pixel size.** With `chromeMediaSource:
'desktop'` Chromium caps the stream at a low default unless `maxWidth` and
`maxHeight` are set to the display's real resolution — its bounds multiplied by
its scale factor, which differs per monitor in a mixed-DPI setup. This is the
same failure as the OBS install that downscaled a 1920x1080 canvas to a 1280x720
output: the recording looks fine, and the on-screen text in the keyframes is
unreadable. Text in keyframes is the thing the agent actually needs.

**FeedbackRecorder's own window is on one of those displays.** During recording
the main window hides and a small always-on-top bar shows elapsed time, the level
meter and *Stop*. With more than one display the bar goes on a screen that is not
being recorded. With one display it is in the recording, at a known screen edge,
where the framing step can crop it out.

**Displays come and go.** If the chosen display is gone when *Record* is pressed
— a dock unplugged, a lid closed — fall back to the primary one and say so rather
than failing. If it disappears mid-recording, Chromium ends the video track: stop
and process what was captured. A review cannot be performed again from memory.

On macOS the thumbnails double as the permission check. Without Screen Recording
approval `desktopCapturer` returns black images, so an empty-looking picker is
the signal section 8 needs, not a mystery.

## 5. Framing after the recording, not before

Decision: **record the whole screen; choose the rectangle afterwards, before
keyframes are extracted.**

Rationale:

- The reviewer usually does not know what matters until the review is over. A
  rectangle chosen in advance is a guess, and a wrong guess is only discovered
  when the review has already been performed.
- Nothing blocks the start of a recording. *Record* is the first thing the user
  can press.
- The picker draws on a still frame from the video, not on a live transparent
  overlay over the desktop. That removes the always-on-top overlay, the
  multi-monitor overlay problem, and cancelling a drag over a live screen.
- It is repeatable. The source recording is kept, so the region can be changed
  and the package rebuilt without re-recording. Only the region, though: the
  recording holds one display, so re-framing cannot move to another one.

Three consequences worth designing around:

**Transcription starts at *Stop*, not after framing.** The crop affects video
only; the audio and therefore the transcript are identical whatever rectangle is
chosen. Whisper is the slowest step in the pipeline, and framing is the one step
that waits on a human. Running them at the same time makes the transcription
mostly free in wall-clock terms.

**The crop is applied to the keyframes, not to the video.** Cropping frames
during extraction costs nothing; cropping the recording means re-encoding all of
it. The agent never opens the video, so a cropped video file is only worth
producing when the user explicitly wants one to share.

**The region must hold for the whole recording, not for the frame on screen.**
Hence the scrubber: the user has to be able to check that the app did not move
or resize out of the rectangle partway through.

## 6. The package

A timestamped folder, the same shape the CLI produces today, so briefs stay
comparable across both tools:

```text
2026-09-01-101500/
  agent-brief.md      # the handover document
  transcript.txt
  transcript.json     # segments with timestamps
  frames/             # keyframe images, cropped to the chosen region
  recording.webm      # MediaRecorder output, the whole chosen display
  run.json            # what ran, what degraded, measured levels, display, region
```

`MediaRecorder` produces WebM in Chromium. There is no reason to remux: FFmpeg
reads it, and the agent never opens the video anyway.

The full-screen recording is kept rather than deleted, because it is what makes
re-framing possible. `run.json` records the chosen region so a rebuild can start
from the previous choice.

## 7. Handover: the clipboard

Decision: **the app copies a ready-made prompt to the clipboard.** No deep links,
no watched folders, no MCP server.

Rationale:

- It works against every agent — Copilot CLI, a web chat, an editor extension —
  with no integration to build or keep working.
- It matches how the reviewer already behaves: they finish recording and go to
  wherever they were already talking to an agent.

The prompt contains the whole brief, not a path to it, so it also works in a chat
with no file access. The package path is kept at the top, so a local agent can
open the keyframes itself. Images cannot travel through the clipboard as text;
an agent without file access works from the transcript alone, and the prompt says
so rather than silently referring to pictures the reader cannot see.

## 8. Permissions

macOS gates both screen recording and the microphone through TCC, and screen
recording is not granted to a running process: the app must be restarted after
the user approves it. That makes permissions a real UI state, not an error
dialog. The Ready screen shows both, with a button that opens the relevant
System Settings pane and an explicit "restart the app" step for screen recording.

Windows needs no equivalent grant, but the microphone can still be disabled at
the OS level, which is indistinguishable from a muted device until it is
measured. The same panel covers it.

Distribution needs signing on both platforms, and notarization on macOS, or the
app will not open on a colleague's machine.

## 9. Deliberately dropped

- **OBS**, and with it the WebSocket, the crash dialog handling, the scene source
  juggling, the shutdown race, and the capture-readiness checks that existed only
  to verify OBS was pointed at something. Chromium records the screen, so there
  is no recorder to install, bundle or license.
- **System audio.** Only the microphone is recorded. This is a decision, not a
  platform limitation working itself out: it happens to match what macOS allows,
  but it is right on Windows too.

  It keeps the audio track clean for Whisper. Music, a Teams call, notification
  sounds — non-speech audio is exactly what makes Whisper invent segments, and
  this project has already measured that happening. It also means a review can be
  recorded during a call without capturing anyone else in it. The cost is that a
  sound made by the app under review is not in the recording, which does not
  matter for a brief built from narration and frames.
- **Window capture.** Recording the whole screen and framing afterwards covers
  the same need without having to track a window. The trade is that the region
  does not follow a window that moves during the review; the scrubber in the
  framing step is what makes that visible.
- **Recording every display at once.** One display is chosen up front instead
  (section 4b).
- **The `analyze` step.** The clipboard prompt goes to an agent that can do the
  same work with better context.

## 10. Retiring the PowerShell tool

The CLI in `scripts\` is replaced by the app, not kept alongside it. It is
Windows-only, it depends on OBS, and every problem in section 1 is one it owns.
Two tools producing near-identical packages would also mean two places to fix
whatever the next review exposes.

It is retired **at parity, not before**. Parity means the app can, on Windows and
macOS: record with a verified microphone, frame a region after the fact, extract
keyframes, transcribe Swedish locally, correlate segments to frames, report the
narration level, and copy a working prompt — with the fail-soft behaviour of
section 2 intact.

The installed Copilot skill goes with it. Its job was to teach an agent to drive
the CLI; a clipboard prompt needs no skill, because it explains itself to whatever
agent receives it. `scripts\install-skill.ps1 -Uninstall` removes it.

The repository and app are called `FeedbackRecorder`. The legacy CLI is still
`scripts\review-recorder.ps1`; renaming that file before the CLI is retired
would break the installed skill, which hardcodes its path.

## 11. Open questions

- Should re-framing an existing package be a first-class action in the UI, or
  only something that happens right after a recording?
- Is a spoken review always for an agent, or should the app also produce a plain
  shareable recording? That is also what decides whether a cropped video file is
  ever written.
- macOS has no prebuilt whisper.cpp in the project's releases, so a build has to
  be produced during packaging. That is a build-pipeline question, not a design
  one, but it is the last thing standing between this and a macOS installer.
