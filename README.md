# FeedbackRecorder

**Show a problem instead of writing it down.** Record your screen while you talk
through what is wrong, and FeedbackRecorder turns it into a written brief that an
AI coding assistant — GitHub Copilot, Claude, ChatGPT — can act on.

You talk. It records the screen, writes down what you said, picks out the
screenshots that matter, and puts the whole thing on your clipboard. You paste it
into a chat with your coding assistant, and it knows what you saw and what you
meant.

Everything happens on your own computer. Nothing is uploaded anywhere.

---

## Download

Pick the one file that matches your computer and open it. There is nothing else
to install, and no account to create.

| Your computer | Download |
| --- | --- |
| **Windows 10 or 11** | [FeedbackRecorder Setup for Windows](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-Windows-x64-Setup.exe) |
| **Mac with Apple chip** (M1/M2/M3/M4, 2020 and later) | [FeedbackRecorder for Apple Silicon](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-macOS-arm64.dmg) |
| **Mac with Intel chip** (before 2020) | [FeedbackRecorder for Intel Macs](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-macOS-x64.dmg) |
| **Linux** | [FeedbackRecorder AppImage](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest/download/FeedbackRecorder-Linux-x86_64.AppImage) |

Everything is also on the
[releases page](https://github.com/magnuslandahl/FeedbackRecorder/releases/latest).

> **Not sure which Mac you have?** Click the Apple menu → *About This Mac*. If it
> says *Apple M1*, *M2*, *M3* or *M4*, take the Apple Silicon download. If it says
> *Intel*, take the Intel one.

**The download is about 1 GB.** That is large for an app, and it is deliberate:
the speech-recognition model is inside it. That is what lets the app understand
what you said without sending your voice to anyone's server.

---

## Installing

The app is not yet signed with a paid developer certificate, so **your computer
will warn you the first time you open it**. The warning means "we cannot confirm
who made this", not "we found something harmful". Here is how to get past it.

### Windows

1. Open the downloaded `FeedbackRecorder-Windows-x64-Setup.exe`.
2. If a blue window says **"Windows protected your PC"**, click **More info**,
   then **Run anyway**.
3. Follow the installer, then start FeedbackRecorder from the Start menu.

### Mac

1. Open the downloaded `.dmg` file and drag **FeedbackRecorder** into your
   **Applications** folder.
2. Open **Applications**, then **right-click** (or Control-click) FeedbackRecorder
   and choose **Open**. Choose **Open** again in the dialog that appears.
   Double-clicking will not work the first time — right-clicking is what gives you
   the *Open* button.
3. If macOS says the app **"is damaged and can't be opened"**, open the
   **Terminal** app, run the line below, and try again:

   ```bash
   xattr -cr /Applications/FeedbackRecorder.app
   ```

4. The first time you record, macOS asks for **Screen Recording** and
   **Microphone** permission. Allow both. macOS only applies Screen Recording
   after the app restarts, so quit FeedbackRecorder and open it again.

### Linux

Make the downloaded file runnable, then start it:

```bash
chmod +x FeedbackRecorder-Linux-x86_64.AppImage
./FeedbackRecorder-Linux-x86_64.AppImage
```

---

## Using it

1. **Get ready.** Choose your microphone and say a few words to check that the
   level meter moves. Choose the screen you want to record.
2. **Record.** Press *Record* and talk through what you are showing. The window
   gets out of the way, and a small bar shows the elapsed time and your microphone
   level. Press *Stop* when you are done.
3. **Frame it.** Drag a rectangle around the part that matters — a panel, a form,
   one button — and drag through the timeline to check it still fits. Or keep the
   whole screen.
4. **Wait a moment.** The app picks out the moments where the screen changed and
   writes down what you said.
5. **Copy the prompt.** Press *Copy prompt* and paste it into a chat with your
   coding assistant. The brief travels with it, so it works even in a chat that
   cannot open files.

**Speak normally, and say what you mean rather than what you see.** "This button
should be on the right" is something an assistant can act on. Silence with a lot
of mouse movement is not.

Swedish and English both work, along with the other languages Whisper supports.

---

## What you get

Each recording is saved in its own folder, inside a `FeedbackRecorder` folder in
your Videos folder:

```text
2026-09-01-113000/
  agent-brief.md      the written handover, which is what you paste
  transcript.txt      what you said
  transcript.json     what you said, with timestamps
  narration.wav       the audio that was transcribed
  frames/             screenshots from the moments that mattered
  recording.webm      the full screen recording
  run.json            what the app measured, and anything it had to skip
```

You can open, keep or delete any of it.

---

## Your privacy

- The screen recording, your voice and the transcript **never leave your
  computer**. There is no server, no account and no tracking.
- Speech recognition runs locally, using a model bundled inside the app.
- Only the **microphone** is recorded. Sound playing on your computer — music,
  calls, notifications — is never captured.
- Recordings stay out of cloud sync. If your Videos folder is synced to OneDrive,
  iCloud or Dropbox, the app saves to your home folder instead, so screen
  recordings are not uploaded without you asking.

You decide what to share, by pasting the brief where you want it.

---

## If something goes wrong

**The transcript is empty.**
The app reports the volume it measured when this happens. Usually the microphone
was muted, or was not the one you spoke into. The app deliberately refuses to
transcribe audio it has measured as too quiet, because speech recognition invents
plausible sentences out of near-silence, and a made-up transcript is worse than
none.

**Nothing happens when I press Record on a Mac.**
macOS needs Screen Recording permission and only applies it after the app
restarts. Go to *System Settings → Privacy & Security → Screen Recording*, switch
FeedbackRecorder on, then quit and reopen the app.

**Windows says it protected my PC.**
Click *More info*, then *Run anyway*. See [Installing](#installing).

**My Mac says the app is damaged.**
It is not. The message means the app is unsigned. Run
`xattr -cr /Applications/FeedbackRecorder.app` in Terminal. See
[Installing](#installing).

**Something else.**
Please [open an issue](https://github.com/magnuslandahl/FeedbackRecorder/issues/new)
and say what you did and what happened. The `run.json` file from the recording
folder is useful to attach: it records what the app measured, and contains none of
your recording.

---

## For developers

```bash
cd app
npm install
npm run vendor    # whisper.cpp and the speech models, ~500 MB, not in git
npm start
```

```bash
npm test              # pure logic: regions, keyframes, narration, briefs
npm run test:pipeline # the media pipeline, in a real Electron renderer
npm run test:ui       # the real UI boots and renders
npm run dist          # a real installer for the current platform
```

On macOS, `npm run vendor` compiles whisper.cpp from source, because the project
publishes no prebuilt macOS command-line binary. That needs `cmake`
(`brew install cmake`) and the Xcode command line tools.

`app/README.md` explains how the app is put together and what each test proves.
`docs/APP_DESIGN.md` is the design it follows, including why OBS and FFmpeg were
both removed.

Every change goes through a pull request; `main` is protected and cannot be
pushed to directly. See [CONTRIBUTING.md](CONTRIBUTING.md). Installers for all
platforms are built from `main` automatically by
[the release workflow](.github/workflows/release.yml).

### The older PowerShell tool

`scripts/review-recorder.ps1` is the Windows-only prototype this app replaces. It
drives OBS and needs FFmpeg and Python installed. It still works and is still
tested, but the app supersedes it — see `scripts/README.md` if you need it.

---

## License

[MIT](LICENSE). FeedbackRecorder bundles
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) and the
[Whisper](https://github.com/openai/whisper) and
[Silero VAD](https://github.com/snakers4/silero-vad) models, which carry their own
licenses.
