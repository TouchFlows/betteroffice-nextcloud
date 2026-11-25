import type { Pool } from 'mariadb';
import { Room } from './room.js';
import { RoomStore } from './store.js';

/**
 * Tracks in-memory `Room` instances by id. Room creation is async (it
 * rehydrates from MariaDB before any peer may join), so two near-simultaneous
 * first joiners for the same room must share one in-flight creation instead
 * of racing to create it twice -- `rooms` holds the `Promise<Room>` itself,
 * not just the resolved room, so a second caller awaits the same promise.
 */
export class RoomRegistry {
	private readonly rooms = new Map<string, Promise<Room>>();

	constructor(private readonly pool: Pool) {}

	async get(roomId: string): Promise<Room> {
		let roomPromise = this.rooms.get(roomId);
		if (!roomPromise) {
			roomPromise = Room.create(roomId, new RoomStore(this.pool, roomId));
			this.rooms.set(roomId, roomPromise);
			// Let a failed creation (e.g. a DB hiccup) be retried by the next joiner.
			roomPromise.catch(() => this.rooms.delete(roomId));
		}
		return roomPromise;
	}

	/**
	 * The room if it is live in this process, without creating one: presence
	 * must answer for a room nobody is connected to (an empty list) rather
	 * than instantiate it and rehydrate its whole update log.
	 */
	async peek(roomId: string): Promise<Room | null> {
		const roomPromise = this.rooms.get(roomId);
		if (!roomPromise) return null;
		try {
			return await roomPromise;
		} catch {
			return null;
		}
	}

	/** Drops a room that failed or emptied out, so the next join rehydrates fresh. */
	evict(roomId: string): void {
		this.rooms.delete(roomId);
	}

	get size(): number {
		return this.rooms.size;
	}
}
