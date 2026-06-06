"""
Convert Spurgeon's Verse Expositions from e-Sword .cmtx (SQLite/RTF)
into the commentary_entries SQLite format used by the ProjectBible pack system.

Input:  data-sources/commentaries/raw/spurgeon-expositions.cmtx
Output: packs/consolidated/spurgeon-expositions.sqlite

Each row in the .cmtx Verses table covers a passage (e.g. Gen 1:1-31) with RTF
containing verse-by-verse commentary. This script:
  1. Strips RTF markup to plain text
  2. Splits each passage on embedded verse markers (e.g. "Gen_1:1")
  3. Emits one commentary_entries row per verse (or passage if no verse markers)
  4. Writes to output SQLite in the pack format the app expects
"""

import sqlite3
import re
import os
import sys

INPUT = "data-sources/commentaries/raw/spurgeon-expositions.cmtx"
OUTPUT = "packs/consolidated/spurgeon-expositions.sqlite"

# e-Sword book number → canonical app book name (standard Bible order)
BOOK_MAP = {
    1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
    6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1 Samuel", 10: "2 Samuel",
    11: "1 Kings", 12: "2 Kings", 13: "1 Chronicles", 14: "2 Chronicles",
    15: "Ezra", 16: "Nehemiah", 17: "Esther", 18: "Job", 19: "Psalms",
    20: "Proverbs", 21: "Ecclesiastes", 22: "Song of Solomon", 23: "Isaiah",
    24: "Jeremiah", 25: "Lamentations", 26: "Ezekiel", 27: "Daniel",
    28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadiah", 32: "Jonah",
    33: "Micah", 34: "Nahum", 35: "Habakkuk", 36: "Zephaniah", 37: "Haggai",
    38: "Zechariah", 39: "Malachi",
    40: "Matthew", 41: "Mark", 42: "Luke", 43: "John", 44: "Acts",
    45: "Romans", 46: "1 Corinthians", 47: "2 Corinthians", 48: "Galatians",
    49: "Ephesians", 50: "Philippians", 51: "Colossians",
    52: "1 Thessalonians", 53: "2 Thessalonians", 54: "1 Timothy",
    55: "2 Timothy", 56: "Titus", 57: "Philemon", 58: "Hebrews",
    59: "James", 60: "1 Peter", 61: "2 Peter", 62: "1 John",
    63: "2 John", 64: "3 John", 65: "Jude", 66: "Revelation",
}

# e-Sword/RTF book abbreviations → canonical book name
# These appear as "Gen_", "Exo_", etc. inside the RTF verse markers
ABBR_MAP = {
    "Gen": "Genesis", "Exo": "Exodus", "Lev": "Leviticus", "Num": "Numbers",
    "Deu": "Deuteronomy", "Jos": "Joshua", "Jdg": "Judges", "Rut": "Ruth",
    "1Sa": "1 Samuel", "2Sa": "2 Samuel", "1Ki": "1 Kings", "2Ki": "2 Kings",
    "1Ch": "1 Chronicles", "2Ch": "2 Chronicles", "Ezr": "Ezra",
    "Neh": "Nehemiah", "Est": "Esther", "Job": "Job", "Psa": "Psalms",
    "Pro": "Proverbs", "Ecc": "Ecclesiastes", "Sol": "Song of Solomon",
    "Sng": "Song of Solomon", "Son": "Song of Solomon",
    "Isa": "Isaiah", "Jer": "Jeremiah", "Lam": "Lamentations",
    "Eze": "Ezekiel", "Dan": "Daniel", "Hos": "Hosea", "Joe": "Joel",
    "Amo": "Amos", "Oba": "Obadiah", "Jon": "Jonah", "Mic": "Micah",
    "Nah": "Nahum", "Hab": "Habakkuk", "Zep": "Zephaniah", "Hag": "Haggai",
    "Zec": "Zechariah", "Mal": "Malachi",
    "Mat": "Matthew", "Mar": "Mark", "Luk": "Luke", "Joh": "John",
    "Act": "Acts", "Rom": "Romans", "1Co": "1 Corinthians",
    "2Co": "2 Corinthians", "Gal": "Galatians", "Eph": "Ephesians",
    "Phi": "Philippians", "Col": "Colossians", "1Th": "1 Thessalonians",
    "2Th": "2 Thessalonians", "1Ti": "1 Timothy", "2Ti": "2 Timothy",
    "Tit": "Titus", "Phm": "Philemon", "Heb": "Hebrews", "Jas": "James",
    "1Pe": "1 Peter", "2Pe": "2 Peter", "1Jo": "1 John", "2Jo": "2 John",
    "3Jo": "3 John", "Jud": "Jude", "Rev": "Revelation",
}

# Regex matching RTF verse markers: "Gen_1:1", "Gen_1:1-5", "Gen_1:1-2:3"
# These appear as bold/underlined text in the RTF
VERSE_MARKER_RE = re.compile(
    r'\b([A-Z][a-z]{1,2})_(\d+):(\d+)(?:-(?:\d+:)?(\d+))?\b'
)


