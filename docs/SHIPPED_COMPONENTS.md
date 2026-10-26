# Shipped components

FeedbackRecorder has no runtime Node dependencies. Release installers also
contain a local Mediabunny browser bundle, Electron, whisper.cpp, model weights,
and a native input helper. Mediabunny is installed as a build dependency and
copied unmodified into the renderer by `app/scripts/prepare-renderer.js`.

| Component | Shipped version or source | Integrity/provenance | License |
| --- | --- | --- | --- |
| FeedbackRecorder | The release commit recorded in the app and release notes | GitHub release artifact attestation and `SHA256SUMS.txt` | [MIT](../LICENSE) |
| Electron | `44.7.2` from `app/package-lock.json` | npm lockfile integrity plus the Electron download verification used by its installer | [MIT; bundled third-party notices][electron-license] |
| Mediabunny | `1.62.1` from `app/package-lock.json` | npm lockfile integrity; unmodified local browser bundle | [MPL-2.0][mediabunny-license] |
| whisper.cpp / ggml | tag `b4938`, commit `371b5a7561823ab2bb32142d2751e35e7534727b` | macOS builds this verified commit from source; Windows/Linux use the pinned archives below | [MIT][whisper-license] |
| Whisper small model | `ggerganov/whisper.cpp` revision `5359861c739e955e79d9a303bcbc70fb988958b1`, `ggml-small.bin` | 487,601,967 bytes; SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` | [MIT][whisper-model] |
| KB-Whisper small model (Swedish) | `KBLab/kb-whisper-small` revision `3564d61a42fc210ceaa55a22a96dd64478959c78`, `ggml-model.bin`; bundled as `ggml-kb-whisper-small.bin` | 487,601,984 bytes; SHA-256 `de6911330cbdc131362f7a955682b65c8a5a2394caba73e7ea821a9822efb8c6` | [Apache-2.0][kb-whisper-model] |
| Whisper base model | Same repository and revision, `ggml-base.bin`; development option, excluded from release installers | 147,951,465 bytes; SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` | [MIT][whisper-model] |
| Silero VAD model | `ggml-org/whisper-vad` revision `9ffd54a1e1ee413ddf265af9913beaf518d1639b`, `ggml-silero-v5.1.2.bin` | 885,098 bytes; SHA-256 `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf` | [MIT][vad-model] |
| macOS input helper | First-party `app/tools/input-tap.swift` from the same release commit | Built from tracked source as universal arm64/x86_64 code; release workflow self-tests typed-character redaction | [MIT](../LICENSE) |
| Windows input helper | First-party `app/tools/input-tap-win.c` from the same release commit | Built from tracked source with x64 MSVC; `--selftest` checks redacted output and `--check` probes hook availability | [MIT](../LICENSE) |

Pinned whisper.cpp release archives:

| Platform | Archive | Exact size | SHA-256 |
| --- | --- | ---: | --- |
| Linux x64 | `whisper-bin-ubuntu-x64.tar.gz` from tag `b4938` | 9,503,425 bytes | `f4cfc1f969a13805908fb72043ce7cc896eb42e0b8afbe841dc8e7298923b061` |
| Windows x64 | `whisper-bin-x64.zip` from tag `b4938` | 8,361,840 bytes | `c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d` |

`app/scripts/fetch-vendor.js` verifies exact size and SHA-256 for every
downloaded model and release archive, including cached copies, before the input
is accepted. Release installers and `SHA256SUMS.txt` are separately attested by
GitHub after packaging.

The Whisper small and KB-Whisper small pins were checked against their upstream
repositories on 2026-10-17 and match the latest published GGML weights for those
variants. KB-Whisper is used only for Swedish. Automatic language selection uses
the multilingual model's detection-only mode before choosing the transcription
model. This does not change the pinned whisper.cpp runtime version.
The KB-Whisper attribution and Apache-2.0 license travel with installers as
`vendor/models/KB-WHISPER-LICENSE.txt`.

The Mediabunny license, attribution, and corresponding-source link travel with
the bundle in `src/renderer/vendor/Mediabunny-LICENSE.txt` and
`Mediabunny-NOTICE.txt` inside the application archive. No CDN or network media
processing is used.

[electron-license]: https://github.com/electron/electron/blob/v44.7.2/LICENSE
[mediabunny-license]: https://github.com/Vanilagy/mediabunny/blob/v1.62.1/LICENSE
[whisper-license]: https://github.com/ggml-org/whisper.cpp/blob/371b5a7561823ab2bb32142d2751e35e7534727b/LICENSE
[whisper-model]: https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
[kb-whisper-model]: https://huggingface.co/KBLab/kb-whisper-small/tree/3564d61a42fc210ceaa55a22a96dd64478959c78
[vad-model]: https://huggingface.co/ggml-org/whisper-vad/tree/9ffd54a1e1ee413ddf265af9913beaf518d1639b
