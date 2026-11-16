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

The main window gets out of the way. A red frame marks the screen being
recorded, while the compact controller shows elapsed time, microphone level,
**Pause**, and a split **Stop** button. The frame does not intercept clicks and is excluded
from the captured video where the operating system supports capture protection.
If the controller or border appears in the recorded picture, frame it out before
handoff.
The controller sits at the top center of the recorded screen. Its Stop button
shows the global stop shortcut if one is available; the shortcut remains a
fallback if an exclusive full-screen app covers the controller. Discarding asks
for confirmation and removes the unfinished package: open the arrow beside
**Stop**, then choose **Discard recording…**.

Select **Pause** when you need an interruption. The controller says **Paused**,
the timer freezes, and the microphone is muted. Select **Resume** to continue the
same recording. Paused video, narration, and input activity are omitted; later
dictation, frames, and clicks stay on the same shortened timeline. You can also
stop or discard while paused without resuming first.

Only the selected microphone is recorded for a new capture. System audio is not
captured. An imported video can already contain its own audio.

### Import an existing video

Drop one video onto the setup screen or choose **Choose a video…**. Common MP4
and WebM recordings work when Electron can decode their contents. The app copies
the video into a new package, reads its audio, and joins the same framing and
handoff workflow as a new recording.
The video import row stays at the bottom of the setup view while the screen
picker scrolls independently. The header stays visible at the top.

## Frame and reframe

The whole picture is selected initially. Drag a rectangle around the interface
region the agent should inspect, then scrub through the timeline to confirm the
subject stays inside it. A small click without a drag returns to the full frame.

The region affects keyframe screenshots, not the stored recording. On the
handover page, click **Frame** in the step bar to go back and change it. The
screen is titled **Adjust the framing**: **Update screenshots** rebuilds the
package from the same recording and transcript, so no second capture is needed,
and **Cancel** (or **Hand over** in the step bar) returns without changing
anything. General notes and transcript corrections are kept; a screenshot note
is kept when a screenshot still exists at that moment.
While keyframes are being found, **Cancel and go back to framing** stops without
changing the package.

## Review screenshots and add notes

FeedbackRecorder samples moments where the framed image meaningfully changes.
This includes thin selection and focus outlines, even when the rest stays still.
It avoids timer-based screenshot spam and records returns to an earlier image
without saving a duplicate PNG. An unchanged screen is saved once; remaining on
it is not reported as leaving and returning.

On **Ready to hand over**, write general context or a fully written request in
**Notes for the agent**. Notes are optional; saving is announced while it happens
and briefly confirmed afterward. The screenshot row shows the screenshot count.
Choose **Review ›** anywhere on that row to open a separate review view:

- use the filmstrip, arrows or left/right arrow keys to select a screenshot
  visit, including every return to an earlier screen;
- write a separate note for each visit, even when the screenshot is reused;
- use the zoom buttons and scroll within the preview to inspect details;
- click the screenshot or the enlarge icon for a larger view;
- open **Transcript** to read or correct the words, or **Details** for package
  information.

**Back to hand over**, **Done** or Esc returns to the handover page. Notes and
transcript corrections save automatically; leaving review saves pending edits.

Notes are saved into the brief, the text copied by **Copy as text**,
`notes.txt`, `run.json`, and exported zip. Written-only handoffs are supported;
narration is not required.

The speech line shows speech timed to the selected visit, not every
sentence associated with the same image. A sentence spanning a screen change is
shown on each overlapping frame and labelled accordingly: word-level timing is
not available. The brief, the copied text and the JSON transcript preserve those
timeline associations. Older packages also open with all their saved returns.

## Copy or export the handoff

**On this computer** is the default route. **Copy prompt** copies a short
instruction pointing to the persistent recording folder and `agent-brief.md`.
Paste it into an agent that can read files on this computer; no attachment is
needed. If its sandbox cannot access that folder, use the attachment route.
**Show prompt** reveals the full instruction; **Hide prompt** hides it again.
The prompt starts hidden for each recording and does not need to be shown to copy it.

**Attach to a chat** shows a ZIP you can drag into a compatible chat, message,
or folder. Write what you need in the chat; **Copy message** offers a suggested
wording when useful, but copying it is not a required step. The ZIP tile shows
its size; its tooltip and accessible description list the contents.

