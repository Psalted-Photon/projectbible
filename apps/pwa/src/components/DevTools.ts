/**
 * DevTools - Workbench Pack Management UI
 * 
 * Simple, functional interface for managing packs between workbench and polished.
 * Not meant to be pretty - just functional for development.
 */

import { getDatabaseStats } from '../adapters/db-manager.js';

export interface PackInfo {
  name: string;
  path: string;
  size: number;
  location: 'workbench' | 'polished';
  installed: boolean;
}

export class DevTools {
  private container: HTMLElement;
  private workbenchPacks: PackInfo[] = [];
  private polishedPacks: PackInfo[] = [];

  constructor(parentElement: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'dev-tools';
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      max-height: 600px;
      overflow-y: auto;
      background: #2a2a2a;
      color: #fff;
      border: 2px solid #444;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 12px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;

    parentElement.appendChild(this.container);
    this.render();
    this.loadPacks();
  }

  private async loadPacks() {
    try {
      // Scan workbench directory
      this.workbenchPacks = await this.scanPackDirectory('workbench');
      
      // Scan polished directory
      this.polishedPacks = await this.scanPackDirectory('polished');
      
      this.render();
    } catch (error) {
      console.error('Error loading packs:', error);
    }
  }

  private async scanPackDirectory(location: 'workbench' | 'polished'): Promise<PackInfo[]> {
    const packs: PackInfo[] = [];
    
    try {
      // Try to fetch directory listing from server
      const response = await fetch(`/packs/${location}/`);
      if (!response.ok) {
        console.warn(`Could not scan ${location} directory`);
        return packs;
      }
      
      const html = await response.text();
      
      // Parse HTML to find .sqlite files (basic parsing)
      const sqlitePattern = /href="([^"]+\.sqlite)"/gi;
      let match;
      
