# User guide

FeedbackRecorder turns a new screen recording or an existing video into a local
package and an agent-ready prompt. This guide covers the complete user workflow.
For installation, start with [Getting started](GETTING_STARTED.md). For exact
data handling and network behavior, use [Privacy](PRIVACY.md).

## Record or import

### Record a screen

1. Choose a display. On macOS, you can also choose an app window, including one
   in another full-screen Space.
2. Choose a microphone if you want narration. Select **Test** and speak normally
   to check the level reaches the marked band.
3. Choose the language you will speak under **Settings → Transcription**.
   Selecting a language is more reliable; **Detect automatically** is useful
   when it is unknown.
4. Select **Record**.

The main window gets out of the way. The compact controller shows elapsed time,
microphone level, **Discard**, and **Stop**. The setup screen and Stop button
show the global stop shortcut when the operating system lets the app register
it. Discarding asks for confirmation and removes the unfinished package.

Only the selected microphone is recorded for a new capture. System audio is not
captured. An imported video can already contain its own audio.

### Import an existing video

Drop one video onto the setup screen or choose **Choose a video…**. Common MP4
and WebM recordings work when Electron can decode their contents. The app copies
the video into a new package, reads its audio, and joins the same framing and
handoff workflow as a new recording.

## Frame and reframe

The whole picture is selected initially. Drag a rectangle around the interface
region the agent should inspect, then scrub through the timeline to confirm the
subject stays inside it. A small click without a drag returns to the full frame.

The region affects keyframe screenshots, not the stored recording. On the
handoff screen, **Back to framing** rebuilds the package from the same recording
and transcript, so no second capture is needed.

## Review keyframes and add context

FeedbackRecorder samples moments where the framed image meaningfully changes.
It avoids timer-based screenshot spam and records returns to an earlier image
without saving a duplicate PNG.

On **Ready to hand over**:

- use the arrows or slider to move between keyframes;
- click the image to enlarge it;
- write a comment that applies to the current keyframe;
- put cross-cutting constraints or a fully written request under **Additional
  instructions**.

Comments and general instructions are saved into the brief, copied prompt,
`notes.txt`, `run.json`, and exported zip. Written-only handoffs are supported;
narration is not required.

## Copy or export the handoff

**Copy prompt for an agent** copies the text brief with narration, written
context, visual references, and input chronology. Paste it into the coding
assistant or issue draft you chose.

The prepared zip can be dragged into a compatible chat, message, or folder.
Clicking it saves a copy. **Save as zip…** provides the same result through a
save dialog.

The zip always includes the brief, transcript, keyframes, written notes when
present, privacy-filtered input chronology when present, and `run.json`. Two
options are off by default:

- **Include the video** adds the raw recording or imported video.
- **Include the audio recording** adds `narration.wav`, the voice sent to the
  local transcriber.

The default zip is smaller and excludes those two media files, but it can still
contain private screen content, spoken words, notes, and local paths. Inspect
every export before sharing.

## Settings

Open the gear on the setup screen.

**Appearance** can be light, dark, or follow the operating system.

**Transcription** selects the spoken language. Speech recognition runs locally
using the bundled model.

**Clicks and keyboard activity** is available on macOS. When enabled:

- clicks, double-clicks, right-clicks, scrolling, shortcuts, and navigation keys
  can be timestamped;
- ordinary typed characters are filtered before they reach the app, and only
  their count is stored;
- Accessibility and Input Monitoring permission are required.

**Where recordings and zips are saved** changes the package and export folder.
The default avoids known OneDrive, iCloud, and Dropbox locations when possible.
A warning appears when a chosen folder looks synchronized, but detection is
best-effort.

FeedbackRecorder checks GitHub for update metadata at startup. No installer is
downloaded until you choose to update. Windows and macOS can replace the current
copy and reopen; Linux downloads the new AppImage and shows it in the file
manager. The download is verified against the release checksum before use.

## Package contents

A package can contain:

```text
agent-brief.md      self-contained handoff text
notes.txt           general and keyframe comments, when present
transcript.txt      spoken narration
transcript.json     timestamped narration segments
input-events.txt    readable input chronology, when captured
input-events.jsonl  machine-readable input chronology, when captured
narration.wav       microphone or imported-video audio used locally
frames/             selected, framed keyframe PNGs
recording.webm      new screen recording, or an imported file with its own extension
run.json            build, timing, source, crop, notes, transcript, paths, and diagnostics
```

`run.json` can repeat transcript and note content and can contain local absolute
paths. Do not post it publicly without inspecting and sanitizing it.

## Safe sharing

Before pasting a prompt or sending a zip:

1. Read the brief, transcript, notes, and visible screenshots.
2. Check for credentials, tokens, private messages, customer or company data,
   and local paths.
3. Leave video and voice audio excluded unless the recipient needs them.
4. Choose the destination deliberately; a paste, drag, export, or synchronized
   folder is controlled by that destination after it leaves FeedbackRecorder.

See [Privacy](PRIVACY.md) for the authoritative data inventory and network
destinations.

## Troubleshooting

### Record does nothing on macOS

Enable FeedbackRecorder under **System Settings → Privacy & Security → Screen
Recording**, then use **Restart FeedbackRecorder**. macOS applies the grant to a
new process.

### FeedbackRecorder is missing from a macOS permission list

Open the app and let it request the permission first. macOS does not list an app
until it has asked.

### The transcript is empty

Check the selected microphone and use **Test** before another recording. Very
quiet audio is intentionally not sent to speech recognition because near-silence
can produce invented text.

### An imported video will not open

The extension is only an initial filter; the codecs inside must also be
decodable by Electron. Convert the video to a common MP4 or WebM codec and try
again.

### Windows blocks the installer

At **Windows protected your PC**, choose **More info → Run anyway**. If that
choice is absent, Smart App Control or an organization policy may prohibit
unsigned apps.

### macOS blocks or calls the app damaged

Use the exact [macOS installation steps](GETTING_STARTED.md#macos), including
**System Settings → Privacy & Security → Open Anyway**. Confirm the architecture
and download again before using the documented `xattr` recovery command.

### A bug needs diagnostic output

Run the installed executable with `--selftest`, then remove usernames, local
paths, device names, and other private material before copying relevant lines
into a bug report. Never attach `run.json`, recordings, narration audio,
transcripts, notes, credentials, or private screenshots to a public issue.
