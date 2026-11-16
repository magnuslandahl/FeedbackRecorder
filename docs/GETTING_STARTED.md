# Getting started

This guide takes a first-time user from the right download to a complete
FeedbackRecorder handoff. For every setting and export option, continue with the
[User guide](USER_GUIDE.md).

## 1. Choose a download

Each installer is about 1 GB because it includes the speech-recognition model
used for local transcription. You do not need a separate model download.

| Computer | Architecture | Download |
| --- | --- | --- |
| Windows 10 or 11 | x86-64 | [`FeedbackRecorder-Windows-x64-Setup.exe`](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-Windows-x64-Setup.exe) |
| Mac from late 2020 or newer | Apple Silicon (`arm64`, M1 or newer) | [`FeedbackRecorder-macOS-arm64.dmg`](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-macOS-arm64.dmg) |
| Older Mac | Intel (`x64`) | [`FeedbackRecorder-macOS-x64.dmg`](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-macOS-x64.dmg) |
| Linux | x86-64 | [`FeedbackRecorder-Linux-x86_64.AppImage`](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-Linux-x86_64.AppImage) |

On a Mac, open **Apple menu → About This Mac**. A chip named Apple M1 or newer
needs `arm64`; a processor named Intel needs `x64`.

macOS releases are signed with the Rabamba AB Developer ID and notarized by
Apple. Windows installers are unsigned, so Windows shows a warning the first
time. Read the steps for your platform before installing.

## 2. Install

### Windows

1. Open `FeedbackRecorder-Windows-x64-Setup.exe`.
2. At the blue **Windows protected your PC** dialog, choose **More info**.
3. Choose **Run anyway**, finish setup, and open FeedbackRecorder from the Start
   menu.

If **Run anyway** is unavailable, Smart App Control or an organization policy
may be blocking unsigned software. FeedbackRecorder cannot override that policy.

### macOS

1. Open the `.dmg` and drag **FeedbackRecorder** into **Applications**.
2. Open the app from Applications. macOS asks whether you want to open an app
   downloaded from the internet; choose **Open**.

That is the whole installation for a copy from the
[releases page](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest).

A copy built from source or from a fork is not signed by Rabamba AB, so macOS
refuses it the first time. To open it anyway:

1. At the first refusal, choose **Done**, not **Move to Trash**.
2. Open **System Settings → Privacy & Security**, scroll to the FeedbackRecorder
   message, choose **Open Anyway**, then confirm **Open**.

The **Open Anyway** button appears only after that first refusal. This is the
primary route on macOS 15, where Control-click is no longer a dependable
first-launch method.

If macOS says the app **is damaged and can't be opened**, do not move it to the
Trash. Confirm that the architecture is correct and download it again. For a
copy that is not from the releases page, remove the quarantine marker from this
app instead:

```bash
xattr -dr com.apple.quarantine /Applications/FeedbackRecorder.app
```

No `sudo` is needed. See [Signing](SIGNING.md) for how releases are signed.

### Linux

```bash
chmod +x FeedbackRecorder-Linux-x86_64.AppImage
./FeedbackRecorder-Linux-x86_64.AppImage
```

## 3. Allow the permissions you want

- **Screen Recording** is required to record a screen or app window.
- **Microphone** is required only for spoken narration.
- On macOS, optional input chronology uses **Accessibility** for clicks and
  **Input Monitoring** for shortcuts, navigation keys, and redacted typing
  counts.
- On Windows, optional input chronology needs no extra system permission; it
  records clicks and redacted keyboard activity only during a new recording.

After changing a macOS permission, use **Restart FeedbackRecorder** in the app.
An imported video does not need Screen Recording or Microphone permission.

## 4. Make the first capture

To record:

1. Choose a microphone, or leave narration unavailable and record without it.
2. Choose the display or macOS app window. Set **Language you speak** under
   **Settings → Recording** if needed; the same group has the **Record clicks
   and keys** switch.
3. Select **Record**, explain the desired outcome while showing it, then use the
   compact controller or its displayed shortcut to stop.

Under **Settings → General**, change **Save recordings in** or **Appearance**.
The version and **Check for updates** are at the bottom; an available update
appears in a banner at the top.

To import:

1. Drop one existing screen recording onto the setup screen, or choose
   **Choose a video…**.
2. Wait while FeedbackRecorder reads the local file.

Imported audio is transcribed in the same local pipeline as new narration.

## 5. Frame and annotate

Drag a rectangle around the stable part of the interface that matters. Scrub
through the timeline to verify that the selection still contains the subject,
then continue.

On the handover page, write context for the whole walkthrough in **Notes for
the agent**, then choose **Review ›** on the screenshot row when you need to:

1. Select screenshot visits in the filmstrip or with the arrows, and zoom or
   enlarge a screenshot.
2. Add a note for the selected visit.
3. Open **Transcript** to read or correct the words.
4. Click **Frame** in the step bar to go back if the crop needs
   adjustment, then **Update screenshots**; the recording and transcript are
   reused. **Cancel** returns without changes.

Notes save automatically. **Done**, **Back to hand over** or Esc leaves review.

## 6. Hand it over

- **On this computer → Copy prompt** copies a short instruction pointing
  to the saved recording folder. Paste it into an agent with local file access.
  The prompt is hidden until you choose **Show prompt**; copying does not require
  showing it.
- **Attach to a chat** lets you drag the prepared ZIP into a compatible chat or
  folder. Write what you need; **Copy message** offers suggested wording when
  useful.
- **Save ZIP…** saves the same prepared archive through a save dialog.
  The **Video** and **Audio** chips apply to both dragging and saving.
- **Copy as text** copies narration, notes and screenshot references without
  images. **Open folder** opens the saved package.

Secondary actions sit below the card. Video and Audio are off by default, show
their sizes when selected, and are disabled if unavailable.

Every completed recording stays in **History**, accessible from the clock icon
or **Kept in History** in the footer. **Record another** reminds you of this
if you have not handed over a new recording yet; **Stay here** keeps it open.

The default zip excludes the raw video and `narration.wav`, but it includes
screenshots, transcript, written notes, input chronology when available, and
`run.json`. Inspect it before sharing; `run.json` is not safe to post blindly.
The canonical data-flow details are in [Privacy](PRIVACY.md).
