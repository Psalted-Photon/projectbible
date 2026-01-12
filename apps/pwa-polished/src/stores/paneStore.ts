import { create } from 'zustand';

export type PaneType = 'settings' | 'map' | 'packs' | 'search' | 'notes';

export interface PaneState {
  id: string;
  type: PaneType;
  position: 'left' | 'right' | 'bottom';
  width?: number; // percentage for left/right
  height?: number; // percentage for bottom
  zIndex: number;
  isOpen: boolean;
}

interface PaneStoreState {
  panes: PaneState[];
  openPane: (type: PaneType, position: 'left' | 'right' | 'bottom') => void;
  closePane: (id: string) => void;
  resizePane: (id: string, size: number) => void;
  closeAllPanes: () => void;
}

export const usePaneStore = create<PaneStoreState>((set) => ({
  panes: [],
  
  openPane: (type, position) => set((state) => {
    const existingPane = state.panes.find(p => p.type === type);
    if (existingPane) {
      return {
        panes: state.panes.map(p =>
          p.id === existingPane.id ? { ...p, isOpen: true } : p
        )
      };
    }
    
    const newPane: PaneState = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      width: position === 'left' || position === 'right' ? 40 : undefined,
      height: position === 'bottom' ? 50 : undefined,
      zIndex: Math.max(0, ...state.panes.map(p => p.zIndex)) + 1,
      isOpen: true
    };
    
    return { panes: [...state.panes, newPane] };
  }),
  
  closePane: (id) => set((state) => ({
    panes: state.panes.map(p =>
      p.id === id ? { ...p, isOpen: false } : p
    )
  })),
  
  resizePane: (id, size) => set((state) => ({
    panes: state.panes.map(p => {
      if (p.id !== id) return p;
      if (p.position === 'left' || p.position === 'right') {
        return { ...p, width: Math.max(20, Math.min(80, size)) };
      }
      return { ...p, height: Math.max(20, Math.min(80, size)) };
    })
  })),
  
  closeAllPanes: () => set((state) => ({
    panes: state.panes.map(p => ({ ...p, isOpen: false }))
  }))
}));
