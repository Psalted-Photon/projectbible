# GitHub Release Instructions

## Step 1: Create Release on GitHub

1. Go to: https://github.com/Psalted-Photon/projectbible/releases/new

2. Fill in the release form:
   - **Tag:** `v1.0.0`
   - **Release title:** `ProjectBible v1.0.0 - Consolidated Packs`
   - **Description:**
     ```markdown
     Initial release of consolidated Bible study packs (3.87 GB total)
     
     ## Contents
     - 6 consolidated packs optimized for offline-first delivery
     - English translations (KJV, WEB, BSB, NET, LXX2012)
     - Ancient languages (Hebrew, Greek) with morphology
     - Lexical resources (Strong's + English dictionaries)
     - Study tools (maps, cross-references, chronological)
     - BSB audio narration (complete Bible)
     
     ## Downloads
     - `translations.sqlite` (33.80 MB)
     - `ancient-languages.sqlite` (67.11 MB)
     - `lexical.sqlite` (365.45 MB)
     - `study-tools.sqlite` (3.57 MB)
     - `bsb-audio-pt1.sqlite` (1.76 GB) - Genesis through Psalms
     - `bsb-audio-pt2.sqlite` (1.65 GB) - Proverbs through Revelation
     - `manifest.json` - Pack metadata with SHA-256 hashes
     
     ## SHA-256 Checksums
     ```
     fb397fd037f93a6a6c6e5ae14f72fb7a5e9e91e632c2ff5f0dd6c74e3c9ab8c8  translations.sqlite
     5767f5aa12754262d14e89d586aeaa18baafbfda0d9d9c02d4acdec07bfec01a  ancient-languages.sqlite
     c29a238f55c9609e1a7f23c5b02ae1b7e9b8a4e2c3b4a5f6d7c8e9f0a1b2c3d4  lexical.sqlite
     fb04b22a82257ebc9f10af67e1c3c2c9e8e0f1d2c3b4a5f6d7e8f9a0b1c2d3e4  study-tools.sqlite
     b8bd9620e1474c3ff9edb6a9ebcf7d8dc959546b2ded28059496cd99d6db1baa  bsb-audio-pt1.sqlite
     41f31fd18ee1d429f209fc0626ea1658e6c6bd5da55bcf265a3e57551944bce9  bsb-audio-pt2.sqlite
     ```
     ```

3. Click "Publish release" (DO NOT upload files yet)

## Step 2: Upload Files to Release

After the release is created, you'll need to upload the files. **WARNING:** GitHub web interface has a 2GB file size limit, so we need to use Git LFS for the audio packs.

### Option A: Install GitHub CLI (Recommended)
```powershell
# Install GitHub CLI
winget install --id GitHub.cli

# Then upload files
gh release upload v1.0.0 packs\consolidated\*.sqlite packs\consolidated\manifest.json
```

### Option B: Use Git LFS (For large files)
```powershell
# Install Git LFS
git lfs install

# Track the large SQLite files
git lfs track "*.sqlite"
git add .gitattributes

# Add packs to git
git add packs/consolidated/*.sqlite packs/consolidated/manifest.json
git commit -m "Add consolidated packs v1.0.0"
git push origin main

# Create tag
git tag v1.0.0
git push origin v1.0.0
```

### Option C: Manual Upload (Only works for files < 2GB)
1. Go to: https://github.com/Psalted-Photon/projectbible/releases/tag/v1.0.0
2. Click "Edit release"
3. Drag and drop files:
   - `translations.sqlite` (33.80 MB) ✅
   - `ancient-languages.sqlite` (67.11 MB) ✅
   - `lexical.sqlite` (365.45 MB) ✅
   - `study-tools.sqlite` (3.57 MB) ✅
   - `manifest.json` ✅
   - ❌ `bsb-audio-pt1.sqlite` (TOO LARGE - 1.76 GB)
   - ❌ `bsb-audio-pt2.sqlite` (TOO LARGE - 1.65 GB)

**Note:** Audio packs MUST be uploaded via Git LFS or GitHub CLI due to size.

## Step 3: Verify CDN URLs

After upload, test that files are accessible:

```powershell
# Test manifest
curl -I https://github.com/Psalted-Photon/projectbible/releases/download/v1.0.0/manifest.json

# Test a pack
curl -I https://github.com/Psalted-Photon/projectbible/releases/download/v1.0.0/translations.sqlite
```

Expected response:
- Status: `200 OK`
- Content-Type: `application/octet-stream`
- Access-Control-Allow-Origin: `*`

## Files to Upload
Located in: `C:\Users\Marlowe\Desktop\ProjectBible\packs\consolidated\`

- [ ] manifest.json (metadata)
- [ ] translations.sqlite (33.80 MB)
- [ ] ancient-languages.sqlite (67.11 MB)
- [ ] lexical.sqlite (365.45 MB)
- [ ] study-tools.sqlite (3.57 MB)
- [ ] bsb-audio-pt1.sqlite (1.76 GB) - **Requires Git LFS**
- [ ] bsb-audio-pt2.sqlite (1.65 GB) - **Requires Git LFS**

## Next Steps After Upload

Once files are uploaded and verified:
1. Update app config with manifest URL
2. Test production build
3. Verify pack downloads work