def strip_rtf(rtf: str) -> str:
    """Strip RTF markup and return plain text with paragraph breaks as newlines."""
    if not rtf:
        return ""

    # Decode RTF hex escapes \'XX → actual character
    def decode_hex(m):
        try:
            return chr(int(m.group(1), 16))
        except Exception:
            return ""
    rtf = re.sub(r"\\'([0-9a-fA-F]{2})", decode_hex, rtf)

    # Convert \par and \line to newlines before stripping control words
    rtf = re.sub(r'\\par\b', '\n', rtf)
    rtf = re.sub(r'\\line\b', '\n', rtf)
    rtf = re.sub(r'\\tab\b', '  ', rtf)

    # Remove groups that are pure markup (header, footer, info, field, etc.)
    # Iteratively collapse innermost {...} groups that start with a control word
    for _ in range(20):
        prev = rtf
        rtf = re.sub(r'\{\\[^{}]*\}', '', rtf)
        if rtf == prev:
            break

    # Remove remaining control words: \word, \word123, \word-123
    rtf = re.sub(r'\\[a-zA-Z]+\-?\d*\*? ?', '', rtf)
    # Remove lone backslash escapes (e.g. \~ \- \*)
    rtf = re.sub(r'\\[^a-zA-Z\n]', '', rtf)

    # Remove remaining braces
    rtf = rtf.replace('{', '').replace('}', '')

    # Normalize whitespace (preserve single newlines)
    rtf = re.sub(r'[ \t]+', ' ', rtf)
    rtf = re.sub(r' *\n *', '\n', rtf)
    rtf = re.sub(r'\n{3,}', '\n\n', rtf)

    return rtf.strip()


def split_into_verses(plain_text: str, default_book: str, default_chapter: int, default_verse_start: int, default_verse_end: int):
    """
    Split a stripped passage text into per-verse entries using embedded
    verse markers like 'Gen_1:1', 'Gen_1:1-5'.

    Yields dicts: {book, chapter, verse_start, verse_end, text}
    """
    # Find all verse marker positions
    markers = []
    for m in VERSE_MARKER_RE.finditer(plain_text):
        abbr = m.group(1)
        book = ABBR_MAP.get(abbr)
        if not book:
            continue
        chapter = int(m.group(2))
        verse_start = int(m.group(3))
        verse_end = int(m.group(4)) if m.group(4) else verse_start
        markers.append({
            "start": m.start(),
            "end": m.end(),
            "book": book,
            "chapter": chapter,
            "verse_start": verse_start,
            "verse_end": verse_end,
        })

    if not markers:
        # No verse markers found — emit the whole passage as one entry
        text = plain_text.strip()
        if text:
            yield {
                "book": default_book,
                "chapter": default_chapter,
                "verse_start": default_verse_start,
                "verse_end": default_verse_end,
                "text": text,
            }
        return

    # Emit text segments between consecutive markers
    for i, marker in enumerate(markers):
        # Text for this verse runs from end of its marker to start of next marker
        seg_start = marker["end"]
        seg_end = markers[i + 1]["start"] if i + 1 < len(markers) else len(plain_text)
        text = plain_text[seg_start:seg_end].strip()

        # Strip leading punctuation artifacts (". " from "Gen_1:1 . KJV text")
        text = re.sub(r'^[.\s]+', '', text).strip()

        if not text:
            continue

        yield {
            "book": marker["book"],
            "chapter": marker["chapter"],
            "verse_start": marker["verse_start"],
            "verse_end": marker["verse_end"],
            "text": text,
        }


def main():
    if not os.path.exists(INPUT):
        print(f"ERROR: Input file not found: {INPUT}")
        sys.exit(1)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

    # Remove existing output
    if os.path.exists(OUTPUT):
        os.remove(OUTPUT)

    src = sqlite3.connect(INPUT)
    dst = sqlite3.connect(OUTPUT)

    # Create pack_info table
    dst.execute("""
        CREATE TABLE pack_info (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            version TEXT,
            description TEXT
        )
    """)
    dst.execute("""
        INSERT INTO pack_info VALUES (
            'spurgeon-expositions',
            "Spurgeon's Verse Expositions",
            'commentary',
            '1.0.0',
            "Charles Spurgeon's verse-by-verse expositions drawn from his sermons, covering the full Bible."
        )
    """)

    # Create commentary_entries table
    dst.execute("""
        CREATE TABLE commentary_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book TEXT NOT NULL,
            chapter INTEGER NOT NULL,
            verse_start INTEGER NOT NULL,
            verse_end INTEGER,
            author TEXT NOT NULL,
            title TEXT,
            text TEXT NOT NULL,
            source TEXT,
            year INTEGER
        )
    """)
    dst.execute("CREATE INDEX idx_verse ON commentary_entries (book, chapter, verse_start)")
    dst.execute("CREATE INDEX idx_author ON commentary_entries (author)")

    rows = src.execute("SELECT Book, ChapterBegin, ChapterEnd, VerseBegin, VerseEnd, Comments FROM Verses").fetchall()

    inserted = 0
    skipped = 0

    for book_num, ch_begin, ch_end, v_begin, v_end, rtf in rows:
        default_book = BOOK_MAP.get(book_num)
        if not default_book:
            print(f"  WARN: Unknown book number {book_num}, skipping")
            skipped += 1
            continue

        if not rtf:
            skipped += 1
            continue

        plain = strip_rtf(rtf)
        if not plain.strip():
            skipped += 1
            continue

        for entry in split_into_verses(plain, default_book, ch_begin, v_begin, v_end):
            dst.execute("""
                INSERT INTO commentary_entries
                    (book, chapter, verse_start, verse_end, author, title, text, source, year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                entry["book"],
                entry["chapter"],
                entry["verse_start"],
                entry["verse_end"],
                "Charles Spurgeon",
                "Spurgeon's Verse Expositions",
                entry["text"],
                "BibleSupport.com",
                1900,
            ))
            inserted += 1

    dst.commit()
    src.close()
    dst.close()

    size_kb = os.path.getsize(OUTPUT) / 1024
    print(f"\nDone.")
    print(f"  Entries inserted: {inserted}")
    print(f"  Passages skipped: {skipped}")
    print(f"  Output: {OUTPUT} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
