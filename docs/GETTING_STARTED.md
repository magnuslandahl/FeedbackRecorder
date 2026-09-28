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

Current installers are unsigned on Windows and are not Developer ID signed or
notarized on macOS. Read the warning for your platform before installing.

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
2. Open the app from Applications. At the first refusal, choose **Done**.
3. Open **System Settings → Privacy & Security**, scroll to the FeedbackRecorder
   message, choose **Open Anyway**, then confirm **Open**.

The **Open Anyway** button appears only after step 2. This is the primary route
on macOS 15, where Control-click is no longer a dependable first-launch method.

If macOS says the app **is damaged and can't be opened**, do not move it to the
Trash. Confirm that the architecture is correct, download it again, or remove
the quarantine marker from this app:

```bash
xattr -dr com.apple.quarantine /Applications/FeedbackRecorder.app
```

No `sudo` is needed. See [Signing](SIGNING.md) for why the warning appears and
what signing would change.

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

After changing a macOS permission, use **Restart FeedbackRecorder** in the app.
An imported video does not need Screen Recording or Microphone permission.

## 4. Make the first capture

To record:

1. Choose a microphone, or leave narration unavailable and record without it.
2. Choose the display or macOS app window.
3. Select **Record**, explain the desired outcome while showing it, then use the
   compact controller or its displayed shortcut to stop.

To import:

1. Drop one existing screen recording onto the setup screen, or choose
   **Choose a video…**.
2. Wait while FeedbackRecorder reads the local file.

Imported audio is transcribed in the same local pipeline as new narration.

## 5. Frame and annotate

Drag a rectangle around the stable part of the interface that matters. Scrub
through the timeline to verify that the selection still contains the subject,
then continue.

On the handoff screen:

1. Move through the selected keyframes and click one to enlarge it.
2. Add a comment to a keyframe when the image needs a specific instruction.
3. Add general instructions for constraints or context that apply to the whole
   walkthrough.
4. Use **Back to framing** if the crop needs adjustment; the recording and
   transcript are reused.

## 6. Hand it over

- **Copy prompt for an agent** copies a self-contained text brief.
- Drag the prepared zip into a compatible chat or folder.
- **Save as zip…** writes a copy and offers explicit video and voice-audio
  options.

The default zip excludes the raw video and `narration.wav`, but it includes
screenshots, transcript, written notes, input chronology when available, and
`run.json`. Inspect it before sharing; `run.json` is not safe to post blindly.
The canonical data-flow details are in [Privacy](PRIVACY.md).
