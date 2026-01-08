# Mobile Setup Guide

## Quick Start: Get ProjectBible PWA on Your Phone

### Option 1: GitHub Pages Deployment (Recommended)

**One-time setup:**

1. **Enable GitHub Pages** in your repo:
   - Go to repo Settings → Pages
   - Source: GitHub Actions
   - Push to main branch (the workflow will auto-deploy)

2. **Access from mobile:**
   - Visit `https://yourusername.github.io/ProjectBible`
   - Tap "Add to Home Screen" (iOS) or "Install" (Android)

3. **Host your packs:**
   - Upload pack files to GitHub Releases:
     ```bash
     # Create a release with your pack files
     gh release create v1.0.0 packs/*.sqlite --title "Bible Packs v1.0.0"
     ```
   - Copy the download URLs from the release

4. **Import packs on mobile:**
   - Open the PWA
   - Go to "Download from URL" section
   - Paste pack URL: `https://github.com/yourusername/ProjectBible/releases/download/v1.0.0/greek.sqlite`
   - Tap "Download & Import"

### Option 2: Codespaces Quick Test

**For development/testing:**

1. **Start dev server:**
   ```bash
   npm run dev:pwa
   ```

2. **Make port public:**
   - Click "Ports" tab in Codespaces
   - Right-click port 5173 → Port Visibility → Public
   - Copy the forwarded URL

3. **Open on mobile:**
   - Visit the forwarded URL on your phone
   - Works great for testing!

4. **Get packs on mobile:**
   - Upload packs to cloud storage (Google Drive, Dropbox, etc.)
   - Set sharing to "Anyone with link"
   - Copy direct download link
   - Use "Download from URL" feature in PWA

### Option 3: Local Network (Same WiFi)

**If both devices on same network:**

1. **Find your local IP:**
   ```powershell
   # Windows
   ipconfig
   # Look for "IPv4 Address" (e.g., 192.168.1.100)
   ```

2. **Start dev server with host flag:**
   ```bash
   npm run dev:pwa -- --host
   ```

3. **Access from mobile:**
   - Visit `http://192.168.1.100:5173` (use your IP)
   - Works without internet!

4. **Transfer packs:**
   - Use file sharing apps (Send Anywhere, ShareDrop, etc.)
   - Or use "Download from URL" with local server

## Pack Hosting Options

### GitHub Releases (Free, Public)
```bash
# Upload all packs to a release
gh release create packs-v1 packs/*.sqlite \
  --title "Bible Data Packs v1" \
  --notes "Initial pack release"
```

**Download URLs:**
- `https://github.com/USER/REPO/releases/download/packs-v1/greek.sqlite`
- `https://github.com/USER/REPO/releases/download/packs-v1/hebrew.sqlite`
- etc.

### Google Drive
1. Upload pack files
2. Right-click → Share → Anyone with link
3. Copy link and convert to direct download:
   - Original: `https://drive.google.com/file/d/FILE_ID/view?usp=sharing`
   - Direct: `https://drive.google.com/uc?export=download&id=FILE_ID`

### Dropbox
1. Upload pack files
2. Get shareable link
3. Change `?dl=0` to `?dl=1` for direct download

### Self-hosted (nginx/Apache)
```nginx
# Static file serving with CORS
location /packs/ {
    add_header Access-Control-Allow-Origin *;
    add_header Content-Type application/x-sqlite3;
}
```

## Installing as PWA

### iOS (Safari)
1. Open site in Safari
2. Tap Share button (square with arrow)
3. Scroll down → "Add to Home Screen"
4. Tap "Add"

### Android (Chrome)
1. Open site in Chrome
2. Tap menu (⋮) → "Install app" or "Add to Home Screen"
3. Tap "Install"

## Offline Usage

Once installed:
- ✅ Works completely offline
- ✅ All packs stored in browser (IndexedDB)
- ✅ Survives browser updates
- ✅ Can clear data from app settings

**Storage limits:**
- Chrome: ~60% of available disk space
- Safari iOS: ~1GB initially, can request more
- Firefox: ~50% of available disk space

## Troubleshooting

**"Out of storage" error:**
- Check browser storage settings
- Request persistent storage (implemented in app)
- Clear old data from Settings

**Packs not loading:**
- Check browser console for errors
- Verify CORS headers on pack host
- Try uploading file directly instead of URL

**App won't install:**
- Ensure HTTPS (required for PWA)
- Check manifest.json is valid
- Verify service worker registration

**Slow performance:**
- Large packs may take time to import
- IndexedDB is slower than native SQLite
- Consider starting with smaller packs
- Desktop app (Electron) has better performance

## Current Available Packs

Built packs in `packs/` directory:
- `greek.sqlite` (~16 MB) - LXX, Byzantine, TR, OpenGNT
- `hebrew.sqlite` (when built) - WLC, Hebrew OT
- `web.sqlite` (when built) - World English Bible
- `kjv.sqlite` (when built) - King James Version
- `cross-references.sqlite` (~40 KB) - Biblical cross-references
- `places.sqlite` (when built) - Biblical places data
- `maps.sqlite` (when built) - Historical map layers

## Next Steps

1. Deploy to GitHub Pages
2. Create release with pack files
3. Test on mobile
4. Install as PWA
5. Import packs from release URLs
6. Enjoy offline Bible study!
