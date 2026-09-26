# Shipped components

FeedbackRecorder intentionally has no production npm dependencies, but an npm
dependency list is not a complete inventory of the application. Release
installers also contain Electron, whisper.cpp, model weights, and a native input
helper.

| Component | Shipped version or source | Integrity/provenance | License |
| --- | --- | --- | --- |
| FeedbackRecorder | The release commit recorded in the app and release notes | GitHub release artifact attestation and `SHA256SUMS.txt` | [MIT](../LICENSE) |
| Electron | `44.1.0` from `app/package-lock.json` | npm lockfile integrity plus the Electron download verification used by its installer | [MIT; bundled third-party notices][electron-license] |
| whisper.cpp / ggml | tag `b4938`, commit `371b5a7561823ab2bb32142d2751e35e7534727b` | macOS builds this verified commit from source; Windows/Linux use the pinned archives below | [MIT][whisper-license] |
| Whisper small model | `ggerganov/whisper.cpp` revision `5359861c739e955e79d9a303bcbc70fb988958b1`, `ggml-small.bin` | 487,601,967 bytes; SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` | [MIT][whisper-model] |
| Whisper base model | Same repository and revision, `ggml-base.bin`; development option, excluded from release installers | 147,951,465 bytes; SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` | [MIT][whisper-model] |
| Silero VAD model | `ggml-org/whisper-vad` revision `9ffd54a1e1ee413ddf265af9913beaf518d1639b`, `ggml-silero-v5.1.2.bin` | 885,098 bytes; SHA-256 `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf` | [MIT][vad-model] |
| macOS input helper | First-party `app/tools/input-tap.swift` from the same release commit | Built from tracked source as universal arm64/x86_64 code; release workflow self-tests typed-character redaction | [MIT](../LICENSE) |

Pinned whisper.cpp release archives:

| Platform | Archive | Exact size | SHA-256 |
| --- | --- | ---: | --- |
| Linux x64 | `whisper-bin-ubuntu-x64.tar.gz` from tag `b4938` | 9,503,425 bytes | `f4cfc1f969a13805908fb72043ce7cc896eb42e0b8afbe841dc8e7298923b061` |
| Windows x64 | `whisper-bin-x64.zip` from tag `b4938` | 8,361,840 bytes | `c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d` |

`app/scripts/fetch-vendor.js` verifies exact size and SHA-256 for every
downloaded model and release archive, including cached copies, before the input
is accepted. Release installers and `SHA256SUMS.txt` are separately attested by
GitHub after packaging.

[electron-license]: https://github.com/electron/electron/blob/v44.1.0/LICENSE
[whisper-license]: https://github.com/ggml-org/whisper.cpp/blob/371b5a7561823ab2bb32142d2751e35e7534727b/LICENSE
[whisper-model]: https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
[vad-model]: https://huggingface.co/ggml-org/whisper-vad/tree/9ffd54a1e1ee413ddf265af9913beaf518d1639b
