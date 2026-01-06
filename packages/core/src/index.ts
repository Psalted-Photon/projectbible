export function renderApp(root: HTMLElement): void {
  root.innerHTML = `
    <main style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 16px; max-width: 900px; margin: 0 auto;">
      <h1 style="margin: 0 0 8px;">ProjectBible</h1>
      <p style="margin: 0 0 16px;">Scaffold running. Next: packs, reader, search.</p>
      <section style="display: grid; gap: 8px;">
        <div><strong>Status</strong>: core UI rendered</div>
        <div><strong>Shell</strong>: PWA (Vite)</div>
        <div><strong>Data</strong>: none installed yet</div>
      </section>
    </main>
  `;
}
