export * from './interfaces.js';

export function renderApp(root: HTMLElement): void {
  root.innerHTML = `
    <main style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 16px; max-width: 900px; margin: 0 auto; background: white; color: black; min-height: 100vh;">
      <h1 style="margin: 0 0 8px; color: #333;">ProjectBible</h1>
      <p style="margin: 0 0 16px; color: #666;">Scaffold running. Next: packs, reader, search.</p>
      <section style="display: grid; gap: 8px;">
        <div><strong>Status</strong>: core UI rendered ✓</div>
        <div><strong>Shell</strong>: PWA (Vite)</div>
        <div><strong>Data</strong>: none installed yet</div>
      </section>
    </main>
  `;
}
