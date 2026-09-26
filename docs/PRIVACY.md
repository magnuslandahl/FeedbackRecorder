# Privacy

This is the canonical description of FeedbackRecorder's data handling. It
distinguishes recording content from the limited network traffic used for
software updates.

## Data the app captures

A recording package can contain:

- video of the selected display or imported video;
- microphone narration and a local transcript;
- screenshots selected as keyframes;
- written general and keyframe notes;
- click locations, click types, scrolling, shortcuts, navigation keys, and
  counts of ordinary typed characters;
- build, display, crop, timing, error, source-file, output-file, and other local
  path metadata in `run.json`.

Ordinary typed characters are filtered in the native macOS helper before they
reach the Electron app. The helper reports only a `typing` event for those keys;
it does not report the character or key code. Shortcuts and named navigation
keys are retained because they describe the walkthrough.

## Local processing and storage

Screen capture, audio extraction, transcription, keyframe selection, note
processing, and package creation run locally. FeedbackRecorder has no account
system, cloud service, advertising, telemetry, or analytics. It does not upload
recording content.

New recording folders and exported zips use the configured recordings
directory. The default avoids known OneDrive, iCloud, and Dropbox locations
when possible, and the app warns when a chosen location looks cloud-synced.
That detection is best-effort: choosing a synchronized folder allows the
sync provider to upload its contents.

Packages are retained until the user deletes them. Discarding an in-progress
recording removes that package. Uninstalling the app may leave recording
folders, exported zips, and app settings behind; delete those separately if
they should not remain on the machine.

## Audio

For a new screen recording, FeedbackRecorder records the selected microphone.
It does not capture system audio from applications, calls, notifications, or
music. An imported video can already contain whatever audio was present in that
file.

## Exports and sharing

The default zip excludes the screen recording and `narration.wav`. Including
either is an explicit option. The default zip is still sensitive: it includes
the brief, transcript, written notes, keyframes, privacy-filtered input
timeline, and `run.json`, which can contain local paths and the same transcript
and notes. Inspect every export before sharing it.

FeedbackRecorder does not send an export anywhere. Pasting, dragging, attaching,
or storing an export in another service is the user's decision and is then
governed by that service's privacy behavior.

## Permissions

- **Screen Recording** permits capture of the selected display or window.
- **Microphone** permits narration capture.
- **Accessibility** permits the listen-only macOS helper to observe pointer
  clicks.
- **Input Monitoring** permits that helper to observe shortcuts, navigation
  keys, and redacted typing events.

Input activity capture is currently available only on macOS and can be disabled
in Settings. The helper uses a listen-only event tap and cannot change, inject,
or swallow input.

## Network behavior

The packaged app uses the network only for updates:

- `https://api.github.com` supplies public latest-release metadata;
- selected installers and `SHA256SUMS.txt` start at documented
  `https://github.com/.../releases/download/...` URLs;
- GitHub can redirect release downloads to
  `https://release-assets.githubusercontent.com` or
  `https://objects.githubusercontent.com`.

The app checks release metadata at startup and when **Check for updates** is
selected. It downloads an installer only after the user chooses to update.
Before an installer is opened or run, the app downloads `SHA256SUMS.txt`,
requires one checksum for the exact asset name, and verifies the completed file.

Maintainer-only `npm run vendor` also downloads immutable model revisions from
Hugging Face and a pinned whisper.cpp release from GitHub. Those build-time
downloads are not performed by the packaged app.

## Signing

Checksums and GitHub artifact attestations protect release integrity and
provenance, but they do not replace platform code signing. Current signing,
notarization, first-run warnings, and permission-identity limitations are
documented in [Code signing and notarization](SIGNING.md).
