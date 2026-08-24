#!/usr/bin/env python3
"""Thin faster-whisper wrapper for OBSReviewRecorder.

Transcribes a WAV file locally and writes both a plain-text transcript and a
JSON transcript with per-segment timestamps. Designed to be called from
review-recorder.ps1, but also runnable directly.

Exit codes:
    0  success
    2  bad arguments / audio file missing
    3  faster-whisper is not installed
    4  transcription failed
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time


def log(message: str) -> None:
    print(f"[transcribe] {message}", flush=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper.")
    parser.add_argument("--audio", required=True, help="Path to the input audio (WAV).")
    parser.add_argument("--model", default="small", help="Whisper model size or path.")
    parser.add_argument("--language", default="sv", help="Language code, e.g. sv or en.")
    parser.add_argument("--compute-type", default="int8", dest="compute_type",
                        help="CTranslate2 compute type (int8, int8_float16, float16, float32).")
    parser.add_argument("--device", default="cpu", help="cpu or cuda.")
    parser.add_argument("--beam-size", type=int, default=5, dest="beam_size")
    parser.add_argument("--output-json", required=True, dest="output_json")
    parser.add_argument("--output-txt", required=True, dest="output_txt")
    parser.add_argument("--no-vad", action="store_true", dest="no_vad",
                        help="Disable voice-activity-detection filtering.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    if not os.path.isfile(args.audio):
        log(f"ERROR: audio file not found: {args.audio}")
        return 2

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log("ERROR: faster-whisper is not installed in this Python environment.")
        log("Install it with: python -m pip install faster-whisper")
        return 3

    language = None if args.language.lower() in ("", "auto") else args.language

    try:
        log(f"Loading model '{args.model}' (device={args.device}, compute_type={args.compute_type}) ...")
        started = time.time()
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

        log(f"Transcribing '{os.path.basename(args.audio)}' (language={language or 'auto'}) ...")
        segments, info = model.transcribe(
            args.audio,
            language=language,
            beam_size=args.beam_size,
            vad_filter=not args.no_vad,
        )

        collected = []
        text_parts = []
        for seg in segments:
            collected.append({
                "id": seg.id,
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
            })
            text_parts.append(seg.text.strip())
            log(f"  [{seg.start:7.2f} -> {seg.end:7.2f}] {seg.text.strip()}")

        full_text = " ".join(p for p in text_parts if p).strip()
        elapsed = round(time.time() - started, 1)

        result = {
            "audio": os.path.abspath(args.audio),
            "model": args.model,
            "language": getattr(info, "language", language),
            "languageProbability": round(getattr(info, "language_probability", 0.0) or 0.0, 4),
            "durationSeconds": round(getattr(info, "duration", 0.0) or 0.0, 3),
            "elapsedSeconds": elapsed,
            "segments": collected,
            "text": full_text,
        }
    except Exception as exc:  # noqa: BLE001 - fail-soft, report and exit non-zero
        log(f"ERROR: transcription failed: {exc}")
        return 4

    os.makedirs(os.path.dirname(os.path.abspath(args.output_json)) or ".", exist_ok=True)
    with open(args.output_json, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    with open(args.output_txt, "w", encoding="utf-8") as fh:
        fh.write(full_text + "\n")

    log(f"Done in {elapsed}s. Wrote {len(collected)} segment(s).")
    log(f"  text : {args.output_txt}")
    log(f"  json : {args.output_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
