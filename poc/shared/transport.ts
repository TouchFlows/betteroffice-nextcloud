/**
 * Implements BetterOffice's `CollaborationTransport` contract
 * (`@betteroffice/docx/collaboration`, shared structurally by the xlsx/pptx
 * packages): connect/disconnect, binary send with backpressure, and an
 * event stream of open/message/close/error/drain.
 */
export type CollaborationTransportEvent =
  | { type: 'open' }
  | { type: 'message'; data: Uint8Array }
  | { type: 'close'; reason?: string }
  | { type: 'error'; error: unknown }
  | { type: 'drain' };

export interface CollaborationTransport {
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  send(data: Uint8Array): boolean;
  onEvent(listener: (event: CollaborationTransportEvent) => void): () => void;
}

/** bufferedAmount above this rejects send() until a drain is observed. */
const BACKPRESSURE_THRESHOLD_BYTES = 1_000_000;
const DRAIN_POLL_MS = 20;

export class WsCollaborationTransport implements CollaborationTransport {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<(event: CollaborationTransportEvent) => void>();
  private draining = false;

  constructor(private readonly url: string) {}

  connect(): void {
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.addEventListener('open', () => this.emit({ type: 'open' }));
    socket.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      this.emit({ type: 'message', data: new Uint8Array(event.data) });
    });
    socket.addEventListener('close', (event) => this.emit({ type: 'close', reason: event.reason }));
    socket.addEventListener('error', (event) => this.emit({ type: 'error', error: event }));
  }

  disconnect(): void {
    this.socket?.close(1000, 'client disconnect');
    this.socket = null;
  }

  send(data: Uint8Array): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > BACKPRESSURE_THRESHOLD_BYTES) {
      this.scheduleDrain(socket);
      return false;
    }
    socket.send(data);
    return true;
  }

  onEvent(listener: (event: CollaborationTransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleDrain(socket: WebSocket): void {
    if (this.draining) return;
    this.draining = true;
    const poll = () => {
      if (socket !== this.socket) {
        this.draining = false;
        return;
      }
      if (socket.bufferedAmount <= BACKPRESSURE_THRESHOLD_BYTES) {
        this.draining = false;
        this.emit({ type: 'drain' });
        return;
      }
      setTimeout(poll, DRAIN_POLL_MS);
    };
    setTimeout(poll, DRAIN_POLL_MS);
  }

  private emit(event: CollaborationTransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
