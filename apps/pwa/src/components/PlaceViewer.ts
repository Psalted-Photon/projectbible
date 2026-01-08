/**
 * Place Viewer Component
 * 
 * Shows comprehensive information when clicking a place name in Bible text:
 * - Location on map
 * - Historical names in Hebrew/Greek
 * - What it looked like in different time periods
 * - All verses mentioning it
 * - Events and people associated with it
 * - Modern equivalent
 */

import type { PlaceInfo, PlaceAppearance, PlaceHistoricalName, BCV } from '@projectbible/core';

export interface PlaceViewerOptions {
  placeStore: any; // PlaceStore interface
  mapStore?: any; // MapStore interface (optional)
  onVerseClick?: (ref: BCV) => void;
  onClose?: () => void;
}

export class PlaceViewer {
  private container: HTMLElement;
  private options: PlaceViewerOptions;
  
  constructor(container: HTMLElement, options: PlaceViewerOptions) {
    this.container = container;
    this.options = options;
  }
  
  /**
   * Show place information for a clicked word
   */
  async showPlace(placeName: string, period?: string) {
    // Look up place by name
    const place = await this.options.placeStore.getPlaceByName(placeName, period);
    
    if (!place) {
      this.container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #999;">
          <p>Place "${placeName}" not found in database</p>
          <button onclick="this.closest('.place-viewer').remove()">Close</button>
        </div>
      `;
      return;
    }
    
    this.render(place, period);
  }
  
  /**
   * Show place information by ID
   */
  async showPlaceById(placeId: string, period?: string) {
    const place = await this.options.placeStore.getPlace(placeId);
    
    if (!place) {
      this.container.innerHTML = '<p>Place not found</p>';
      return;
    }
    
    this.render(place, period);
  }
  
  /**
   * Render the complete place viewer
   */
  private render(place: PlaceInfo, currentPeriod?: string) {
    const appearance = currentPeriod 
      ? place.appearances?.find(a => a.period === currentPeriod)
      : place.appearances?.[0];
    
    this.container.innerHTML = `
      <div class="place-viewer" style="
        max-width: 800px;
        margin: 20px auto;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        overflow: hidden;
      ">
        ${this.renderHeader(place)}
        ${this.renderMap(place)}
        ${this.renderHistoricalNames(place)}
        ${this.renderAppearances(place, appearance)}
        ${this.renderBiblicalContext(place)}
        ${this.renderModernInfo(place)}
      </div>
    `;
    
    // Add event listeners
    this.attachEventListeners(place);
  }
  
  private renderHeader(place: PlaceInfo): string {
    const typeIcon = this.getTypeIcon(place.type);
    
    return `
      <div style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 5px;">
              ${typeIcon} ${place.type || 'Place'}
            </div>
            <h1 style="margin: 0; font-size: 36px; font-weight: bold;">
              ${place.name}
            </h1>
            ${place.altNames && place.altNames.length > 0 ? `
              <div style="margin-top: 8px; opacity: 0.85; font-size: 14px;">
                Also known as: ${place.altNames.join(', ')}
              </div>
            ` : ''}
          </div>
          <button 
            class="close-btn"
            style="
              background: rgba(255,255,255,0.2);
              border: none;
              color: white;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              cursor: pointer;
              font-size: 20px;
              transition: background 0.2s;
            "
            onmouseover="this.style.background='rgba(255,255,255,0.3)'"
            onmouseout="this.style.background='rgba(255,255,255,0.2)'"
          >×</button>
        </div>
        
        ${place.significance ? `
          <div style="
            margin-top: 20px;
            padding: 15px;
            background: rgba(255,255,255,0.15);
            border-radius: 8px;
            font-size: 15px;
            line-height: 1.6;
          ">
            ${place.significance}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  private renderMap(place: PlaceInfo): string {
    if (!place.latitude || !place.longitude) {
      return '';
    }
    
    // For now, use a static map image
    // TODO: Integrate with MapStore for offline tiles
    const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v11/static/pin-s+ff0000(${place.longitude},${place.latitude})/${place.longitude},${place.latitude},10,0/600x300@2x?access_token=YOUR_TOKEN`;
    
    return `
      <div style="padding: 20px; border-bottom: 1px solid #eee;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px;">📍 Location</h2>
        <div style="background: #f5f5f5; border-radius: 8px; overflow: hidden;">
          <div style="height: 200px; background: #ddd; display: flex; align-items: center; justify-content: center; color: #666;">
            Map: ${place.latitude.toFixed(4)}°, ${place.longitude.toFixed(4)}°
            ${place.elevation ? `<br/>Elevation: ${place.elevation}m` : ''}
          </div>
          <div style="padding: 12px; background: white; font-size: 14px;">
            <a 
              href="https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}"
              target="_blank"
              style="color: #667eea; text-decoration: none; margin-right: 15px;"
            >
              📍 Open in Google Maps
            </a>
            <a 
              href="https://earth.google.com/web/@${place.latitude},${place.longitude},0a,5000d,35y,0h,45t,0r"
              target="_blank"
              style="color: #667eea; text-decoration: none;"
            >
              🌍 Open in Google Earth
            </a>
          </div>
        </div>
      </div>
    `;
  }
  
  private renderHistoricalNames(place: PlaceInfo): string {
    if (!place.historicalNames || place.historicalNames.length === 0) {
      return '';
    }
    
    const namesByLanguage = this.groupBy(place.historicalNames, 'language');
    
    return `
      <div style="padding: 20px; border-bottom: 1px solid #eee;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px;">📜 Historical Names</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
          ${Object.entries(namesByLanguage).map(([lang, names]) => `
            <div style="
              padding: 12px;
              background: #f8f9fa;
              border-radius: 6px;
              border-left: 3px solid #667eea;
            ">
              <div style="font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 5px;">
                ${lang}
              </div>
              ${names.map((n: PlaceHistoricalName) => `
                <div style="font-size: 16px; margin-bottom: 3px;">
                  ${n.name}
                  ${n.strongsId ? `<span style="font-size: 11px; color: #999;"> (${n.strongsId})</span>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  private renderAppearances(place: PlaceInfo, currentAppearance?: PlaceAppearance): string {
    if (!place.appearances || place.appearances.length === 0) {
      return '';
    }
    
    return `
      <div style="padding: 20px; border-bottom: 1px solid #eee;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px;">⏳ Through Time</h2>
        
        ${place.appearances.length > 1 ? `
          <div style="margin-bottom: 15px;">
            <select 
              class="period-selector"
              style="
                padding: 8px 12px;
                border: 2px solid #667eea;
                border-radius: 6px;
                font-size: 14px;
                cursor: pointer;
              "
            >
              ${place.appearances.map((a, i) => `
                <option value="${i}" ${currentAppearance === a ? 'selected' : ''}>
                  ${a.period}
                </option>
              `).join('')}
            </select>
          </div>
        ` : ''}
        
        ${this.renderAppearance(currentAppearance || place.appearances[0])}
      </div>
    `;
  }
  
  private renderAppearance(appearance: PlaceAppearance): string {
    return `
      <div class="appearance-content" style="
        padding: 20px;
        background: #f8f9fa;
        border-radius: 8px;
      ">
        <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #667eea;">
          ${appearance.period}
        </h3>
        <p style="line-height: 1.6; margin: 0 0 15px 0;">
          ${appearance.description}
        </p>
        
        ${appearance.population ? `
          <div style="font-size: 14px; color: #666; margin-bottom: 8px;">
            👥 Estimated population: ~${appearance.population.toLocaleString()}
          </div>
        ` : ''}
        
        ${appearance.significance ? `
          <div style="
            margin-top: 12px;
            padding: 12px;
            background: white;
            border-left: 3px solid #fbbf24;
            border-radius: 4px;
          ">
            <strong>Significance:</strong> ${appearance.significance}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  private renderBiblicalContext(place: PlaceInfo): string {
    return `
      <div style="padding: 20px; border-bottom: 1px solid #eee;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px;">📖 Biblical Context</h2>
        
        ${place.firstMention ? `
          <div style="margin-bottom: 15px; padding: 12px; background: #f0fdf4; border-radius: 6px;">
            <div style="font-size: 12px; color: #166534; margin-bottom: 4px;">FIRST MENTIONED</div>
            <a 
              class="verse-link"
              data-book="${place.firstMention.book}"
              data-chapter="${place.firstMention.chapter}"
              data-verse="${place.firstMention.verse}"
              style="color: #16a34a; text-decoration: none; font-weight: 500; cursor: pointer;"
            >
              ${place.firstMention.book} ${place.firstMention.chapter}:${place.firstMention.verse}
            </a>
          </div>
        ` : ''}
        
        ${place.events && place.events.length > 0 ? `
          <div style="margin-bottom: 15px;">
            <h3 style="font-size: 16px; margin: 0 0 10px 0;">Key Events</h3>
            <ul style="margin: 0; padding-left: 20px;">
              ${place.events.map(event => `
                <li style="margin-bottom: 6px; line-height: 1.5;">${event}</li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${place.people && place.people.length > 0 ? `
          <div>
            <h3 style="font-size: 16px; margin: 0 0 10px 0;">Associated People</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${place.people.map(person => `
                <span style="
                  padding: 6px 12px;
                  background: #e0e7ff;
                  color: #3730a3;
                  border-radius: 20px;
                  font-size: 14px;
                ">${person}</span>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${place.verses && place.verses.length > 0 ? `
          <div style="margin-top: 15px;">
            <details>
              <summary style="cursor: pointer; font-weight: 500; color: #667eea;">
                View all ${place.verses.length} references →
              </summary>
              <div style="margin-top: 10px; max-height: 200px; overflow-y: auto;">
                ${place.verses.slice(0, 20).map(v => `
                  <a 
                    class="verse-link"
                    data-book="${v.book}"
                    data-chapter="${v.chapter}"
                    data-verse="${v.verse}"
                    style="
                      display: inline-block;
                      padding: 4px 8px;
                      margin: 2px;
                      background: #f3f4f6;
                      color: #667eea;
                      text-decoration: none;
                      border-radius: 4px;
                      font-size: 13px;
                      cursor: pointer;
                    "
                  >
                    ${v.book} ${v.chapter}:${v.verse}
                  </a>
                `).join('')}
                ${place.verses.length > 20 ? `
                  <div style="margin-top: 8px; font-size: 13px; color: #666;">
                    + ${place.verses.length - 20} more references
                  </div>
                ` : ''}
              </div>
            </details>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  private renderModernInfo(place: PlaceInfo): string {
    if (!place.modernCity && !place.modernCountry) {
      return '';
    }
    
    return `
      <div style="padding: 20px;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px;">🌍 Today</h2>
        <div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
          ${place.modernCity ? `
            <div style="margin-bottom: 8px;">
              <strong>Modern city:</strong> ${place.modernCity}
            </div>
          ` : ''}
          ${place.modernCountry ? `
            <div style="margin-bottom: 8px;">
              <strong>Country:</strong> ${place.modernCountry}
            </div>
          ` : ''}
          ${place.region ? `
            <div>
              <strong>Biblical region:</strong> ${place.region}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
  
  private attachEventListeners(place: PlaceInfo) {
    // Close button
    const closeBtn = this.container.querySelector('.close-btn');
    closeBtn?.addEventListener('click', () => {
      if (this.options.onClose) {
        this.options.onClose();
      } else {
        this.container.innerHTML = '';
      }
    });
    
    // Verse links
    const verseLinks = this.container.querySelectorAll('.verse-link');
    verseLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        const ref: BCV = {
          book: target.dataset.book!,
          chapter: parseInt(target.dataset.chapter!),
          verse: parseInt(target.dataset.verse!)
        };
        
        if (this.options.onVerseClick) {
          this.options.onVerseClick(ref);
        }
      });
    });
    
    // Period selector
    const periodSelector = this.container.querySelector('.period-selector');
    if (periodSelector && place.appearances) {
      periodSelector.addEventListener('change', (e) => {
        const index = parseInt((e.target as HTMLSelectElement).value);
        const appearance = place.appearances![index];
        
        const contentArea = this.container.querySelector('.appearance-content');
        if (contentArea) {
          contentArea.outerHTML = this.renderAppearance(appearance);
        }
      });
    }
  }
  
  private getTypeIcon(type?: string): string {
    const icons: Record<string, string> = {
      'city': '🏛️',
      'mountain': '⛰️',
      'river': '🌊',
      'sea': '🌊',
      'wilderness': '🏜️',
      'region': '🗺️',
      'country': '🏴'
    };
    return icons[type || ''] || '📍';
  }
  
  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((result, item) => {
      const group = String(item[key]);
      if (!result[group]) {
        result[group] = [];
      }
      result[group].push(item);
      return result;
    }, {} as Record<string, T[]>);
  }
}
