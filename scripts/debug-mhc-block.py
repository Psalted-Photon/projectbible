#!/usr/bin/env python3
"""Diagnose MHC Genesis block structure to find verse patterns."""
import struct, zlib, re
from pathlib import Path

base = Path('C:/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw/matthew-henry/modules/comments/zcom4/mhc')
bzs = (base / 'ot.bzs').read_bytes()
bzz = (base / 'ot.bzz').read_bytes()

# Genesis is block 1
offset, comp_size, uncomp_size = struct.unpack('<III', bzs[12:24])
block = zlib.decompress(bzz[offset:offset+comp_size]).decode('utf-8', errors='replace')

print(f'Genesis block: {len(block):,} chars (uncompressed)')
print()

# Find all <verse ...> patterns
verse_tags = re.findall(r'<verse[^>]*>', block[:50000])
print('First 10 verse tags found:')
for t in verse_tags[:10]:
    print(' ', t[:120])
print()

# Show first 3000 chars of readable content
print('=== First 3000 chars ===')
print(block[:3000])
print()
print('=== Chars 5000-8000 ===')
print(block[5000:8000])
