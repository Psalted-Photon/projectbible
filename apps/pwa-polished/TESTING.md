# Polished Bible Reader - Testing Guide

## Starting the App

1. **Start Polished PWA**:
   ```bash
   cd apps/pwa-polished
   npm run dev
   ```
   Runs on `http://localhost:5174`

2. **Start Main Developer PWA** (optional):
   ```bash
   cd apps/pwa
   npm run dev
   ```
   Runs on `http://localhost:5173`
   - Go to Settings section
   - Click "Open Polished Version ✨" button

## Testing Edge Gestures

### Desktop (Mouse)
1. **Left Edge** → Opens Settings Pane
   - Move mouse to left edge (within 20px)
   - Click and drag right
   - Drag more than 30% of screen width to trigger pane

2. **Right Edge** → Opens Search Pane
   - Move mouse to right edge (within 20px)
   - Click and drag left
   - Drag more than 30% of screen width

3. **Bottom Edge** → Opens Map Pane
   - Move mouse to bottom edge (within 20px)
   - Click and drag up
   - Drag more than 30% of screen height

### Mobile (Touch)
- Same as above but with finger swipe gestures
- Swipe from edge inward

## Testing Pane Features

### Resize Panes
- Drag the edge of an open pane to resize
- Side panes (left/right) resize horizontally
- Bottom pane resizes vertically

### Close Panes
- Click the × button in top-right corner
- Click the backdrop (dark area) outside pane

### Multiple Panes
- Open multiple panes from different edges
- Each pane has its own z-index layer

## Current Features

### Bible Reader
- Full-screen text display
- Placeholder verses (will integrate with adapters)
- Tap zone at top (shows console log for now)

### Settings Pane
- Theme selector (Light/Dark)
- Font size slider (12-24px)
- Line spacing slider (1.0-2.5)

### Map Pane
- Placeholder for Leaflet integration
- Will center on Israel by default

### Packs Pane
- Placeholder pack list
- Install from URL/File buttons (not wired up yet)

### Search Pane
- Search input box
- Results display (not wired up yet)

## Next Steps

### Phase 1: Core Integration
- [ ] Wire up adapters from main PWA
- [ ] Load real Bible text in BibleReader
- [ ] Integrate Leaflet map in MapPane
- [ ] Connect pack manager functionality
- [ ] Connect search functionality

### Phase 2: Enhanced Features
- [ ] Virtualized scrolling for Bible text
- [ ] Verse selection and highlights
- [ ] Word study popup
- [ ] Cross-references
- [ ] Reading history
- [ ] Settings persistence

### Phase 3: Polish
- [ ] Keyboard shortcuts (Esc to close panes)
- [ ] Custom pane assignments per edge
- [ ] Pane layout persistence
- [ ] Theme transitions
- [ ] Loading states
- [ ] Error boundaries

## Known Issues

- Bible text is placeholder data
- Panes show mock data
- No persistence yet
- No adapter integration yet
