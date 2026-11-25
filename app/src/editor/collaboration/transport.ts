import type { CollaborationTransport, CollaborationTransportEvent } from '@betteroffice/docx/collaboration';

/**
 * Implements BetterOffice's `CollaborationTransport` contract over a plain
 * browser `WebSocket`: connect/disconnect, binary send with backpressure, and
 * an event stream of open/message/close/error/drain.
 *
 * Ported from the Phase 0 proof (`poc/shared/transport.ts`), which validated
 * this exact shape against the real editors -- with one deliberate change:
 * the URL is resolved per connection attempt instead of once. The
 * collaboration token it carries is short-lived (five minutes), so a
 * transport that latched its URL would reconnect with an expired token
 * forever; the resolver lets each attempt ask the app for a current one.
 */

/** bufferedAmount above this rejects send() until a drain is observed. */
const BACKPRESSURE_THRESHOLD_BYTES = 1_000_000;
const DRAIN_POLL_MS = 20;

/**
 * Called on every connection attempt, so it must return a *current* WebSocket
 * URL (fresh token), not a cached one.
 */
export type CollaborationUrlResolver = () => string | Promise<string>;

export class WsCollaborationTransport implements CollaborationTransport {
	private socket: WebSocket | null = null;
	private readonly listeners = new Set<(event: CollaborationTransportEvent) => void>();
	private draining = false;
	/** True while a URL is being resolved, so two attempts cannot open two sockets. */
	private connecting = false;
	/** Bumped by disconnect(), so an attempt that resolves afterwards does not open. */
	private generation = 0;

	constructor(private readonly resolveUrl: CollaborationUrlResolver) {}

	async connect(): Promise<void> {
		// The provider reconnects by calling connect() again after a close;
		// an already-open socket must not be replaced (that would leak the
		// live one and duplicate every frame).
		if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
		if (this.connecting) return;

		this.connecting = true;
		const generation = ++this.generation;
		let url: string;
		try {
			url = await this.resolveUrl();
		} catch (error) {
			this.connecting = false;
			if (generation !== this.generation) return;
			// No URL means no token (the session request failed). Report it
			// like a dropped connection rather than a rejected promise: the
			// provider treats 'close' as recoverable and the editor retries,
			// whereas a rejection would end the collaboration session.
			console.warn('[betteroffice] could not obtain a collaboration URL', error);
			this.emit({ type: 'close', reason: 'Collaboration session unavailable' });
			return;
		}
		this.connecting = false;
		if (generation !== this.generation) return;
		// A socket may have been opened while the URL was resolving.
		if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

		const socket = new WebSocket(url);
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
		this.generation += 1;
		this.connecting = false;
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
