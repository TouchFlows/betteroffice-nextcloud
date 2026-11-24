import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { WebSocket } from 'ws';
import type { RoomStore } from './store.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Checkpoint after this many accepted updates, mirroring the reference relay's compaction trigger. */
const CHECKPOINT_EVERY = 20;

/**
 * One collaboration room: a Yjs doc fed by whatever CRDT updates the
 * BetterOffice client replicas emit (the relay never needs to know DOCX/
 * XLSX/PPTX semantics, only the generic Yjs update wire format they share),
 * plus the peers connected to it and its MariaDB-backed persistence.
 *
 * Ported from the Phase 0 PoC (`poc/relay/room.ts`), with one structural
 * change: persistence is now a DB write, not a synchronous fs write, so an
 * update must be durably stored *before* it is broadcast to other peers
 * (PLAN.md §8.4: "acknowledge an update as durably accepted only after the
 * required persistence transaction succeeds") -- broadcasting first would
 * let a peer build on an update the relay itself doesn't durably have yet.
 * `persistQueue` chains each update's persist-then-broadcast step so
 * ordering survives the async gap even under back-to-back updates.
 */
export class Room {
	readonly doc = new Y.Doc();
	readonly awareness = new awarenessProtocol.Awareness(this.doc);
	private readonly peers = new Set<WebSocket>();
	private readonly controlledIds = new Map<WebSocket, Set<number>>();
	private updatesSinceCheckpoint = 0;
	private persistQueue: Promise<void> = Promise.resolve();
	private failed = false;

	private constructor(
		readonly id: string,
		private readonly store: RoomStore,
	) {
		this.doc.on('update', (update: Uint8Array, origin: unknown) => {
			this.persistQueue = this.persistQueue.then(() => this.persistAndBroadcast(update, origin as WebSocket | null));
		});

		this.awareness.on(
			'update',
			(
				{ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
				origin: WebSocket | null,
			) => {
				if (origin && this.peers.has(origin)) {
					let ids = this.controlledIds.get(origin);
					if (!ids) {
						ids = new Set();
						this.controlledIds.set(origin, ids);
					}
					for (const clientId of added) ids.add(clientId);
					for (const clientId of removed) ids.delete(clientId);
				}
				const changed = added.concat(updated, removed);
				const encoder = encoding.createEncoder();
				encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
				encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
				const frame = encoding.toUint8Array(encoder);
				for (const peer of this.peers) if (peer !== origin) this.sendIfOpen(peer, frame);
			},
		);
	}

	/** Creates the room and rehydrates it from durable storage before any peer joins. */
	static async create(id: string, store: RoomStore): Promise<Room> {
		await store.ensureRoom();
		const room = new Room(id, store);
		const frames = await store.readUpdates();
		for (const frame of frames) Y.applyUpdate(room.doc, frame);
		return room;
	}

	private async persistAndBroadcast(update: Uint8Array, origin: WebSocket | null): Promise<void> {
		try {
			await this.store.appendUpdate(update);
			this.updatesSinceCheckpoint += 1;
			if (this.updatesSinceCheckpoint >= CHECKPOINT_EVERY) await this.checkpoint();
			this.broadcastSyncUpdate(update, origin);
		} catch (error) {
			// PLAN.md §9.6: "if persistence cannot be confirmed, do not
			// acknowledge the update as safely stored" -- so it must not be
			// broadcast. The safest Phase 3 response is to stop trusting this
			// in-memory room at all: drop every connection so clients
			// reconnect and rehydrate from the last state actually durable in
			// MariaDB, rather than keep diverging from it silently. Graceful
			// retry/backoff is Phase 5/6 territory (reconnection hardening).
			this.failed = true;
			console.error(`[relay] room ${this.id}: failed to persist update, closing room`, error);
			for (const peer of this.peers) peer.close(1011, 'Room persistence failed');
		}
	}

	/** Merges the doc's full state into one checkpoint frame and replaces the log with it. */
	async checkpoint(): Promise<void> {
		await this.store.checkpoint(Y.encodeStateAsUpdate(this.doc));
		this.updatesSinceCheckpoint = 0;
	}

	join(socket: WebSocket): void {
		this.peers.add(socket);

		const syncEncoder = encoding.createEncoder();
		encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
		syncProtocol.writeSyncStep1(syncEncoder, this.doc);
		this.sendIfOpen(socket, encoding.toUint8Array(syncEncoder));

		const stateEncoder = encoding.createEncoder();
		encoding.writeVarUint(stateEncoder, MESSAGE_SYNC);
		syncProtocol.writeSyncStep2(stateEncoder, this.doc);
		this.sendIfOpen(socket, encoding.toUint8Array(stateEncoder));

		const states = this.awareness.getStates();
		if (states.size > 0) {
			const awarenessEncoder = encoding.createEncoder();
			encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
			encoding.writeVarUint8Array(
				awarenessEncoder,
				awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())),
			);
			this.sendIfOpen(socket, encoding.toUint8Array(awarenessEncoder));
		}
	}

	/** True once a persistence failure has closed this room; the registry must not reuse it. */
	get isFailed(): boolean {
		return this.failed;
	}

	receive(socket: WebSocket, message: Uint8Array): void {
		const decoder = decoding.createDecoder(message);
		const encoder = encoding.createEncoder();
		const messageType = decoding.readVarUint(decoder);

		switch (messageType) {
			case MESSAGE_SYNC: {
				encoding.writeVarUint(encoder, MESSAGE_SYNC);
				syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket);
				if (encoding.length(encoder) > 1) this.sendIfOpen(socket, encoding.toUint8Array(encoder));
				break;
			}
			case MESSAGE_AWARENESS: {
				const update = decoding.readVarUint8Array(decoder);
				awarenessProtocol.applyAwarenessUpdate(this.awareness, update, socket);
				break;
			}
			default:
				// Frame type the relay does not model (e.g. a host-specific extension).
				// Forward it untouched instead of dropping it, but never retain it.
				for (const peer of this.peers) if (peer !== socket) this.sendIfOpen(peer, message);
		}
	}

	leave(socket: WebSocket): void {
		this.peers.delete(socket);
		const ids = this.controlledIds.get(socket);
		this.controlledIds.delete(socket);
		if (ids && ids.size > 0) {
			awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ids), null);
		}
	}

	get peerCount(): number {
		return this.peers.size;
	}

	/** True once every connected peer has left -- the registry can safely evict it. */
	get isEmpty(): boolean {
		return this.peers.size === 0;
	}

	/** Stops the awareness protocol's internal stale-client timer. Call once this room is evicted. */
	destroy(): void {
		this.awareness.destroy();
	}

	private broadcastSyncUpdate(update: Uint8Array, origin: WebSocket | null): void {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, MESSAGE_SYNC);
		syncProtocol.writeUpdate(encoder, update);
		const frame = encoding.toUint8Array(encoder);
		for (const peer of this.peers) if (peer !== origin) this.sendIfOpen(peer, frame);
	}

	private sendIfOpen(socket: WebSocket, data: Uint8Array): void {
		if (socket.readyState !== socket.OPEN) return;
		socket.send(data);
	}
}
