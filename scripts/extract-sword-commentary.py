#!/usr/bin/env python3
"""
Extract MHC and JFB from SWORD zCom4 binary modules to container-style OSIS XML.

Uses the .bzv verse index to navigate each commentary's binary data,
groups consecutive verses that share the same block text range into a single
entry (preserving MHC's section-level structure), and writes OSIS XML
files compatible with the existing parse-commentary-sources.mjs parser.

BZV index structure (per testament):
  2 global headers
  + 1 book-intro entry per book
  + 1 chapter-intro entry per chapter
  + 1 verse entry per KJV verse
  = total entries

Output:
  data-sources/commentaries/osis/mhc.osis.xml
  data-sources/commentaries/osis/jfb.osis.xml
"""

import struct
import zlib
import re
import html
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RAW_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'raw'
OSIS_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'osis'
OSIS_DIR.mkdir(parents=True, exist_ok=True)

# SWORD KJV book order matching block indices (block 0 = module header, book starts at 1)
OT_BOOKS = [
    'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth',
    '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh',
    'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer',
    'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah',
    'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
]
NT_BOOKS = [
    'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor',
    'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim',
    'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John',
    '3John', 'Jude', 'Rev',
]

# KJV verse counts per chapter for all 66 books
# Indexed as KJV_VERSES[book_index][chapter_index] (0-based)
KJV_VERSES = [
    # OT
    [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],# Gen 50 ch
    [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],# Exod 40
    [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,24,8,12,14,44,13,39,39,20],# Lev 27
    [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],# Num 36
    [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],# Deut 34
    [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],# Josh 24
    [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],# Judg 21
    [22,23,18,22],# Ruth 4
    [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],# 1Sam 31
    [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],# 2Sam 24
    [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],# 1Kgs 22
    [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],# 2Kgs 25
    [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],# 1Chr 29
    [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],# 2Chr 36
    [11,70,13,24,17,22,28,36,15,44],# Ezra 10
    [11,20,32,23,19,19,73,18,38,39,36,47,31],# Neh 13
    [22,17,19,11,12,24,20],# Esth... 10 (but actually only 7 non-apocryphal)
    [22,17,19,11,12,24,20,38,18,17],# Esth 10 <-- correction
    [10,21,17,19,26,38,30,17,14,15,33,21,21,20,27,16,31,16,15,15,27,22,27,16,21,14,21,21,14,12,19,22,22,16,15,27,21,21,27,27,21,15,15,21,12,15,21,15,21],# Job 42
    [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,20,28,22,35,22,20,28,22,35,27,20,17,12],# Ps 50 (incomplete)
    None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None
]

