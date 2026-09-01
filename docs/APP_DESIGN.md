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
- A transparent, always-on-top, full-screen window is a straightforward way to
  build the drag-a-rectangle picker, on both platforms.
- `MediaRecorder` writes the file without a bundled encoder.
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

One window, one column, four states:

1. **Ready.** Microphone device picker with a live level meter and a *Test*
   button; permission status for screen and microphone; a *Select area* button.
   Recording is disabled until the area is chosen and the microphone is either
   confirmed or explicitly declined.
2. **Selecting.** The window hides, a transparent overlay covers the screens, the
   user drags a rectangle. Escape cancels. The chosen rectangle is remembered
   between sessions.
3. **Recording.** Elapsed time, a live level meter so a mic that dies mid-review
   is visible immediately, and *Stop*. The main window stays out of the way.
4. **Done.** The package summary: duration, keyframe count, transcript segment
   count, measured narration level, and anything that degraded. A *Copy prompt*
   button and a *Reveal in folder* button.

The level meter appears in three of the four states on purpose. Silent narration
is the failure this project has hit most often.

## 5. Region capture

Chromium cannot capture an arbitrary rectangle; it captures a display or a
window. Two ways to get a rectangle:

- **Crop during processing.** Record the full display, then `ffmpeg -vf crop`.
  Simple, and the region can be changed afterwards without re-recording.
- **Crop live** by drawing the region into a canvas and recording
  `canvas.captureStream()`. No full-screen video is ever written, at the cost of
  continuous CPU during the review.

Proposed: crop during processing, and delete the full-screen source file once the
package is complete unless the user opts to keep it. Re-encoding a review live is
a poor trade when the machine may also be running the app being reviewed. The
privacy argument for live cropping is real but weaker than it looks, since the
source file never leaves the machine.

This needs to be decided before the capture code is written; it is the one choice
that is expensive to reverse.

## 6. The package

A timestamped folder, the same shape the CLI produces today, so briefs stay
comparable across both tools:

```text
2026-09-01-101500/
  agent-brief.md      # the handover document
  transcript.txt
  transcript.json     # segments with timestamps
  frames/             # keyframe images
  recording.webm      # MediaRecorder output, cropped
  run.json            # what ran, what degraded, measured levels
```

`MediaRecorder` produces WebM in Chromium. There is no reason to remux: FFmpeg
reads it, and the agent never opens the video anyway.

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
- **Window capture.** A rectangle is simpler to explain and to implement, and it
  is what the reviewer usually wants. It does not follow a window that moves;
  that trade is worth stating in the UI rather than solving.
- **The `analyze` step.** The clipboard prompt goes to an agent that can do the
  same work with better context.

## 10. Open questions

- Does the PowerShell CLI stay, or is it retired once the app is at parity? It
  currently has an installed Copilot skill pointing at it.
- Multi-monitor: does the overlay span all displays, or does the user pick a
  display first?
- Which whisper.cpp model ships, and is it downloaded on first run or bundled?
  `small` is the current default and is roughly 500 MB in GGML form.
- Is a spoken review always for an agent, or should the app also produce a plain
  shareable recording?
