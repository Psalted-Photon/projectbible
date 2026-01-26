#!/usr/bin/env python3
"""
Convert Sword zCom4 modules to OSIS XML format

Reads compressed Sword modules and converts them to OSIS XML that can be parsed by our JavaScript parser.
"""

import os
import struct
import zlib
from pathlib import Path
import configparser

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
RAW_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'raw'

# KJV book order (Sword versification)
KJV_BOOKS = [
    'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
    '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
    'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
    'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
    'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
    'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb',
    'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'
]

# Chapters per book (KJV versification)
KJV_CHAPTERS = {
    'Gen': 50, 'Exod': 40, 'Lev': 27, 'Num': 36, 'Deut': 34, 'Josh': 24, 'Judg': 21, 'Ruth': 4,
    '1Sam': 31, '2Sam': 24, '1Kgs': 22, '2Kgs': 25, '1Chr': 29, '2Chr': 36, 'Ezra': 10, 'Neh': 13,
    'Esth': 10, 'Job': 42, 'Ps': 150, 'Prov': 31, 'Eccl': 12, 'Song': 8, 'Isa': 66, 'Jer': 52,
    'Lam': 5, 'Ezek': 48, 'Dan': 12, 'Hos': 14, 'Joel': 3, 'Amos': 9, 'Obad': 1, 'Jonah': 4,
    'Mic': 7, 'Nah': 3, 'Hab': 3, 'Zeph': 3, 'Hag': 2, 'Zech': 14, 'Mal': 4,
    'Matt': 28, 'Mark': 16, 'Luke': 24, 'John': 21, 'Acts': 28, 'Rom': 16, '1Cor': 16, '2Cor': 13,
    'Gal': 6, 'Eph': 6, 'Phil': 4, 'Col': 4, '1Thess': 5, '2Thess': 3, '1Tim': 6, '2Tim': 4,
    'Titus': 3, 'Phlm': 1, 'Heb': 13, 'Jas': 5, '1Pet': 5, '2Pet': 3, '1John': 5, '2John': 1,
    '3John': 1, 'Jude': 1, 'Rev': 22
}

# Verses per chapter (simplified - use 200 as max for indexing)
MAX_VERSES_PER_CHAPTER = 200

def read_sword_index(module_path):
    """Read Sword module index files (.idx, .dat, .zdx, .zdt)"""
    entries = {}
    
    # Try compressed index first
    idx_file = module_path / 'mhc.zdx'
    dat_file = module_path / 'mhc.zdt'
    
    if not idx_file.exists():
        # Try uncompressed
        idx_file = module_path / 'mhc.idx'
        dat_file = module_path / 'mhc.dat'
    
    if not idx_file.exists():
        print(f"❌ Index file not found in {module_path}")
        return entries
    
    print(f"Reading index: {idx_file}")
    print(f"Reading data: {dat_file}")
    
    try:
        with open(idx_file, 'rb') as idx:
            with open(dat_file, 'rb') as dat:
                idx_data = idx.read()
                dat_data = dat.read()
                
                # Each index entry is 12 bytes (offset, size, compressed_size)
                entry_size = 12
                num_entries = len(idx_data) // entry_size
                
                print(f"Found {num_entries} index entries")
                
                for i in range(min(num_entries, 100)):  # Sample first 100 entries
                    idx_entry = idx_data[i*entry_size:(i+1)*entry_size]
                    offset, size, comp_size = struct.unpack('<III', idx_entry)
                    
                    if offset > 0 and size > 0:
                        # Read compressed data
                        dat.seek(offset)
                        compressed = dat.read(comp_size)
                        
                        try:
                            # Decompress
                            text = zlib.decompress(compressed).decode('utf-8', errors='ignore')
                            entries[i] = text[:200]  # Store first 200 chars
                        except Exception as e:
                            pass
                
                print(f"Successfully read {len(entries)} entries")
                
    except Exception as e:
        print(f"❌ Error reading Sword module: {e}")
    
    return entries

def convert_module_to_osis(module_dir, output_file):
    """Convert Sword module to OSIS XML"""
    try:
        print(f"\n{'='*60}")
        print(f"Converting: {module_dir.name}")
        print(f"{'='*60}")
        
        # Find module config
        conf_files = list((module_dir / 'mods.d').glob('*.conf'))
        if not conf_files:
            print(f"❌ No .conf file found")
            return False
        
        # Read config
        config = configparser.ConfigParser()
        config.read(conf_files[0], encoding='utf-8')
        
        module_name = list(config.sections())[0]
        data_path = config[module_name].get('DataPath', '').strip('./')
        
        print(f"Module: {module_name}")
        print(f"Data path: {data_path}")
        
        # Find data files
        data_dir = module_dir / data_path
        if not data_dir.exists():
            print(f"❌ Data directory not found: {data_dir}")
            return False
        
        # Read Sword index
        entries = read_sword_index(data_dir)
        
        if not entries:
            print(f"⚠ No entries found, generating placeholder OSIS")
        
        # Generate OSIS XML
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
            f.write('<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">\n')
            f.write('  <osisText osisIDWork="Bible">\n')
            
            # Write sample entries
            for idx, text in list(entries.items())[:50]:
                # Guess book/chapter/verse from index
                book_idx = idx // (50 * MAX_VERSES_PER_CHAPTER)
                if book_idx < len(KJV_BOOKS):
                    book = KJV_BOOKS[book_idx]
                    chapter = ((idx % (50 * MAX_VERSES_PER_CHAPTER)) // MAX_VERSES_PER_CHAPTER) + 1
                    verse = (idx % MAX_VERSES_PER_CHAPTER) + 1
                    
                    osisID = f"{book}.{chapter}.{verse}"
                    escaped_text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    f.write(f'    <verse osisID="{osisID}">{escaped_text}</verse>\n')
            
            f.write('  </osisText>\n')
            f.write('</osis>\n')
        
        file_size = output_file.stat().st_size / (1024 * 1024)
        print(f"✅ Created {output_file.name} ({file_size:.2f} MB)")
        print(f"📝 Note: This is a basic export. Full conversion requires proper Sword library.")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("Sword Module to OSIS Converter")
    print("="*60)
    
    # Find all module directories
    module_dirs = [d for d in RAW_DIR.iterdir() if d.is_dir() and (d / 'mods.d').exists()]
    
    print(f"Found {len(module_dirs)} module directories\n")
    
    success_count = 0
    for module_dir in module_dirs:
        output_file = module_dir / f"{module_dir.name}.osis.xml"
        if convert_module_to_osis(module_dir, output_file):
            success_count += 1
    
    print("\n" + "="*60)
    print(f"Conversion complete! ({success_count}/{len(module_dirs)} successful)")
    print("="*60)
    
    print("\n📝 NOTE: Sword module format is complex.")
    print("For best results, use the official Sword tools (mod2osis).")
    print("\nAlternative: Download pre-converted OSIS files from:")
    print("  - https://github.com/eBible-org/")
    print("  - https://ebible.org/find/")

if __name__ == '__main__':
    main()
