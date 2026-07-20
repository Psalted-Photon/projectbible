# Voice Factory — make a Read Aloud voice that sounds like you

This folder is the runbook + tools for creating a custom voice for the app's
**Read Aloud** feature. You run these steps once per voice. The end product is
two small files — `your-voice.onnx` (~30–60 MB) and `your-voice.onnx.json` —
that you install in the app under **Manage Packs → Voices → Install voice from
file**. After that the voice reads any chapter, fully offline.

**Cost: $0** (free tools + a free cloud GPU). **Your hands-on time: ~1 hour.**
Most of the work is the computer running unattended while you sleep or work.

---

## The idea in one paragraph

Small offline voices (Piper) are fast enough to run in the app but can't be
"cloned" from a short clip. Big cloning models (Chatterbox) can copy your voice
from ~1 minute of audio but are too heavy to run on a phone. So we bridge them:
Chatterbox listens to your short recording and **manufactures a few thousand
practice sentences in your voice**; we then **train a small Piper voice** on
those sentences. The Piper voice inherits your sound and runs anywhere.

```
 you read ~1–2 min  ─►  Chatterbox clones it  ─►  ~1,200 practice WAVs
      (Phase B)              (Phase C, PC)          in "your" voice
                                                          │
 install in app  ◄─  your-voice.onnx  ◄─  train Piper on them
   (Phase E)            (Phase D, free cloud GPU)
```

---

## What you need

- This PC (Beelink GTR6, Ryzen 9 6900HX). The heavy generation runs on CPU here
  overnight — slower than a gaming GPU, but you don't mind waiting.
- A free Google account (for the Colab training notebook) **or** a Kaggle account.
- A quiet room and your phone's voice-recorder app (or any mic). A quiet room
  matters more than an expensive mic.
- Python 3.10 or 3.11 installed.

---

## Phase B — Set up + record your reference (one evening, ~30 min hands-on)

1. **Install the tools** (one time):
   ```bash
   cd voice-factory
   python -m venv .venv
   # Windows PowerShell:  .venv\Scripts\Activate.ps1
   # Git Bash:            source .venv/Scripts/activate
   pip install -r requirements.txt
   ```

2. **Record the prompt sheet.** Open [prompts.txt](prompts.txt) and read it
   aloud in one calm, natural take — the way you'd read a bedtime story, not the
   news. Aim for 1–2 minutes total. Save it as `reference.wav` (or .m4a/.mp3 —
   the scripts convert it) in this folder.
   - Quiet room, no echo, phone held a hand's width away is fine.
   - Read at a steady pace. Your reading style here is the style the voice will have.

3. **Listen back.** If there's background hum, a barking dog, or you rushed it,
   just re-record. This 2-minute file shapes everything downstream.

**✅ Gate B:** you have a clean `reference.wav` of yourself reading the prompts.

---

## Phase C — Manufacture the practice sentences (1–2 nights, unattended)

This is the long, hands-off part. Chatterbox reads ~1,200 sentences in your
voice. On this CPU expect a while per sentence — that's why it runs overnight.
It's **resumable**: stop it any time (Ctrl+C), run it again, it picks up where
it left off.

1. **Build the sentence list** (once):
   ```bash
   python build_corpus.py
   ```
   This writes `corpus.txt` (~1,200 lines). By default it's mostly Bible verses
   (so the voice is tuned for what it'll actually read) plus general sentences
   for phonetic coverage. Drop any `.txt` of Bible chapters into `verses/` first
   to enrich it — more varied text = a better voice.

2. **Generate the dataset** (the overnight run):
   ```bash
   python 01_generate_dataset.py --reference reference.wav
   ```
   Leave it running. It fills `dataset/wavs/` and writes `dataset/metadata.csv`.
   Run it across several nights if you like — it resumes.

3. **Quality-check** (30 min, mostly automatic):
   ```bash
   python 02_quality_check.py
   ```
   This has the computer listen back to each clip (Whisper) and throw out any
   that came out garbled. It prints how many it kept.

4. **Package for training:**
   ```bash
   python 03_package_dataset.py
   ```
   Produces `dataset.zip` — the single file you upload to the cloud in Phase D.

**✅ Gate C:** `03_package_dataset.py` reports ~1,000+ good clips and writes
`dataset.zip`. Spot-listen to a few files in `dataset/wavs/` — do they sound
like you? (They won't be perfect; the trained voice smooths them out.)

---

## Phase D — Train the small voice on a free GPU (1 long session or 2–3 short)

Piper training needs a GPU, which this PC doesn't have — so this one step rides
a **free** cloud notebook.

1. Open [train_piper_colab.ipynb](train_piper_colab.ipynb):
   - **Google Colab:** upload it at https://colab.research.google.com (Runtime →
     Change runtime type → **T4 GPU**).
   - **Kaggle:** New Notebook → upload → Settings → Accelerator → **GPU**.
2. Run the cells top to bottom. You'll upload `dataset.zip` when prompted. It
   fine-tunes from the same base voice the app's Standard voice came from, so it
   learns *your* sound fast rather than starting from scratch.
3. Training saves progress continuously. Free sessions can disconnect after a few
   hours — if that happens, re-run and it resumes from the last checkpoint. One
   good voice usually needs a few hours total.
4. The final cells play a **test sentence** and export `your-voice.onnx` +
   `your-voice.onnx.json`. Download both.

**✅ Gate D:** the notebook's test sentence sounds like you before you download.
If it's rough, the notebook tells you how to train a bit longer.

> Impatient? A rented GPU (~US$0.30/hr, e.g. one evening) does it faster. Not
> required — the free path works, it just asks you to babysit reconnects.

---

## Phase E — Install it in the app (2 minutes)

1. **Desktop first:** app → **Manage Packs → Voices → Install voice from file**.
   Select **both** `your-voice.onnx` and `your-voice.onnx.json` together. It
   appears as a 🎙 card. Open any chapter and hit 🗣 — you're listening to
   yourself read the Bible.
2. **On your phone:** two ways —
   - Get both files onto the phone and use the same **Install voice from file**, or
   - Upload the two files to a **GitHub Release** and we add a one-line hosted
     entry so the phone downloads it like any other voice.
3. In **Settings → Read Aloud**, pick your voice as the default.

**✅ Gate E — the finish line:** phone in airplane mode, your voice reads a
chapter offline.

---

## Honest expectations

- **Quality:** recognizably you — a warm audiobook-narrator version of your
  voice, not a frame-perfect studio double. The single biggest lever is your
  Phase B recording (quiet room, natural pace).
- **Time:** ~1 hour of your attention spread over a few days; the machine does
  the rest.
- **Consent:** only make voices of people who've agreed. Yours: go for it.

## Files in this folder

| File | What it's for |
|---|---|
| `prompts.txt` | The sentences you read for your reference recording (Phase B) |
| `build_corpus.py` | Builds `corpus.txt`, the practice sentence list (Phase C) |
| `01_generate_dataset.py` | Chatterbox → practice WAVs in your voice (Phase C) |
| `02_quality_check.py` | Whisper drops garbled clips (Phase C) |
| `03_package_dataset.py` | Zips the dataset for upload (Phase C) |
| `train_piper_colab.ipynb` | Free-GPU training → your `.onnx` (Phase D) |
| `requirements.txt` | Python packages for the PC scripts |
