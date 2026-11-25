import type { CollaborationTransport, CollaborationTransportEvent } from '@betteroffice/docx/collaboration';

/**
 * Implements BetterOffice's `CollaborationTransport` contract over a plain
 * browser `WebSocket`: connect/disconnect, binary send with backpressure, and
 * an event stream of open/message/close/error/drain.
 *
 * Ported from the Phase 0 proof (`poc/shared/transport.ts`), which validated
 * this exact shape against the real editors -- only the type import changed
 * (the package's own types, instead of a structurally identical local copy,
 * so a mismatch is a compile error rather than a silent runtime one).
 */

/** bufferedAmount above this rejects send() until a drain is observed. */
const BACKPRESSURE_THRESHOLD_BYTES = 1_000_000;
const DRAIN_POLL_MS = 20;

export class WsCollaborationTransport implements CollaborationTransport {
	private socket: WebSocket | null = null;
	private readonly listeners = new Set<(event: CollaborationTransportEvent) => void>();
	private draining = false;

	constructor(private readonly url: string) {}

	connect(): void {
		// The provider reconnects by calling connect() again after a close;
		// an already-open socket must not be replaced (that would leak the
		// live one and duplicate every frame).
		if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

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
