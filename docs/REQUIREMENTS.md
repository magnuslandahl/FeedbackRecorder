# Requirements and prerequisites

## Required for MVP

| Dependency | Why |
| --- | --- |
| Windows PowerShell or PowerShell 7 | Runs the CLI. |
| OBS Studio | Recording engine. |
| OBS WebSocket | Start/stop automation. Included in modern OBS versions. |
| FFmpeg and ffprobe | Extract audio and keyframes. |
| Python 3.11 or 3.12 | Stable runtime for faster-whisper and ML dependencies. |
| faster-whisper | Local transcription, including Swedish. |

## Optional but recommended

| Dependency | Why |
| --- | --- |
| GitHub Copilot CLI | Analyze transcripts/keyframes and improve the agent brief. |
| winget | Simple installation of OBS, FFmpeg, and Python. |

## Installation approach

The first version of `doctor` should not automatically install everything. It should:

1. Check whether each dependency exists.
2. Show status.
3. Suggest exact commands.
4. Stop clearly when a required step is missing.

Examples of commands that the documentation can suggest:

```powershell
winget install OBSProject.OBSStudio
winget install Gyan.FFmpeg
winget install Python.Python.3.12
```

The Whisper environment should be created separately:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install faster-whisper
```

## Swedish transcription

`faster-whisper` supports Swedish through the Whisper models. For the current laptop class, the recommended default is:

```text
model = small
language = sv
compute_type = int8
device = cpu
```

`base` can be a fallback if transcription is too slow. `medium` can become a later quality profile.

## GPU mode

The checked machine has AMD Radeon 890M and no NVIDIA/CUDA. The MVP should therefore not require a GPU.

Future GPU support can be investigated separately, but must remain optional.