# Use a simpler verse count lookup: we only need max_verse per book to navigate bzv
# Complete KJV verse counts (book index, chapters)
KJV_VERSE_COUNTS = {
    'Gen': [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
    'Exod': [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
    'Lev': [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,24,8,12,14,44,13,39,39,20],
    'Num': [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
    'Deut': [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
    'Josh': [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
    'Judg': [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
    'Ruth': [22,23,18,22],
    '1Sam': [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],
    '2Sam': [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
    '1Kgs': [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
    '2Kgs': [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
    '1Chr': [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
    '2Chr': [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
    'Ezra': [11,70,13,24,17,22,28,36,15,44],
    'Neh': [11,20,32,23,19,19,73,18,38,39,36,47,31],
    'Esth': [22,17,19,11,12,24,20,38,18,17],
    'Job': [22,17,35,11,30,40,22,26,11,30,26,21,27,22,17,17,42,14,26,8,21,20,27,22,34,20,19,22,28,28,33,37,27,23,22,21,21,19,35,37,17,20,29,27,47,11,32,22,24,20,28,22,33,11,19,27,26,25,27,29,17,23,21,9,19,20,8,25,11,30],
    'Ps': [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,20,28,22,35,22,20,28,22,35,27,20,17,12,12,8,11,11,7,8,10,9,9,10,18,26,20,18,19,14,18,16,23,20,15,16,21,11,17,20,12,8,11,10,11,14,11,12,25,19,23,11,9,13,14,9,11,29,22,14,22,14,14,7,6,19,11,20,18,19,18,20,20,18,18,21,13,25,22,26,25,16,22,14,13,14,17,12,18,9,13,9,71,13,7,19,6,20,20,19,24,19,25,16,23,22,27,12,29,22,10,11,21,22,13,14,11,12,15,36,15,14,22,9,13,31],
    'Prov': [33,22,35,27,23,35,27,36,27,21,45,13,32,21,26,16,29,21,20,19,25,16,16,18,23,22,20,16,17,14,24,17,22,24,21,24,14,29,35,17,32,7],
    'Eccl': [18,26,22,17,19,12,29,17,18,20,10,14],
    'Song': [17,17,11,16,16,13,13,14],
    'Isa': [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,21,29,2,26,16,2,19,18,26,15,14,16,16,24,25,19,26,23,11,17,6,21,20,21,10,25,26,23,18,15,26,31,9],
    'Jer': [54,20,56,22,27,26,20,60,40,12,25,11,22,47,35,43,7,51,27,27,24,19,24,36,25,15,30,15,28,20,44,62,21,14,8,25,11,45,13,12,38,29,28,28,15,45,23,34,16,33],
    'Lam': [22,22,66,22,22],
    'Ezek': [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
    'Dan': [21,49,30,37,31,28,28,27,27,21,45,13],
    'Hos': [11,23,5,19,15,11,16,14,17,15,12,14,16,9],
    'Joel': [20,32,21],
    'Amos': [15,16,15,13,27,14,17,14,15],
    'Obad': [21],
    'Jonah': [17,10,10,11],
    'Mic': [16,13,12,13,15,16,20],
    'Nah': [15,13,19],
    'Hab': [17,20,19],
    'Zeph': [18,15,20],
    'Hag': [15,23],
    'Zech': [21,13,10,14,11,15,14,23,17,12,17,14,9,21],
    'Mal': [14,17,18,6],
    # NT
    'Matt': [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
    'Mark': [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
    'Luke': [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
    'John': [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
    'Acts': [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
    'Rom': [32,29,31,25,21,23,25,39,33,21,36,21,14,26,33,25],
    '1Cor': [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
    '2Cor': [24,29,10,21,13,18,24,16,10,28,22,9,13],
    'Gal': [24,21,29,31,26,18],
    'Eph': [23,22,21,28,30,14],
    'Phil': [23,27,25,18],
    'Col': [18,26,18,28],
    '1Thess': [28,13,10,11,9],
    '2Thess': [15,13,19],
    '1Tim': [19,17,19,18,20,18],
    '2Tim': [18,26,17,22],
    'Titus': [16,15,15],
    'Phlm': [25],
    'Heb': [14,18,19,16,14,20,28,13,28,39,40,29,25],
    'Jas': [27,26,18,17,20],
    '1Pet': [25,25,22,19,14],
    '2Pet': [21,22,18],
    '1John': [10,29,24,21,21],
    '2John': [13],
    '3John': [14],
    'Jude': [25],
    'Rev': [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
}


def read_bzv(bzv_path):
    """Read all BZV entries as (block_num, start, size) triples."""
    data = bzv_path.read_bytes()
    entries = []
    for i in range(len(data) // 12):
        block_num, start, size = struct.unpack('<III', data[i*12:(i+1)*12])
        entries.append((block_num, start, size))
    return entries


def read_blocks(bzs_path, bzz_path):
    """Decompress all blocks. Returns dict: block_index -> decompressed_text."""
    bzs = bzs_path.read_bytes()
    bzz = bzz_path.read_bytes()
    blocks = {}
    for i in range(len(bzs) // 12):
        offset, comp_size, uncomp_size = struct.unpack('<III', bzs[i*12:(i+1)*12])
        if comp_size == 0:
            continue
        raw = bzz[offset:offset+comp_size]
        try:
            text = zlib.decompress(raw).decode('utf-8', errors='replace')
        except:
            try:
                text = zlib.decompress(raw, -15).decode('utf-8', errors='replace')
            except:
                text = ''
        blocks[i] = text
    return blocks


def clean_text(text):
    """Strip XML/HTML tags and normalize whitespace."""
    # Handle orphaned tag remnants from byte-boundary slicing:
    # e.g. text starts with: ype="x-s3">The Creation...
    text = re.sub(r'^[^<>]*>', ' ', text)
    # Strip all complete XML/HTML tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Strip orphaned open tag at end: "...text<title t" -> "...text"
    text = re.sub(r'<[^>]*$', '', text)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def escape_xml(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))


def extract_testament_entries(books, bzv_entries, blocks, testament_name):
    """
    Walk the BZV index for one testament and extract commentary entries.

    BZV layout (per our diagnosis):
      2 global header entries (skipped by caller)
      then per-book:
        1 book-intro entry
        per-chapter:
          1 chapter-intro entry
          n verse entries (one per KJV verse)

    Groups consecutive verses sharing the same (block, start, size) into
    one entry with a verse range so MHC's section commentary is preserved.
    Returns list of dicts: {book, chapter, verse_start, verse_end, text_key}
    text_key = (block_num, start, size) for later deref.
    """
    entries = []
    idx = 0  # offset into bzv_entries passed in (already past the 2 globals)

    for book_osis in books:
        verse_counts = KJV_VERSE_COUNTS.get(book_osis, [])
        if not verse_counts:
            # Skip: advance past estimated entries
            continue

        # Skip book-intro entry
        idx += 1

        for chapter_idx, n_verses in enumerate(verse_counts):
            chapter_num = chapter_idx + 1

            # Skip chapter-intro entry
            idx += 1

            # Collect verse entries for this chapter
            verse_range_entries = []
            for v in range(1, n_verses + 1):
                if idx >= len(bzv_entries):
                    break
                block_num, start, size = bzv_entries[idx]
                idx += 1
                if size == 0:
                    continue
                verse_range_entries.append((v, block_num, start, size))

            # Group consecutive verses with same text range
            if not verse_range_entries:
                continue

            groups = []
            cur_verses = [verse_range_entries[0][0]]
            cur_key = verse_range_entries[0][1:]  # (block, start, size)

            for i in range(1, len(verse_range_entries)):
                v, block, start, size = verse_range_entries[i]
                key = (block, start, size)
                if key == cur_key:
                    cur_verses.append(v)
                else:
                    groups.append((cur_verses, cur_key))
                    cur_verses = [v]
                    cur_key = key
            groups.append((cur_verses, cur_key))

            for group_verses, (block_num, start, size) in groups:
                # Get text from block
                block_text = blocks.get(block_num, '')
                if not block_text or size == 0:
                    continue
                raw = block_text[start:start + size]
                text = clean_text(raw)
                if len(text) < 30:
                    continue

                verse_start = group_verses[0]
                verse_end = group_verses[-1] if len(group_verses) > 1 else None
                entries.append({
                    'book': book_osis,
                    'chapter': chapter_num,
                    'verse_start': verse_start,
                    'verse_end': verse_end,
                    'text': text,
                })

    print(f'    {testament_name}: {len(entries)} section entries from BZV (idx advanced to {idx})')
    return entries, idx


def extract_module_to_osis(module_dir, module_id, work_id, title, author, year, output_file):
    """Extract a SWORD zCom4 module to container-style OSIS XML using BZV verse index."""
    print(f'\n{"=" * 60}')
    print(f'Extracting {module_id} → {output_file.name}')
    print(f'{"=" * 60}')

    conf_files = list((module_dir / 'mods.d').glob('*.conf'))
    if not conf_files:
        print('  ERROR: No .conf file'); return False

    conf_text = conf_files[0].read_text(encoding='utf-8', errors='replace')
    dp = re.search(r'DataPath\s*=\s*(.+)', conf_text)
    if not dp:
        print('  ERROR: No DataPath'); return False

    data_dir = module_dir / dp.group(1).strip().lstrip('./')
    if not data_dir.exists():
        print(f'  ERROR: Data directory not found: {data_dir}'); return False

    all_entries = []  # list of {book, chapter, verse_start, verse_end, text}

    for testament, books, prefix in [('OT', OT_BOOKS, 'ot'), ('NT', NT_BOOKS, 'nt')]:
        bzs_path = data_dir / f'{prefix}.bzs'
        bzv_path = data_dir / f'{prefix}.bzv'
        bzz_path = data_dir / f'{prefix}.bzz'

        if not all(p.exists() for p in [bzs_path, bzv_path, bzz_path]):
            print(f'  WARNING: Missing {prefix} files, skipping {testament}')
            continue

        print(f'\n  Loading {testament} data...')
        blocks = read_blocks(bzs_path, bzz_path)
        bzv = read_bzv(bzv_path)

        # Skip the 2 global header entries at the start of bzv
        testament_bzv = bzv[2:]

        entries, _ = extract_testament_entries(books, testament_bzv, blocks, testament)
        all_entries.extend(entries)

    if not all_entries:
        print('  ERROR: No entries extracted'); return False

    print(f'\n  Total: {len(all_entries):,} commentary sections')
    print(f'  Writing {output_file}...')

    # Organize by book for OSIS output
    from collections import defaultdict
    by_book = defaultdict(list)
    for e in all_entries:
        by_book[e['book']].append(e)

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">\n')
        f.write(f'<osisText osisIDWork="{work_id}">\n')
        f.write(f'  <header>\n')
        f.write(f'    <work osisWork="{work_id}">\n')
        f.write(f'      <title>{escape_xml(title)}</title>\n')
        f.write(f'      <creator role="author">{escape_xml(author)}</creator>\n')
        f.write(f'      <date>{year}</date>\n')
        f.write(f'      <refSystem>Bible.KJV</refSystem>\n')
        f.write(f'    </work>\n')
        f.write(f'  </header>\n\n')

        for book_osis in (OT_BOOKS + NT_BOOKS):
            book_entries = by_book.get(book_osis, [])
            if not book_entries:
                continue

            f.write(f'  <div type="book" osisID="{book_osis}">\n')
            cur_chapter = None

            for e in book_entries:
                ch = e['chapter']
                if ch != cur_chapter:
                    if cur_chapter is not None:
                        f.write(f'    </chapter>\n')
                    f.write(f'    <chapter osisID="{book_osis}.{ch}">\n')
                    cur_chapter = ch

                v_start = e['verse_start']
                v_end = e['verse_end']
                if v_end and v_end != v_start:
                    osis_id = f'{book_osis}.{ch}.{v_start}-{book_osis}.{ch}.{v_end}'
                else:
                    osis_id = f'{book_osis}.{ch}.{v_start}'

                f.write(f'      <verse osisID="{osis_id}">{escape_xml(e["text"])}</verse>\n')

            if cur_chapter is not None:
                f.write(f'    </chapter>\n')
            f.write(f'  </div>\n\n')

        f.write('</osisText>\n</osis>\n')

    size_mb = output_file.stat().st_size / (1024 * 1024)
    print(f'  ✅ Written {output_file.name} ({size_mb:.2f} MB, {len(all_entries):,} sections)')
    return True


MODULES = [
    {
        'dir_name': 'matthew-henry',
        'work_id': 'MHC',
        'title': "Matthew Henry's Complete Commentary on the Whole Bible",
        'author': 'Matthew Henry',
        'year': 1706,
        'output': 'mhc.osis.xml',
    },
    {
        'dir_name': 'jfb',
        'work_id': 'JFB',
        'title': 'Commentary Critical and Explanatory on the Whole Bible',
        'author': 'Jamieson-Fausset-Brown',
        'year': 1871,
        'output': 'jfb.osis.xml',
    },
    {
        'dir_name': 'spurgeon',
        'work_id': 'TDavid',
        'title': 'The Treasury of David',
        'author': 'Charles Spurgeon',
        'year': 1885,
        'output': 'tdavid.osis.xml',
    },
]


def main():
    print('SWORD zCom4 -> OSIS Extractor (BZV-based)')
    print('=' * 60)
    success = 0
    for mod in MODULES:
        module_dir = RAW_DIR / mod['dir_name']
        if not module_dir.exists():
            print(f'\nERROR: Not found: {module_dir}')
            continue
        output_file = OSIS_DIR / mod['output']
        ok = extract_module_to_osis(
            module_dir=module_dir,
            module_id=mod['work_id'],
            work_id=mod['work_id'],
            title=mod['title'],
            author=mod['author'],
            year=mod['year'],
            output_file=output_file,
        )
        if ok:
            success += 1
    print(f'\n{"=" * 60}')
    print(f'Done: {success}/{len(MODULES)} modules extracted')
    print(f'OSIS directory: {OSIS_DIR}')
    if success:
        print(f'\nNext: node scripts/parse-commentary-sources.mjs')


if __name__ == '__main__':
    main()
