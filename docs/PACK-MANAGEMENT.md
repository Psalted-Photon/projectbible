# Pack Management Guide

## Quick Reference

### Directory Structure
```
packs/
├── workbench/        # Development packs (testing)
├── polished/         # Production packs (bundled with app)
└── [loose files]     # Legacy packs (being phased out)
```

## Common Tasks

### 1. List All Packs
```powershell
.\manage-packs.ps1 list
```

### 2. Promote Pack from Workbench → Polished
```powershell
.\manage-packs.ps1 promote kjv.sqlite
```

### 3. Copy Pack from Polished → Workbench (for testing)
```powershell
.\manage-packs.ps1 demote kjv.sqlite
```

### 4. Clean Workbench
```powershell
.\manage-packs.ps1 clean
```

## Development Workflow

### Adding a New Pack

1. **Build the pack** (or download it)
   ```powershell
   npm run pack:build kjv
   ```

2. **Move to workbench**
   ```powershell
   move packs\kjv.sqlite packs\workbench\
   ```

3. **Test in Workbench** (port 5173)
   - Open http://localhost:5173
   - Use DevTools panel in bottom-right to manage packs
   - Test features

4. **Promote to Polished**
   ```powershell
   .\manage-packs.ps1 promote kjv.sqlite
   ```

5. **Build Polished**
   ```powershell
   npm run build:polished
   ```
   - This bundles all packs from `packs/polished/` into the production build
   - Output: `apps/pwa-polished/dist/`

### Testing Polished Build

1. **Serve the build locally**
   ```powershell
   cd apps\pwa-polished\dist
   npx serve
   ```

2. **Open in browser**
   - First run will extract bundled packs to IndexedDB
   - Progress bar shows initialization
   - App loads with pre-installed packs

## DevTools Panel (Workbench Only)

The workbench (port 5173) includes a DevTools panel in the bottom-right corner:

- **View packs** in workbench and polished directories
- **Copy packs** between directories (browser downloads them)
- **See IndexedDB stats** (size, verse count, etc.)
- **Refresh** to rescan directories

## Key Differences

### Workbench (5173)
- ✅ DevTools panel visible
- ✅ Can test any pack
- ✅ IndexedDB for runtime storage
- ❌ Not for end users

### Polished (5174)
- ✅ Clean, production UI
- ✅ Packs bundled with app
- ✅ First-run initialization
- ❌ No pack management UI
- ❌ Users can't add/remove packs (currently)

## Release Process

### Version 1.0 Release Steps

1. **Finalize packs in polished/**
   ```powershell
   .\manage-packs.ps1 list
   # Verify only desired packs are in polished/
   ```

2. **Build polished**
   ```powershell
   npm run build:polished
   ```
   - Output shows bundled packs
   - Check `apps/pwa-polished/dist/assets/packs/`

3. **Test the build**
   ```powershell
   cd apps\pwa-polished\dist
   npx serve
   # Open in browser, verify all features work
   ```

4. **Deploy**
   - Upload `apps/pwa-polished/dist/` to hosting (Vercel, Netlify, etc.)
   - Or package as Electron app
   - Or create Android APK wrapper

5. **Tag release**
   ```powershell
   git tag -a v1.0.0 -m "ProjectBible v1.0.0"
   git push --tags
   ```

## Troubleshooting

### Packs not showing in DevTools
- Run `.\manage-packs.ps1 list` to verify files exist
- Check file extensions (must be `.sqlite`)
- Refresh the DevTools panel

### First-run initialization fails
- Check browser console for errors
- Verify packs exist in `dist/assets/packs/`
- Check network tab for 404s on pack files
- Try: `localStorage.removeItem('projectbible_polished_initialized')` and refresh

### Build doesn't include packs
- Verify packs are in `packs/polished/` (not `packs/workbench/`)
- Check build output for "Bundling polished packs" message
- Ensure files are `.sqlite` format

## Future: User Pack Management

Currently, polished ships with fixed packs. Future versions may add:
- Settings panel with "Developer Mode" toggle
- Pack download/install UI (opt-in)
- Pack store/catalog
- User-created pack imports

For now, the approach is: **curate in workbench, ship in polished**.
