#!/usr/bin/env python3
"""Diagnose MHC Genesis block - search for verse content patterns."""
import struct, zlib, re
from pathlib import Path

base = Path('C:/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw/matthew-henry/modules/comments/zcom4/mhc')
bzs = (base / 'ot.bzs').read_bytes()
bzz = (base / 'ot.bzz').read_bytes()

offset, comp_size, uncomp_size = struct.unpack('<III', bzs[12:24])
block = zlib.decompress(bzz[offset:offset+comp_size]).decode('utf-8', errors='replace')

print(f'Genesis block: {len(block):,} chars')
print()

# What chapter/verse markers exist?
chapter_tags = re.findall(r'<chapter[^>]+>', block)
print(f'Chapter tags ({len(chapter_tags)} total), first 5:')
for t in chapter_tags[:5]:
    print(' ', t[:120])
print()

# Look for any "verse" pattern
verse_tags = re.findall(r'<verse[^>]*>', block)
print(f'Verse tags: {len(verse_tags)}')
for t in verse_tags[:10]:
    print(' ', t[:120])
print()

# Look for reference patterns that suggest verse structure  
print('=== Block at position 20000-23000 ===')
print(block[20000:23000])
print()
print('=== Chapter tag area ===')
m = re.search(r'<chapter[^>]+sID="Gen\.', block)
if m:
    print(block[m.start():m.start()+2000])
