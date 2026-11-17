export interface DebugCollabState {
  status: string;
  synced: boolean;
  peers: number;
}

export interface DebugHandle {
  ready: boolean;
  ref: unknown;
  collab: DebugCollabState;
}

declare global {
  interface Window {
    __bo?: DebugHandle;
  }
}

export function setDebugHandle(patch: Partial<DebugHandle>): void {
  window.__bo = {
    ready: false,
    ref: null,
    collab: { status: 'disconnected', synced: false, peers: 0 },
    ...window.__bo,
    ...patch,
  };
}
