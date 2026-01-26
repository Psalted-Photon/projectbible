import { writable, derived } from 'svelte/store';

export type PaneType = 'settings' | 'map' | 'packs' | 'search' | 'notes' | 'commentaries';

export interface PaneState {
  id: string;
  type: PaneType;
  position: 'left' | 'right' | 'bottom';
  width?: number; // percentage for left/right
  height?: number; // percentage for bottom
  zIndex: number;
  isOpen: boolean;
}

function createPaneStore() {
  const { subscribe, set, update } = writable<PaneState[]>([]);

  return {
    subscribe,
    
    openPane: (type: PaneType, position: 'left' | 'right' | 'bottom') => {
      update(panes => {
        const existingPane = panes.find(p => p.type === type);
        if (existingPane) {
          return panes.map(p =>
            p.id === existingPane.id ? { ...p, isOpen: true } : p
          );
        }
        
        const newPane: PaneState = {
          id: `${type}-${Date.now()}`,
          type,
          position,
          width: position === 'left' || position === 'right' ? 40 : undefined,
          height: position === 'bottom' ? 50 : undefined,
          zIndex: Math.max(0, ...panes.map(p => p.zIndex)) + 1,
          isOpen: true
        };
        
        return [...panes, newPane];
      });
    },
    
    closePane: (id: string) => {
      update(panes => 
        panes.map(p => p.id === id ? { ...p, isOpen: false } : p)
      );
    },
    
    resizePane: (id: string, size: number) => {
      update(panes => 
        panes.map(p => {
          if (p.id !== id) return p;
          if (p.position === 'left' || p.position === 'right') {
            return { ...p, width: Math.max(20, Math.min(80, size)) };
          }
          return { ...p, height: Math.max(20, Math.min(80, size)) };
        })
      );
    },
    
    closeAllPanes: () => {
      update(panes => panes.map(p => ({ ...p, isOpen: false })));
    }
  };
}

export const paneStore = createPaneStore();

