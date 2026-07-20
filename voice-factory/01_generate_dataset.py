#!/usr/bin/env python3
"""
01_generate_dataset.py — Chatterbox reads every line of corpus.txt in YOUR
voice (from reference.wav) and saves the clips as a training dataset.

This is the long, unattended run (Phase C). It is RESUMABLE: stop with Ctrl+C
and run it again — it skips clips it already made.

    python 01_generate_dataset.py --reference reference.wav

Output:
    dataset/wavs/00001.wav, 00002.wav, ...   (22.05 kHz mono)
    dataset/metadata.csv                      ("id|text" per line, LJSpeech style)
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus.txt"
DATASET = HERE / "dataset"
WAVS = DATASET / "wavs"
METADATA = DATASET / "metadata.csv"

TARGET_SR = 22050  # matches the Piper base voice we fine-tune from


def load_corpus() -> list[str]:
    if not CORPUS.exists():
        sys.exit(f"Missing {CORPUS.name}. Run:  python build_corpus.py")
    lines = [ln.strip() for ln in CORPUS.read_text(encoding="utf-8").splitlines()]
    return [ln for ln in lines if ln and not ln.startswith("#")]


def write_metadata(ids_texts: list[tuple[str, str]]) -> None:
    with METADATA.open("w", encoding="utf-8", newline="\n") as f:
        for wav_id, text in ids_texts:
            f.write(f"{wav_id}|{text}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate the voice dataset with Chatterbox.")
    ap.add_argument("--reference", default="reference.wav",
                    help="your reference recording (wav/mp3/m4a)")
    ap.add_argument("--limit", type=int, default=0,
                    help="only generate the first N lines (0 = all; handy for a quick test)")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = ap.parse_args()

    ref = (HERE / args.reference) if not Path(args.reference).is_absolute() else Path(args.reference)
    if not ref.exists():
        sys.exit(f"Reference recording not found: {ref}\n"
                 f"Record the prompts (see prompts.txt) and save it as reference.wav.")

    # Heavy imports deferred so --help stays instant.
    import numpy as np
    import soundfile as sf
    import librosa
    try:
        import torch
        from chatterbox.tts import ChatterboxTTS
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Could not import Chatterbox/torch: {e}\n"
                 f"Install deps:  pip install -r requirements.txt")

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading Chatterbox on {device} (first run downloads the model)…")
    model = ChatterboxTTS.from_pretrained(device=device)
    model_sr = getattr(model, "sr", 24000)

    corpus = load_corpus()
    if args.limit > 0:
        corpus = corpus[: args.limit]
    WAVS.mkdir(parents=True, exist_ok=True)

    done_ids_texts: list[tuple[str, str]] = []
    made, skipped, failed = 0, 0, 0
    total = len(corpus)
    print(f"Generating {total} clips → {WAVS}\n")

    for i, text in enumerate(corpus, start=1):
        wav_id = f"{i:05d}"
        out_path = WAVS / f"{wav_id}.wav"
        if out_path.exists() and out_path.stat().st_size > 0:
            done_ids_texts.append((wav_id, text))
            skipped += 1
            continue
        try:
            with torch.no_grad():
                wav = model.generate(text, audio_prompt_path=str(ref))
            audio = wav.squeeze().detach().cpu().numpy().astype("float32")
            if model_sr != TARGET_SR:
                audio = librosa.resample(audio, orig_sr=model_sr, target_sr=TARGET_SR)
            peak = float(np.max(np.abs(audio))) or 1.0
            audio = (audio / peak) * 0.95  # gentle peak-normalize
            sf.write(str(out_path), audio, TARGET_SR, subtype="PCM_16")
            done_ids_texts.append((wav_id, text))
            made += 1
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved. Re-run to resume.")
            break
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ! line {i} failed: {e}", file=sys.stderr)

        if (made + skipped) % 25 == 0 or i == total:
            write_metadata(done_ids_texts)
            pct = 100 * i / total
            print(f"  {i}/{total} ({pct:4.1f}%)  made={made} skipped={skipped} failed={failed}")

    write_metadata(done_ids_texts)
    print(f"\nDone. {len(done_ids_texts)} clips ready in {WAVS}.")
    print("Next:  python 02_quality_check.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
