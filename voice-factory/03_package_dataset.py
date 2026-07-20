#!/usr/bin/env python3
"""
03_package_dataset.py — bundle the cleaned dataset into a single dataset.zip to
upload to the training notebook (Phase C → D).

Includes only the wav files still listed in metadata.csv (i.e. the ones that
passed quality check), plus metadata.csv itself.

    python 03_package_dataset.py
"""
from __future__ import annotations
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE / "dataset"
WAVS = DATASET / "wavs"
METADATA = DATASET / "metadata.csv"
OUT_ZIP = HERE / "dataset.zip"


def main() -> int:
    if not METADATA.exists():
        sys.exit(f"Missing {METADATA}. Run 01 and 02 first.")

    rows = [ln for ln in METADATA.read_text(encoding="utf-8").splitlines() if "|" in ln]
    ids = [ln.split("|", 1)[0].strip() for ln in rows]
    if not ids:
        sys.exit("metadata.csv is empty — nothing to package.")

    missing = 0
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("metadata.csv", "\n".join(rows) + "\n")
        for wav_id in ids:
            wav_path = WAVS / f"{wav_id}.wav"
            if wav_path.exists():
                z.write(wav_path, arcname=f"wavs/{wav_id}.wav")
            else:
                missing += 1

    size_mb = OUT_ZIP.stat().st_size / 1024 / 1024
    print(f"Wrote {OUT_ZIP.name}: {len(ids) - missing} clips, {size_mb:.0f} MB.")
    if missing:
        print(f"  note: {missing} listed clips were missing on disk and skipped.")
    print("\nNext: open train_piper_colab.ipynb in Google Colab (T4 GPU) and\n"
          "upload this dataset.zip when the notebook asks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
