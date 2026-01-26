#!/usr/bin/env python3
"""
Download public domain commentaries from eBible.org and other sources

These are provided in easier-to-parse formats (USFX, plain text, etc.)
"""

import os
import zipfile
from pathlib import Path
from urllib.request import urlretrieve, Request, urlopen
import json

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
RAW_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'raw'

# Public domain commentary sources
COMMENTARY_SOURCES = [
    {
        'name': 'Matthew Henry Complete Commentary (Text)',
        'url': 'https://www.gutenberg.org/files/4135/4135-0.txt',
        'filename': 'matthew-henry/matthew-henry-complete.txt',
        'format': 'plain_text'
    },
    {
        'name': 'Jamieson-Fausset-Brown (Text)',
        'url': 'http://www.sacred-texts.com/bib/cmt/jfb/index.htm',
        'filename': 'jfb/jfb-index.html',
        'format': 'html_index'
    },
]

# Alternative: Use JSON-formatted commentaries from Open Bible APIs
OPEN_BIBLE_COMMENTARIES = [
    {
        'name': 'Matthew Henry (JSON API)',
        'base_url': 'https://bolls.life/get-commentary/MHC/',
        'books': ['Genesis', 'Exodus', 'Matthew', 'John', 'Romans'],  # Sample books
        'filename_pattern': 'matthew-henry/json/{book}.json',
    },
]

def download_text_source(source):
    """Download plain text or HTML source"""
    try:
        print(f"\n{'='*60}")
        print(f"Downloading: {source['name']}")
        print(f"{'='*60}")
        
        output_path = RAW_DIR / source['filename']
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        print(f"URL: {source['url']}")
        print(f"Output: {output_path}")
        
        # Create request with user agent (some servers require this)
        req = Request(source['url'], headers={'User-Agent': 'Mozilla/5.0'})
        
        with urlopen(req) as response:
            content = response.read()
            output_path.write_bytes(content)
        
        file_size = output_path.stat().st_size / (1024 * 1024)
        print(f"✅ Downloaded {file_size:.2f} MB")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def download_json_commentary(source):
    """Download JSON commentary data from API"""
    try:
        print(f"\n{'='*60}")
        print(f"Downloading: {source['name']}")
        print(f"{'='*60}")
        
        success_count = 0
        
        for book in source['books']:
            try:
                url = source['base_url'] + book
                output_path = RAW_DIR / source['filename_pattern'].format(book=book)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                
                print(f"  {book}... ", end='', flush=True)
                
                req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urlopen(req) as response:
                    content = response.read()
                    output_path.write_bytes(content)
                
                print(f"✅ {len(content)} bytes")
                success_count += 1
                
            except Exception as e:
                print(f"❌ {e}")
        
        print(f"\nDownloaded {success_count}/{len(source['books'])} books")
        return success_count > 0
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    print("Public Domain Commentary Downloader")
    print("="*60)
    print(f"Output directory: {RAW_DIR}\n")
    
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    
    success_count = 0
    
    # Download text sources
    for source in COMMENTARY_SOURCES:
        if download_text_source(source):
            success_count += 1
    
    # Download JSON commentaries
    for source in OPEN_BIBLE_COMMENTARIES:
        if download_json_commentary(source):
            success_count += 1
    
    print("\n" + "="*60)
    print(f"Downloads complete! ({success_count} successful)")
    print("="*60)
    
    print("\n📝 Next steps:")
    print("1. Manually review downloaded files")
    print("2. Convert to NDJSON format using custom parsers")
    print("3. Run: node scripts/parse-commentary-sources.mjs")

if __name__ == '__main__':
    main()
