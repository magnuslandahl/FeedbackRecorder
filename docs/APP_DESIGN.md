# Standalone app design

Status: **proposal, nothing built.** This describes a cross-platform desktop app
that replaces the OBS + PowerShell pipeline with a single application. The
PowerShell CLI in `scripts\` keeps working until the app produces an equivalent
package.

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

Decision: **Electron**.

Rationale:

- `getDisplayMedia` (via `setDisplayMediaRequestHandler` in the main process)
  and `getUserMedia` provide screen and microphone capture on both platforms
  through one API, with Chromium handling the platform differences.
- `MediaRecorder` writes the file without a bundled encoder.
- The framing step is a still image and a rectangle drawn on a canvas, which is
  ordinary web UI.
- Shelling out to helper binaries is already how the current tool works.

Tauri is the lighter alternative, but screen and audio capture would have to be
written per platform. That is the riskiest part of the project, so it should sit
on the most travelled path, not the least.

Decision: **whisper.cpp instead of a Python venv.**

Rationale:

- It is a single binary with a model file. `faster-whisper` needs Python, pip and
  a virtualenv — acceptable for a developer tool on one machine, hostile as an
  application install.
- Metal acceleration on macOS matters, because the Mac is the platform with no
  existing option.
- It supports Swedish and emits segment-level JSON, which is what the
  keyframe correlation needs.

Decision: **bundle a static FFmpeg build.**

FFmpeg does keyframes, audio extraction, cropping, and duration probing. It stays
for the same reasons as before; it just ships with the app instead of being a
prerequisite.

## 4. Recording flow and UI states

One window, one column, five states:

1. **Ready.** Microphone device picker with a live level meter and a *Test*
   button; permission status for screen and microphone; a display picker when
   more than one screen is connected. Recording is disabled until the microphone
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
  and the package rebuilt without re-recording.

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
  recording.webm      # MediaRecorder output, full screen
  run.json            # what ran, what degraded, measured levels, the region
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
  to verify OBS was pointed at something.
- **Window capture.** Recording the whole screen and framing afterwards covers
  the same need without having to track a window. The trade is that the region
  does not follow a window that moves during the review; the scrubber in the
  framing step is what makes that visible.
- **The `analyze` step.** The clipboard prompt goes to an agent that can do the
  same work with better context.

## 10. Open questions

- Does the PowerShell CLI stay, or is it retired once the app is at parity? It
  currently has an installed Copilot skill pointing at it.
- Multi-monitor: is picking a display before recording good enough, or should the
  app record every display and let the framing step choose between them?
- Should re-framing an existing package be a first-class action in the UI, or
  only something that happens right after a recording?
- Which whisper.cpp model ships, and is it downloaded on first run or bundled?
  `small` is the current default and is roughly 500 MB in GGML form.
- Is a spoken review always for an agent, or should the app also produce a plain
  shareable recording? That is also what decides whether a cropped video file is
  ever written.
