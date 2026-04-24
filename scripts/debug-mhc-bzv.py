#!/usr/bin/env python3
"""Diagnose MHC .bzv verse index format."""
import struct, zlib
from pathlib import Path

base = Path('C:/Users/Marlowe/Desktop/ProjectBible/data-sources/commentaries/raw/matthew-henry/modules/comments/zcom4/mhc')
bzs_data = (base / 'ot.bzs').read_bytes()
bzv_data = (base / 'ot.bzv').read_bytes()
bzz_data = (base / 'ot.bzz').read_bytes()

n_bzv = len(bzv_data) // 12
n_bzs = len(bzs_data) // 12
print(f'bzs entries: {n_bzs} (blocks)')
print(f'bzv entries: {n_bzv} (verse index)')
print()

# Read block offsets/sizes
blocks = []
for i in range(n_bzs):
    offset, comp, uncomp = struct.unpack('<III', bzs_data[i*12:(i+1)*12])
    blocks.append((offset, comp, uncomp))
    
print('Block 0 (header):', blocks[0])
print('Block 1 (Genesis):', blocks[1])
print('Block 2 (Exodus):', blocks[2])
print()

# Cache decompressed blocks for inspection
def get_block(idx):
    if idx >= len(blocks): return ''
    offset, comp, uncomp = blocks[idx]
    if comp == 0: return ''
    data = bzz_data[offset:offset+comp]
    try:
        return zlib.decompress(data).decode('utf-8', errors='replace')
    except:
        return ''

# Read first 20 bzv entries
print('First 20 bzv entries [block, start, size] (12 bytes each):')
for i in range(20):
    entry = bzv_data[i*12:(i+1)*12]
    block_num, start, size = struct.unpack('<III', entry)
    print(f'  [{i:3d}] block={block_num}, start={start}, size={size}', end='')
    
    # Try to read the text at this position
    if block_num > 0 and block_num < len(blocks) and size > 0 and size < 50000:
        block_text = get_block(block_num)
        snippet = block_text[start:start+size] if block_text else ''
        import re
        snippet_clean = re.sub(r'<[^>]+>', ' ', snippet).strip()[:80]
        print(f' -> "{snippet_clean}"')
    else:
        print()

print()

# KJV verse count per chapter for Genesis to figure out index structure
# Gen has 50 chapters, KJV verse counts:
gen_chapters = [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26]
print(f'Genesis: {len(gen_chapters)} chapters, {sum(gen_chapters)} verses')

# Check if the bzv structure is: book entry, then chapter entries, then verse entries
# Or just: verse entries
# For OT: 39 books, ~23145 verses + chapters + book entries
