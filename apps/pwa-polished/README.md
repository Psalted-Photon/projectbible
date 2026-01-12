# ProjectBible Polished

Immersive Bible reading experience with slide-in panes.

## Development

```bash
npm install
npm run dev
```

The app will run on `http://localhost:5174`

## Features

- **Zero-chrome Bible reader** - Full-screen text without distractions
- **Edge gestures** - Swipe from screen edges to open panes
- **Slide-in panes** - Settings, Map, Packs, Search
- **Smooth animations** - GPU-accelerated transitions
- **Resizable panes** - Drag to adjust pane sizes
- **Backdrop blur** - Focus on content while pane is open

## Architecture

Built with Svelte 5 for minimal bundle size and smooth animations. Uses Zustand for pane state management and reuses existing adapters from the main PWA.