      while ((match = sqlitePattern.exec(html)) !== null) {
        const filename = match[1];
        
        // Get file size by fetching HEAD
        try {
          const fileResponse = await fetch(`/packs/${location}/${filename}`, { method: 'HEAD' });
          const size = parseInt(fileResponse.headers.get('content-length') || '0');
          
          packs.push({
            name: filename,
            path: `/packs/${location}/${filename}`,
            size: size,
            location: location,
            installed: false // Will check against IndexedDB
          });
        } catch (e) {
          console.warn(`Could not get size for ${filename}`);
        }
      }
    } catch (error) {
      console.error(`Error scanning ${location}:`, error);
    }
    
    return packs;
  }

  private async copyToPolished(pack: PackInfo) {
    if (confirm(`Copy ${pack.name} from workbench to polished?\n\nThis will make it available for bundling in the next polished build.`)) {
      try {
        // Download the pack file
        const response = await fetch(pack.path);
        const blob = await response.blob();
        
        // Create a download link to save to polished folder
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = pack.name;
        a.click();
        URL.revokeObjectURL(url);
        
        alert(`Pack downloaded!\n\nManually move ${pack.name} to:\npacks/polished/\n\nThen rebuild polished.`);
      } catch (error) {
        alert(`Error copying pack: ${error}`);
      }
    }
  }

  private async copyToWorkbench(pack: PackInfo) {
    if (confirm(`Copy ${pack.name} from polished to workbench?\n\nThis will let you test modifications.`)) {
      try {
        // Download the pack file
        const response = await fetch(pack.path);
        const blob = await response.blob();
        
        // Create a download link to save to workbench folder
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = pack.name;
        a.click();
        URL.revokeObjectURL(url);
        
        alert(`Pack downloaded!\n\nManually move ${pack.name} to:\npacks/workbench/\n\nThen refresh this panel.`);
      } catch (error) {
        alert(`Error copying pack: ${error}`);
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  private async getDbStats() {
    try {
      const stats = await getDatabaseStats();
      const statsDiv = document.getElementById('db-stats');
      if (statsDiv) {
        statsDiv.innerHTML = `
          <strong>IndexedDB Stats:</strong><br>
          Total Size: ${this.formatBytes(stats.totalSize)}<br>
          Pack Count: ${stats.packCount}<br>
          Verse Count: ${stats.verseCount}
        `;
      }
    } catch (error) {
      console.error('Error getting DB stats:', error);
    }
  }

  private render() {
    this.container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #555; padding-bottom: 8px;">
        <h2 style="margin: 0; font-size: 16px; color: #ffa500;">🔧 Workbench DevTools</h2>
        <button id="refresh-packs" style="background: #444; color: #fff; border: 1px solid #666; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px;">
          Refresh
        </button>
      </div>
      
      <div id="db-stats" style="background: #1a1a1a; padding: 8px; border-radius: 4px; margin-bottom: 12px; font-size: 11px;">
        Loading stats...
      </div>

      <section style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; color: #4CAF50;">
          📦 Workbench Packs (Testing)
        </h3>
        <div style="background: #1a1a1a; padding: 8px; border-radius: 4px; max-height: 200px; overflow-y: auto;">
          ${this.workbenchPacks.length === 0 
            ? '<em style="color: #888;">No packs in /packs/workbench/</em>' 
            : this.workbenchPacks.map(pack => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #333;">
                  <div>
                    <div style="font-weight: bold;">${pack.name}</div>
                    <div style="font-size: 10px; color: #888;">${this.formatBytes(pack.size)}</div>
                  </div>
                  <button 
                    class="copy-to-polished" 
                    data-pack-name="${pack.name}"
                    style="background: #4CAF50; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px; font-size: 10px;">
                    ➡️ Polished
                  </button>
                </div>
              `).join('')
          }
        </div>
      </section>

      <section style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; color: #2196F3;">
          ✨ Polished Packs (Will be bundled)
        </h3>
        <div style="background: #1a1a1a; padding: 8px; border-radius: 4px; max-height: 200px; overflow-y: auto;">
          ${this.polishedPacks.length === 0 
            ? '<em style="color: #888;">No packs in /packs/polished/</em>' 
            : this.polishedPacks.map(pack => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #333;">
                  <div>
                    <div style="font-weight: bold; color: #2196F3;">✅ ${pack.name}</div>
                    <div style="font-size: 10px; color: #888;">${this.formatBytes(pack.size)}</div>
                  </div>
                  <button 
                    class="copy-to-workbench" 
                    data-pack-name="${pack.name}"
                    style="background: #666; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px; font-size: 10px;">
                    ⬅️ Test
                  </button>
                </div>
              `).join('')
          }
        </div>
      </section>

      <div style="background: #1a1a1a; padding: 8px; border-radius: 4px; font-size: 10px; color: #888;">
        <strong>How to use:</strong><br>
        1. Add .sqlite files to /packs/workbench/<br>
        2. Test features in workbench<br>
        3. Click "➡️ Polished" to promote<br>
        4. Run <code>npm run build:polished</code>
      </div>
    `;

    // Add event listeners
    const refreshBtn = this.container.querySelector('#refresh-packs');
    refreshBtn?.addEventListener('click', () => this.loadPacks());

    const copyToPolishedBtns = this.container.querySelectorAll('.copy-to-polished');
    copyToPolishedBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const packName = (e.target as HTMLElement).dataset.packName;
        const pack = this.workbenchPacks.find(p => p.name === packName);
        if (pack) this.copyToPolished(pack);
      });
    });

    const copyToWorkbenchBtns = this.container.querySelectorAll('.copy-to-workbench');
    copyToWorkbenchBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const packName = (e.target as HTMLElement).dataset.packName;
        const pack = this.polishedPacks.find(p => p.name === packName);
        if (pack) this.copyToWorkbench(pack);
      });
    });

    // Load DB stats
    this.getDbStats();
  }

  public toggle() {
    this.container.style.display = this.container.style.display === 'none' ? 'block' : 'none';
  }

  public show() {
    this.container.style.display = 'block';
  }

  public hide() {
    this.container.style.display = 'none';
  }
}
