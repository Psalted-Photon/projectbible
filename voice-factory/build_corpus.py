#!/usr/bin/env python3
"""
build_corpus.py — assemble corpus.txt, the list of sentences Chatterbox will
speak in your voice (Phase C).

The voice mostly reads Scripture, so the corpus is mostly Bible text (drop any
.txt of chapters into ./verses/) plus a built-in set of general sentences for
phonetic coverage. More varied lines = a better voice.

Usage:
    python build_corpus.py                # ~1200 lines from verses/ + seed
    python build_corpus.py --target 1500  # aim for more lines
    python build_corpus.py --min 4 --max 180   # tweak sentence length window

Only the Python standard library is used.
"""
from __future__ import annotations
import argparse
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSES_DIR = HERE / "verses"
OUT = HERE / "corpus.txt"

# General phonetically-varied sentences (public-domain / original). These give
# the voice coverage of sounds that may be rare in a given passage of Scripture.
SEED_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Pack my box with five dozen liquor jugs.",
    "How vexingly quick daft zebras jump.",
    "The five boxing wizards jump quickly.",
    "Bright vixens jump; dozy fowl quack.",
    "A wizard's job is to vex chumps quickly in fog.",
    "We watched the orange sunset fade behind the quiet hills.",
    "She carefully poured the warm tea into a small blue cup.",
    "Thunder rolled across the valley as the rain began to fall.",
    "He counted seven silver coins and placed them on the table.",
    "The children laughed and chased each other through the garden.",
    "Please measure twice before you cut the long wooden plank.",
    "A gentle breeze carried the scent of pine across the meadow.",
    "The old clock chimed twelve times at the stroke of midnight.",
    "Fresh bread and ripe fruit filled the little market stall.",
    "They rowed the small boat slowly toward the distant shore.",
    "My father taught me to whistle a simple, cheerful tune.",
    "The library was silent except for the turning of pages.",
    "Golden wheat swayed gently in the wide summer field.",
    "We hiked for hours before we reached the mountain spring.",
    "The painter mixed red and yellow to make a warm orange.",
    "A curious cat watched the birds from the kitchen window.",
    "The train arrived exactly on time despite the heavy snow.",
    "He spoke softly, choosing each word with great care.",
    "Bright stars appeared one by one across the darkening sky.",
    "The baker rose before dawn to knead the morning dough.",
    "Cool water tumbled over the smooth stones of the creek.",
    "She folded the letter neatly and sealed it with wax.",
    "The dog wagged its tail and barked twice at the door.",
    "Long shadows stretched across the road as evening came.",
    "We planted rows of beans, carrots, and sweet green peas.",
    "The violin's clear notes floated through the open hall.",
    "A single candle lit the corner of the quiet room.",
    "The farmer led the horses back into the wooden barn.",
    "Waves crashed and hissed along the rocky northern coast.",
    "He zipped his jacket and stepped out into the cold wind.",
    "Yellow leaves drifted down and gathered by the fence.",
    "The teacher wrote the question clearly on the blackboard.",
    "They shared a quiet meal of soup, bread, and cheese.",
    "A rainbow arched above the fields after the summer storm.",
]

_SENT_SPLIT = re.compile(r"(?<=[.!?;:])\s+")
_VERSE_NUM = re.compile(r"^\s*\d+[:.]\d+\s*|^\s*\d+\s+")  # strip leading "3:16 " / "16 "
_WS = re.compile(r"\s+")


def clean_line(text: str) -> str:
    text = text.replace("﻿", "").replace("¶", " ")  # BOM, pilcrow
    text = _VERSE_NUM.sub("", text)
    text = _WS.sub(" ", text).strip()
    return text


def sentences_from_text(raw: str) -> list[str]:
    out: list[str] = []
    for block in raw.splitlines():
        block = block.strip()
        if not block or block.startswith("#"):
            continue
        for piece in _SENT_SPLIT.split(block):
            line = clean_line(piece)
            if line:
                out.append(line)
    return out


def load_verses() -> list[str]:
    if not VERSES_DIR.exists():
        return []
    lines: list[str] = []
    for path in sorted(VERSES_DIR.glob("*.txt")):
        try:
            lines.extend(sentences_from_text(path.read_text(encoding="utf-8")))
        except Exception as e:  # noqa: BLE001
            print(f"  ! could not read {path.name}: {e}", file=sys.stderr)
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description="Build corpus.txt for voice training.")
    ap.add_argument("--target", type=int, default=1200, help="desired number of lines")
    ap.add_argument("--min", type=int, default=3, help="minimum characters per line")
    ap.add_argument("--max", type=int, default=180, help="maximum characters per line")
    ap.add_argument("--seed", type=int, default=7, help="shuffle seed (reproducible)")
    args = ap.parse_args()

    verses = load_verses()
    pool = verses + SEED_SENTENCES

    # Deduplicate (case-insensitive) and apply the length window.
    seen: set[str] = set()
    cleaned: list[str] = []
    for line in pool:
        if not (args.min <= len(line) <= args.max):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(line)

    rng = random.Random(args.seed)
    rng.shuffle(cleaned)

    if len(cleaned) > args.target:
        cleaned = cleaned[: args.target]

    OUT.write_text("\n".join(cleaned) + "\n", encoding="utf-8")

    print(f"Wrote {OUT.name}: {len(cleaned)} lines "
          f"({len(verses)} from verses/, {len(SEED_SENTENCES)} seed sentences).")
    if len(cleaned) < args.target:
        print(f"  note: fewer than the target of {args.target}. Drop more Bible "
              f"chapters as .txt into {VERSES_DIR.name}/ to enrich the voice.")
    if not verses:
        print(f"  tip: {VERSES_DIR.name}/ is empty — using only the {len(SEED_SENTENCES)} "
              f"built-in sentences. Add Bible text there for a much better voice.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
