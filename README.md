# OBS Review Recorder

Lokalt Windows-verktyg för att spela in en app-review med OBS och skapa ett agentunderlag som kan användas av GitHub Copilot eller en annan kodagent.

Målet är en minimal fungerande version först:

1. Starta och stoppa OBS-inspelning via OBS WebSocket.
2. Ha manuellt fallback-läge om OBS WebSocket saknas eller inte fungerar.
3. Hitta senaste videofilen när inspelningen stoppas.
4. Skapa en tidsstämplad output-mapp.
5. Extrahera keyframes med FFmpeg, till exempel en bild varannan sekund.
6. Transkribera ljud lokalt med faster-whisper, med svenska som förstaklassigt språk.
7. Skapa `agent-brief.md` med video, transkript, keyframes och en färdig prompt för kodagent.
8. Låta en Copilot-skill guida flödet och köra PowerShell-CLI:t.

## Föreslagen användarresa

```powershell
.\scripts\review-recorder.ps1 doctor
.\scripts\review-recorder.ps1 init
.\scripts\review-recorder.ps1 start
# användaren gör sin app-review
.\scripts\review-recorder.ps1 stop
.\scripts\review-recorder.ps1 analyze
```

`analyze` blir ett valfritt steg som använder GitHub Copilot CLI lokalt, till exempel GPT-5.5, för att förbättra agentunderlaget. Mediahantering, keyframes och transkribering ska ske lokalt.

## Lokal maskinprofil, första kontroll

Kontrollerad på primär laptop 2026-08-24:

| Del | Status |
| --- | --- |
| OS | Windows 11 Enterprise |
| CPU | AMD Ryzen AI 9 HX PRO 370, 12 cores / 24 threads |
| RAM | cirka 60 GB |
| GPU | AMD Radeon 890M, 4 GB |
| NVIDIA/CUDA | Saknas |
| Python | 3.14.3 finns, men ML-paket bör köras i Python 3.11/3.12 |
| Node/npm | Finns |
| GitHub Copilot CLI | Finns, `1.0.80` |
| OBS | Saknas |
| FFmpeg/ffprobe | Saknas |
| faster-whisper/torch | Saknas |

Praktisk slutsats: bygg CPU-first. Använd `faster-whisper` med `small` eller `base`, `compute_type=int8`, och gör GPU-stöd optional senare.

## Repo-status

Det här repot innehåller först dokumentation och plan. Implementation läggs till i nästa steg.

Planerade huvuddelar:

```text
scripts/
  review-recorder.ps1       # CLI-kärna
  transcribe-whisper.py     # lokal transkribering via faster-whisper

skill/
  SKILL.md                  # Copilot-skill som guidar och kör CLI:t

docs/
  PLAN.md
  REQUIREMENTS.md
  SKILL_DESIGN.md
  DECISIONS.md
```