The ZIP is prepared automatically when the handover page opens. Saved comments,
transcript corrections, and media selections rebuild it; the drag handle stays
unavailable until the current archive is ready. Clicking it or choosing
**Save ZIP…** saves a copy of that same archive through a save dialog.

**Copy as text** copies narration, notes,
visual references, and input chronology without attaching images.
**Open folder** opens the original package folder.
These secondary actions sit below the card. On the chat route, **Copy message**
and the keyboard-accessible **Save ZIP…** button are there too.

The zip always includes the brief, transcript, keyframes, written notes when
present, privacy-filtered input chronology when present, and `run.json`. Two
options are off by default:

- The **Video** chip adds the raw recording or imported video.
- The **Audio** chip adds `narration.wav`, the voice sent to the
  local transcriber.

These options apply to both dragging and saving the ZIP.
Their added sizes appear only when selected; unavailable media chips are disabled.

The default zip is smaller and excludes those two media files, but it can still
contain private screen content, spoken words, notes, and local paths. Inspect
every export before sharing.

## Earlier recordings

The clock button in the header opens **Recordings**: every package in the save
folder, newest first, with its first keyframe, date, length, frame count, and
the start of its notes or transcript. Type in the search box to filter by words
from comments, notes, the transcript, or the date.

Opening a recording shows it on the same handover page as a new one. Notes
and general instructions can be edited and are saved back into that package,
and both handover routes and **Save ZIP…** work as before. Framing
cannot be changed on a reopened recording.

**Kept in History** in the handover footer opens this list too. If you choose
**Record another** before copying, exporting, dragging the ZIP or opening the
folder, a **Saved in History** popup explains where the recording stays.
**Stay here** (or Esc) keeps it open; **Record another** saves pending edits and
returns to Set up. Recordings reopened from History do not show this popup.

The folder button shows a recording in the file manager. The trash button asks
first, then moves the whole package folder to the system trash. A recording
that was never finished, for example because the app closed while processing,
is listed but can only be shown in its folder or deleted. **Back** or Esc
returns to where you were.

## Settings

Open the gear on the setup screen.
The main window remembers its last resized width and height on the next launch;
if the display is smaller, the window fits within the available screen.

**Version and updates** shows the installed build, offers a manual check, and
shows available updates. A dot on the gear indicates a newer release.

**Appearance** can be light, dark, or follow the operating system.
On Windows and macOS, the window controls share the app header instead of a
separate title strip. Drag an empty part of the header to move the window.
Windows keeps its native window buttons and macOS keeps its traffic lights;
in narrow windows the progress steps sit on a second row.

**Transcription** selects the spoken language. Speech recognition runs locally
using the bundled model.

**Clicks and keyboard activity** is available on macOS and Windows. When enabled:

- clicks, double-clicks, right-clicks, scrolling, shortcuts, and navigation keys
  can be timestamped;
- ordinary typed characters are filtered before they reach the app, and only
  their count is stored;
- on macOS, Accessibility and Input Monitoring permission are required; Windows
  needs no additional permission, but desktop-session policy may restrict hooks.

The input helper starts only for a new recording, not for video imports or while
the app is idle. Mouse motion between clicks is not logged. On Windows,
Ctrl+Alt printable keys (including AltGr typing) are counted without key codes.
On Windows, the setup indicator briefly checks whether the helper can install
both hooks in the current desktop session; they are removed immediately after
the check and installed again only while recording.

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
notes.txt           general instructions and per-visit frame comments, when present
transcript.txt      spoken narration
transcript.json     timestamped narration with frame-occurrence references
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

A copy from the releases page is notarized and should open after one
confirmation. If it is refused or called damaged, confirm the architecture and
download it again. For a copy that is not from the releases page, use the
[macOS installation steps](GETTING_STARTED.md#macos), including
**System Settings → Privacy & Security → Open Anyway** and the documented
`xattr` recovery command.

### A bug needs diagnostic output

Run the installed executable with `--selftest`, then remove usernames, local
paths, device names, and other private material before copying relevant lines
into a bug report. Never attach `run.json`, recordings, narration audio,
transcripts, notes, credentials, or private screenshots to a public issue.
