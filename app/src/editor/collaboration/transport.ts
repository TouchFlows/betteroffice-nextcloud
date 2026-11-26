/**
 * BetterOffice's `CollaborationTransport` contract, declared here instead of
 * imported from one format's package. The contract is structurally identical
 * in `@betteroffice/docx`, `xlsx` and `pptx` (poc/RECONNAISSANCE.md §3), and
 * all three providers accept any object that satisfies it -- so the transport
 * belongs to none of them. `transportContract.ts` pins that: tsc fails naming
 * the format whose contract this document no longer satisfies.
 */
export type CollaborationTransportEvent =
	| { type: 'open' }
	| { type: 'message'; data: Uint8Array }
	| { type: 'close'; reason?: string }
	| { type: 'error'; error: unknown }
	| { type: 'drain' };

export interface CollaborationTransport {
	/** Starts one connection attempt; transports may also reopen while still subscribed. */
	connect(): void | Promise<void>;
	disconnect(): void | Promise<void>;
	/** Returns true only when the owned frame was accepted; false requires a later drain event. */
	send(data: Uint8Array): boolean;
	onEvent(listener: (event: CollaborationTransportEvent) => void): () => void;
}

/**
 * Implements that contract over a plain browser `WebSocket`:
 * connect/disconnect, binary send with backpressure, and an event stream of
 * open/message/close/error/drain.
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
 * A Yjs sync frame starts with the message type (0 = sync), then its sub-type
 * (2 = update). These mirror `relay/src/wsServer.ts`, which refuses an update
 * from a read-only token by closing the socket with 1008.
 */
const SYNC_MESSAGE_TYPE = 0;
const SYNC_SUBTYPE_UPDATE = 2;

/** True for a frame carrying this client's own document state. */
function isDocumentUpdate(frame: Uint8Array): boolean {
	return frame.length >= 2 && frame[0] === SYNC_MESSAGE_TYPE && frame[1] === SYNC_SUBTYPE_UPDATE;
}

export interface WsTransportOptions {
	/**
	 * Whether this session may publish document state at all: false for a
	 * session the server signed a read role into.
	 *
	 * The relay's rule is that a read-only token submits no editing update
	 * (`relay/src/wsServer.ts`: it closes the socket with 1008), and it already
	 * drops the SyncStep2 a read client answers the room's handshake with. But
	 * the spreadsheet provider also sends a whole-state *update* when it
	 * connects with an empty state vector, so a read-only viewer's socket was
	 * closed on open and reopened about once a second: it never stayed in the
	 * room long enough to be listed in presence, and its view only caught up
	 * between reconnects.
	 *
	 * Dropping that frame here keeps the relay's rule exactly as it is and the
	 * connection stable -- which is what the relay's own comment asks for ("a
	 * read-only participant still receives the document"). The editor behind
	 * such a session is read-only too, so there is no local edit to lose.
	 *
	 * Defaults to true: DOCX's provider sends no such frame from a viewer, and
	 * the relay's refusal of an *edit* from a writable editor must stay
	 * observable (`collaboration-roles.spec.ts` asserts the 1008).
	 */
	publishUpdates?: boolean;
}

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

	private readonly publishUpdates: boolean;

	constructor(
		private readonly resolveUrl: CollaborationUrlResolver,
		options: WsTransportOptions = {},
	) {
		this.publishUpdates = options.publishUpdates ?? true;
	}

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
		// Accepted, not sent: the relay would refuse this frame anyway, and
		// reporting backpressure instead would make the provider queue it and
		// retry forever.
		if (!this.publishUpdates && isDocumentUpdate(data)) return true;

		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) return false;
		if (socket.bufferedAmount > BACKPRESSURE_THRESHOLD_BYTES) {
			this.scheduleDrain(socket);
			return false;
		}
		// lib.dom types WebSocket.send as ArrayBufferView<ArrayBuffer>, so a
		// Uint8Array<ArrayBufferLike> is rejected even though browsers accept it.
		// Collaboration frames are always backed by a plain ArrayBuffer (they come
		// from encoding.toUint8Array), so narrow to say that at the DOM boundary.
		socket.send(data as Uint8Array<ArrayBuffer>);
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
