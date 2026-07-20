#!/usr/bin/env python3
"""
02_quality_check.py — have the computer listen back to each generated clip and
drop the garbled ones (Phase C).

Cloning models occasionally mumble, cut off, or say the wrong thing. This
transcribes every clip with Whisper and compares it to the sentence it was
supposed to say. Clips that differ too much are removed from metadata (and
optionally deleted), so training only sees clean audio.

    python 02_quality_check.py                 # flag + drop bad clips
    python 02_quality_check.py --threshold 0.5 # stricter (keep only close matches)
    python 02_quality_check.py --delete        # also delete the wav files

Whisper runs on CPU here; this is slower than realtime but unattended.
"""
from __future__ import annotations
import argparse
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE / "dataset"
WAVS = DATASET / "wavs"
METADATA = DATASET / "metadata.csv"
REJECTS = DATASET / "rejects.csv"

_NORM = re.compile(r"[^a-z0-9 ]+")
_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    text = text.lower().replace("&", " and ")
    text = _NORM.sub(" ", text)
    return _WS.sub(" ", text).strip()


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def load_metadata() -> list[tuple[str, str]]:
    if not METADATA.exists():
        sys.exit(f"Missing {METADATA}. Run 01_generate_dataset.py first.")
    rows = []
    for line in METADATA.read_text(encoding="utf-8").splitlines():
        if "|" in line:
            wav_id, text = line.split("|", 1)
            rows.append((wav_id.strip(), text.strip()))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Quality-check the generated dataset.")
    ap.add_argument("--threshold", type=float, default=0.45,
                    help="keep clips whose transcript matches at least this well (0–1)")
    ap.add_argument("--model", default="base.en", help="Whisper model size")
    ap.add_argument("--delete", action="store_true", help="delete rejected wav files too")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Could not import faster-whisper: {e}\n"
                 f"Install deps:  pip install -r requirements.txt")

    rows = load_metadata()
    print(f"Checking {len(rows)} clips with Whisper '{args.model}' "
          f"(keep ≥ {args.threshold:.2f})…\n")
    asr = WhisperModel(args.model, device="cpu", compute_type="int8")

    kept: list[tuple[str, str]] = []
    rejects: list[tuple[str, str, float, str]] = []

    for n, (wav_id, text) in enumerate(rows, start=1):
        wav_path = WAVS / f"{wav_id}.wav"
        if not wav_path.exists():
            continue
        segments, _ = asr.transcribe(str(wav_path), language="en", beam_size=1)
        heard = " ".join(seg.text for seg in segments)
        score = similarity(text, heard)
        if score >= args.threshold:
            kept.append((wav_id, text))
        else:
            rejects.append((wav_id, text, score, heard.strip()))
            if args.delete:
                wav_path.unlink(missing_ok=True)
        if n % 25 == 0 or n == len(rows):
            print(f"  {n}/{len(rows)}  kept={len(kept)} rejected={len(rejects)}")

    with METADATA.open("w", encoding="utf-8", newline="\n") as f:
        for wav_id, text in kept:
            f.write(f"{wav_id}|{text}\n")

    if rejects:
        with REJECTS.open("w", encoding="utf-8", newline="\n") as f:
            f.write("id|score|expected|heard\n")
            for wav_id, text, score, heard in rejects:
                f.write(f"{wav_id}|{score:.2f}|{text}|{heard}\n")

    print(f"\nKept {len(kept)} clips, rejected {len(rejects)} "
          f"(logged in {REJECTS.name}).")
    if len(kept) < 300:
        print("  warning: fewer than ~300 good clips is thin for training. Consider\n"
              "  lowering --threshold, enriching corpus.txt, or a cleaner reference.wav.")
    print("Next:  python 03_package_dataset.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
