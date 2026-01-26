#!/usr/bin/env python3
"""
Download pre-converted OSIS XML commentaries from alternative sources
"""

import os
from pathlib import Path
from urllib.request import urlretrieve

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
RAW_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'raw'

# Pre-converted OSIS XML sources (Archive.org and other public sources)
OSIS_SOURCES = [
    {
        'name': 'Matthew Henry (Archive.org OSIS)',
        'url': 'https://archive.org/download/sword-modules-osis/MHC.xml',
        'filename': 'matthew-henry/MHC.osis.xml'
    },
    {
        'name': 'Jamieson-Fausset-Brown (Archive.org OSIS)',
        'url': 'https://archive.org/download/sword-modules-osis/JFB.xml',
        'filename': 'jfb/JFB.osis.xml'
    },
    {
        'name': 'Barnes Notes (Archive.org OSIS)',
        'url': 'https://archive.org/download/sword-modules-osis/Barnes.xml',
        'filename': 'barnes/Barnes.osis.xml'
    },
]

def download_osis(source):
    """Download pre-converted OSIS XML file"""
    try:
        print(f"\n{'='*60}")
        print(f"Downloading: {source['name']}")
        print(f"{'='*60}")
        
        # Create module directory
        output_path = RAW_DIR / source['filename']
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        print(f"URL: {source['url']}")
        print(f"Output: {output_path}")
        
        # Download file
        urlretrieve(source['url'], output_path)
        
        file_size = output_path.stat().st_size / (1024 * 1024)
        print(f"✅ Downloaded {file_size:.2f} MB")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    print("Commentary OSIS XML Downloader")
    print(f"Raw directory: {RAW_DIR}")
    
    # Create raw directory
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    
    # Download each source
    success_count = 0
    for source in OSIS_SOURCES:
        if download_osis(source):
            success_count += 1
    
    print("\n" + "="*60)
    print(f"Download complete! ({success_count}/{len(OSIS_SOURCES)} successful)")
    print("="*60)
    
    if success_count > 0:
        print("\n✅ Ready to parse!")
        print("Next step: node scripts/parse-commentary-sources.mjs")

if __name__ == '__main__':
    main()
