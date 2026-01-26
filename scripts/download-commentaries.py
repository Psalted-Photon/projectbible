#!/usr/bin/env python3
"""
Download and export Commentary modules using pysword
"""

import os
import sys
from pathlib import Path
from pysword.modules import SwordModules

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
RAW_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'raw'

# Commentary modules to download
MODULES = [
    ('MHC', 'matthew-henry'),
    ('JFB', 'jfb'),
    ('Barnes', 'barnes'),
    ('KD', 'keil-delitzsch'),
    ('Gill', 'gill'),
    ('Clarke', 'clarke'),
    ('Wesley', 'wesley'),
    ('PooleCommentary', 'poole'),
]

def main():
    print("Commentary Downloader - Starting...")
    print(f"Raw directory: {RAW_DIR}")
    
    # Create raw directory
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    
    # Initialize Sword modules
    print("\nInitializing Sword module manager...")
    modules = SwordModules()
    
    # List available commentaries
    print("\nAvailable commentary modules:")
    for mod in modules.list_modules():
        if 'comment' in mod.lower():
            print(f"  - {mod}")
    
    # Download and export each module
    for module_name, folder_name in MODULES:
        try:
            print(f"\n{'='*60}")
            print(f"Processing: {module_name}")
            print(f"{'='*60}")
            
            # Create module directory
            module_dir = RAW_DIR / folder_name
            module_dir.mkdir(exist_ok=True)
            
            # Check if module is available
            if module_name not in [m for m in modules.list_modules()]:
                print(f"⚠ Module {module_name} not found, skipping...")
                continue
            
            # Get module
            module = modules.get_module(module_name)
            print(f"✅ Module loaded: {module.name}")
            
            # Export to OSIS XML format
            output_file = module_dir / f"{module_name}.osis.xml"
            print(f"Exporting to: {output_file}")
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
                f.write('<osis>\n')
                
                # Get all books in module
                books = module.get_structure()
                for book in books.get_books():
                    print(f"  Exporting {book}...")
                    for chapter in books.get_chapters(book):
                        for verse in books.get_verses(book, chapter):
                            try:
                                text = module.get(book, chapter, verse)
                                if text:
                                    osisID = f"{book}.{chapter}.{verse}"
                                    f.write(f'  <verse osisID="{osisID}">{text}</verse>\n')
                            except Exception as e:
                                print(f"    ⚠ Error exporting {book} {chapter}:{verse}: {e}")
                
                f.write('</osis>\n')
            
            file_size = output_file.stat().st_size / (1024 * 1024)
            print(f"✅ Exported {output_file.name} ({file_size:.2f} MB)")
            
        except Exception as e:
            print(f"❌ Error processing {module_name}: {e}")
            import traceback
            traceback.print_exc()
    
    print("\n" + "="*60)
    print("Download complete!")
    print("="*60)
    print(f"\nNext step: node scripts/parse-commentary-sources.mjs")

if __name__ == '__main__':
    main()
