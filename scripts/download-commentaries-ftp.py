#!/usr/bin/env python3
"""
Download Commentary modules directly from CrossWire FTP
"""

import os
import zipfile
import tarfile
from pathlib import Path
from urllib.request import urlretrieve
import shutil

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
RAW_DIR = PROJECT_ROOT / 'data-sources' / 'commentaries' / 'raw'

# CrossWire FTP base
FTP_BASE = "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/"

# Commentary modules to download
MODULES = [
    ('MHC.zip', 'matthew-henry', 'Matthew Henry'),
    ('JFB.zip', 'jfb', 'Jamieson-Fausset-Brown'),
    ('Barnes.zip', 'barnes', 'Barnes'),
    ('KD.zip', 'keil-delitzsch', 'Keil & Delitzsch'),
    ('Gill.zip', 'gill', 'John Gill'),
    ('Clarke.zip', 'clarke', 'Adam Clarke'),
    ('Wesley.zip', 'wesley', 'John Wesley'),
    ('PooleCommentary.zip', 'poole', 'Matthew Poole'),
    ('Geneva.zip', 'geneva', 'Geneva Bible Notes'),
    ('Ellicott.zip', 'ellicott', 'Ellicott Commentary'),
]

def download_and_extract(zip_name, folder_name, display_name):
    """Download and extract a Sword module"""
    try:
        print(f"\n{'='*60}")
        print(f"Downloading: {display_name}")
        print(f"{'='*60}")
        
        # Create module directory
        module_dir = RAW_DIR / folder_name
        module_dir.mkdir(parents=True, exist_ok=True)
        
        # Download URL
        url = FTP_BASE + zip_name
        zip_path = module_dir / zip_name
        
        print(f"URL: {url}")
        print(f"Downloading to: {zip_path}")
        
        # Download file
        urlretrieve(url, zip_path)
        
        file_size = zip_path.stat().st_size / (1024 * 1024)
        print(f"✅ Downloaded {file_size:.2f} MB")
        
        # Extract zip
        print(f"Extracting...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(module_dir)
        
        # Clean up zip
        zip_path.unlink()
        
        print(f"✅ Extracted to {module_dir}")
        
        # List extracted files
        files = list(module_dir.glob('*'))
        print(f"Extracted files:")
        for f in files[:10]:  # Show first 10
            print(f"  - {f.name}")
        if len(files) > 10:
            print(f"  ... and {len(files) - 10} more files")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    print("Commentary Downloader - CrossWire Direct Download")
    print(f"Raw directory: {RAW_DIR}")
    
    # Create raw directory
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    
    # Download each module
    success_count = 0
    for zip_name, folder_name, display_name in MODULES:
        if download_and_extract(zip_name, folder_name, display_name):
            success_count += 1
    
    print("\n" + "="*60)
    print(f"Download complete! ({success_count}/{len(MODULES)} successful)")
    print("="*60)
    
    # Note about conversion
    print("\n📝 NOTE: Sword modules are in compressed format.")
    print("We need to convert them to OSIS XML using Sword tools.")
    print("\nAlternative approach:")
    print("1. Install Sword utilities from https://www.crosswire.org/sword/software/")
    print("2. Use: mod2osis <MODULE> > <output>.osis.xml")
    print("\nOr we can parse the Sword module format directly in JavaScript.")

if __name__ == '__main__':
    main()
