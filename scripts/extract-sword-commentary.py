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
import json
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

# KJV per-chapter verse counts are derived at runtime from the bundled KJV text
# (data-sources/KJV.json) rather than a hand-maintained table. A wrong count in a
# hand-typed table desyncs the sequential BZV walker and silently corrupts every
# later verse reference, which is exactly the bug this replaced. KJV.json is real
# verse-by-verse data, so its counts are authoritative by construction.
def _load_kjv_verse_counts():
    osis_order = OT_BOOKS + NT_BOOKS
    kjv_path = PROJECT_ROOT / 'data-sources' / 'KJV.json'
    books = json.loads(kjv_path.read_text(encoding='utf-8'))['books']
    if len(books) != len(osis_order):
        raise SystemExit(
            f'KJV.json has {len(books)} books, expected {len(osis_order)} '
            '(66, standard KJV order) — cannot derive versification')
    return {osis: [len(ch['verses']) for ch in b['chapters']]
            for osis, b in zip(osis_order, books)}


# Complete KJV verse counts (osis_book -> [verses per chapter]), sourced from KJV.json
KJV_VERSE_COUNTS = _load_kjv_verse_counts()

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

        # Guard: the sequential walker assumes the module's versification is KJV,
        # laid out as 2 global headers + per book(1 book-intro + per chapter(1
        # chapter-intro + 1 entry per verse)). If the bzv length disagrees with
        # what KJV_VERSE_COUNTS predicts, the index/verse mapping cannot be trusted.
        expected = 2 + sum(1 + sum(1 + n for n in KJV_VERSE_COUNTS.get(b, []))
                           for b in books)
        if expected != len(bzv):
            raise SystemExit(
                f'  FATAL: {testament} bzv has {len(bzv)} entries but versification '
                f'predicts {expected}; module is not standard KJV — aborting to '
                'avoid corrupting verse alignment')

        # Skip the 2 global header entries at the start of bzv
        testament_bzv = bzv[2:]

        entries, _ = extract_testament_entries(books, testament_bzv, blocks, testament)
        all_entries.extend(entries)

    if not all_entries:
        print('  ERROR: No entries extracted'); return False

    # Guard: cross-check assigned verses against the verse numbers embedded in the
    # JFB/MHC text. Entries whose text begins with a bare "N." carry the true verse
    # number; for a correct extraction it must equal the assigned verse_start. A low
    # match rate means the walker has drifted (the original bug), so abort loudly
    # rather than writing silently-wrong data. The bzv-length guard alone misses this
    # because a wrong-but-same-total versification still passes it.
    checked = matched = 0
    mismatches = []
    for e in all_entries:
        m = re.match(r'^(\d+)\.\s', e['text'])
        if not m:
            continue
        checked += 1
        if int(m.group(1)) == e['verse_start']:
            matched += 1
        elif len(mismatches) < 10:
            mismatches.append(
                f"{e['book']} {e['chapter']}:{e['verse_start']} text says {m.group(1)}")
    rate = matched / checked if checked else 1.0
    print(f'  Alignment check: {matched}/{checked} '
          f'({rate:.1%}) text verse numbers match assigned verse')
    if checked >= 50 and rate < 0.90:
        print('  Sample mismatches (assigned vs text):')
        for s in mismatches:
            print(f'    {s}')
        raise SystemExit(
            '  FATAL: commentary verse alignment is off — aborting before writing '
            'bad data')

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
